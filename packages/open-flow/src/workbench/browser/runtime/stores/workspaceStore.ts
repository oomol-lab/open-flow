import type { I18n } from 'val-i18n'
import type { FlowDisplayMode } from '../../../../designer/common/flowDisplay.ts'
import type { Settings as NodeSettings, TriggerSettings } from '../../../../flow/common/nodeChanges.ts'
import type { WorkbenchClient, ConnectorAction, Draft, Flow, GraphNode, InputPort, JsonValue, Live, TriggerSchedule } from '../api.ts'
import type { FlowChangeEvent } from '../contract.ts'
import type { AddNodeOption } from '../designer/addNodeOptions.ts'
import type { DiagnosticItem } from '../designer/diagnostics.ts'
import type {
  ConditionSettings,
  CodeTaskPorts,
  DesignerTarget,
  NodeClipboard,
  FlowChanges,
  SubflowSettings,
  TaskSettings,
  ValueSettings,
  WebhookSettings,
} from '../designer/flowChanges.ts'
import type { RevisionView } from '../revisionView.ts'
import type { DesignerEdge, DesignerGraph, DesignerViewport, Point } from '../workspace.ts'
import type { DraftChangeContext } from './draftChanges.ts'
import type { PresentationUpdate } from './presentationChanges.ts'
import type { SetNotice } from './workbenchNotice.ts'
import type { ModuleEditorDraft, Workspace$, WorkspaceState } from './workspaceModel.ts'

import { createAuthoringId } from '../../../../flow/common/authoring.ts'
import { connect as connectFlowNodes, disconnect as disconnectFlowNodes } from '../../../../flow/common/edgeChanges.ts'
import { imports as moduleImports, replaceSource as replaceModuleSource } from '../../../../flow/common/moduleChanges.ts'
import {
  setConnectorConnection as changeConnectorConnection,
  setTriggerConnection as changeTriggerConnection,
  updateTrigger,
  updateTriggerConfig,
  updateTriggerSchedule,
} from '../../../../flow/common/nodeChanges.ts'
import { addNodeIntent } from '../designer/addNodeOptions.ts'
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
  updateCodeTaskPorts,
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
} from '../designer/flowChanges.ts'
import { createI18n } from '../i18n.ts'
import { revisionView } from '../revisionView.ts'
import { commentIds, designerGraph, removeComments, setComment, setFlowViewport, setNodePositions } from '../workspace.ts'
import { DraftChanges } from './draftChanges.ts'
import { FlowCatalog } from './flowCatalog.ts'
import { Latest } from './latest.ts'
import { PresentationChanges } from './presentationChanges.ts'
import { errorNotice } from './workbenchNotice.ts'
import { moduleEditorStatus, selectedModuleEditor, WorkspaceModel } from './workspaceModel.ts'

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
  readonly target?: DesignerTarget
}

function reconcileTarget(revision: RevisionView, target: DesignerTarget | undefined): DesignerTarget | undefined {
  if (target == null) return
  return target.kind == 'flow' || revision.subflow(target.id) != null ? target : { kind: 'flow' }
}

