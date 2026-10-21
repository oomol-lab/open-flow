import type { I18n } from 'val-i18n'
import type { ReadonlyVal } from 'value-enhancer'
import type { CanvasCommand, CanvasCommandSubscriber } from '../../../../canvas/common/commands.ts'
import type { WorkflowFile } from '../../../../flow/common/workflowFile.ts'
import type { WorkbenchClient, ConnectorConnection, Draft, Flow, JsonValue, Live, TriggerKeySnapshot } from '../api.ts'
import type { DesignerViewport, Point } from '../canvasPresentation.ts'
import type { FlowChangeEvent } from '../contract.ts'
import type { AddNodeOption } from '../editor/addNodeOptions.ts'
import type { DiagnosticItem } from '../editor/diagnostics.ts'
import type { FlowChanges } from '../editor/flowChanges.ts'
import type { PropertyDeletion } from '../editor/propertyDeletion.ts'
import type { RevisionView } from '../revisionView.ts'
import type { DesignerEdge, DesignerGraph } from '../workspace.ts'
import type { CanvasAction, CanvasHistoryEntry } from './canvasHistory.ts'
import type { DraftChangeContext } from './draftChanges.ts'
import type { PresentationUpdate } from './presentationChanges.ts'
import type { SetNotice } from './workbenchNotice.ts'
import type { ModuleEditorDraft, WorkspaceState, Workspace$ } from './workspaceModel.ts'

import { dequal } from 'dequal/lite'
import { controlErrorCode } from '../../../../control/common/errors.ts'
import { createAuthoringId } from '../../../../flow/common/authoring.ts'
import { connect as connectFlowNodes, disconnect as disconnectFlowNodes } from '../../../../flow/common/edgeChanges.ts'
import { inverseFlowChanges } from '../../../../flow/common/inverseChanges.ts'
import { repairNodeNames } from '../../../../flow/common/nodeChanges.ts'
import { encodeWorkflowFile, workflowFileName } from '../../../../flow/common/workflowFile.ts'
import { workflowCandidate } from '../../../../workflow/common/workflow.ts'
import { ApiError } from '../api.ts'
import {
  canvasPresentationChange,
  restoreCanvasPresentation,
  commentIds,
  removeComments,
  setComment,
  setFlowViewport,
  setNodePositions,
  setNodeContentHidden,
} from '../canvasPresentation.ts'
import { connectionCatalog } from '../connectionCatalog.ts'
import { addNodeIntent } from '../editor/addNodeOptions.ts'
import { CanvasClipboard } from '../editor/canvasClipboard.ts'
import { applyFlowChanges, deleteSelection, addNode as addFlowNode, setTriggerConnection } from '../editor/flowChanges.ts'
import { createI18n } from '../i18n.ts'
import { revisionView } from '../revisionView.ts'
import { designerGraph } from '../workspace.ts'
import { CanvasHistory } from './canvasHistory.ts'
import { CatalogStores } from './catalogStores.ts'
import { DraftChanges } from './draftChanges.ts'
import { FlowCatalog } from './flowCatalog.ts'
import { Latest } from './latest.ts'
import { ModuleEditorSession } from './moduleEditorSession.ts'
import { NodeEdits } from './nodeEdits.ts'
import { PresentationChanges } from './presentationChanges.ts'
import { resourceValue } from './resource.ts'
import { errorNotice } from './workbenchNotice.ts'
import { moduleEditorStatus, selectedModuleEditor, WorkspaceModel } from './workspaceModel.ts'

const deletionMessageKeys = {
  field: 'history.deleted.field',
  group: 'history.deleted.group',
  objectItem: 'history.deleted.objectItem',
  arrayItem: 'history.deleted.arrayItem',
  option: 'history.deleted.option',
  case: 'history.deleted.case',
  condition: 'history.deleted.condition',
  conditionGroup: 'history.deleted.conditionGroup',
  webhookBody: 'history.deleted.webhookBody',
} as const satisfies Readonly<Record<PropertyDeletion['target'], string>>

interface ReconciledRevision {
  readonly revision: RevisionView
  readonly selectedNodeIds: readonly string[]
}

