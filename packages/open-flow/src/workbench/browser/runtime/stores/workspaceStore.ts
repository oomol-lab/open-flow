import type { I18n } from 'val-i18n'
import type { ReadonlyVal } from 'value-enhancer'
import type { GraphTarget } from '../../../../flow/common/change.ts'
import type { ConnectorCapability } from '../../../../flow/common/change.ts'
import type { Settings as NodeSettings } from '../../../../flow/common/nodeChanges.ts'
import type { WorkbenchClient, ConnectorAction, Draft, Flow, GraphNode, InputPort, JsonValue, Live, TriggerSchedule } from '../api.ts'
import type { FlowChangeEvent } from '../contract.ts'
import type { AddNodeOption } from '../editor/addNodeOptions.ts'
import type { DiagnosticItem } from '../editor/diagnostics.ts'
import type {
  ConditionSettings,
  TaskPorts,
  NodeClipboard,
  FlowChanges,
  SubflowSettings,
  TaskSettings,
  ValueSettings,
  WebhookSettings,
} from '../editor/flowChanges.ts'
import type { RevisionView } from '../revisionView.ts'
import type { DesignerEdge, DesignerGraph, DesignerViewport, Point } from '../workspace.ts'
import type { CanvasAction } from './canvasHistory.ts'
import type { DraftChangeContext } from './draftChanges.ts'
import type { PresentationUpdate } from './presentationChanges.ts'
import type { SetNotice } from './workbenchNotice.ts'
import type { ModuleEditorDraft, Workspace$, WorkspaceState } from './workspaceModel.ts'

import { dequal } from 'dequal/lite'
import { controlErrorCode } from '../../../../control/common/errors.ts'
import { createAuthoringId } from '../../../../flow/common/authoring.ts'
import { connect as connectFlowNodes, disconnect as disconnectFlowNodes } from '../../../../flow/common/edgeChanges.ts'
import { inverseFlowChanges } from '../../../../flow/common/inverseChanges.ts'
import { imports as moduleImports, replaceSource as replaceModuleSource } from '../../../../flow/common/moduleChanges.ts'
import {
  setCodeActions,
  setInputSources,
  setConnectorConnection as changeConnectorConnection,
  setTriggerConnection as changeTriggerConnection,
  repairNodeNames,
  updateTriggerConfig,
  updateTriggerSchedule,
} from '../../../../flow/common/nodeChanges.ts'
import { ApiError } from '../api.ts'
import { addNodeIntent } from '../editor/addNodeOptions.ts'
import {
  addNode as addFlowNode,
  applyFlowChanges,
  copyNodes,
  createResource as createFlowResource,
  deleteSelection,
  pasteNodes,
  setInputVariable as changeInputVariable,
  setInputValue as changeInputValue,
  setWaitNotification,
  updateCondition,
  updateTaskPorts,
  updateTaskAdditionalInputs,
  updateNodeDescription,
  updateNodeIcon,
  updateNodeSettings,
  updateNodeName,
  updateSubflow,
  updateTask,
  updateValue,
  updateWait,
  updateWebhook,
} from '../editor/flowChanges.ts'
import { createI18n } from '../i18n.ts'
import { revisionView } from '../revisionView.ts'
import { canvasPresentationChange, restoreCanvasPresentation } from '../workspace.ts'
import { commentIds, designerGraph, removeComments, setComment, setFlowViewport, setNodePositions } from '../workspace.ts'
import { CanvasHistory } from './canvasHistory.ts'
import { DraftChanges } from './draftChanges.ts'
import { FlowCatalog } from './flowCatalog.ts'
import { Latest } from './latest.ts'
import { PresentationChanges } from './presentationChanges.ts'
import { errorNotice } from './workbenchNotice.ts'
import { moduleEditorStatus, selectedModuleEditor, WorkspaceModel } from './workspaceModel.ts'

const PASTE_OFFSET: Point = { x: 40, y: 40 }

interface Clipboard {
  readonly comments: readonly {
    readonly content: string
    readonly position: Point
    readonly sourceId: string
    readonly title: string
  }[]
  readonly nodes: NodeClipboard
}

interface ReconciledRevision {
  readonly revision: RevisionView
  readonly selectedNodeIds: readonly string[]
  readonly target?: GraphTarget
}

function reconcileTarget(revision: RevisionView, target: GraphTarget | undefined): GraphTarget | undefined {
  if (target == null) return
  return target.kind == 'flow' || revision.subflow(target.id) != null ? target : { kind: 'flow' }
}

