import type { DisposableStore } from '@wopjs/disposable'
import type { Connection as _RFConnection, OnBeforeDelete, OnEdgesChange, OnNodesChange, ReactFlowInstance, Viewport, XYPosition } from '@xyflow/react'
import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { ReactiveMap, ReadonlyReactiveMap } from 'value-enhancer/collections'
import type { NodeId } from '../../../../schema/index.ts'
import type { CanvasDirection } from '../../../common/direction.ts'
import type { AddNodeType } from '../../base/dragNDrop.ts'
import type { RFConnection, RFEdge, RFNode } from '../../base/rfHelpers.ts'
import type { ToReadonly$Group } from '../../base/val.ts'
import type { LayoutPoint } from '../../base/wrapLayout.ts'
import type { FlowCanvasViewEdge, FlowCanvasViewModel, FlowCanvasViewPosition, FlowCanvasViewViewport, ViewCallbacks } from '../../graph/FlowCanvas/model.ts'
import type { NodeEntry } from '../../graph/FlowCanvas/node.tsx'
import type { EdgeStore } from '../edge/edge.store.ts'
import type { RFCommand } from './rfCommand.ts'
import type { FlowRunStatus } from './typings.ts'

import { dispose, disposableStore } from '@wopjs/disposable'
import { compute, derive, val } from 'value-enhancer'
import { reactiveMap } from 'value-enhancer/collections'
import { canvasDirection } from '../../../common/direction.ts'
import { compactLayout } from '../../base/compactLayout.ts'
import { isSameViewport } from '../../base/compare.ts'
import { isInside, isMac } from '../../base/dom.ts'
import { graphLayout } from '../../base/graphLayout.ts'
import { applyEdgeChanges, applyNodeChanges, toManifestHandleName, toManifestNodeId } from '../../base/rfHelpers.ts'
import { coalesce } from '../../base/trivial.ts'
import { wrapLayout } from '../../base/wrapLayout.ts'
import { toViewEdge } from '../../graph/FlowCanvas/model.ts'
import { createNodeEntry, createCommentNodeEntry, updateNodeEntry, updateCommentNodeEntry } from '../../graph/FlowCanvas/node.tsx'
import { createI18n } from '../../i18n/index.ts'
import { getRFEdgeId } from '../edge/edge.store.ts'
import { deriveEdges } from '../edge/edges.ts'
import { CommentNodeStore } from '../node/commentNode.store.ts'
import { NodeStore } from '../node/node.store.ts'
import { getNodeMinimap, NodeMiniMapPhase } from './nodeMiniMap.ts'
import { createRFCommand } from './rfCommand.ts'
import { FLOW_RUN_STATUS } from './typings.ts'

export type InteractiveMode = 'mouse' | 'touchpad'

export interface RFGraph {
  readonly nodes: RFNode[]
  readonly edges: RFEdge[]
}

export interface CanvasStore$$ {
  readonly initialized: Val<boolean>
  readonly editable: Val<boolean>

  readonly viewport: Val<Viewport | undefined>
  readonly miniMapExpanded: Val<boolean | undefined>
  readonly interactiveMode: Val<InteractiveMode>
  readonly direction: Val<CanvasDirection>
  readonly changingDirection: Val<boolean>

  /** Semantic nodes in the current product model. */
  readonly nodes: ReactiveMap<NodeId, NodeStore>
  readonly commentNodes?: ReactiveMap<NodeId, CommentNodeStore>
}

export interface CanvasStore$ extends ToReadonly$Group<CanvasStore$$> {
  readonly initialized: ReadonlyVal<boolean>
  readonly nodes: ReadonlyReactiveMap<NodeId, NodeStore>
  readonly edges: ReadonlyVal<EdgeStore[]>

  /** Selected semantic nodes and comments. */
  readonly selectedNodes: ReadonlyVal<(NodeStore | CommentNodeStore)[]>

  readonly scale: ReadonlyVal<number>

  readonly rfNodes: ReadonlyVal<RFNode[]>
  readonly rfEdges: ReadonlyVal<RFEdge[]>

  readonly runStatus: ReadonlyVal<FlowRunStatus>

  readonly nodeMiniMapPhase: ReadonlyVal<NodeMiniMapPhase>
}

