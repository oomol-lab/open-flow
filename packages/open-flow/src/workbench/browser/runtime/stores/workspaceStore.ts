import type { I18n } from 'val-i18n'
import type { CanvasCommand, CanvasCommandSubscriber } from '../../../../canvas/common/commands.ts'
import type { FlowUpdate } from '../../../../control/common/api.ts'
import type { WorkflowFile } from '../../../../flow/common/workflowFile.ts'
import type { WorkbenchClient, ConnectorConnection, Flow, JsonValue, Live, TriggerKeySnapshot } from '../api.ts'
import type { DesignerViewport, Point } from '../canvasPresentation.ts'
import type { FlowChangeEvent } from '../contract.ts'
import type { AddNodeOption } from '../editor/addNodeOptions.ts'
import type { DiagnosticItem } from '../editor/diagnostics.ts'
import type { FlowChanges } from '../editor/flowChanges.ts'
import type { RevisionView } from '../revisionView.ts'
import type { DesignerEdge, DesignerGraph } from '../workspace.ts'
import type { SetNotice } from './workbenchNotice.ts'
import type { Workspace$ } from './workspaceModel.ts'

import { controlErrorCode } from '../../../../control/common/errors.ts'
import { createAuthoringId } from '../../../../flow/common/authoring.ts'
import { connect as connectFlowNodes, disconnect as disconnectFlowNodes } from '../../../../flow/common/edgeChanges.ts'
import { encodeWorkflowFile, workflowFileName } from '../../../../flow/common/workflowFile.ts'
import { workflowCandidate } from '../../../../workflow/common/workflow.ts'
import { ApiError } from '../api.ts'
import { commentIds, removeComments, setComment, setFlowViewport, setNodePositions, setNodeContentHidden } from '../canvasPresentation.ts'
import { connectionCatalog } from '../connectionCatalog.ts'
import { addNodeIntent } from '../editor/addNodeOptions.ts'
import { CanvasClipboard } from '../editor/canvasClipboard.ts'
import { applyFlowChanges, deleteSelection, addNode as addFlowNode, selectWebhookResponse, setTriggerConnection } from '../editor/flowChanges.ts'
import { createI18n } from '../i18n.ts'
import { revisionView } from '../revisionView.ts'
import { designerGraph } from '../workspace.ts'
import { CatalogStores } from './catalogStores.ts'
import { EditSession } from './editSession.ts'
import { FlowCatalog } from './flowCatalog.ts'
import { NodeEdits } from './nodeEdits.ts'
import { resourceValue } from './resource.ts'
import { errorNotice } from './workbenchNotice.ts'
import { WorkspaceModel } from './workspaceModel.ts'

