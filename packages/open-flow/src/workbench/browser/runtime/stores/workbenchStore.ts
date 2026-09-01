import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { WorkbenchClient, Draft, FlowCheck, Run, RunEvent } from '../api.ts'
import type { FlowChangeEvent, WorkbenchHost, WorkbenchPreferences } from '../contract.ts'
import type { AddNodeOption } from '../designer/addNodeOptions.ts'
import type { DiagnosticItem } from '../designer/diagnostics.ts'
import type { DesignerTarget } from '../designer/flowChanges.ts'
import type { DesignerEdge, DesignerNode, DesignerGraph, Point } from '../workspace.ts'
import type { Notice } from './workbenchNotice.ts'
import type { WorkspaceBusy } from './workspaceModel.ts'

import { compute, derive, val } from 'value-enhancer'
import { createAuthoringId } from '../../../../flow/common/authoring.ts'
import { diagnosticItems } from '../designer/diagnostics.ts'
import { createI18n } from '../i18n.ts'
import { PublicationStore } from '../publications/publicationStore.ts'
import { revisionView } from '../revisionView.ts'
import { RunRequestStore } from '../runs/runRequestStore.ts'
import { RunStore } from '../runs/runStore.ts'
import { designerGraph, targetPresentation } from '../workspace.ts'
import { ConnectorStore } from './connectorStore.ts'
import { Latest } from './latest.ts'
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
  readonly selectedDesignerNode: ReadonlyVal<DesignerNode | undefined>
  readonly variableNames: ReadonlyVal<readonly string[]>
  readonly variableNamesLoaded: ReadonlyVal<boolean>
  readonly variableNamesLoading: ReadonlyVal<boolean>
}

function indexNodes(designer: DesignerGraph): ReadonlyMap<string, DesignerNode> {
  return new Map(designer.nodes.map((node) => [node.id, node]))
}

function designerRevisionInputs(draft: Draft | undefined, target: DesignerTarget | undefined): readonly unknown[] {
  return draft == null || target == null ? [] : revisionView(draft).designerInputs(target)
}

