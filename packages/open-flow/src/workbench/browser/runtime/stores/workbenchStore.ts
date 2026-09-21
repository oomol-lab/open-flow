import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { GraphTarget } from '../../../../flow/common/change.ts'
import type { ConnectorConnection, WorkbenchClient, Draft, FlowCheck, Run, RunEvent } from '../api.ts'
import type { Point } from '../canvasPresentation.ts'
import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { FlowChangeEvent, WorkbenchHost, WorkbenchPreferences } from '../contract.ts'
import type { AddNodeOption } from '../editor/addNodeOptions.ts'
import type { DiagnosticItem } from '../editor/diagnostics.ts'
import type { DesignerEdge, DesignerNode, DesignerGraph } from '../workspace.ts'
import type { Notice } from './workbenchNotice.ts'
import type { WorkspaceBusy } from './workspaceModel.ts'

import { dequal } from 'dequal'
import { compute, derive, val } from 'value-enhancer'
import { randomId } from '../../../../control/common/random.ts'
import { createAuthoringId } from '../../../../flow/common/authoring.ts'
import { targetPresentation } from '../canvasPresentation.ts'
import { diagnosticItems } from '../editor/diagnostics.ts'
import { createI18n } from '../i18n.ts'
import { PublicationStore } from '../publications/publicationStore.ts'
import { revisionView } from '../revisionView.ts'
import { RunRequestStore } from '../runs/runRequestStore.ts'
import { RunStore } from '../runs/runStore.ts'
import { designerGraph } from '../workspace.ts'
import { CatalogStores } from './catalogStores.ts'
import { ConnectorAccessStore } from './connectorAccessStore.ts'
import { ConnectorStore } from './connectorStore.ts'
import { Latest } from './latest.ts'
import { combineSources } from './optionSource.ts'
import { resourceData } from './resource.ts'
import { TriggerStore } from './triggerStore.ts'
import { errorNotice } from './workbenchNotice.ts'
import { WorkspaceStore } from './workspaceStore.ts'

export type Busy = WorkspaceBusy | 'cancel' | 'publish' | 'rollback' | 'run' | 'trigger'

export interface Workbench$ {
  readonly busy: ReadonlyVal<Busy | undefined>
  readonly diagnosticItems: ReadonlyVal<readonly DiagnosticItem[]>
  readonly diagnostics: ReadonlyVal<FlowCheck | undefined>
  readonly designer: ReadonlyVal<DesignerGraph>
  readonly designerNodeById: ReadonlyVal<ReadonlyMap<string, DesignerNode>>
  readonly notice: ReadonlyVal<Notice | undefined>
  readonly runEventNodes: ReadonlyVal<ReadonlyMap<number, string>>
  readonly sourceNodeIcons: ReadonlyVal<Readonly<Record<string, string | undefined>>>
  readonly selectedDesignerNode: ReadonlyVal<DesignerNode | undefined>
  readonly variableNames: ReadonlyVal<readonly string[]>
  readonly variableNamesLoaded: ReadonlyVal<boolean>
  readonly variableNamesLoading: ReadonlyVal<boolean>
}

function indexNodes(designer: DesignerGraph): ReadonlyMap<string, DesignerNode> {
  return new Map(designer.nodes.map((node) => [node.id, node]))
}

function designerRevisionInputs(draft: Draft | undefined, target: GraphTarget | undefined): readonly unknown[] {
  return draft == null || target == null ? [] : revisionView(draft).designerInputs(target)
}

function indexRunEventNodes(
  draft: Draft | undefined,
  target: GraphTarget | undefined,
  run: Run | undefined,
  events: readonly RunEvent[],
  nodes: ReadonlyMap<string, DesignerNode>,
): ReadonlyMap<number, string> {
  if (draft == null || target?.kind != 'flow' || run?.revisionId != draft.revisionId || run.flowId != draft.flowId) return new Map()
  const scopeId = events.find((event) => event.kind == 'run.started' && event.payload.flowId == draft.flowId)?.payload.scopeId
  if (typeof scopeId != 'string') return new Map()
  return new Map(
    events.flatMap((event) => {
      const nodeId = event.payload.nodeId
      return event.payload.scopeId == scopeId && event.payload.flowId == draft.flowId && typeof nodeId == 'string' && nodes.has(nodeId)
        ? [[event.sequence, nodeId] as const]
        : []
    }),
  )
}

const blockedExternalPages: Pick<WorkbenchHost, 'openExternalPage'> = {
  openExternalPage: async () => false,
}