export class WorkspaceStore {
  readonly #client: WorkbenchClient
  readonly #draftChanges: DraftChanges
  readonly #draftSession = new Latest()
  readonly #i18n: I18n
  readonly #identity: () => string
  readonly #presentationChanges: PresentationChanges
  readonly #flows: FlowCatalog
  readonly #runChanged: (event: Extract<FlowChangeEvent, { readonly kind: 'run.changed' | 'run.created' }>) => void
  readonly #setNotice: SetNotice
  readonly #model: WorkspaceModel
  readonly #moduleDrafts = new Map<string, { editor: ModuleEditorDraft; base: Draft['content']['modules'][string] }>()
  readonly #history = new CanvasHistory()
  public readonly history$: ReadonlyVal<CanvasHistory['state$']['value']> = this.#history.state$
  #historyRecovery?: Promise<void>
  #moduleSave?: Promise<boolean>
  #clipboard?: Clipboard
  #diagnosticFocusId = 0
  #draftInvalidation = 0
  #draftUpdateNotice = false
  #disposed = false
  #draftSyncQueued = false
  #nodeFocusId = 0
  #stopCatalogWatch?: () => void
  #stopFlowWatch?: () => void
  public readonly $: Workspace$

  public constructor(
    client: WorkbenchClient,
    setNotice: SetNotice,
    identity: () => string = createAuthoringId,
    i18n: I18n = createI18n(),
    runChanged: (event: Extract<FlowChangeEvent, { readonly kind: 'run.changed' | 'run.created' }>) => void = () => {},
  ) {
    this.#client = client
    this.#setNotice = setNotice
    this.#identity = identity
    this.#i18n = i18n
    this.#runChanged = runChanged
    this.#flows = new FlowCatalog(client, setNotice, i18n)
    this.#model = new WorkspaceModel(i18n, this.#flows)
    this.#draftChanges = new DraftChanges(client, setNotice, i18n, {
      apply: (draft, preserveDiagnostics) => this.#applyDraft(draft, 'local', preserveDiagnostics),
      beforeChange: (manageBusy) => {
        if (manageBusy) {
          this.#set({ busy: 'designer' })
          this.#setNotice(undefined)
        }
      },
      check: () => void this.#checkTarget(),
      current: (context) => this.#isDraftChangeCurrent(context),
      diagnostics: () => this.#model.value.diagnostics,
      finishChanges: () => {
        if (!this.#disposed && this.#model.value.busy == 'designer') this.#set({ busy: undefined })
      },
      headChanged: (flowId, revisionId) => this.#flows.advanceHead(flowId, revisionId),
      recover: (context) => {
        void this.retryHistorySync()
        return this.#syncDraftHead(context, true)
      },
    })
    this.#presentationChanges = new PresentationChanges(client, setNotice, (presentation) => this.#set({ presentation }), i18n)
    this.$ = this.#model.$
  }

  public dispose(): void {
    this.#disposed = true
    this.#draftSession.invalidate()
    this.#presentationChanges.dispose()
    this.#stopCatalogWatch?.()
    this.#stopFlowWatch?.()
    this.history$.dispose()
    this.#model.dispose()
    this.#flows.dispose()
  }

  public async start(flowId?: string): Promise<void> {
    if (this.#stopCatalogWatch == null) {
      const subscription = this.#client.watchFlowCatalog(() => void this.reloadFlows())
      this.#stopCatalogWatch = subscription.stop
      await subscription.ready
    }
    if (this.#disposed) return
    await this.reloadFlows()
    if (!this.#disposed) await this.selectFlow(flowId)
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
      target: flowId == null ? undefined : { kind: 'flow' },
      workspaceLoadFailed: false,
      workspaceLoading: flowId != null,
    })
    if (flowId == null) return true
    try {
      let invalidated = false
      let pendingRevision: string | undefined
      const subscription = this.#client.watchFlow(
        flowId,
        (revisionId) => {
          if (!current()) return
          if (this.#draftChanges.committed == null) {
            invalidated = true
            pendingRevision = revisionId
          } else if (revisionId != this.#draftChanges.committed.revisionId) {
            void this.#refreshDraft(revisionId)
          }
        },
        (event) => {
          if (current()) this.#runChanged(event)
        },
      )
      this.#stopFlowWatch = subscription.stop
      await subscription.ready
      if (!current()) return false
      const { flow, draft, live, presentation } = await this.#client.getEditor(flowId)
      if (!current()) return false
      this.#draftChanges.reset(draft)
      this.#presentationChanges.reset(presentation)
      this.#flows.include(flow)
      this.#set({
        draft,
        live,
        presentation,
        target: { kind: 'flow' },
        workspaceLoadFailed: false,
        workspaceLoading: false,
      })
      await this.#repairDraftNodeNames(current)
      if (invalidated && pendingRevision != draft.revisionId) void this.#refreshDraft(pendingRevision)
    } catch (error) {
      if (!current()) return false
      this.#stopFlowWatch?.()
      this.#stopFlowWatch = undefined
      const missing = error instanceof ApiError && error.code == controlErrorCode.flowNotFound
      this.#set(
        missing
          ? { flowId: undefined, target: undefined, workspaceLoadFailed: false, workspaceLoading: false }
          : { workspaceLoadFailed: true, workspaceLoading: false },
      )
      this.#setNotice(missing ? { kind: 'error', message: this.#i18n.t('notice.flowMissing') } : errorNotice(error, this.#i18n.t))
      return false
    }
    return true
  }

  public selectTarget(target: GraphTarget | undefined): boolean {
    if (this.#history.applying) return false
    if (!dequal(target, this.#model.value.target)) this.#history.clear()
    void this.#flushModules()
    this.#set({
      diagnosticFocus: undefined,
      diagnostics: undefined,
      moduleEditor: undefined,
      nodeFocus: undefined,
      selectedNodeIds: [],
      target,
    })
    void this.#checkTarget()
    return true
  }

  public selectNodes(nodeIds: readonly string[]): boolean {
    if (nodeIds.length == this.#model.value.selectedNodeIds.length && nodeIds.every((nodeId, index) => nodeId == this.#model.value.selectedNodeIds[index]))
      return true
    void this.#flushModules()
    this.#set({
      diagnosticFocus: undefined,
      moduleEditor: selectedModuleEditor(
        this.#model.value.draft == null ? undefined : revisionView(this.#model.value.draft),
        this.#model.value.target,
        nodeIds,
      ),
      nodeFocus: undefined,
      selectedNodeIds: nodeIds,
    })
    return true
  }

  public async createFlow(name: string, create?: (name: string) => Promise<string>): Promise<Flow | undefined> {
    if (!(await this.saveModuleEditor())) return
    this.#set({ busy: 'flow' })
    this.#setNotice(undefined)
    try {
      if (create == null) return await this.#flows.create(name)
      const flow = await this.#client.getFlow(await create(name))
      this.#flows.insert(flow)
      return flow
    } catch (error) {
      if (!this.#disposed) this.#setNotice(errorNotice(error, this.#i18n.t))
    } finally {
      this.#set({ busy: undefined })
    }
  }

  public async deleteFlow(flowId: string): Promise<boolean> {
    if (!(await this.saveModuleEditor())) return false
    const flow = this.#flows.flow(flowId)
    if (flow == null || flow.status == 'retiring') return false
    this.#set({ busy: 'flow' })
    this.#setNotice(undefined)
    try {
      await this.#client.deleteFlow(flowId)
      if (this.#disposed) return false
      this.#flows.remove(flowId)
      this.#setNotice({ kind: 'success', message: this.#i18n.t('notice.flowDeleteAccepted', { name: flow.name }) })
      return true
    } catch (error) {
      if (!this.#disposed) this.#setNotice(errorNotice(error, this.#i18n.t))
      return false
    } finally {
      this.#set({ busy: undefined })
    }
  }

  public async createResource(name: string): Promise<boolean> {
    if (!(await this.saveModuleEditor())) return false
    if (this.#model.value.draft == null) return false
    const id = this.#identity()
    this.#set({ busy: 'resource' })
    this.#setNotice(undefined)
    const changed = await this.#changeDraft(createFlowResource(id, name), false)
    this.#set({ busy: undefined })
    if (changed == null) return false
    this.selectTarget({ id, kind: 'subflow' })
    this.#setNotice({
      kind: 'success',
      message: this.#i18n.t('notice.createdInDraft', { name }),
    })
    return true
  }

  public async renameFlow(flowId: string, name: string): Promise<boolean> {
    const flow = this.#flows.flow(flowId)
    const nextName = name.trim()
    if (flow == null || nextName.length == 0) return false
    if (flow.name == nextName) return true
    this.#set({ busy: 'flow' })
    this.#setNotice(undefined)
    let changed: Flow | undefined
    try {
      changed = await this.#client.renameFlow(flowId, nextName)
      if (changed != null) this.#flows.include(changed)
    } catch (error) {
      if (!this.#disposed) this.#setNotice(errorNotice(error, this.#i18n.t))
    }
    this.#set({ busy: undefined })
    if (changed == null) return false
    this.#setNotice({
      kind: 'success',
      message: this.#i18n.t('notice.flowRenamed', { name: nextName }),
    })
    return true
  }

  public async addNode(option: AddNodeOption, position: Point, connection?: (nodeId: string) => Omit<DesignerEdge, 'id'>): Promise<string | undefined> {
    if (!(await this.saveModuleEditor())) return
    const draft = this.#model.value.draft
    const target = this.#model.value.target
    if (draft == null || target == null) return
    const nodeId = this.#identity()
    if (option.kind == 'comment') return await this.#addComment(target, nodeId, position)
    const revision = revisionView(draft)
    const intent = addNodeIntent(option, revision, target, this.#i18n.t)
    if (intent == null) return
    const edge = connection?.(nodeId)
    const nodeChanges = addFlowNode(revision, target, nodeId, intent, this.#identity)
    if (nodeChanges == null) return
    const changes =
      edge == null
        ? nodeChanges
        : [
            ...nodeChanges,
            ...connectFlowNodes(applyFlowChanges(draft, nodeChanges).content, target, {
              source: edge.source,
              target: edge.target,
              ...(edge.sourceHandle.startsWith('$branch:') ? { sourceHandle: edge.sourceHandle.slice(8) } : {}),
            }),
          ]
    if (!(await this.#canvasChange('add', 1, changes, (value) => setNodePositions(value, target, { [nodeId]: position }), [nodeId]))) return
    if (this.#disposed) return
    this.#set({ nodeFocus: { nodeId, requestId: ++this.#nodeFocusId } })
    return nodeId
  }

  public async connect(edge: Omit<DesignerEdge, 'id'>): Promise<void> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return
    const changes = connectFlowNodes(revision.revision.content, target, {
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle.startsWith('$branch:') ? { sourceHandle: edge.sourceHandle.slice(8) } : {}),
    })
    if (changes.length > 0) await this.#canvasChange('connect', 1, changes)
  }

  public async disconnect(edge: DesignerEdge): Promise<void> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return
    const changes = disconnectFlowNodes(revision.revision.content, target, {
      source: edge.source,
      target: edge.target,
      ...(edge.sourceHandle.startsWith('$branch:') ? { sourceHandle: edge.sourceHandle.slice(8) } : {}),
    })
    if (changes.length > 0) await this.#canvasChange('disconnect', 1, changes)
  }

  public async deleteSelectedNodes(): Promise<void> {
    if (!(await this.saveModuleEditor())) return
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null || this.#model.value.selectedNodeIds.length == 0) return
    const comments = commentIds(this.#model.value.presentation?.value ?? {}, target)
    const commentNodes = new Set(this.#model.value.selectedNodeIds.filter((nodeId) => comments.has(nodeId)))
    const changes = deleteSelection(revision, target, this.#model.value.selectedNodeIds)
    await this.#canvasChange(
      'delete',
      this.#model.value.selectedNodeIds.length,
      changes,
      commentNodes.size == 0 ? undefined : (value) => removeComments(value, target, commentNodes),
      [],
    )
  }

  public copySelectedNodes(): void {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null || this.#model.value.selectedNodeIds.length == 0) return
    const selected = new Set(this.#model.value.selectedNodeIds)
    this.#clipboard = {
      comments: this.#designer().nodes.flatMap((node) =>
        node.kind == 'comment' && selected.has(node.id)
          ? [
              {
                content: node.content,
                position: node.position,
                sourceId: node.id,
                title: node.title,
              },
            ]
          : [],
      ),
      nodes: copyNodes(revision, target, this.#model.value.selectedNodeIds),
    }
  }

  public async pasteNodes(sourcePositions?: Readonly<Record<string, Point>>, offset: Point = PASTE_OFFSET): Promise<void> {
    if (!(await this.saveModuleEditor())) return
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null || this.#clipboard == null) return
    const pasted = pasteNodes(revision, target, this.#clipboard.nodes, this.#identity)
    const comments = this.#clipboard.comments.map((comment) => ({
      ...comment,
      nodeId: this.#identity(),
    }))
    if (pasted.nodeIds.length == 0 && comments.length == 0) return
    const designerNodes = new Map(this.#designer().nodes.map((node) => [node.id, node]))
    const added = new Set([...pasted.nodeIds, ...comments.map((comment) => comment.nodeId)])
    const occupied = new Set([...designerNodes].filter(([nodeId]) => !added.has(nodeId)).map(([, node]) => `${node.position.x}\0${node.position.y}`))
    const sources = [
      ...pasted.sourceIds.map((sourceId) => sourcePositions?.[sourceId] ?? designerNodes.get(sourceId)?.position ?? { x: 80, y: 80 }),
      ...comments.map((comment) => comment.position),
    ]
    let step = 1
    if (offset.x != 0 || offset.y != 0) {
      while (sources.some((source) => occupied.has(`${source.x + offset.x * step}\0${source.y + offset.y * step}`))) step += 1
    }
    const positions = Object.fromEntries(
      pasted.sourceIds.map((sourceId, index) => {
        const source = sourcePositions?.[sourceId] ?? designerNodes.get(sourceId)?.position
        return [
          pasted.nodeIds[index]!,
          {
            x: (source?.x ?? 80) + offset.x * step,
            y: (source?.y ?? 80) + offset.y * step,
          },
        ]
      }),
    )
    await this.#canvasChange(
      'paste',
      added.size,
      pasted.changes,
      (value) => {
        let next = setNodePositions(value, target, positions)
        for (const comment of comments) {
          next = setComment(next, target, comment.nodeId, {
            content: comment.content,
            position: { x: comment.position.x + offset.x * step, y: comment.position.y + offset.y * step },
            title: this.#i18n.t('addNode.commentCopy', { title: comment.title }),
          })
        }
        return next
      },
      [...pasted.nodeIds, ...comments.map((comment) => comment.nodeId)],
    )
  }

  public async duplicateSelectedNodes(positions?: Readonly<Record<string, Point>>, offset?: Point): Promise<void> {
    this.copySelectedNodes()
    await this.pasteNodes(positions, offset)
  }

  public async saveNodeSettings(nodeId: string, settings: NodeSettings): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return false
    const changes = updateNodeSettings(revision, target, nodeId, settings)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async saveNodeDescription(nodeId: string, description: string | undefined): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return false
    const changes = updateNodeDescription(revision, target, nodeId, description)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async saveNodeIcon(nodeId: string, icon: string | undefined): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return false
    const changes = updateNodeIcon(revision, target, nodeId, icon)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async saveNodeTitle(nodeId: string, title: string | undefined): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return false
    const changes = updateNodeName(revision, target, nodeId, title)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async setInputValue(nodeId: string, handle: string, value: JsonValue | undefined): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return false
    const changes = changeInputValue(revision, target, nodeId, handle, value)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async setInputSource(nodeId: string, handle: string, source: { readonly nodeId: string; readonly output: string }): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return false
    return (await this.#changeDraft(setInputSources(revision.revision.content, target, nodeId, handle, [{ kind: 'node', ...source }]))) != null
  }

  public async setInputVariable(nodeId: string, handle: string, name: string | undefined): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return false
    const changes =
      name == null
        ? changeInputValue(revision, target, nodeId, handle, undefined)
        : changeInputVariable(revision, target, nodeId, handle, name, this.#identity())
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async saveCondition(nodeId: string, settings: ConditionSettings): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return false
    const changes = updateCondition(revision, target, nodeId, settings)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async saveValue(nodeId: string, values: readonly ValueSettings[]): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return false
    const changes = updateValue(revision, target, nodeId, values)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async saveWait(
    nodeId: string,
    settings: Pick<Extract<GraphNode, { readonly kind: 'wait' }>, 'actions' | 'prompt'> & {
      readonly name?: string
      readonly notification: Extract<GraphNode, { readonly kind: 'wait' }>['notification']
    },
  ): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target?.kind != 'flow') return false
    const changes = updateWait(revision, target, nodeId, settings)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async setWaitNotification(nodeId: string, action: ConnectorAction): Promise<boolean> {
    const revision = this.$.revision.value
    const changes = revision == null ? undefined : setWaitNotification(revision, nodeId, action, this.#identity())
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async saveComment(nodeId: string, comment: { readonly content: string; readonly title: string }): Promise<void> {
    const target = this.#model.value.target
    if (target == null) return
    const position = this.#designer().nodes.find((node) => node.id == nodeId)?.position
    if (position == null) return
    await this.#changePresentation((value) => setComment(value, target, nodeId, { ...comment, position }))
  }

  public async saveTaskSettings(nodeId: string, settings: TaskSettings): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return false
    const changes = updateTask(revision, target, nodeId, settings)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async saveCodeActions(nodeId: string, capabilities: readonly ConnectorCapability[]): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return false
    const changes = setCodeActions(revision.revision.content, target, nodeId, capabilities)
    return changes == null || (await this.#changeDraft(changes)) != null
  }

  public async saveTaskPorts(nodeId: string, ports: TaskPorts): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return false
    const changes = updateTaskPorts(revision, target, nodeId, ports)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async saveTaskAdditionalInputs(nodeId: string, inputs: readonly InputPort[]): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return false
    const changes = updateTaskAdditionalInputs(revision, target, nodeId, inputs)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async setConnectorConnection(taskId: string, connectionId: string): Promise<boolean> {
    const revision = this.$.revision.value
    if (revision == null) return false
    const changes = changeConnectorConnection(revision.revision.content, taskId, connectionId)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async saveTriggerConfig(triggerId: string, name: string, value: JsonValue | undefined): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target?.kind != 'flow') return false
    const changes = updateTriggerConfig(revision.revision.content, target, triggerId, name, value)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async saveTriggerSchedule(triggerId: string, schedule: readonly TriggerSchedule[]): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target?.kind != 'flow') return false
    const changes = updateTriggerSchedule(revision.revision.content, target, triggerId, schedule)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async saveWebhook(triggerId: string, settings: WebhookSettings): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target?.kind != 'flow') return false
    const changes = updateWebhook(revision, target, triggerId, settings)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async setTriggerConnection(triggerId: string, connectionId: string): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target?.kind != 'flow') return false
    const changes = changeTriggerConnection(revision.revision.content, target, triggerId, connectionId)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public async saveSubflowSettings(subflowId: string, settings: SubflowSettings): Promise<boolean> {
    const revision = this.$.revision.value
    if (revision == null) return false
    const changes = updateSubflow(revision, subflowId, settings)
    return changes != null && (await this.#changeDraft(changes)) != null
  }

  public updateModuleSource(source: string): void {
    const editor = this.#model.value.moduleEditor
    if (this.#history.applying || this.#history.failed || editor == null || editor.source == source) return
    this.#clearHistoryForEdit()
    const pending = this.#moduleDrafts.get(editor.moduleId)
    const base = pending?.base ?? this.#model.value.draft?.content.modules[editor.moduleId]
    if (base == null) return
    this.#moduleDrafts.set(editor.moduleId, { base, editor: { ...editor, phase: undefined, source } })
    this.#publishEditor()
  }

  public discardModuleChanges(): void {
    const editor = this.#model.value.moduleEditor
    if (editor == null || this.#moduleSave != null) return
    this.#moduleDrafts.delete(editor.moduleId)
    const module = this.#model.value.draft?.content.modules[editor.moduleId]
    this.#set({ moduleEditor: module == null ? undefined : { moduleId: editor.moduleId, source: module.source } })
  }

  public get hasUnsavedCode(): boolean {
    return this.#moduleDrafts.size > 0
  }

  public async saveModuleEditor(): Promise<boolean> {
    if (this.#disposed) return false
    for (const pending of this.#moduleDrafts.values()) {
      if (pending.editor.phase == 'failed') pending.editor = { ...pending.editor, phase: undefined }
    }
    this.#publishEditor()
    return await this.#flushModules()
  }

  #flushModules(): Promise<boolean> {
    if (this.#moduleSave != null) return this.#moduleSave
    if (this.#disposed) return Promise.resolve(false)
    if (![...this.#moduleDrafts.values()].some((pending) => pending.editor.phase != 'failed')) return Promise.resolve(this.#moduleDrafts.size == 0)
    const current = this.#draftSession.capture()
    this.#moduleSave = this.#saveModules(current).finally(() => {
      this.#moduleSave = undefined
    })
    return this.#moduleSave
  }

  async #saveModules(current: () => boolean): Promise<boolean> {
    while (!this.#disposed && current()) {
      const entry = [...this.#moduleDrafts.entries()].find(([, pending]) => pending.editor.phase != 'failed')
      if (entry == null) return this.#moduleDrafts.size == 0
      const [moduleId, pending] = entry
      const source = pending.editor.source
      pending.editor = { ...pending.editor, phase: 'saving' }
      this.#publishEditor()
      try {
        const imports = await moduleImports(source)
        if (this.#disposed || !current()) return false
        const module = this.#model.value.draft?.content.modules[moduleId]
        if (module == null || module.source != pending.base.source || JSON.stringify(module.imports) != JSON.stringify(pending.base.imports)) {
          throw new Error(this.#i18n.t('notice.moduleUpdated'))
        }
        const changed =
          source == module.source && JSON.stringify(imports) == JSON.stringify(module.imports)
            ? this.#model.value.draft
            : await this.#changeDraft(replaceModuleSource(moduleId, pending.base.source, pending.base.imports, source, imports), false)
        if (this.#disposed || !current()) return false
        const latest = this.#moduleDrafts.get(moduleId)
        if (latest == null) continue
        if (changed == null) {
          latest.editor = { ...latest.editor, phase: 'failed' }
        } else if (latest.editor.source == source) {
          this.#moduleDrafts.delete(moduleId)
          if (this.#model.value.moduleEditor?.moduleId == moduleId) this.#set({ moduleEditor: { moduleId, source } })
        } else {
          latest.base = { ...pending.base, source, imports }
          latest.editor = { ...latest.editor, phase: undefined }
        }
      } catch (error) {
        if (this.#disposed || !current()) return false
        const latest = this.#moduleDrafts.get(moduleId)
        if (latest != null) latest.editor = { ...latest.editor, phase: 'failed' }
        this.#setNotice(errorNotice(error, this.#i18n.t))
      }
      this.#publishEditor()
    }
    return false
  }

  public async moveNodes(positions: Readonly<Record<string, Point>>): Promise<void> {
    const target = this.#model.value.target
    if (target == null) return
    await this.#canvasChange('move', Object.keys(positions).length, [], (value) => setNodePositions(value, target, positions))
  }

  public async moveViewport(viewport: DesignerViewport): Promise<void> {
    const target = this.#model.value.target
    if (target == null) return
    await this.#changePresentation((value) => setFlowViewport(value, target, viewport), true)
  }

  public async check(): Promise<void> {
    await this.#checkTarget()
  }

  public async refreshFlows(): Promise<void> {
    await this.reloadFlows()
  }

  public updateLive(live: Live): void {
    if (live.flowId == this.#model.value.flowId) this.#set({ live })
  }

  public locateNode(nodeId: string): boolean {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null || revision.node(target, nodeId) == null || !this.selectNodes([nodeId])) return false
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

  async #addComment(target: GraphTarget, nodeId: string, position: Point): Promise<string | undefined> {
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
        setComment(value, target, nodeId, {
          content: '',
          position,
          title: this.#i18n.t('addNode.commentName', { number: number + 1 }),
        }),
      [nodeId],
    )
    if (!(await change) || this.#disposed) return
    return nodeId
  }

  async #changeDraft(changes: FlowChanges, manageBusy = true, historyOwned = false): Promise<Draft | undefined> {
    if (this.#disposed || ((this.#history.applying || this.#history.failed) && !historyOwned)) return
    const flowId = this.#model.value.flowId
    const draft = this.#model.value.draft
    if (flowId == null || draft == null) return
    if (changes.length == 0 || dequal(applyFlowChanges(draft, changes).content, draft.content)) return draft
    const cleared = !historyOwned && this.#history.clear()
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

  async #repairDraftNodeNames(current: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 2 && current(); attempt += 1) {
      const draft = this.#model.value.draft
      if (draft == null) return
      const repairs = repairNodeNames(draft.content)
      if (repairs.length == 0) {
        void this.#checkTarget()
        return
      }
      const changed = await this.#changeDraft(repairs, false)
      if (changed != null || !current()) return
      if (this.#model.value.draft?.revisionId == draft.revisionId) break
    }
    if (current()) void this.#checkTarget()
  }

  #applyDraft(draft: Draft, origin: 'local' | 'external', preserveDiagnostics = false): boolean {
    const previousDraft = this.#model.value.draft
    const { revision, selectedNodeIds, target } = this.#reconcileRevision(draft)
    const editor = this.#model.value.moduleEditor
    const keepEditor = editor != null && (origin == 'external' || previousDraft != null) && moduleEditorStatus(previousDraft, editor) != 'saved'
    let moduleEditor: ModuleEditorDraft | undefined
    if (keepEditor) moduleEditor = origin == 'external' ? { ...editor, phase: 'failed' } : editor
    else moduleEditor = selectedModuleEditor(revision, target, selectedNodeIds)
    this.#set({
      diagnostics: preserveDiagnostics ? this.#model.value.diagnostics : undefined,
      draft,
      moduleEditor,
      selectedNodeIds,
      target,
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
  ): Promise<boolean> {
    if (this.#disposed || this.#history.applying || this.#history.failed) return false
    const { draft, target, presentation, selectedNodeIds } = this.#model.value
    if (draft == null || target == null || presentation == null) return false
    const next = update?.(presentation.value) ?? presentation.value
    const presentationChange = canvasPresentationChange(presentation.value, next, target)
    if (dequal(applyFlowChanges(draft, changes).content, draft.content) && presentationChange.nodeIds.length == 0) return true
    const generation = this.#history.generation
    const inverse = inverseFlowChanges(draft.content, changes)
    this.#history.pending++
    const retained = this.#history.record({
      action,
      count,
      target,
      forward: changes,
      inverse,
      presentation: presentationChange,
      beforeSelection: selectedNodeIds,
      afterSelection: selection,
    })
    try {
      const change = changes.length == 0 ? Promise.resolve(draft) : this.#changeDraft(changes, true, true)
      const layout = update == null ? Promise.resolve(true) : this.#changePresentation(update, true)
      this.selectNodes(selection)
      if (!retained) this.#setNotice({ kind: 'success', message: this.#i18n.t('history.tooLarge') })
      const [saved, positioned] = await Promise.all([change, layout])
      return saved != null && positioned && (!retained || generation == this.#history.generation)
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
    const state = this.history$.value
    if (!(redo ? state.canRedo : state.canUndo)) return
    const entry = redo ? state.redo : state.undo
    if (entry == null) return
    const generation = this.#history.generation
    this.#history.applying = true
    this.#history.publish()
    try {
      const [draft, presentation] = await Promise.all([
        this.#changeDraft(redo ? entry.forward : entry.inverse, true, true),
        this.#changePresentation((value) => restoreCanvasPresentation(value, entry.target, entry.presentation, redo), true),
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
        this.#flows.advanceHead(flowId, draft.revisionId)
        this.#history.failed = false
        this.#setNotice({ kind: 'error', message: this.#i18n.t('history.resynced') })
        void this.#checkTarget()
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

  async #checkTarget(): Promise<void> {
    if (this.#disposed) return
    const flowId = this.#model.value.flowId
    const draft = this.#model.value.draft
    const target = this.#model.value.target
    if (flowId == null || draft == null || target == null) {
      if (target == null) this.#set({ checkLoading: false, diagnostics: undefined })
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
      this.#flows.advanceHead(context.flowId, committed.revisionId)
      if (notifyUpdate) {
        this.#setNotice({
          kind: preserveModuleEditor ? 'error' : 'success',
          message: this.#i18n.t(preserveModuleEditor ? 'notice.moduleUpdated' : 'notice.draftUpdated'),
        })
      }
      void this.#checkTarget()
      return true
    } catch (error) {
      if (reportError && this.#isDraftChangeCurrent(context)) this.#setNotice(errorNotice(error, this.#i18n.t))
      return false
    }
  }

  #designer(): DesignerGraph {
    const state = this.#model.value
    return designerGraph(state.draft, state.target, state.presentation?.value, state.diagnostics?.diagnostics, {}, {}, this.#i18n.t)
  }

  #reconcileRevision(draft: Draft): ReconciledRevision {
    const revision = revisionView(draft)
    const target = reconcileTarget(revision, this.#model.value.target)
    const selectedNodeIds = this.#model.value.selectedNodeIds.filter((nodeId) => target != null && revision.selection(target, nodeId) != null)
    return { revision, selectedNodeIds, target }
  }

  #isDraftChangeCurrent(context: DraftChangeContext): boolean {
    return !this.#disposed && context.flowId == this.#model.value.flowId && context.current()
  }

  #editorState(editor: ModuleEditorDraft | undefined): Pick<WorkspaceState, 'moduleEditor' | 'moduleSaveStatus'> {
    const moduleEditor = editor == null ? undefined : (this.#moduleDrafts.get(editor.moduleId)?.editor ?? editor)
    let moduleSaveStatus: WorkspaceState['moduleSaveStatus']
    if ([...this.#moduleDrafts.values()].some((pending) => pending.editor.phase == 'failed')) moduleSaveStatus = 'failed'
    else if (this.#moduleDrafts.size > 0) moduleSaveStatus = 'saving'
    return { moduleEditor, moduleSaveStatus }
  }

  #publishEditor(): void {
    if (!this.#disposed) this.#model.set(this.#editorState(this.#model.value.moduleEditor))
  }

  #set(patch: Partial<WorkspaceState>): void {
    if (this.#disposed) return
    const editor = Object.hasOwn(patch, 'moduleEditor') ? patch.moduleEditor : this.#model.value.moduleEditor
    this.#model.set({ ...patch, ...this.#editorState(editor) })
  }
}