function indexRunEventNodes(
  draft: Draft | undefined,
  target: DesignerTarget | undefined,
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
  readonly #client: WorkbenchClient
  readonly #externalRuns = new Latest()
  readonly #i18n: I18n
  readonly #notice: Val<Notice | undefined> = val()
  readonly #variables: boolean
  readonly #variableNames = val<readonly string[]>([])
  readonly #variableNamesLoaded = val(false)
  readonly #variableNamesLoading = val(false)
  readonly #variableRefresh = new Latest()
  #disposed = false

  public readonly $: Workbench$
  public readonly connectors: ConnectorStore
  public readonly publications: PublicationStore
  public readonly runRequests: RunRequestStore
  public readonly runs: RunStore
  public readonly triggers: TriggerStore
  public readonly workspace: WorkspaceStore

  public constructor(
    client: WorkbenchClient,
    preferences: WorkbenchPreferences,
    identity: () => string = () => crypto.randomUUID(),
    i18n: I18n = createI18n(),
    host: Pick<WorkbenchHost, 'openExternalPage'> = blockedExternalPages,
    variables = true,
  ) {
    this.#client = client
    this.#i18n = i18n
    this.#variables = variables
    const setNotice = (notice: Notice | undefined): void => {
      if (!this.#disposed) this.#notice.set(notice)
    }
    this.runs = new RunStore(client, setNotice, i18n)
    this.workspace = new WorkspaceStore(client, setNotice, createAuthoringId, i18n, (event) => void this.#followExternalRun(client, event))
    this.connectors = new ConnectorStore(client, this.workspace, setNotice, host, i18n)
    this.triggers = new TriggerStore(client, this.workspace, setNotice, host, i18n)
    this.publications = new PublicationStore(client, this.workspace, setNotice, preferences, identity, i18n)
    this.runRequests = new RunRequestStore(client, this.runs, setNotice, i18n, identity)
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
      const actions = get(this.connectors.$.actions)
      const catalogs = get(this.connectors.$.catalogs)
      const t = get(i18n.t$)
      const run = get(this.runs.$.run)
      const events = get(this.runs.$.events)
      const variableNames = get(this.#variableNames)
      const variableNamesLoaded = get(this.#variableNamesLoaded)
      const variableNamesLoading = get(this.#variableNamesLoading)
      const key = target == null ? '' : target.kind == 'flow' ? 'flow' : `subflow:${target.id}`
      const inputs = [
        ...designerRevisionInputs(draft, target),
        presentation == null || target == null ? undefined : targetPresentation(presentation, target),
        designerDiagnostics,
        actions,
        catalogs,
        t,
        run,
        events,
        variableNames,
        variableNamesLoaded,
        variableNamesLoading,
        ...(run == null ? [] : [draft?.revisionId]),
      ]
      const cached = designerCache.get(key)
      if (cached != null && cached.inputs.length == inputs.length && cached.inputs.every((input, index) => input === inputs[index])) return cached.graph
      const graph = designerGraph(
        draft,
        target,
        presentation,
        designerDiagnostics,
        actions,
        catalogs,
        t,
        run,
        events,
        variableNames,
        variableNamesLoaded,
        variableNamesLoading,
        this.#variables,
      )
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
    this.#externalRuns.invalidate()
    this.#variableRefresh.invalidate()
    for (const value of Object.values(this.$)) value.dispose()
    this.connectors.dispose()
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
  }

  public async retryFlows(): Promise<void> {
    await this.workspace.reloadFlows()
  }

  public dismissNotice(): void {
    if (!this.#disposed) this.#notice.set(undefined)
  }

  public async refreshVariableNames(): Promise<void> {
    if (this.#disposed || !this.#variables) return
    const current = this.#variableRefresh.begin()
    this.#variableNamesLoading.set(true)
    try {
      const { variables } = await this.#client.listVariables()
      if (!current() || this.#disposed) return
      this.#variableNames.set(variables.map((variable) => variable.name))
      this.#variableNamesLoaded.set(true)
    } catch (error) {
      if (current() && !this.#disposed) this.#notice.set(errorNotice(error, this.#i18n.t))
    } finally {
      if (current() && !this.#disposed) this.#variableNamesLoading.set(false)
    }
  }

  public async selectFlow(flowId: string | undefined): Promise<boolean> {
    if (this.#disposed) return false
    this.#externalRuns.invalidate()
    this.#notice.set(undefined)
    if (!(await this.workspace.selectFlow(flowId))) return false
    this.connectors.reset()
    this.triggers.reset()
    this.publications.reset()
    this.runRequests.reset()
    this.runs.reset()
    return true
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

  public async addNode(option: AddNodeOption, position: Point, connection?: (nodeId: string) => Omit<DesignerEdge, 'id'>): Promise<string | undefined> {
    if (option.kind == 'trigger' && 'trigger' in option && option.trigger.kind == 'connect') {
      await this.triggers.connect(option.trigger.provider)
      return
    }
    const nodeId = await this.workspace.addNode(option, position, connection)
    if (nodeId != null && option.kind == 'connector') void this.connectors.refresh()
    if (nodeId != null && option.kind == 'trigger') void this.triggers.refresh()
    return nodeId
  }

  async #mergeAddNodeOptions(
    requests: readonly Promise<readonly AddNodeOption[] | undefined>[],
    signal: AbortSignal,
  ): Promise<readonly AddNodeOption[] | undefined> {
    const results = await Promise.allSettled(requests)
    if (signal.aborted || this.#disposed) return
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status == 'rejected')
    if (rejected.length > 0 && rejected.length == results.length) throw rejected[0]!.reason
    if (rejected.length > 0) this.#notice.set(errorNotice(rejected[0]!.reason, this.#i18n.t))
    return results.flatMap((result) => (result.status == 'fulfilled' ? (result.value ?? []) : []))
  }

  public readonly provideAddNodeOptions = async (searchTerm: string, signal: AbortSignal): Promise<readonly AddNodeOption[] | undefined> => {
    return await this.#mergeAddNodeOptions(
      [this.triggers.provideAddNodeOptions(searchTerm, signal), this.connectors.provideAddNodeOptions(searchTerm, signal)],
      signal,
    )
  }

  public readonly browseAddNodeOptions = async (signal: AbortSignal): Promise<readonly AddNodeOption[] | undefined> => {
    return await this.#mergeAddNodeOptions([this.triggers.browseAddNodeOptions(signal), this.connectors.browseAddNodeOptions(signal)], signal)
  }

  public readonly provideAddNodeOptionChoices = async (optionId: string, signal: AbortSignal): Promise<readonly AddNodeOption[] | undefined> => {
    if (optionId.startsWith('trigger:')) return
    return await this.connectors.provideAddNodeOptionChoices(optionId, signal)
  }

  public async refreshSelectedConnector(force = false): Promise<void> {
    await this.connectors.refresh(force)
  }

  public async requestDraftRun() {
    const flow = this.workspace.$.targetFlow.value
    const draft = this.workspace.$.draft.value
    if (flow == null || draft == null) return 'unavailable' as const
    return await this.runRequests.requestDraft(flow, draft)
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