export class WorkbenchStore {
  readonly results: Pick<WorkbenchClient, 'listRunResults' | 'readRunResult' | 'downloadRunResult'>
  readonly #client: WorkbenchClient
  readonly #externalRuns = new Latest()
  readonly #i18n: I18n
  readonly #notice: Val<Notice | undefined> = val()
  public get variablesEnabled(): boolean {
    return this.#variables
  }

  readonly #variables: boolean
  readonly #variableNames = val<readonly string[]>([])
  readonly #variableNamesLoaded = val(false)
  readonly #variableNamesLoading = val(false)
  #variableNamesStale = true
  #variableRequest: Promise<void> | undefined
  #disposed = false
  #openingCreatedFlow = false
  readonly #stopAccessReaction: () => void
  #accessLoading: Promise<void> = Promise.resolve()

  public readonly preferences: WorkbenchPreferences
  public readonly $: Workbench$
  public readonly connectors: ConnectorStore
  public readonly connectorAccess: ConnectorAccessStore
  public readonly publications: PublicationStore
  public readonly runRequests: RunRequestStore
  public readonly runs: RunStore
  public readonly triggers: TriggerStore
  public readonly workspace: WorkspaceStore

  public constructor(
    client: WorkbenchClient,
    preferences: WorkbenchPreferences,
    identity: () => string = randomId,
    i18n: I18n = createI18n(),
    host: Pick<WorkbenchHost, 'openExternalPage' | 'connectorCache' | 'triggerCatalogCache'> = blockedExternalPages,
    variables = true,
  ) {
    this.preferences = preferences
    this.#client = client
    this.results = client
    this.#i18n = i18n
    this.#variables = variables
    const setNotice = (notice: Notice): void => {
      if (!this.#disposed) this.#notice.set(notice)
    }
    this.connectorAccess = new ConnectorAccessStore(client, setNotice, i18n)
    this.runs = new RunStore(client, setNotice, i18n)
    this.workspace = new WorkspaceStore(
      client,
      setNotice,
      createAuthoringId,
      i18n,
      (event) => {
        if (event.kind == 'run.created') void this.#followExternalRun(client, event)
        else this.runs.changed(event.runId)
      },
      new CatalogStores(client, host.connectorCache),
      (flowId) => void this.#openCreatedFlow(flowId),
      (flowId) => {
        this.connectorAccess.changed(flowId)
        this.workspace.catalogs.refreshFlow(flowId)
      },
    )
    this.#stopAccessReaction = this.workspace.$.flowId.reaction((flowId) => {
      this.#accessLoading = this.connectorAccess.load(flowId)
    })
    this.connectors = new ConnectorStore(client, this.workspace, setNotice, host, i18n)
    this.triggers = new TriggerStore(client, this.workspace, setNotice, host, i18n)
    this.publications = new PublicationStore(client, this.workspace, setNotice, preferences, identity, i18n)
    this.runRequests = new RunRequestStore(
      client,
      this.runs,
      setNotice,
      async (flowId) => {
        if (flowId != this.workspace.$.flowId.value || !(await this.workspace.saveModuleEditor()) || this.#disposed || flowId != this.workspace.$.flowId.value)
          return
        return this.workspace.$.draft.value?.revisionId
      },
      i18n,
      identity,
    )
    const diagnostics = compute<FlowCheck | undefined>((get) => {
      const check = get(this.workspace.$.diagnostics)
      if (check == null) return
      const connectorDiagnostics = get(this.connectors.$.diagnostics)
      if (connectorDiagnostics.length == 0) return check
      return { ...check, diagnostics: [...check.diagnostics, ...connectorDiagnostics], valid: false }
    })
    const designerCache = new Map<string, { readonly graph: DesignerGraph; readonly inputs: readonly unknown[] }>()
    let designerFlowId: string | undefined
    const designer = compute((get) => {
      const draft = get(this.workspace.$.draft)
      if (designerFlowId != draft?.flowId) {
        designerCache.clear()
        designerFlowId = draft?.flowId
      }
      const target = get(this.workspace.$.target)
      const presentation = get(this.workspace.$.presentation)?.value
      const designerDiagnostics = get(diagnostics)?.diagnostics ?? get(this.connectors.$.diagnostics)
      const providerEntries = draft == null ? undefined : get(resourceData(this.workspace.catalogs.providers.get(draft.flowId, i18n.lang)))
      const providerCatalog = Object.fromEntries((providerEntries ?? []).map((provider) => [provider.serviceId, provider]))
      const actions = get(this.connectors.$.actions)
      const catalogs = get(this.connectors.$.catalogs)
      const t = get(i18n.t$)
      const run = get(this.runs.$.run)
      const events = get(this.runs.$.events)
      const key = target == null ? '' : target.kind == 'flow' ? 'flow' : `subflow:${target.id}`
      const inputs = [
        ...designerRevisionInputs(draft, target),
        presentation == null || target == null ? undefined : targetPresentation(presentation, target),
        designerDiagnostics,
        actions,
        providerEntries,
        catalogs,
        t,
        run,
        events,
        ...(run == null ? [] : [draft?.revisionId]),
      ]
      const cached = designerCache.get(key)
      if (cached != null && cached.inputs.length == inputs.length && cached.inputs.every((input, index) => input === inputs[index])) return cached.graph
      const graph = designerGraph(draft, target, presentation, designerDiagnostics, actions, catalogs, t, run, events, providerCatalog)
      designerCache.set(key, { graph, inputs })
      return graph
    })
    const designerNodeById = derive(designer, indexNodes)
    this.$ = {
      busy: compute((get) => {
        const workspaceBusy = get(this.workspace.$.busy)
        if (workspaceBusy != null) return workspaceBusy
        if (get(this.runRequests.$.starting)) return 'run'
        if (get(this.runs.$.cancelingRunId) != null) return 'cancel'
        if (get(this.publications.$.publishing)) return 'publish'
        if (get(this.publications.$.rollingBackPublicationId) != null) return 'rollback'
        if (get(this.publications.$.changingTriggerId) != null) return 'trigger'
      }),
      diagnosticItems: compute((get) => diagnosticItems(get(this.workspace.$.revision), get(this.workspace.$.target), get(diagnostics))),
      diagnostics,
      designer,
      designerNodeById,
      sourceNodeIcons: derive(designer, (graph) => Object.fromEntries(graph.nodes.flatMap((node) => ('icon' in node ? [[node.id, node.icon] as const] : []))), {
        equal: dequal,
      }),
      notice: this.#notice,
      runEventNodes: compute((get) =>
        indexRunEventNodes(get(this.workspace.$.draft), get(this.workspace.$.target), get(this.runs.$.run), get(this.runs.$.events), get(designerNodeById)),
      ),
      selectedDesignerNode: compute((get) => {
        const selected = get(this.workspace.$.selectedNodeIds)
        return selected.length == 1 ? get(designerNodeById).get(selected[0]!) : undefined
      }),
      variableNames: this.#variableNames,
      variableNamesLoaded: this.#variableNamesLoaded,
      variableNamesLoading: this.#variableNamesLoading,
    }
  }