function connectedCodePorts(draft: Draft, target: DesignerTarget, nodeId: string, edge: Omit<DesignerEdge, 'id'>): CodeTaskPorts | undefined {
  const nodes = designerGraph(draft, target).nodes
  if (edge.target == nodeId) {
    const source = nodes.find((node) => node.id == edge.source)
    if (source == null || source.kind == 'comment') return
    const port = source.outputs.find((output) => 'handle' in output && output.handle == edge.sourceHandle)
    if (port == null || !('handle' in port)) return
    return {
      inputs: [
        {
          description: port.description,
          handle: edge.targetHandle,
          jsonSchema: (port.jsonSchema ?? {}) as JsonValue,
          nullable: port.nullable ?? false,
          value: null,
        },
      ],
      outputs: [{ handle: 'result', jsonSchema: {}, nullable: true }],
    }
  }
  if (edge.source == nodeId) {
    const targetNode = nodes.find((node) => node.id == edge.target)
    if (targetNode == null || targetNode.kind == 'comment') return
    const port = targetNode.inputs.find((input) => 'handle' in input && input.handle == edge.targetHandle)
    if (port == null || !('handle' in port)) return
    return {
      inputs: [{ handle: 'value', jsonSchema: {}, nullable: true, value: null }],
      outputs: [
        {
          description: port.description,
          handle: edge.sourceHandle,
          jsonSchema: (port.jsonSchema ?? {}) as JsonValue,
          nullable: port.nullable ?? false,
        },
      ],
    }
  }
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
      apply: (draft, preserveDiagnostics) => this.#applyProjectedDraft(draft, preserveDiagnostics),
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
      headChanged: (flowId, revisionId) => this.#advanceFlowHead(flowId, revisionId),
      recover: (context) => this.#syncDraftHead(context, true),
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
    this.#model.dispose()
    this.#flows.dispose()
  }

  public async start(flowId?: string): Promise<void> {
    this.#stopCatalogWatch ??= this.#client.watchFlowCatalog(() => void this.reloadFlows())
    await this.reloadFlows()
    await this.selectFlow(flowId)
  }

  public async reloadFlows(): Promise<void> {
    await this.#flows.reload()
  }

  public async loadMoreFlows(): Promise<void> {
    await this.#flows.loadMore()
  }

  public async selectFlow(flowId: string | undefined): Promise<boolean> {
    if (!this.#allowModuleNavigation()) return false
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
      const knownFlow = this.#flows.flow(flowId)
      const [flow, draft, live, presentation] = await Promise.all([
        knownFlow ?? this.#client.getFlow(flowId),
        this.#client.getDraft(flowId),
        this.#client.getLive(flowId),
        this.#client.getPresentation(flowId),
      ])
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
      void this.#checkTarget()
      this.#stopFlowWatch = this.#client.watchFlow(
        flowId,
        (revisionId) => {
          if (!this.#disposed && revisionId != this.#draftChanges.committed?.revisionId) void this.#refreshDraft(revisionId)
        },
        this.#runChanged,
      )
    } catch (error) {
      if (!current()) return false
      this.#set({ workspaceLoadFailed: true, workspaceLoading: false })
      this.#setNotice(errorNotice(error, this.#i18n.t))
      return false
    }
    return true
  }

  public selectTarget(target: DesignerTarget | undefined): boolean {
    if (!this.#allowModuleNavigation()) return false
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
    if (!this.#allowModuleNavigation()) return false
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
    if (!this.#allowModuleNavigation()) return
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
    if (!this.#allowModuleNavigation()) return false
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
    if (!this.#allowModuleNavigation()) return false
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
    if (!this.#allowModuleNavigation()) return
    const draft = this.#model.value.draft
    const target = this.#model.value.target
    if (draft == null || target == null) return
    const nodeId = this.#identity()
    if (option.kind == 'comment') return await this.#addComment(target, nodeId, position)
    const revision = revisionView(draft)
    let intent = addNodeIntent(option, revision, target, this.#i18n.t)
    if (intent == null) return
    const edge = connection?.(nodeId)
    if (intent.kind == 'code' && edge != null) {
      const ports = connectedCodePorts(draft, target, nodeId, edge)
      if (ports == null) return
      intent = { ...intent, ports }
    }
    const nodeChanges = addFlowNode(revision, target, nodeId, intent, this.#identity)
    if (nodeChanges == null) return
    const changes = edge == null ? nodeChanges : [...nodeChanges, ...connectFlowNodes(applyFlowChanges(draft, nodeChanges).content, target, edge)]
    const change = this.#changeDraft(changes)
    this.selectNodes([nodeId])
    const move = this.moveNodes({ [nodeId]: position })
    if ((await change) == null) return
    await move
    if (this.#disposed) return
    this.#set({ nodeFocus: { nodeId, requestId: ++this.#nodeFocusId } })
    return nodeId
  }

  public async connect(edge: Omit<DesignerEdge, 'id'>): Promise<void> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return
    const changes = connectFlowNodes(revision.revision.content, target, edge)
    if (changes.length > 0) await this.#changeDraft(changes)
  }

  public async disconnect(edge: DesignerEdge): Promise<void> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return
    const changes = disconnectFlowNodes(revision.revision.content, target, edge)
    if (changes.length > 0) await this.#changeDraft(changes)
  }

  public async deleteSelectedNodes(): Promise<void> {
    if (!this.#allowModuleNavigation()) return
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null || this.#model.value.selectedNodeIds.length == 0) return
    const comments = commentIds(this.#model.value.presentation?.value ?? {}, target)
    const commentNodes = new Set(this.#model.value.selectedNodeIds.filter((nodeId) => comments.has(nodeId)))
    const changes = deleteSelection(revision, target, this.#model.value.selectedNodeIds)
    const draftChange = changes.length == 0 ? undefined : this.#changeDraft(changes)
    const presentationChange = commentNodes.size == 0 ? undefined : this.#changePresentation((value) => removeComments(value, target, commentNodes))
    this.selectNodes([])
    if (draftChange != null && (await draftChange) == null) return
    await presentationChange
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

  public async pasteNodes(sourcePositions?: Readonly<Record<string, Point>>): Promise<void> {
    if (!this.#allowModuleNavigation()) return
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null || this.#clipboard == null) return
    const pasted = pasteNodes(revision, target, this.#clipboard.nodes, this.#identity)
    const draftChange = pasted.changes.length == 0 ? undefined : this.#changeDraft(pasted.changes)
    const comments = this.#clipboard.comments.map((comment) => ({
      ...comment,
      nodeId: this.#identity(),
    }))
    if (pasted.nodeIds.length == 0 && comments.length == 0) return
    const designerNodes = new Map(this.#designer().nodes.map((node) => [node.id, node]))
    const positions = Object.fromEntries(
      pasted.sourceIds.map((sourceId, index) => {
        const source = sourcePositions?.[sourceId] ?? designerNodes.get(sourceId)?.position
        return [
          pasted.nodeIds[index]!,
          {
            x: (source?.x ?? 80) + 40,
            y: (source?.y ?? 80) + 40,
          },
        ]
      }),
    )
    const presentationChange = this.#changePresentation((value) => {
      let next = setNodePositions(value, target, positions)
      for (const comment of comments) {
        next = setComment(next, target, comment.nodeId, {
          content: comment.content,
          position: { x: comment.position.x + 40, y: comment.position.y + 40 },
          title: this.#i18n.t('addNode.commentCopy', { title: comment.title }),
        })
      }
      return next
    })
    this.selectNodes([...pasted.nodeIds, ...comments.map((comment) => comment.nodeId)])
    if (draftChange != null && (await draftChange) == null) return
    await presentationChange
  }

  public async duplicateSelectedNodes(positions?: Readonly<Record<string, Point>>): Promise<void> {
    this.copySelectedNodes()
    await this.pasteNodes(positions)
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

  public async saveCodeTaskPorts(nodeId: string, ports: CodeTaskPorts): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target == null) return false
    const changes = updateCodeTaskPorts(revision, target, nodeId, ports)
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

  public async saveTriggerSettings(triggerId: string, settings: TriggerSettings): Promise<boolean> {
    const revision = this.$.revision.value
    const target = this.#model.value.target
    if (revision == null || target?.kind != 'flow') return false
    const changes = updateTrigger(revision.revision.content, target, triggerId, settings)
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
    if (editor == null || editor.source == source) return
    this.#set({ moduleEditor: { ...editor, phase: undefined, source } })
  }

  public discardModuleChanges(): void {
    const editor = this.#model.value.moduleEditor
    if (editor == null) return
    const module = this.#model.value.draft?.content.modules[editor.moduleId]
    if (module == null) {
      this.#set({ moduleEditor: undefined })
      return
    }
    this.#set({
      moduleEditor: { moduleId: editor.moduleId, source: module.source },
    })
  }

  public async saveModuleEditor(): Promise<boolean> {
    const editor = this.#model.value.moduleEditor
    if (editor == null || editor.phase == 'saving') return false
    this.#set({ moduleEditor: { ...editor, phase: 'saving' } })
    const imports = await moduleImports(editor.source)
    if (this.#disposed) return false
    const module = this.#model.value.draft?.content.modules[editor.moduleId]
    if (module == null) return false
    const changed = await this.#changeDraft(replaceModuleSource(editor.moduleId, module.source, module.imports, editor.source, imports))
    if (!this.#disposed && this.#model.value.moduleEditor?.moduleId == editor.moduleId) {
      this.#set({
        moduleEditor: {
          ...this.#model.value.moduleEditor,
          phase: changed == null ? 'failed' : undefined,
        },
      })
    }
    return changed != null
  }

  public async moveNodes(positions: Readonly<Record<string, Point>>, displayMode: FlowDisplayMode = 'detail'): Promise<void> {
    const target = this.#model.value.target
    if (target == null) return
    await this.#changePresentation((value) => setNodePositions(value, target, positions, displayMode))
  }

  public async moveViewport(viewport: DesignerViewport, displayMode: FlowDisplayMode = 'detail'): Promise<void> {
    const target = this.#model.value.target
    if (target == null) return
    await this.#changePresentation((value) => setFlowViewport(value, target, viewport, displayMode))
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

  async #addComment(target: DesignerTarget, nodeId: string, position: Point): Promise<string | undefined> {
    const number = Math.max(
      0,
      ...this.#designer().nodes.flatMap((node) => {
        if (node.kind != 'comment') return []
        const match = /#(\d+)$/.exec(node.title)
        return match == null ? [] : [Number(match[1])]
      }),
    )
    const change = this.#changePresentation((value) =>
      setComment(value, target, nodeId, {
        content: '',
        position,
        title: this.#i18n.t('addNode.commentName', { number: number + 1 }),
      }),
    )
    this.selectNodes([nodeId])
    await change
    if (this.#disposed) return
    return nodeId
  }

  async #changeDraft(changes: FlowChanges, manageBusy = true): Promise<Draft | undefined> {
    const flowId = this.#model.value.flowId
    const draft = this.#model.value.draft
    if (flowId == null || draft == null) return
    if (changes.length == 0) return draft
    return await this.#draftChanges.change({ current: this.#draftSession.capture(), flowId }, draft, changes, manageBusy)
  }

  #applyProjectedDraft(draft: Draft, preserveDiagnostics = false): RevisionView {
    const previousDraft = this.#model.value.draft
    const { revision, selectedNodeIds, target } = this.#reconcileRevision(draft)
    const currentEditor = this.#model.value.moduleEditor
    this.#set({
      diagnostics: preserveDiagnostics ? this.#model.value.diagnostics : undefined,
      draft,
      moduleEditor:
        currentEditor != null && previousDraft != null && moduleEditorStatus(previousDraft, currentEditor) != 'saved'
          ? currentEditor
          : selectedModuleEditor(revision, target, selectedNodeIds),
      selectedNodeIds,
      target,
    })
    return revision
  }

  async #changePresentation(update: PresentationUpdate): Promise<void> {
    if (this.#disposed) return
    const flowId = this.#model.value.flowId
    const presentation = this.#model.value.presentation
    if (flowId != null && presentation != null) await this.#presentationChanges.change(flowId, presentation, this.#flows.capture(), update)
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

      const preserveDiagnostics = false
      const preserveModuleEditor = this.#applyExternalDraft(committed, preserveDiagnostics)
      this.#advanceFlowHead(context.flowId, committed.revisionId)
      if (notifyUpdate) {
        this.#setNotice({
          kind: preserveModuleEditor ? 'error' : 'success',
          message: this.#i18n.t(preserveModuleEditor ? 'notice.moduleUpdated' : 'notice.draftUpdated'),
        })
        if (!preserveDiagnostics) void this.#checkTarget()
      }
      return true
    } catch (error) {
      if (reportError && this.#isDraftChangeCurrent(context)) this.#setNotice(errorNotice(error, this.#i18n.t))
      return false
    }
  }

  #advanceFlowHead(flowId: string, revisionId: string): void {
    this.#flows.advanceHead(flowId, revisionId)
  }

  #designer(): DesignerGraph {
    const state = this.#model.value
    return designerGraph(state.draft, state.target, state.presentation?.value, state.diagnostics?.diagnostics, {}, {}, this.#i18n.t)
  }

  #allowModuleNavigation(): boolean {
    const editor = this.#model.value.moduleEditor
    if (editor == null || moduleEditorStatus(this.#model.value.draft, editor) == 'saved') return true
    this.#setNotice({
      kind: 'error',
      message: this.#i18n.t('notice.unsavedCode'),
    })
    return false
  }

  #reconcileRevision(draft: Draft): ReconciledRevision {
    const revision = revisionView(draft)
    const target = reconcileTarget(revision, this.#model.value.target)
    const selectedNodeIds = this.#model.value.selectedNodeIds.filter((nodeId) => target != null && revision.selection(target, nodeId) != null)
    return { revision, selectedNodeIds, target }
  }

  #applyExternalDraft(committed: Draft, preserveDiagnostics: boolean): boolean {
    const draft = this.#draftChanges.replaceCommitted(committed)
    const editor = this.#model.value.moduleEditor
    const preserveModuleEditor = editor != null && moduleEditorStatus(this.#model.value.draft, editor) != 'saved'
    const reconciled = this.#reconcileRevision(draft)
    const target = reconciled.target
    this.#set({
      diagnostics: preserveDiagnostics ? this.#model.value.diagnostics : undefined,
      draft,
      moduleEditor: this.#moduleEditorAfterExternalDraft(reconciled.revision, target, reconciled.selectedNodeIds),
      selectedNodeIds: reconciled.selectedNodeIds,
      target,
    })
    return preserveModuleEditor
  }

  #moduleEditorAfterExternalDraft(
    revision: RevisionView,
    target: DesignerTarget | undefined,
    selectedNodeIds: readonly string[],
  ): ModuleEditorDraft | undefined {
    const editor = this.#model.value.moduleEditor
    if (editor == null || moduleEditorStatus(this.#model.value.draft, editor) == 'saved') {
      return selectedModuleEditor(revision, target, selectedNodeIds)
    }
    return { ...editor, phase: 'failed' }
  }

  #isDraftChangeCurrent(context: DraftChangeContext): boolean {
    return !this.#disposed && context.flowId == this.#model.value.flowId && context.current()
  }

  #set(patch: Partial<WorkspaceState>): void {
    if (this.#disposed) return
    this.#model.set(patch)
  }
}