export class WorkspaceStore {
  readonly #edits: EditSession
  public readonly history$: EditSession['history$']
  readonly #canvasCommandListeners = new Set<(command: CanvasCommand) => void>()
  readonly #client: WorkbenchClient
  readonly #i18n: I18n
  readonly #identity: () => string
  readonly #flows: FlowCatalog
  readonly #runChanged: (event: Extract<FlowChangeEvent, { readonly kind: 'run.changed' | 'run.created' }>) => void
  public readonly notify: SetNotice = (notice) => {
    if (!this.#disposed) this.#setNotice(notice)
  }

  readonly #setNotice: SetNotice
  readonly #model: WorkspaceModel
  readonly #clipboard: CanvasClipboard
  #diagnosticFocusId = 0
  #disposed = false
  #started = false
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
    this.#edits = new EditSession(client, this.#model, this.#flows, setNotice, i18n)
    this.history$ = this.#edits.history$
    this.$ = this.#model.$
    this.nodes = new NodeEdits(
      this.$.revision,
      async (changes, deletion) => (await this.#edits.canvasChange('edit', 1, changes, undefined, undefined, deletion)) && this.#model.value.draft != null,
      identity,
    )
  }

  public dispose(): void {
    this.catalogs.dispose()
    this.#disposed = true
    this.#edits.dispose()
    this.#stopCatalogWatch?.()
    this.#stopFlowWatch?.()
    this.#canvasCommandListeners.clear()
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
    if (this.#edits.applying) return false
    if (!(await this.saveModuleEditor()) || this.#disposed) return false
    this.#pendingRepair = undefined
    const current = this.#edits.begin()
    this.#stopFlowWatch?.()
    this.#stopFlowWatch = undefined
    this.#edits.set({
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
        if (this.#edits.committed == null) {
          invalidated = true
          pendingRevision = revisionId
        } else if (revisionId != this.#edits.committed.revisionId) {
          void this.#edits.refreshDraft(revisionId)
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
      this.#edits.reset(draft, presentation)
      this.#flows.include(flow)
      this.#edits.set({
        draft,
        live,
        presentation,
        workspaceLoadFailed: false,
        workspaceLoadProblem: undefined,
      })
      await this.#edits.repairDraftNodeNames(current)
      if (!current()) return false
      this.#edits.set({ workspaceLoading: false })
      if (invalidated && pendingRevision != draft.revisionId) void this.#edits.refreshDraft(pendingRevision)
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
      this.#edits.set({
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
    const current = this.#edits.capture()
    this.#edits.set({ workspaceRepairing: true, workspaceLoadProblem: this.#model.value.workspaceLoadProblem })
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
      this.#edits.set({
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
      if (current() && this.#model.value.flowId == flowId) this.#edits.set({ live })
    } catch (error) {
      if (current() && this.#model.value.flowId == flowId) this.#setNotice(errorNotice(error, this.#i18n.t))
    }
  }

  public selectNodes(nodeIds: readonly string[]): boolean {
    return this.#edits.selectNodes(nodeIds)
  }

  public async exportFlow(flowId: string): Promise<void> {
    const current = this.#edits.capture()
    const selected = this.#model.value.flowId == flowId
    if (selected && (!(await this.#edits.flush()) || !current())) {
      this.#setNotice({ kind: 'error', message: this.#i18n.t('notice.exportSaveFailed') })
      return
    }
    this.#edits.set({ busy: 'flow' })
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
      this.#edits.set({ busy: undefined })
    }
  }

  public createFlow(
    name: string,
    create?: (name: string, options?: { readonly tagIds?: readonly string[] }) => Promise<string>,
    tagIds?: readonly string[],
  ): Promise<Flow | undefined> {
    return this.#createFlow(() => this.#flows.create(name, create, tagIds))
  }

  public importFlow(
    file: WorkflowFile,
    name: string,
    key: string,
    importer?: (file: WorkflowFile, name: string, key: string, options?: { readonly tagIds?: readonly string[] }) => Promise<string>,
    tagIds?: readonly string[],
  ): Promise<Flow | undefined> {
    return this.#createFlow(() => this.#flows.import(file, name, key, importer, tagIds))
  }

  async #createFlow(create: () => Promise<Flow | undefined>): Promise<Flow | undefined> {
    if (!(await this.saveModuleEditor())) return
    this.#edits.set({ busy: 'flow' })
    try {
      return await create()
    } finally {
      this.#edits.set({ busy: undefined })
    }
  }

  public getFlowReferences(flowId: string, options: { offset?: number; signal?: AbortSignal } = {}) {
    return this.#client.getFlowReferences(flowId, { ...options, direction: 'incoming', limit: 50 })
  }

  public getErrorListeners(flowId: string, signal?: AbortSignal) {
    return this.#client.getErrorListeners(flowId, signal)
  }

  public async deleteFlow(flow: Flow): Promise<boolean> {
    if (!(await this.saveModuleEditor())) return false
    this.#edits.set({ busy: 'flow' })
    try {
      return await this.#flows.delete(flow)
    } finally {
      this.#edits.set({ busy: undefined })
    }
  }

  public updateFlowSettings(flowId: string, changes: FlowUpdate): Promise<boolean> {
    return this.#flows.updateSettings(flowId, changes)
  }

  public async renameFlow(flow: Flow, name: string): Promise<boolean> {
    this.#edits.set({ busy: 'flow' })
    try {
      return await this.#flows.rename(flow, name)
    } finally {
      this.#edits.set({ busy: undefined })
    }
  }

  public async addNode(
    option: AddNodeOption,
    position: Point,
    connection?: (nodeId: string) => Omit<DesignerEdge, 'id'>,
    relatedChanges?: (nodeId: string, revision: RevisionView) => FlowChanges,
  ): Promise<string | undefined> {
    if (!(await this.saveModuleEditor())) return
    const draft = this.#model.value.draft
    if (draft == null) return
    const nodeId = this.#identity()
    if (option.kind == 'comment') return await this.#addComment(nodeId, position)
    const revision = revisionView(draft)
    const intent = addNodeIntent(option, revision, this.#i18n.t)
    if (intent == null) return
    const edge = connection?.(nodeId)
    const created = addFlowNode(revision, nodeId, intent)
    const nodeChanges = created == null ? undefined : [...created, ...(relatedChanges?.(nodeId, revision) ?? [])]
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
    if (!(await this.#edits.canvasChange('add', 1, changes, (value) => setNodePositions(value, { [nodeId]: position }), [nodeId]))) return
    if (this.#disposed) return
    this.#edits.set({ nodeFocus: { nodeId, requestId: ++this.#nodeFocusId } })
    if (intent.kind == 'provider-trigger' && intent.connectionId == null) void this.#configureAddedTrigger(draft.flowId, nodeId, intent.definition)
    return nodeId
  }

  public async addWebhookResponseNode(triggerId: string): Promise<string | undefined> {
    const option = this.$.addNodeOptions.value.find((item) => item.kind === 'webhook-response')
    const position = this.#designer().nodes.find((node) => node.id === triggerId)?.position
    if (option == null || position == null) return
    return this.addNode(
      option,
      { x: position.x + 320, y: position.y },
      undefined,
      (nodeId, revision) => selectWebhookResponse(revision, triggerId, nodeId) ?? [],
    )
  }

  async #configureAddedTrigger(flowId: string, nodeId: string, definition: TriggerKeySnapshot): Promise<void> {
    const current = this.#edits.capture()
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
      if (changes != null) await this.#edits.finishNodeCreation(nodeId, changes)
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
    if (changes.length > 0) await this.#edits.canvasChange('connect', 1, changes)
  }

  public async disconnect(edge: DesignerEdge): Promise<void> {
    const revision = this.$.revision.value
    if (revision == null) return
    const changes = disconnectFlowNodes(revision.revision.content, {
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle.startsWith('$branch:') ? { sourceHandle: edge.sourceHandle.slice(8) } : {}),
    })
    if (changes.length > 0) await this.#edits.canvasChange('disconnect', 1, changes)
  }

  public async deleteSelectedNodes(): Promise<void> {
    if (!(await this.saveModuleEditor())) return
    const revision = this.$.revision.value
    if (revision == null || this.#model.value.selectedNodeIds.length == 0) return
    const selectedNodeIds = [...this.#model.value.selectedNodeIds]
    const comments = commentIds(this.#model.value.presentation?.value ?? {})
    const commentNodes = new Set(this.#model.value.selectedNodeIds.filter((nodeId) => comments.has(nodeId)))
    const changes = deleteSelection(revision, this.#model.value.selectedNodeIds)
    await this.#edits.canvasChange(
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
    if (pasted != null) await this.#edits.canvasChange('paste', pasted.nodeIds.length, pasted.changes, pasted.update, pasted.nodeIds)
  }

  public async duplicateSelectedNodes(positions?: Readonly<Record<string, Point>>, offset?: Point): Promise<void> {
    this.copySelectedNodes()
    await this.pasteNodes(positions, offset)
  }

  public async saveNodeContentHidden(nodeId: string, hidden: boolean): Promise<void> {
    const node = this.#designer().nodes.find((candidate) => candidate.id == nodeId)
    if (node == null || node.kind == 'condition') return
    await this.#edits.canvasChange('edit', 1, [], (value) => setNodeContentHidden(value, nodeId, hidden))
  }

  public async saveComment(nodeId: string, comment: { readonly content: string; readonly title: string }): Promise<void> {
    if (this.#model.value.draft == null) return
    const position = this.#designer().nodes.find((node) => node.id == nodeId)?.position
    if (position == null) return
    await this.#edits.canvasChange('edit', 1, [], (value) => setComment(value, nodeId, { ...comment, position }))
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

  public loadTriggerConfigOptions(triggerId: string, field: string, signal: AbortSignal) {
    return this.#edits.loadTriggerConfigOptions(triggerId, field, signal)
  }

  public updateModuleSource(source: string): void {
    this.#edits.updateModuleSource(source)
  }

  public discardModuleChanges(): void {
    this.#edits.discardModuleChanges()
  }

  public get hasUnsavedCode(): boolean {
    return this.#edits.hasUnsavedCode
  }

  public async saveDraft(): Promise<boolean> {
    return this.#edits.saveDraft()
  }

  public saveModuleEditor(): Promise<boolean> {
    return this.#edits.saveModuleEditor()
  }

  public async moveNodes(positions: Readonly<Record<string, Point>>): Promise<void> {
    if (this.#model.value.draft == null) return
    await this.#edits.canvasChange('move', Object.keys(positions).length, [], (value) => setNodePositions(value, positions))
  }

  public readonly subscribeCanvasCommands: CanvasCommandSubscriber = (execute) => {
    this.#canvasCommandListeners.add(execute)
    return () => {
      this.#canvasCommandListeners.delete(execute)
    }
  }

  public async moveViewport(viewport: DesignerViewport): Promise<void> {
    if (this.#model.value.draft == null) return
    await this.#edits.changePresentation((value) => setFlowViewport(value, viewport), true)
  }

  public async check(): Promise<void> {
    await this.#edits.checkDraft()
  }

  public async refreshFlows(): Promise<void> {
    await this.reloadFlows()
  }

  public updateLive(live: Live): void {
    if (live.flowId == this.#model.value.flowId) this.#edits.set({ live })
  }

  public locateNode(nodeId: string, { preserveSelection = false }: { readonly preserveSelection?: boolean } = {}): boolean {
    const revision = this.$.revision.value
    if (revision == null) return false
    if (revision.node(nodeId) == null && !commentIds(this.#model.value.presentation?.value ?? {}).has(nodeId)) return false
    if (!preserveSelection && !this.selectNodes([nodeId])) return false
    this.#edits.set({ nodeFocus: { nodeId, requestId: ++this.#nodeFocusId } })
    return true
  }

  public locateDiagnostic(item: DiagnosticItem): boolean {
    if (item.location == null || !this.selectNodes([item.location.nodeId])) return false
    this.#edits.set({
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
    const change = this.#edits.canvasChange(
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

  public async undo(): Promise<void> {
    await this.#edits.undo()
  }
  public async redo(): Promise<void> {
    await this.#edits.redo()
  }

  public async retryHistorySync(): Promise<void> {
    return this.#edits.retryHistorySync()
  }

  #designer(): DesignerGraph {
    const state = this.#model.value
    return designerGraph(state.draft, state.presentation?.value, state.diagnostics?.diagnostics, {}, {}, this.#i18n.t)
  }
}