export class WorkspaceStore {
  readonly #canvasCommandListeners = new Set<(command: CanvasCommand) => void>()
  readonly #client: WorkbenchClient
  readonly #draftChanges: DraftChanges
  readonly #draftSession = new Latest()
  readonly #i18n: I18n
  readonly #identity: () => string
  readonly #presentationChanges: PresentationChanges
  readonly #flows: FlowCatalog
  readonly #runChanged: (event: Extract<FlowChangeEvent, { readonly kind: 'run.changed' | 'run.created' }>) => void
  public readonly notify: SetNotice = (notice) => {
    if (!this.#disposed) this.#setNotice(notice)
  }

  readonly #setNotice: SetNotice
  readonly #model: WorkspaceModel
  readonly #modules: ModuleEditorSession
  readonly #history = new CanvasHistory()
  public readonly history$: ReadonlyVal<CanvasHistory['state$']['value']> = this.#history.state$
  #historyRecovery?: Promise<void>
  readonly #clipboard: CanvasClipboard
  #diagnosticFocusId = 0
  #draftInvalidation = 0
  #draftUpdateNotice = false
  #disposed = false
  #started = false
  #draftSyncQueued = false
  #nodeFocusId = 0
  #pendingRepair?: { readonly changeId: string; readonly expectedRevisionId: string }
  #stopCatalogWatch?: () => void
  #stopFlowWatch?: () => void
  public readonly $: Workspace$
  public readonly nodes: NodeEdits

  public constructor(
    client: WorkbenchClient,
    setNotice: SetNotice,
    identity: () => string = createAuthoringId,
    i18n: I18n = createI18n(),
    runChanged: (event: Extract<FlowChangeEvent, { readonly kind: 'run.changed' | 'run.created' }>) => void = () => {},
    public readonly catalogs = new CatalogStores(client),
    private readonly flowCreated: (flowId: string) => void = () => {},
    private readonly accessChanged: (flowId: string, accessRevision: number) => void = () => {},
    private readonly filterTriggerConnections?: (
      flowId: string,
      definition: TriggerKeySnapshot,
      connections: readonly ConnectorConnection[],
    ) => Promise<readonly ConnectorConnection[]>,
  ) {
    this.#client = client
    this.#setNotice = setNotice
    this.#identity = identity
    this.#clipboard = new CanvasClipboard(identity, i18n.t)
    this.#i18n = i18n
    this.#runChanged = runChanged
    this.#flows = new FlowCatalog(client, setNotice, i18n)
    this.#model = new WorkspaceModel(i18n, this.#flows)
    this.#modules = new ModuleEditorSession(this.#model, this.#draftSession, (changes) => this.#saveModuleSource(changes), setNotice, i18n)
    this.#draftChanges = new DraftChanges(client, setNotice, i18n, {
      apply: (draft) => this.#applyDraft(draft, 'local'),
      beforeChange: (manageBusy) => {
        if (manageBusy) {
          this.#set({ busy: 'designer' })
        }
      },
      check: () => void this.#checkDraft(),
      current: (context) => this.#isDraftChangeCurrent(context),
      finishChanges: () => {
        if (!this.#disposed && this.#model.value.busy == 'designer') this.#set({ busy: undefined })
      },
      headChanged: (flowId, revisionId, content) => this.#flows.advanceHead(flowId, revisionId, content),
      recover: (context) => {
        void this.retryHistorySync()
        return this.#syncDraftHead(context, true)
      },
    })
    this.#presentationChanges = new PresentationChanges(client, setNotice, (presentation) => this.#set({ presentation }), i18n)
    this.$ = this.#model.$
    this.nodes = new NodeEdits(
      this.$.revision,
      async (changes, deletion) => (await this.#canvasChange('edit', 1, changes, undefined, undefined, deletion)) && this.#model.value.draft != null,
      identity,
    )
  }

  public dispose(): void {
    this.catalogs.dispose()
    this.#disposed = true
    this.#modules.dispose()
    this.#draftSession.invalidate()
    this.#presentationChanges.dispose()
    this.#stopCatalogWatch?.()
    this.#stopFlowWatch?.()
    this.#canvasCommandListeners.clear()
    this.history$.dispose()
    this.#model.dispose()
    this.#flows.dispose()
  }

  public async start(flowId?: string): Promise<void> {
    this.#started = false
    await this.selectFlow(flowId)
    this.#started = !this.#disposed
  }

  async #loadFlowCatalog(): Promise<void> {
    if (this.#flows.loaded && this.#stopCatalogWatch != null) return
    let initialLoad: Promise<void> | undefined
    if (this.#stopCatalogWatch == null) {
      const subscription = this.#client.watchFlowCatalog((event) => {
        if (this.#disposed) return
        void this.reloadFlows()
        if (event?.kind == 'flow.created' && this.#started && this.#model.value.flowId == null && this.#model.value.busy == null) this.flowCreated(event.flowId)
      })
      this.#stopCatalogWatch = subscription.stop
      void subscription.ready.then(async () => {
        if (initialLoad == null || this.#disposed) return
        await initialLoad
        if (!this.#disposed) await this.reloadFlows()
      })
      // An already-ready subscription needs only the initial read.
      await Promise.resolve()
    }
    if (this.#disposed) return
    initialLoad = this.reloadFlows()
    await initialLoad
  }

  public async reloadFlows(): Promise<void> {
    await this.#flows.reload()
  }

  public async setFlowEnabled(flow: Flow, enabled: boolean): Promise<void> {
    await this.#flows.setEnabled(flow, enabled)
  }

  public async publishFlow(flow: Flow): Promise<void> {
    await this.#flows.publish(flow)
  }

  public async loadMoreFlows(): Promise<void> {
    await this.#flows.loadMore()
  }

  public async selectFlow(flowId: string | undefined): Promise<boolean> {
    if (this.#history.applying) return false
    if (!(await this.saveModuleEditor()) || this.#disposed) return false
    this.#history.clear()
    this.#pendingRepair = undefined
    this.#history.failed = false
    this.#history.publish()
    const current = this.#draftSession.begin()
    this.#draftChanges.reset()
    this.#presentationChanges.reset()
    this.#draftInvalidation = 0
    this.#draftUpdateNotice = false
    this.#draftSyncQueued = false
    this.#stopFlowWatch?.()
    this.#stopFlowWatch = undefined
    this.#set({
      checkLoading: false,
      diagnosticFocus: undefined,
      diagnostics: undefined,
      draft: undefined,
      live: undefined,
      moduleEditor: undefined,
      nodeFocus: undefined,
      presentation: undefined,
      flowId,
      selectedNodeIds: [],
      workspaceLoadFailed: false,
      workspaceLoadProblem: undefined,
      workspaceLoading: flowId != null,
      workspaceRepairing: false,
    })
    if (flowId == null) {
      await this.#loadFlowCatalog()
      return true
    }
    try {
      let invalidated = false
      let pendingRevision: string | undefined
      const changed = (revisionId?: string): void => {
        if (!current()) return
        if (this.#draftChanges.committed == null) {
          invalidated = true
          pendingRevision = revisionId
        } else if (revisionId != this.#draftChanges.committed.revisionId) {
          void this.#refreshDraft(revisionId)
        }
      }
      const subscription = this.#client.watchFlow(
        flowId,
        changed,
        (event) => {
          if (current()) this.#runChanged(event)
        },
        (accessRevision) => {
          if (current()) {
            this.accessChanged(flowId, accessRevision)
            void this.#refreshLive(flowId, current)
          }
        },
        (command) => {
          if (current() && !this.#model.value.workspaceLoading) {
            for (const execute of this.#canvasCommandListeners) execute(command)
          }
        },
      )
      this.#stopFlowWatch = subscription.stop
      let reading = false
      void subscription.ready.then(
        () => {
          // Reconcile changes missed between the initial read and subscription readiness.
          if (reading) changed()
        },
        (error) => {
          if (!current()) return
          subscription.stop()
          this.#stopFlowWatch = undefined
          this.#setNotice(errorNotice(error, this.#i18n.t))
        },
      )
      // An already-ready subscription covers the initial read without a catch-up request.
      await Promise.resolve()
      if (!current()) return false
      reading = true
      let editor = await this.#client.getEditor(flowId)
      for (let attempt = 0; current() && Object.values(revisionView(editor.draft).graph().nodes).some((node) => node.kind == 'manual'); attempt += 1) {
        if (attempt >= 3) throw new ApiError(409, controlErrorCode.flowRevisionConflict, 'The Draft changed while upgrading its Start node.')
        try {
          await this.#client.upgradeDraft(flowId, editor.draft.revisionId, { idempotencyKey: this.#identity() })
        } catch (error) {
          if (!(error instanceof ApiError) || error.code !== controlErrorCode.flowRevisionConflict || attempt >= 2) throw error
        }
        if (!current()) return false
        editor = await this.#client.getEditor(flowId)
      }
      const { flow, draft, live, presentation } = editor
      if (!current()) return false
      this.#draftChanges.reset(draft)
      this.#presentationChanges.reset(presentation)
      this.#flows.include(flow)
      this.#set({
        draft,
        live,
        presentation,
        workspaceLoadFailed: false,
        workspaceLoadProblem: undefined,
      })
      await this.#repairDraftNodeNames(current)
      if (!current()) return false
      this.#set({ workspaceLoading: false })
      if (invalidated && pendingRevision != draft.revisionId) void this.#refreshDraft(pendingRevision)
    } catch (error) {
      if (!current()) return false
      this.#stopFlowWatch?.()
      this.#stopFlowWatch = undefined
      const kind =
        error instanceof ApiError && error.code == controlErrorCode.flowUpgradeRequired
          ? 'upgrade'
          : error instanceof ApiError && (error.code == controlErrorCode.flowRepairRequired || error.code == controlErrorCode.flowInvalid)
            ? 'repair'
            : 'failed'
      this.#set({
        workspaceLoadFailed: true,
        workspaceLoadProblem: { kind, ...(kind == 'failed' ? { message: errorNotice(error, this.#i18n.t).message } : {}) },
        workspaceLoading: false,
      })
      return false
    }
    return true
  }

  public async repairWorkspace(): Promise<void> {
    const flowId = this.#model.value.flowId
    if (flowId == null || this.#model.value.workspaceRepairing) return
    const current = this.#draftSession.capture()
    this.#set({ workspaceRepairing: true, workspaceLoadProblem: this.#model.value.workspaceLoadProblem })
    try {
      let repair = this.#pendingRepair
      if (repair == null) {
        const flow = this.#flows.flow(flowId) ?? (await this.#client.getFlow(flowId))
        if (!current()) return
        repair = this.#pendingRepair = { changeId: this.#identity(), expectedRevisionId: flow.draftRevisionId }
      }
      await this.#client.repairDraft(flowId, repair.expectedRevisionId, repair.changeId)
      if (!current()) return
      this.#pendingRepair = undefined
      await this.selectFlow(flowId)
    } catch (error) {
      if (this.#disposed || !current()) return
      if (error instanceof ApiError && error.code == controlErrorCode.flowRevisionConflict) {
        this.#pendingRepair = undefined
        await this.selectFlow(flowId)
        return
      }
      this.#set({
        workspaceLoadProblem: {
          kind: this.#model.value.workspaceLoadProblem?.kind == 'upgrade' ? 'upgrade' : 'repair',
          message: errorNotice(error, this.#i18n.t).message,
        },
        workspaceRepairing: false,
      })
    }
  }

  async #refreshLive(flowId: string, current: () => boolean): Promise<void> {
    try {
      const live = await this.#client.getLive(flowId)
      if (current() && this.#model.value.flowId == flowId) this.#set({ live })
    } catch (error) {
      if (current() && this.#model.value.flowId == flowId) this.#setNotice(errorNotice(error, this.#i18n.t))
    }
  }

  public selectNodes(nodeIds: readonly string[]): boolean {
    if (nodeIds.length == this.#model.value.selectedNodeIds.length && nodeIds.every((nodeId, index) => nodeId == this.#model.value.selectedNodeIds[index]))
      return true
    void this.#modules.flush()
    this.#set({
      diagnosticFocus: undefined,
      moduleEditor: selectedModuleEditor(this.#model.value.draft == null ? undefined : revisionView(this.#model.value.draft), nodeIds),
      nodeFocus: undefined,
      selectedNodeIds: nodeIds,
    })
    return true
  }

  public async exportFlow(flowId: string): Promise<void> {
    const current = this.#draftSession.capture()
    const selected = this.#model.value.flowId == flowId
    if (selected && (!(await this.saveDraft()) || !(await this.#presentationChanges.flush()) || !current())) {
      this.#setNotice({ kind: 'error', message: this.#i18n.t('notice.exportSaveFailed') })
      return
    }
    this.#set({ busy: 'flow' })
    try {
      const file = await this.#client.exportFlow(flowId)
      if (this.#disposed || (selected && !current())) return
      const url = URL.createObjectURL(new Blob([encodeWorkflowFile(file)], { type: 'application/json;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = workflowFileName(file.name ?? 'workflow')
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (error) {
      if (!this.#disposed) this.#setNotice(errorNotice(error, this.#i18n.t))
    } finally {
      this.#set({ busy: undefined })
    }
  }

  public createFlow(name: string, create?: (name: string) => Promise<string>): Promise<Flow | undefined> {
    return this.#createFlow(() => this.#flows.create(name, create))
  }

  public importFlow(
    file: WorkflowFile,
    name: string,
    key: string,
    importer?: (file: WorkflowFile, name: string, key: string) => Promise<string>,
  ): Promise<Flow | undefined> {
    return this.#createFlow(() => this.#flows.import(file, name, key, importer))
  }

  async #createFlow(create: () => Promise<Flow | undefined>): Promise<Flow | undefined> {
    if (!(await this.saveModuleEditor())) return
    this.#set({ busy: 'flow' })
    try {
      return await create()
    } finally {
      this.#set({ busy: undefined })
    }
  }

  public getFlowReferences(flowId: string, options: { offset?: number; signal?: AbortSignal } = {}) {
    return this.#client.getFlowReferences(flowId, { ...options, direction: 'incoming', limit: 50 })
  }

  public getErrorListeners(flowId: string, signal?: AbortSignal) {
    return this.#client.getErrorListeners(flowId, signal)
  }

  public async deleteFlow(flowId: string): Promise<boolean> {
    if (!(await this.saveModuleEditor())) return false
    this.#set({ busy: 'flow' })
    try {
      return await this.#flows.delete(flowId)
    } finally {
      this.#set({ busy: undefined })
    }
  }

  public async renameFlow(flowId: string, name: string): Promise<boolean> {
    this.#set({ busy: 'flow' })
    try {
      return await this.#flows.rename(flowId, name)
    } finally {
      this.#set({ busy: undefined })
    }
  }

  public async addNode(option: AddNodeOption, position: Point, connection?: (nodeId: string) => Omit<DesignerEdge, 'id'>): Promise<string | undefined> {
    if (!(await this.saveModuleEditor())) return
    const draft = this.#model.value.draft
    if (draft == null) return
    const nodeId = this.#identity()
    if (option.kind == 'comment') return await this.#addComment(nodeId, position)
    const revision = revisionView(draft)
    const intent = addNodeIntent(option, revision, this.#i18n.t)
    if (intent == null) return
    const edge = connection?.(nodeId)
    const nodeChanges = addFlowNode(revision, nodeId, intent)
    if (nodeChanges == null) return
    const changes =
      edge == null
        ? nodeChanges
        : [
            ...nodeChanges,
            ...connectFlowNodes(applyFlowChanges(draft, nodeChanges).content, {
              source: edge.source,
              target: edge.target,
              ...(edge.sourceHandle.startsWith('$branch:') ? { sourceHandle: edge.sourceHandle.slice(8) } : {}),
            }),
          ]
    if (!(await this.#canvasChange('add', 1, changes, (value) => setNodePositions(value, { [nodeId]: position }), [nodeId]))) return
    if (this.#disposed) return
    this.#set({ nodeFocus: { nodeId, requestId: ++this.#nodeFocusId } })
    if (intent.kind == 'provider-trigger' && intent.connectionId == null) void this.#configureAddedTrigger(draft.flowId, nodeId, intent.definition)
    return nodeId
  }

  async #configureAddedTrigger(flowId: string, nodeId: string, definition: TriggerKeySnapshot): Promise<void> {
    const current = this.#draftSession.capture()
    const original = this.$.revision.value?.graph().nodes[nodeId]
    const unchanged = () => current() && !this.#disposed && this.$.revision.value?.graph().nodes[nodeId] === original
    try {
      const connections = await resourceValue(this.catalogs.connections.get(definition.provider, flowId))
      if (!unchanged()) return
      const allowed = this.filterTriggerConnections == null ? connections : await this.filterTriggerConnections(flowId, definition, connections)
      if (!unchanged()) return
      const connection = connectionCatalog(allowed).preferred
      if (connection == null) return
      const revision = this.$.revision.value
      if (revision == null) return
      const changes = setTriggerConnection(revision, nodeId, connection.connectionId)
      if (changes != null && this.#history.completeNodeCreation(nodeId, changes)) await this.#changeDraft(changes, false, 'canvas')
    } catch (error) {
      if (unchanged()) this.#setNotice(errorNotice(error, this.#i18n.t))
    }
  }

  public async connect(edge: Omit<DesignerEdge, 'id'>): Promise<void> {
    const revision = this.$.revision.value
    if (revision == null) return
    const changes = connectFlowNodes(revision.revision.content, {
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle.startsWith('$branch:') ? { sourceHandle: edge.sourceHandle.slice(8) } : {}),
    })
    if (changes.length > 0) await this.#canvasChange('connect', 1, changes)
  }

  public async disconnect(edge: DesignerEdge): Promise<void> {
    const revision = this.$.revision.value
    if (revision == null) return
    const changes = disconnectFlowNodes(revision.revision.content, {
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle.startsWith('$branch:') ? { sourceHandle: edge.sourceHandle.slice(8) } : {}),
    })
    if (changes.length > 0) await this.#canvasChange('disconnect', 1, changes)
  }

  public async deleteSelectedNodes(): Promise<void> {
    if (!(await this.saveModuleEditor())) return
    const revision = this.$.revision.value
    if (revision == null || this.#model.value.selectedNodeIds.length == 0) return
    const selectedNodeIds = [...this.#model.value.selectedNodeIds]
    const comments = commentIds(this.#model.value.presentation?.value ?? {})
    const commentNodes = new Set(this.#model.value.selectedNodeIds.filter((nodeId) => comments.has(nodeId)))
    const changes = deleteSelection(revision, this.#model.value.selectedNodeIds)
    await this.#canvasChange(
      'delete',
      this.#model.value.selectedNodeIds.length,
      changes,
      (value) => {
        let next = commentNodes.size == 0 ? value : removeComments(value, commentNodes)
        for (const nodeId of selectedNodeIds) next = setNodeContentHidden(next, nodeId, false)
        return next
      },
      [],
    )
  }

  public copySelectedNodes(): void {
    const revision = this.$.revision.value
    if (revision == null || this.#model.value.selectedNodeIds.length == 0) return
    this.#clipboard.copy(revision, this.#designer(), this.#model.value.selectedNodeIds)
  }

  public async pasteNodes(sourcePositions?: Readonly<Record<string, Point>>, offset?: Point): Promise<void> {
    if (!(await this.saveModuleEditor())) return
    const revision = this.$.revision.value
    if (revision == null) return
    const pasted = this.#clipboard.paste(revision, this.#designer(), sourcePositions, offset)
    if (pasted != null) await this.#canvasChange('paste', pasted.nodeIds.length, pasted.changes, pasted.update, pasted.nodeIds)
  }

  public async duplicateSelectedNodes(positions?: Readonly<Record<string, Point>>, offset?: Point): Promise<void> {
    this.copySelectedNodes()
    await this.pasteNodes(positions, offset)
  }

  public async saveNodeContentHidden(nodeId: string, hidden: boolean): Promise<void> {
    const node = this.#designer().nodes.find((candidate) => candidate.id == nodeId)
    if (node == null || node.kind == 'condition') return
    await this.#canvasChange('edit', 1, [], (value) => setNodeContentHidden(value, nodeId, hidden))
  }

  public async saveComment(nodeId: string, comment: { readonly content: string; readonly title: string }): Promise<void> {
    if (this.#model.value.draft == null) return
    const position = this.#designer().nodes.find((node) => node.id == nodeId)?.position
    if (position == null) return
    await this.#canvasChange('edit', 1, [], (value) => setComment(value, nodeId, { ...comment, position }))
  }

  public async listWorkflowTargets(signal?: AbortSignal) {
    const flowId = this.$.revision.value?.revision.flowId
    if (flowId == null) return []
    const candidates: import('../../../../workflow/common/workflow.ts').WorkflowCandidate[] = []
    let cursor: string | undefined
    do {
      const page = await this.#client.listFlows({ cursor, limit: 100, signal })
      candidates.push(...page.flows.filter((flow) => flow.flowId != flowId).map((flow) => workflowCandidate(flow)))
      cursor = page.nextCursor
    } while (cursor != null)
    return candidates
  }

  public loadWorkflowContract(flowId: string, signal?: AbortSignal) {
    return this.#client.getWorkflowContract(flowId, signal)
  }

  public loadOpenApiDocument(url: string, signal?: AbortSignal): Promise<JsonValue> {
    return this.#client.loadOpenApiDocument(url, signal)
  }

  public get eventSourceClient() {
    return this.#client
  }

  public async loadEventSources(signal: AbortSignal) {
    const flowId = this.#model.value.flowId
    if (flowId == null) throw new Error('No Flow selected')
    return await this.#client.listEventSources(flowId, signal)
  }

  public async loadTriggerConfigOptions(triggerId: string, field: string, signal: AbortSignal) {
    const flowId = this.#model.value.flowId
    const current = this.#draftSession.capture()
    await this.#draftChanges.settled()
    signal.throwIfAborted()
    if (this.#disposed || !current() || flowId == null) throw new DOMException('Draft changed', 'AbortError')
    return await this.#client.listTriggerConfigOptions(flowId, triggerId, field, signal)
  }

  public updateModuleSource(source: string): void {
    const editor = this.#model.value.moduleEditor
    if (this.#history.applying || this.#history.failed || editor == null || editor.source == source) return
    this.#history.discardRedo()
    this.#modules.updateModuleSource(source)
  }

  public discardModuleChanges(): void {
    this.#modules.discardModuleChanges()
  }

  public get hasUnsavedCode(): boolean {
    return this.#modules.hasUnsavedCode
  }

  public async saveDraft(): Promise<boolean> {
    const current = this.#draftSession.capture()
    const saved = await Promise.all([this.#draftChanges.flush(), this.saveModuleEditor()])
    if (saved.some((success) => !success) || !current()) return false
    return (await this.#draftChanges.flush()) && current() && !this.#disposed && !this.#history.failed
  }

  public saveModuleEditor(): Promise<boolean> {
    return this.#modules.saveModuleEditor()
  }

  public async moveNodes(positions: Readonly<Record<string, Point>>): Promise<void> {
    if (this.#model.value.draft == null) return
    await this.#canvasChange('move', Object.keys(positions).length, [], (value) => setNodePositions(value, positions))
  }

  public readonly subscribeCanvasCommands: CanvasCommandSubscriber = (execute) => {
    this.#canvasCommandListeners.add(execute)
    return () => {
      this.#canvasCommandListeners.delete(execute)
    }
  }

  public async moveViewport(viewport: DesignerViewport): Promise<void> {
    if (this.#model.value.draft == null) return
    await this.#changePresentation((value) => setFlowViewport(value, viewport), true)
  }

  public async check(): Promise<void> {
    await this.#checkDraft()
  }

  public async refreshFlows(): Promise<void> {
    await this.reloadFlows()
  }

  public updateLive(live: Live): void {
    if (live.flowId == this.#model.value.flowId) this.#set({ live })
  }

  public locateNode(nodeId: string, { preserveSelection = false }: { readonly preserveSelection?: boolean } = {}): boolean {
    const revision = this.$.revision.value
    if (revision == null) return false
    if (revision.node(nodeId) == null && !commentIds(this.#model.value.presentation?.value ?? {}).has(nodeId)) return false
    if (!preserveSelection && !this.selectNodes([nodeId])) return false
    this.#set({ nodeFocus: { nodeId, requestId: ++this.#nodeFocusId } })
    return true
  }

  public locateDiagnostic(item: DiagnosticItem): boolean {
    if (item.location == null || !this.selectNodes([item.location.nodeId])) return false
    this.#set({
      diagnosticFocus: {
        ...item.location,
        diagnostic: item.diagnostic,
        requestId: ++this.#diagnosticFocusId,
      },
    })
    return true
  }

  async #addComment(nodeId: string, position: Point): Promise<string | undefined> {
    const number = Math.max(
      0,
      ...this.#designer().nodes.flatMap((node) => {
        if (node.kind != 'comment') return []
        const match = /#(\d+)$/.exec(node.title)
        return match == null ? [] : [Number(match[1])]
      }),
    )
    const change = this.#canvasChange(
      'add',
      1,
      [],
      (value) =>
        setComment(value, nodeId, {
          content: '',
          position,
          title: this.#i18n.t('addNode.commentName', { number: number + 1 }),
        }),
      [nodeId],
    )
    if (!(await change) || this.#disposed) return
    return nodeId
  }

  #notifyDeletion(deletion: PropertyDeletion, entry: CanvasHistoryEntry): void {
    this.#setNotice({
      kind: 'success',
      message:
        'name' in deletion ? this.#i18n.t(deletionMessageKeys[deletion.target], { name: deletion.name }) : this.#i18n.t(deletionMessageKeys[deletion.target]),
      undo: {
        label: this.#i18n.t('history.undo'),
        run: async () => {
          if (this.history$.value.undo !== entry) return
          await this.undo()
        },
      },
    })
  }

  async #changeDraft(changes: FlowChanges, manageBusy = true, historyMode: 'clear' | 'canvas' | 'code' = 'clear'): Promise<Draft | undefined> {
    if (this.#disposed || ((this.#history.applying || this.#history.failed) && historyMode != 'canvas')) return
    const flowId = this.#model.value.flowId
    const draft = this.#model.value.draft
    if (flowId == null || draft == null) return
    if (changes.length == 0 || dequal(applyFlowChanges(draft, changes).content, draft.content)) return draft
    const cleared = historyMode == 'clear' && this.#history.clear()
    const current = this.#draftSession.capture()
    this.#history.pending++
    this.#history.publish()
    try {
      const saved = this.#draftChanges.change({ current, flowId }, draft, changes, manageBusy)
      if (cleared) this.#setNotice({ kind: 'success', message: this.#i18n.t('history.cleared') })
      const result = await saved
      if (result == null && current()) void this.retryHistorySync()
      return result
    } finally {
      this.#history.pending--
      if (!this.#disposed) this.#history.publish()
    }
  }

  async #saveModuleSource(changes: FlowChanges): Promise<Draft | undefined> {
    const saved = await this.#changeDraft(changes, false, 'code')
    if (saved != null) {
      for (const operation of changes) {
        if (operation.kind != 'module.source.replace') continue
        const module = saved.content.modules[operation.moduleId]
        if (module != null) this.#history.rebaseModuleCreation(operation.moduleId, module)
      }
    }
    return saved
  }

  async #repairDraftNodeNames(current: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 2 && current(); attempt += 1) {
      const draft = this.#model.value.draft
      if (draft == null) return
      const repairs = repairNodeNames(draft.content, { start: this.#i18n.t('addNode.start') })
      if (repairs.length == 0) {
        void this.#checkDraft()
        return
      }
      const changed = await this.#changeDraft(repairs, false)
      if (changed != null || !current()) return
      if (this.#model.value.draft?.revisionId == draft.revisionId) break
    }
    if (current()) void this.#checkDraft()
  }

  #applyDraft(draft: Draft, origin: 'local' | 'external'): boolean {
    const previousDraft = this.#model.value.draft
    const { revision, selectedNodeIds } = this.#reconcileRevision(draft)
    const editor = this.#model.value.moduleEditor
    const keepEditor = editor != null && (origin == 'external' || previousDraft != null) && moduleEditorStatus(previousDraft, editor) != 'saved'
    let moduleEditor: ModuleEditorDraft | undefined
    if (keepEditor) moduleEditor = origin == 'external' ? { ...editor, phase: 'failed' } : editor
    else moduleEditor = selectedModuleEditor(revision, selectedNodeIds)
    this.#set({
      // Keep the last check until its replacement arrives; pending is not error-free.
      draft,
      moduleEditor,
      selectedNodeIds,
    })
    return keepEditor
  }

  async #changePresentation(update: PresentationUpdate, historyOwned = false): Promise<boolean> {
    if (this.#disposed || ((this.#history.applying || this.#history.failed) && !historyOwned)) return false
    const flowId = this.#model.value.flowId
    const presentation = this.#model.value.presentation
    if (flowId == null || presentation == null) return false
    if (dequal(update(presentation.value), presentation.value)) return true
    if (!historyOwned) this.#clearHistoryForEdit()
    const current = this.#draftSession.capture()
    this.#history.pending++
    this.#history.publish()
    try {
      const result = await this.#presentationChanges.change(flowId, presentation, current, update)
      if (!result && current()) void this.retryHistorySync()
      return result
    } finally {
      this.#history.pending--
      if (!this.#disposed) this.#history.publish()
    }
  }

  #clearHistoryForEdit(): void {
    if (this.#history.clear()) this.#setNotice({ kind: 'success', message: this.#i18n.t('history.cleared') })
  }

  async #canvasChange(
    action: CanvasAction,
    count: number,
    changes: FlowChanges,
    update?: PresentationUpdate,
    selection = this.#model.value.selectedNodeIds,
    deletion?: PropertyDeletion,
  ): Promise<boolean> {
    if (this.#disposed || this.#history.applying || this.#history.failed) return false
    const { draft, presentation, selectedNodeIds } = this.#model.value
    if (draft == null || presentation == null) return false
    const next = update?.(presentation.value) ?? presentation.value
    const presentationChange = canvasPresentationChange(presentation.value, next)
    if (dequal(applyFlowChanges(draft, changes).content, draft.content) && presentationChange.nodeIds.length == 0) return true
    const generation = this.#history.generation
    const inverse = inverseFlowChanges(draft.content, changes)
    this.#history.pending++
    const entry: CanvasHistoryEntry = {
      action,
      count,
      forward: changes,
      inverse,
      presentation: presentationChange,
      beforeSelection: selectedNodeIds,
      afterSelection: selection,
    }
    const retained = this.#history.record(entry)
    try {
      const change = changes.length == 0 ? Promise.resolve(draft) : this.#changeDraft(changes, true, 'canvas')
      const layout = update == null ? Promise.resolve(true) : this.#changePresentation(update, true)
      this.selectNodes(selection)
      if (!retained) this.#setNotice({ kind: 'success', message: this.#i18n.t('history.tooLarge') })
      const [saved, positioned] = await Promise.all([change, layout])
      const complete = saved != null && positioned && (!retained || generation == this.#history.generation)
      if (complete && retained && deletion != null && this.history$.value.undo === entry) this.#notifyDeletion(deletion, entry)
      return complete
    } catch (error) {
      this.#setNotice(errorNotice(error, this.#i18n.t))
      void this.retryHistorySync()
      return false
    } finally {
      this.#history.pending--
      if (!this.#disposed) this.#history.publish()
    }
  }

  public async undo(): Promise<void> {
    await this.#restoreHistory(false)
  }
  public async redo(): Promise<void> {
    await this.#restoreHistory(true)
  }

  async #restoreHistory(redo: boolean): Promise<void> {
    if (this.hasUnsavedCode && !(await this.saveModuleEditor())) return
    const state = this.history$.value
    if (!(redo ? state.canRedo : state.canUndo)) return
    const entry = redo ? state.redo : state.undo
    if (entry == null) return
    const generation = this.#history.generation
    this.#history.applying = true
    this.#history.publish()
    try {
      const [draft, presentation] = await Promise.all([
        this.#changeDraft(redo ? entry.forward : entry.inverse, true, 'canvas'),
        this.#changePresentation((value) => restoreCanvasPresentation(value, entry.presentation, redo), true),
      ])
      if (draft != null && presentation && generation == this.#history.generation) {
        this.selectNodes(redo ? entry.afterSelection : entry.beforeSelection)
        this.#history.complete(redo)
      }
    } catch (error) {
      this.#setNotice(errorNotice(error, this.#i18n.t))
      void this.retryHistorySync()
    } finally {
      this.#history.applying = false
      if (!this.#disposed) this.#history.publish()
    }
  }

  public async retryHistorySync(): Promise<void> {
    if (this.#disposed || this.#historyRecovery != null) return this.#historyRecovery
    const flowId = this.#model.value.flowId
    if (flowId == null) return
    const current = this.#draftSession.capture()
    this.#history.failed = true
    this.#history.clear()
    const recovery = async () => {
      await Promise.allSettled([this.#draftChanges.settled(), this.#presentationChanges.settled()])
      if (!current() || this.#disposed) return
      try {
        const { draft, presentation } = await this.#client.getEditor(flowId)
        if (!current() || this.#disposed) return
        this.#draftChanges.reset(draft)
        this.#presentationChanges.reset(presentation)
        this.#applyDraft(draft, 'external')
        this.#set({ presentation })
        this.#flows.advanceHead(flowId, draft.revisionId, draft.content)
        this.#history.failed = false
        this.#setNotice({ kind: 'error', message: this.#i18n.t('history.resynced') })
        void this.#checkDraft()
      } catch {
        if (current() && !this.#disposed) this.#setNotice({ kind: 'error', message: this.#i18n.t('history.syncFailed') })
      }
    }
    this.#historyRecovery = recovery().finally(() => {
      this.#historyRecovery = undefined
      if (!this.#disposed) this.#history.publish()
    })
    return this.#historyRecovery
  }

  async #checkDraft(): Promise<void> {
    if (this.#disposed) return
    const flowId = this.#model.value.flowId
    const draft = this.#model.value.draft
    if (flowId == null || draft == null) {
      if (this.#model.value.draft == null) this.#set({ checkLoading: false, diagnostics: undefined })
      return
    }
    this.#set({ checkLoading: true, diagnosticFocus: undefined })
    try {
      const diagnostics = await this.#client.checkFlow(flowId, draft.revisionId)
      if (!this.#disposed && flowId == this.#model.value.flowId && draft.revisionId == this.#model.value.draft?.revisionId) {
        const live = this.#model.value.live
        this.#set({
          diagnostics,
          live:
            live == null
              ? undefined
              : {
                  ...live,
                  hasUnpublishedChanges: live.publication == null || live.publication.closureDigest != diagnostics.closureDigest,
                },
        })
      }
    } catch (error) {
      if (!this.#disposed && flowId == this.#model.value.flowId && draft.revisionId == this.#model.value.draft?.revisionId) {
        this.#setNotice(errorNotice(error, this.#i18n.t))
      }
    } finally {
      if (!this.#disposed && flowId == this.#model.value.flowId && draft.revisionId == this.#model.value.draft?.revisionId) this.#set({ checkLoading: false })
    }
  }

  async #refreshDraft(revisionId?: string): Promise<void> {
    if (this.#disposed) return
    const flowId = this.#model.value.flowId
    if (flowId == null) return
    this.#draftInvalidation += 1
    if (revisionId != null) {
      this.#draftUpdateNotice = true
    }
    if (this.#draftSyncQueued) return
    this.#draftSyncQueued = true
    const context = { current: this.#draftSession.capture(), flowId }
    await this.#draftChanges.enqueue(async () => {
      let generation: number
      do {
        generation = this.#draftInvalidation
        const notifyUpdate = this.#draftUpdateNotice
        this.#draftUpdateNotice = false
        await this.#syncDraftHead(context, false, notifyUpdate)
      } while (this.#isDraftChangeCurrent(context) && generation != this.#draftInvalidation)
    })
    if (this.#isDraftChangeCurrent(context)) this.#draftSyncQueued = false
  }

  async #syncDraftHead(context: DraftChangeContext, reportError: boolean, notifyUpdate = false): Promise<boolean> {
    try {
      const base = this.#draftChanges.committed
      if (base == null) return false

      const synced = await this.#client.syncDraft(context.flowId)
      if (!this.#isDraftChangeCurrent(context)) return false
      const committed = synced.draft
      if (committed.revisionId == base.revisionId) return true

      if (this.#history.clear()) this.#setNotice({ kind: 'success', message: this.#i18n.t('history.external') })
      const draft = this.#draftChanges.replaceCommitted(committed)
      const preserveModuleEditor = this.#applyDraft(draft, 'external')
      this.#flows.advanceHead(context.flowId, committed.revisionId, committed.content)
      if (notifyUpdate) {
        this.#setNotice({
          kind: preserveModuleEditor ? 'error' : 'success',
          message: this.#i18n.t(preserveModuleEditor ? 'notice.moduleUpdated' : 'notice.draftUpdated'),
        })
      }
      void this.#checkDraft()
      return true
    } catch (error) {
      if (reportError && this.#isDraftChangeCurrent(context)) this.#setNotice(errorNotice(error, this.#i18n.t))
      return false
    }
  }

  #designer(): DesignerGraph {
    const state = this.#model.value
    return designerGraph(state.draft, state.presentation?.value, state.diagnostics?.diagnostics, {}, {}, this.#i18n.t)
  }

  #reconcileRevision(draft: Draft): ReconciledRevision {
    const revision = revisionView(draft)
    const selectedNodeIds = this.#model.value.selectedNodeIds.filter((nodeId) => revision.selection(nodeId) != null)
    return { revision, selectedNodeIds }
  }

  #isDraftChangeCurrent(context: DraftChangeContext): boolean {
    return !this.#disposed && context.flowId == this.#model.value.flowId && context.current()
  }

  #set(patch: Partial<WorkspaceState>): void {
    if (this.#disposed) return
    const editor = Object.hasOwn(patch, 'moduleEditor') ? patch.moduleEditor : this.#model.value.moduleEditor
    this.#model.set({ ...patch, ...this.#modules.state(editor) })
  }
}