export class CanvasStore {
  public readonly lang$: ReadonlyVal<string>
  public readonly i18n: I18n

  public readonly canDeleteNodes = true

  public readonly dispose: DisposableStore = disposableStore()
  /** Temporary routes used only by an explicitly arranged export canvas. */
  public readonly connectionRoutes = this.dispose.add(val<ReadonlyMap<string, readonly LayoutPoint[]>>(new Map()))
  public readonly ignoredNodeIds = this.dispose.add(val<readonly string[]>([]))
  public readonly ignoreNodes = (nodeIds: readonly string[], ignored: boolean): void => {
    if (this.$.editable.value) this.#callbacks.onIgnoreNodes?.(nodeIds, ignored)
  }

  public get canChangeDirection(): boolean {
    return this.#callbacks.onChangeDirection != null
  }

  public readonly changeDirection = (direction: CanvasDirection): void => {
    if (!this.canChangeDirection || this.$.changingDirection.value || this.$.direction.value === direction) return
    this.layoutComplete = false
    this.layoutMeasurementAttempts = 0
    this.$$.changingDirection.set(true)
    this.$$.direction.set(direction)
  }

  public get canChangeNodeContentHidden(): boolean {
    return this.#callbacks.onChangeNodeContentHidden != null
  }

  public get canChangeNodeWidth(): boolean {
    return this.#callbacks.onChangeNodeWidth != null
  }