  public dispose(): void {
    this.#disposed = true
    this.#stopAccessReaction()
    this.#externalRuns.invalidate()
    for (const value of Object.values(this.$)) value.dispose()
    this.connectors.dispose()
    this.connectorAccess.dispose()
    this.publications.dispose()
    this.runRequests.dispose()
    this.runs.dispose()
    this.triggers.dispose()
    this.workspace.dispose()
    this.#variableNames.dispose()
    this.#variableNamesLoaded.dispose()
    this.#variableNamesLoading.dispose()
  }

  public async start(flowId?: string): Promise<void> {
    this.#externalRuns.invalidate()
    this.connectors.reset()
    this.triggers.reset()
    this.publications.reset()
    this.runRequests.reset()
    this.runs.reset()
    await this.workspace.start(flowId)
    await this.#accessLoading
  }

  public async retryFlows(): Promise<void> {
    await this.workspace.reloadFlows()
  }

  public dismissNotice(): void {
    if (!this.#disposed) this.#notice.set(undefined)
  }

  public invalidateVariableNames(): void {
    this.#variableNamesStale = true
  }

  public async refreshVariableNames(): Promise<void> {
    if (this.#disposed || !this.#variables) return
    if (this.#variableRequest != null) return this.#variableRequest
    if (!this.#variableNamesStale) return
    this.#variableNamesStale = false
    this.#variableNamesLoading.set(true)
    this.#variableRequest = (async () => {
      try {
        const { variables } = await this.#client.listVariables()
        if (this.#disposed) return
        this.#variableNames.set(variables.map((variable) => variable.name))
        this.#variableNamesLoaded.set(true)
      } catch (error) {
        this.#variableNamesStale = true
        if (!this.#disposed) this.#notice.set(errorNotice(error, this.#i18n.t))
      } finally {
        this.#variableRequest = undefined
        if (!this.#disposed) this.#variableNamesLoading.set(false)
      }
    })()
    return this.#variableRequest
  }

  public async selectFlow(flowId: string | undefined): Promise<boolean> {
    if (this.#disposed) return false
    this.#externalRuns.invalidate()
    const previousFlowId = this.workspace.$.flowId.value
    const previousNotice = this.#notice.value
    if (!(await this.workspace.selectFlow(flowId))) return false
    if (this.#disposed) return false
    // Clear the previous Flow's notices only after navigation succeeds, preserving new feedback.
    if (flowId != previousFlowId && this.#notice.value === previousNotice) this.#notice.set(undefined)
    this.connectors.reset()
    this.triggers.reset()
    this.publications.reset()
    this.runRequests.reset()
    this.runs.reset()
    await this.#accessLoading
    return true
  }

  async #openCreatedFlow(flowId: string): Promise<void> {
    if (this.#disposed || this.#openingCreatedFlow || this.workspace.$.flowId.value != null) return
    this.#openingCreatedFlow = true
    try {
      await this.selectFlow(flowId)
    } finally {
      this.#openingCreatedFlow = false
    }
  }

  public async createFlow(name: string, create?: (name: string) => Promise<string>): Promise<boolean> {
    const flow = await this.workspace.createFlow(name, create)
    if (this.#disposed || flow == null) return false
    await this.selectFlow(flow.flowId)
    if (!this.#disposed) this.#notice.set({ kind: 'success', message: this.#i18n.t('notice.created', { name: flow.name }) })
    return true
  }

  public selectNodes(nodeIds: readonly string[]): void {
    const previous = this.workspace.$.selectedNodeIds.value
    if (this.workspace.selectNodes(nodeIds)) {
      if (previous === this.workspace.$.selectedNodeIds.value) return
      void this.connectors.refresh()
      void this.triggers.refresh()
    }
  }

  public locateRunEvent(sequence: number): boolean {
    const nodeId = this.$.runEventNodes.value.get(sequence)
    return nodeId != null && this.workspace.locateNode(nodeId)
  }

  public locateRunWait(nodeId: string): boolean {
    const run = this.runs.$.run.value
    if (run == null || !('waits' in run) || !run.waits.some((wait) => wait.nodeId == nodeId)) return false
    return this.workspace.locateNode(nodeId)
  }

  public async addNode(option: AddNodeOption, position: Point, connection?: (nodeId: string) => Omit<DesignerEdge, 'id'>): Promise<string | undefined> {
    try {
      if (option.kind == 'trigger' && 'trigger' in option && option.trigger.kind == 'connect') {
        await this.triggers.connect(option.trigger.provider)
        return
      }
      if (option.kind == 'connector') {
        const prepared = await this.prepareConnectorAction(option.connector)
        if (prepared == null) return
        option = { ...option, connector: prepared.action }
      }
      const nodeId = await this.workspace.addNode(option, position, connection)
      if (nodeId != null && option.kind == 'connector') void this.connectors.refresh()
      if (nodeId != null && option.kind == 'trigger') void this.triggers.refresh()
      return nodeId
    } catch (error) {
      if (!this.#disposed) this.#notice.set(errorNotice(error, this.#i18n.t))
      return undefined
    }
  }

  public async prepareConnectorAction(
    action: ConnectorActionView,
  ): Promise<{ readonly action: ConnectorActionView; readonly connections: readonly ConnectorConnection[] } | undefined> {
    const flowId = this.workspace.$.flowId.value
    if (flowId == null) return
    const { defaultConnection: _defaultConnection, ...metadata } = action
    const unconfigured = { action: metadata, connections: [] }
    if (!action.authenticated) {
      const prepared = await this.connectors.resolveAction(action.actionId)
      return this.#disposed || flowId != this.workspace.$.flowId.value ? undefined : prepared
    }
    if (this.connectorAccess.$.value.access == null) await this.connectorAccess.load(flowId)
    if (this.#disposed || flowId != this.workspace.$.flowId.value) return
    let access = this.connectorAccess.$.value.access
    if (access == null) return unconfigured
    let actionAccessAllowed: boolean | undefined
    if (access?.mode == 'selectable') {
      if (this.connectorAccess.$.value.candidates[action.serviceId] == null) await this.connectorAccess.loadCandidates(action.serviceId)
      if (this.#disposed || flowId != this.workspace.$.flowId.value) return
      const candidates = this.connectorAccess.$.value.candidates[action.serviceId]?.candidates.filter(
        (candidate) => candidate.permissions == null || candidate.permissions.allActions || candidate.permissions.actionIds.includes(action.actionId),
      )
      if (candidates == null) {
        return unconfigured
      }
      const activeBindingIds = new Set(
        access.bindings.filter((binding) => binding.providerId == action.serviceId && binding.status == 'active').map((binding) => binding.accessBindingId),
      )
      if (candidates != null && !candidates.some((candidate) => activeBindingIds.has(candidate.accessBindingId))) {
        const candidate = candidates.find((item) => item.isDefault) ?? (candidates.length == 1 ? candidates[0] : undefined)
        if (candidate != null) {
          if (!(await this.connectorAccess.select(action.serviceId, candidate.accessBindingId))) {
            return this.#disposed || flowId != this.workspace.$.flowId.value ? undefined : unconfigured
          }
          access = this.connectorAccess.$.value.access
        }
      }
      actionAccessAllowed = candidates?.some((candidate) =>
        access?.bindings.some((binding) => binding.accessBindingId == candidate.accessBindingId && binding.status == 'active'),
      )
    }
    if (this.#disposed || flowId != this.workspace.$.flowId.value) return
    const hasActiveBinding = access?.bindings.some((binding) => binding.providerId == action.serviceId && binding.status == 'active') ?? false
    if (access?.mode != 'implicit' && !(actionAccessAllowed ?? hasActiveBinding)) {
      return unconfigured
    }
    this.workspace.catalogs.refreshFlow(flowId)
    const prepared = await this.connectors.resolveAction(action.actionId)
    if (this.#disposed || flowId != this.workspace.$.flowId.value) return
    if (prepared.action.serviceId != action.serviceId) throw new Error('Connector Action Provider changed while access was being configured.')
    return prepared
  }

  public readonly retryCatalog = (): void => {
    this.connectors.retryCatalog()
    this.triggers.catalog.retry()
  }

  public readonly provideAddNodeOptions = (searchTerm: string, signal: AbortSignal, sessionSignal = signal) =>
    combineSources(signal, [this.triggers.provideAddNodeOptions(searchTerm, signal), this.connectors.provideAddNodeOptions(searchTerm, signal, sessionSignal)])

  public readonly browseAddNodeOptions = (signal: AbortSignal) =>
    combineSources(signal, [this.triggers.browseAddNodeOptions(signal), this.connectors.browseAddNodeOptions(signal)])

  public readonly provideAddNodeOptionChoices = (optionId: string, signal: AbortSignal) => this.connectors.provideAddNodeOptionChoices(optionId, signal)

  public async refreshSelectedConnector(force = false): Promise<void> {
    await this.connectors.refresh(force)
  }

  public async requestDraftRun(triggerId?: string) {
    const flowId = this.workspace.$.flowId.value
    if (!(await this.workspace.saveDraft()) || this.#disposed || flowId != this.workspace.$.flowId.value) return 'unavailable' as const
    const flow = this.workspace.$.targetFlow.value
    const draft = this.workspace.$.draft.value
    if (flow == null || draft == null) return 'unavailable' as const
    return await this.runRequests.requestDraft(flow, draft, triggerId)
  }

  public async editDraftRunInputs(triggerId: string) {
    const flowId = this.workspace.$.flowId.value
    if (!(await this.workspace.saveDraft()) || this.#disposed || flowId != this.workspace.$.flowId.value) return 'unavailable' as const
    const flow = this.workspace.$.targetFlow.value
    const draft = this.workspace.$.draft.value
    if (flow == null || draft == null) return 'unavailable' as const
    return await this.runRequests.editDraft(flow, draft, triggerId)
  }

  public async requestLiveRun() {
    const flow = this.workspace.$.targetFlow.value
    if (flow == null) return 'unavailable' as const
    return await this.runRequests.requestLive(flow)
  }

  async #followExternalRun(client: Pick<WorkbenchClient, 'getRun'>, event: Extract<FlowChangeEvent, { readonly kind: 'run.created' }>): Promise<void> {
    const target = this.workspace.$.target.value
    if (this.#disposed || this.runRequests.$.submitting.value != null || target?.kind != 'flow' || this.workspace.$.flowId.value != event.flowId) {
      return
    }
    const current = this.#externalRuns.begin()
    try {
      const run = await client.getRun(event.runId)
      const latestTarget = this.workspace.$.target.value
      if (
        !current() ||
        this.#disposed ||
        latestTarget?.kind != 'flow' ||
        this.workspace.$.flowId.value != event.flowId ||
        run.flowId != event.flowId ||
        run.runId != event.runId
      ) {
        return
      }
      this.runs.followExternal(run)
    } catch {
      return
    }
  }
}