  public readonly changeNodeWidth = async (nodeId: string, width: number | undefined, position?: FlowCanvasViewPosition): Promise<boolean> => {
    const node = this.$.nodes.get(nodeId as NodeId)
    if (!this.$.editable.value || this.$.changingDirection.value || this.$.direction.value !== 'vertical' || node?.content$.value.kind !== 'condition')
      return false
    try {
      return (await this.#callbacks.onChangeNodeWidth?.(nodeId, width, position)) ?? false
    } catch (error) {
      console.error('Failed to save node width.', error)
      return false
    }
  }

  public readonly changeNodeContentHidden = (nodeId: string, hidden: boolean): void => {
    if (this.$.editable.value) this.#callbacks.onChangeNodeContentHidden?.(nodeId, hidden)
  }

  public readonly $: CanvasStore$
  public readonly $$: CanvasStore$$

  public readonly rfCommand: RFCommand

  private disposed = false
  private layoutMeasurementAttempts = 0
  private layoutComplete: boolean
  #modelDirection: CanvasDirection = 'horizontal'
  private deletionTimer: ReturnType<typeof setTimeout> | undefined
  private readonly pendingNodeDeletes = new Set<NodeStore | CommentNodeStore>()
  private readonly pendingDisconnects = new Map<string, FlowCanvasViewEdge>()

  #connections: Val<readonly FlowCanvasViewEdge[]>
  readonly #callbacks: ViewCallbacks
  #entries = new Map<string, NodeEntry>()
  #language: Val<string>
  #modelPositions = new Map<string, FlowCanvasViewPosition>()
  #modelViewport: FlowCanvasViewViewport | undefined
  #runStatus: Val<FlowRunStatus>
  #selectedNodeIds = new Set<string>()

  public constructor(
    model: FlowCanvasViewModel,
    editable: boolean,
    language: string,
    callbacks: ViewCallbacks,
    autoLayout = false,
    interactiveMode$?: Val<InteractiveMode>,
  ) {
    this.#callbacks = callbacks
    this.#language = this.dispose.add(val(language))
    this.lang$ = this.#language
    this.i18n = createI18n(language)
    this.dispose.add(this.lang$.reaction((lang) => this.i18n.switchLang(lang)))
    this.dispose.add(() => {
      this.disposed = true
      this.cancelPendingDeletions()
    })
    const nodes = this.dispose.add(reactiveMap<NodeId, NodeStore>(null, { onDeleted: dispose }))
    const commentNodes = this.dispose.add(reactiveMap<NodeId, CommentNodeStore>(null, { onDeleted: dispose }))
    const viewport = this.dispose.add(val<FlowCanvasViewViewport | undefined>(model.viewport, { equal: isSameViewport }))
    this.rfCommand = this.dispose.add(createRFCommand(nodes))
    this.layoutComplete = !autoLayout
    this.#runStatus = this.dispose.add(val<FlowRunStatus>(model.runStatus == 'running' ? FLOW_RUN_STATUS.Running : FLOW_RUN_STATUS.Idle))
    this.#connections = this.dispose.add(val<readonly FlowCanvasViewEdge[]>([]))
    const edges = this.dispose.add(deriveEdges(this.#connections, nodes))
    const rfEdges = this.dispose.add(compute((get) => coalesce(get(edges).map((edge) => get(edge.$.rfEdge)))))
    this.$$ = {
      initialized: this.dispose.add(val(false)),
      editable: this.dispose.add(val(editable)),
      miniMapExpanded: this.dispose.add(val<boolean | undefined>()),
      viewport: viewport,
      interactiveMode: interactiveMode$ ?? this.dispose.add(val<InteractiveMode>('touchpad')),
      direction: this.dispose.add(val(canvasDirection(model.direction))),
      changingDirection: this.dispose.add(val(false)),
      nodes,
      commentNodes,
    }

    const rfNodes = this.dispose.add(compute((get) => [...(get(commentNodes?.$)?.values() ?? []), ...get(nodes.$).values()].map((node) => get(node.$.rfNode))))

    this.$ = {
      ...this.$$,
      nodes,
      commentNodes,
      edges,
      runStatus: this.#runStatus,
      scale: this.dispose.add(derive(viewport, (currentViewport) => 1 / (currentViewport?.zoom || 1))),
      selectedNodes: this.dispose.add(
        compute((get) => {
          const nodeStores: (NodeStore | CommentNodeStore)[] = []
          for (const node of get(nodes.$).values()) {
            if (get(node.$.selected)) {
              nodeStores.push(node)
            }
          }
          if (commentNodes) {
            for (const node of get(commentNodes.$)?.values() ?? []) {
              if (get(node.$.selected)) {
                nodeStores.push(node)
              }
            }
          }
          return nodeStores
        }),
      ),
      rfNodes,
      rfEdges,
      nodeMiniMapPhase: this.dispose.add(compute((get) => getNodeMinimap(get(nodes.$).size + get(commentNodes.$).size, get(viewport)?.zoom ?? 1))),
    }
    this.#syncModel(model)
  }

  /** Initializes the shared layout after React Flow has measured the nodes. */
  public completeLayout = (availableWidth?: number): boolean | 'relayout' => {
    if (this.disposed || this.layoutComplete) return true
    const nodes = this.allLayoutNodes()
    if (nodes.length === 0 && !this.$.changingDirection.value) return true
    for (const node of nodes) {
      const measured = node.$.measured.value
      if (!measured?.width || !measured.height) {
        if (this.layoutMeasurementAttempts++ < 5) return false
        this.layoutMeasurementAttempts = 0
        this.layoutComplete = true
        this.#restoreDirection()
        return true
      }
    }
    const positions = this.layoutPositions(nodes, availableWidth)
    this.applyPositions(positions)
    this.layoutMeasurementAttempts = 0
    this.layoutComplete = true
    if (this.$.changingDirection.value) void this.#saveDirection(positions)
    else this.#callbacks.onMoveNodes(positions)
    return 'relayout'
  }

  async #saveDirection(positions: Readonly<Record<string, FlowCanvasViewPosition>>): Promise<void> {
    try {
      const saved = await this.#callbacks.onChangeDirection?.(this.$.direction.value, positions)
      if (!saved && !this.disposed) this.#restoreDirection()
    } catch (error) {
      if (!this.disposed) this.#restoreDirection()
      console.error('Failed to save canvas direction.', error)
    } finally {
      if (!this.disposed) this.$$.changingDirection.set(false)
    }
  }

  #restoreDirection(): void {
    if (!this.$.changingDirection.value) return
    this.$$.direction.set(this.#modelDirection)
    this.applyPositions(Object.fromEntries(this.#modelPositions))
    this.$$.changingDirection.set(false)
  }

  private allLayoutNodes(): (NodeStore | CommentNodeStore)[] {
    return [...this.$.nodes.values(), ...(this.$.commentNodes?.values() ?? [])]
  }

  /** Deletes nodes programmatically, such as from a menu action. */
  public async deleteNodes(nodes: readonly (NodeStore | CommentNodeStore)[], skipConfirm?: boolean): Promise<void> {
    if (!this.$.editable.value) return
    const payload = {
      nodes: nodes.map((e) => e.$.rfNode.value),
      edges: [],
    }
    if (skipConfirm || (await this.onBeforeDelete(payload))) {
      this.handleNodesChange(nodes.map((e) => ({ type: 'remove', id: e.rfNodeId })))
    }
  }

  /**
   * Returning false cancels the deletion.
   * @internal
   */
  public onBeforeDelete: OnBeforeDelete<RFNode, RFEdge> = async (): Promise<boolean> => this.$.editable.value

  /**
   * @internal
   */
  public handleNodesChange: OnNodesChange<RFNode> = async (changes): Promise<void> => {
    const toRemoveNodes = applyNodeChanges(changes, this.$.nodes, this.$.commentNodes, this.$$.editable)
    if (toRemoveNodes) this.doRemoveNodes(toRemoveNodes)
  }

  /**
   * @internal
   */
  public handleEdgesChange: OnEdgesChange<RFEdge> = (changes): void => {
    if (this.disposed) return
    const toRemoveEdges = applyEdgeChanges(changes, this.$.rfEdges.value, this.$.editable)
    if (toRemoveEdges?.size) {
      for (const connection of toRemoveEdges) this.pendingDisconnects.set(getRFEdgeId(connection), connection)
      this.scheduleDeletions()
    }
  }

  public onRFConnect = (rfConnection: _RFConnection): void => {
    if (rfConnection.targetHandle === null || rfConnection.sourceHandle === null) {
      console.error(
        `not found source or target handle. ` +
          `source: ${rfConnection.source}:${rfConnection.sourceHandle}, ` +
          `target: ${rfConnection.target}:${rfConnection.targetHandle}`,
      )
      return
    }

    const { source, target, sourceHandle, targetHandle } = rfConnection as RFConnection

    if (!this.$.editable.value) return
    this.#callbacks.onConnect?.({
      source: toManifestNodeId(source),
      sourceHandle: toManifestHandleName(sourceHandle),
      target: toManifestNodeId(target),
      targetHandle: toManifestHandleName(targetHandle),
    })
  }

  public prepareDeselectNodesAndEdges(): () => void {
    const toDeselect: { readonly $$: { readonly selected: Val<boolean | undefined> } }[] = []

    for (const node of this.$.nodes.values()) {
      toDeselect.push(node)
    }
    if (this.$.commentNodes)
      for (const node of this.$.commentNodes.values()) {
        toDeselect.push(node)
      }
    for (const edge of this.$.edges.value) {
      toDeselect.push(edge)
    }

    return () => {
      toDeselect.forEach((store) => store.$$.selected.set(false))
    }
  }

  public onRelayout = (availableWidth?: number): void => {
    if (this.$.changingDirection.value) return
    try {
      this.doRelayout(availableWidth)
    } catch (e) {
      console.error(e)
    }
  }

  // https://reactflow.dev/learn/layouting/layouting#dagre
  private doRelayout(availableWidth?: number) {
    const selected = this.$.selectedNodes.value.length > 1 ? this.$.selectedNodes.value : []
    const nodes = selected.length > 0 ? selected : this.allLayoutNodes()
    if (nodes.length === 0) return
    let positions = this.layoutPositions(nodes, availableWidth)
    if (selected.length > 0) {
      const offsetX = Math.min(...nodes.map((node) => node.$.position.value.x)) - Math.min(...Object.values(positions).map((position) => position.x))
      const offsetY = Math.min(...nodes.map((node) => node.$.position.value.y)) - Math.min(...Object.values(positions).map((position) => position.y))
      positions = Object.fromEntries(Object.entries(positions).map(([id, position]) => [id, { x: position.x + offsetX, y: position.y + offsetY }]))
    }
    this.applyPositions(positions)
    this.#callbacks.onMoveNodes(positions)
  }

  private applyPositions(positions: Readonly<Record<string, FlowCanvasViewPosition>>) {
    for (const node of this.allLayoutNodes()) {
      const position = positions[node.nodeId]
      if (position) node.$$.position.set(position)
    }
  }

  private measuredLayout(nodes: readonly (NodeStore | CommentNodeStore)[]) {
    return graphLayout(
      nodes.map((node) => {
        const measured = node.$.measured.value
        const content = NodeStore.is(node) ? node.content$.value : undefined
        return {
          id: node.nodeId,
          width: measured?.width ?? 0,
          height: measured?.height ?? 0,
          branchHandles:
            content?.kind === 'condition' || content?.kind === 'approval' || content?.kind === 'wait'
              ? content.outputs.flatMap((port) => ('handle' in port ? ['$branch:' + port.handle] : []))
              : undefined,
        }
      }),
      this.#connections.value.map((edge) => ({ ...edge, id: getRFEdgeId(edge) })),
      this.$.direction.value,
    )
  }

  private layoutPositions(nodes: readonly (NodeStore | CommentNodeStore)[], availableWidth?: number): Readonly<Record<string, FlowCanvasViewPosition>> {
    const { nodes: layoutNodes } = this.measuredLayout(nodes)
    return this.$.direction.value === 'horizontal'
      ? wrapLayout(layoutNodes, availableWidth)
      : Object.fromEntries(layoutNodes.map(({ id, x, y }) => [id, { x, y }]))
  }

  /** Arrange the isolated export store without saving presentation or history. */
  public compactForExport(insets: { readonly width: number; readonly height: number }, instance?: Pick<ReactFlowInstance, 'getInternalNode'>, aspectRatio = 1) {
    const graph = this.measuredLayout(this.allLayoutNodes())
    const port = (id: string, handle: string | undefined, type: 'source' | 'target'): LayoutPoint | undefined => {
      const node = this.$.nodes.get(id as NodeId)
      const handles = node && instance?.getInternalNode(node.rfNodeId)?.internals.handleBounds?.[type]
      const measured = handles?.find((entry) => entry.id === `h:${handle}`)
      return measured && { x: measured.x + measured.width / 2, y: measured.y + (type === 'source' ? measured.height : 0) }
    }
    const connections = new Map<string, FlowCanvasViewEdge>(this.#connections.value.map((edge) => [getRFEdgeId(edge), edge]))
    const edges = graph.edges.map((edge) =>
      Object.assign({}, edge, {
        sourceOffset: port(edge.source, connections.get(edge.id)?.sourceHandle, 'source'),
        targetOffset: port(edge.target, connections.get(edge.id)?.targetHandle, 'target'),
      }),
    )
    const result = compactLayout({ nodes: graph.nodes, edges }, insets, aspectRatio)
    this.applyPositions(result.positions)
    this.connectionRoutes.set(result.routes)
    return result.bounds
  }

  public duplicateNodes = async (nodeIds?: NodeId[], offset?: XYPosition): Promise<void> => {
    if (!this.onDuplicate) return
    const toDuplicateNodes = nodeIds ?? this.$.selectedNodes.value.map((node) => node.nodeId)
    const deselect = this.prepareDeselectNodesAndEdges()
    await this.onDuplicate(toDuplicateNodes, offset)
    setTimeout(deselect, 0)
  }

  /**
   * @internal
   */
  public setupForceDelete = (): (() => void) => {
    const NODE_CLASS = '.react-flow__node, .react-flow__nodesselection-rect'
    // Command + Shift
    const onKeyDown = (ev: KeyboardEvent) => {
      if (
        (isMac ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey) &&
        !ev.altKey &&
        ev.shiftKey &&
        (ev.key === 'Backspace' || ev.key === 'Delete') &&
        this.$.selectedNodes.value.length > 0 &&
        isInside(ev.target, NODE_CLASS) &&
        !isInside(ev.target, '.nokey')
      ) {
        const activeElement = document.activeElement?.tagName.toLowerCase()
        if (activeElement === 'input' || activeElement === 'textarea') {
          return
        }

        ev.preventDefault()
        this.doRemoveNodes(new Set(this.$.selectedNodes.value))
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }

  private doRemoveNodes(nodes: Set<NodeStore | CommentNodeStore> | undefined): void {
    if (this.disposed || !nodes?.size) return
    for (const node of nodes) this.pendingNodeDeletes.add(node)
    this.scheduleDeletions()
  }

  /** React Flow emits node and edge removals separately for one user action. */
  private scheduleDeletions(): void {
    if (this.disposed || this.deletionTimer != null) return
    this.deletionTimer = setTimeout(() => {
      this.deletionTimer = undefined
      const nodes = [...this.pendingNodeDeletes]
      const nodeIds = new Set<string>(nodes.map((node) => node.nodeId))
      const connections = [...this.pendingDisconnects.values()].filter(({ source, target }) => !nodeIds.has(source) && !nodeIds.has(target))
      this.pendingNodeDeletes.clear()
      this.pendingDisconnects.clear()
      // The host owns removal of a node and all incident connections.
      if (nodes.length) this.#callbacks.onDeleteNodes?.(nodes.map((node) => node.nodeId))
      for (const edge of connections) this.#callbacks.onDisconnect?.(toViewEdge(edge.source, edge.sourceHandle, edge.target, edge.targetHandle))
    }, 0)
  }

  public cancelPendingDeletions = (): void => {
    if (this.deletionTimer != null) clearTimeout(this.deletionTimer)
    this.deletionTimer = undefined
    this.pendingNodeDeletes.clear()
    this.pendingDisconnects.clear()
  }

  /**
   * Marks initialization complete after the settings-panel padding is measured.
   * @internal
   */
  public onInit = (): void => {
    this.$$.initialized.set(true)
  }

  /**
   * Waits for a node to appear in the reactive node map.
   * @internal
   */
  public waitNode = async <T extends NodeStore = NodeStore>(nodeId: NodeId): Promise<T | undefined> => {
    if (this.disposed) return undefined
    const existingNode = this.$.nodes.get(nodeId)
    if (existingNode) return existingNode as T
    return new Promise<T | undefined>((resolve) => {
      let settled = false
      let disposeReaction: (() => void) | undefined
      const finish = (node: T | undefined): void => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          disposeReaction?.()
          this.dispose.remove(cancel)
          resolve(node)
        }
      }
      const cancel = () => finish(undefined)
      const timer = setTimeout(() => {
        console.error(`node ${nodeId} not found`)
        finish(undefined)
      }, 5000)
      this.dispose.add(cancel)
      disposeReaction = this.$.nodes.$.reaction((nodeMap) => {
        const node = nodeMap.get(nodeId)
        if (node) {
          finish(node as T)
        }
      })
    })
  }

  setCallbacks(callbacks: ViewCallbacks): void {
    Object.assign(this.#callbacks, callbacks)
  }

  focusNode(nodeId: string, duration: number): void {
    this.rfCommand.send('focusNode', nodeId as NodeId, { duration })
  }

  async addNode(
    itemId: string,
    position: FlowCanvasViewPosition,
    connection?: (nodeId: string) => Omit<FlowCanvasViewEdge, 'id'>,
  ): Promise<string | undefined> {
    if (!this.$.editable.value) return
    const nodeId = await (connection == null ? this.#callbacks.onAddNode?.(itemId, position) : this.#callbacks.onAddNode?.(itemId, position, connection))
    if (nodeId == null) return
    void this.#selectNode(nodeId)
    return nodeId
  }

  async #selectNode(nodeId: string): Promise<void> {
    const node = await this.waitNode(nodeId as NodeId)
    if (node == null) return
    for (const entry of this.#entries.values()) entry.store.$$.selected.set(entry.store === node)
  }

  reconcile(model: FlowCanvasViewModel, editable: boolean, language: string, selectedNodeIds: readonly string[], ignoredNodeIds: readonly string[] = []): void {
    const editableChanged = this.$.editable.value != editable
    if (editableChanged) this.$$.editable.set(editable)
    if (this.#language.value != language) this.#language.set(language)
    this.ignoredNodeIds.set(ignoredNodeIds)
    this.#syncModel(model)
    this.#syncSelection(selectedNodeIds)
  }

  #syncModel(model: FlowCanvasViewModel): void {
    this.#modelDirection = canvasDirection(model.direction)
    if (!this.$.changingDirection.value) this.$$.direction.set(this.#modelDirection)
    const runStatus = model.runStatus == 'running' ? FLOW_RUN_STATUS.Running : FLOW_RUN_STATUS.Idle
    if (this.#runStatus.value != runStatus) this.#runStatus.set(runStatus)
    if (
      this.#modelViewport == null ||
      this.#modelViewport.x != model.viewport.x ||
      this.#modelViewport.y != model.viewport.y ||
      this.#modelViewport.zoom != model.viewport.zoom
    ) {
      this.$$.viewport.set(model.viewport)
      this.#modelViewport = { ...model.viewport }
    }
    this.#connections.set(model.edges)
    const nextEntries = new Map<string, NodeEntry>()
    const nextComments = new Map<NodeId, CommentNodeStore>()
    const nextStores = new Map<NodeId, NodeStore>()
    const nextPositions = new Map<string, FlowCanvasViewPosition>()

    for (const node of model.nodes) {
      const { position, ...content } = node
      const contentKey = JSON.stringify(content)
      let entry = this.#entries.get(node.id)
      if (entry?.kind != node.kind) entry = undefined
      if (node.kind == 'comment') {
        if (entry?.kind != 'comment') {
          entry = createCommentNodeEntry(node, contentKey, this, this.#callbacks)
        } else {
          if (entry.contentKey != contentKey) entry = updateCommentNodeEntry(entry, node, contentKey)
          const previousPosition = this.#modelPositions.get(node.id)
          if (previousPosition == null || previousPosition.x != position.x || previousPosition.y != position.y) entry.store.$$.position.set(position)
        }
        nextComments.set(node.id as NodeId, entry.store)
      } else if (entry == null) {
        entry = createNodeEntry(node, contentKey, this)
      } else {
        if (entry.kind == 'comment') throw new Error('Unexpected Comment node entry.')
        if (entry.contentKey != contentKey) entry = updateNodeEntry(entry, node, contentKey)
        const previousPosition = this.#modelPositions.get(node.id)
        if (previousPosition == null || previousPosition.x != position.x || previousPosition.y != position.y) entry.store.$$.position.set(position)
      }
      nextEntries.set(node.id, entry)
      if (entry.kind != 'comment') nextStores.set(node.id as NodeId, entry.store)
      nextPositions.set(node.id, position)
    }

    if (nextStores.size != this.$.nodes.size || [...nextStores].some(([nodeId, store]) => this.$.nodes.get(nodeId) !== store)) {
      this.$$.nodes.replace(nextStores)
    }
    if (nextComments.size != this.$.commentNodes!.size || [...nextComments].some(([nodeId, store]) => this.$.commentNodes!.get(nodeId) !== store)) {
      this.$$.commentNodes!.replace(nextComments)
    }
    this.#entries = nextEntries
    this.#modelPositions = nextPositions
  }

  #syncSelection(nodeIds: readonly string[]): void {
    const next = new Set(nodeIds)
    if (next.size == this.#selectedNodeIds.size && [...next].every((nodeId) => this.#selectedNodeIds.has(nodeId))) return
    this.#selectedNodeIds = next
    for (const [nodeId, entry] of this.#entries) entry.store.$$.selected.set(next.has(nodeId))
  }
  public onAddNode = async (
    _type: AddNodeType,
    itemId: string,
    position: XYPosition,
    connection?: (nodeId: NodeId) => RFConnection,
  ): Promise<NodeId | undefined> =>
    (await this.addNode(
      itemId,
      position,
      connection == null
        ? undefined
        : (nodeId) => {
            const edge = connection(nodeId as NodeId)
            return {
              source: toManifestNodeId(edge.source),
              sourceHandle: toManifestHandleName(edge.sourceHandle),
              target: toManifestNodeId(edge.target),
              targetHandle: toManifestHandleName(edge.targetHandle),
            }
          },
    )) as NodeId | undefined

  public onDuplicate = async (nodeIds: NodeId[], offset?: XYPosition): Promise<void> => {
    if (!this.$.editable.value) return
    const copies = nodeIds.flatMap((nodeId) => {
      const node = this.$.nodes.get(nodeId) ?? this.$.commentNodes?.get(nodeId)
      return node == null ? [] : [node]
    })
    if (!copies.length) return
    this.#callbacks.onDuplicate?.(nodeIds, offset ?? { x: 24, y: 24 }, Object.fromEntries(copies.map((node) => [node.nodeId, node.$.position.value])))
  }
  public onCopy = (nodeIds: NodeId[]): void => this.#callbacks.onCopy?.(nodeIds)
  public onPaste = (position?: XYPosition): void => {
    if (this.$.editable.value) this.#callbacks.onPaste?.(position)
  }
}
