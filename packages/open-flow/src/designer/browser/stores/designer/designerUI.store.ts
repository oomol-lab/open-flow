import type { DisposableStore } from '@wopjs/disposable'
import type { AddEventListener } from '@wopjs/event'
import type { Viewport } from '@xyflow/react'
import type { Val } from 'value-enhancer'
import type { ReadonlyReactiveMap } from 'value-enhancer/collections'
import type { NodeId } from '../../../../schema/index.ts'
import type { FlowDisplayMode } from '../../../common/flowDisplay.ts'
import type { XYPosition } from '../../base/compare.ts'
import type { CommentNodeStore } from '../node/commentNode.store.ts'
import type { NodeStore } from '../node/node.store.ts'
import type { NodeUIPersistedData } from '../node/nodeUI.store.ts'

import { isPlainObject } from '@wopjs/cast'
import { disposableStore } from '@wopjs/disposable'
import { event, send } from '@wopjs/event'
import { FLOW_DISPLAY_MODES } from '../../../common/flowDisplay.ts'
import { isSameViewport, isViewport, isXYPosition } from '../../base/compare.ts'
import { toPlainObject } from '../../base/trivial.ts'
import { watchEach } from '../../base/val.ts'

export interface DesignerUILayout {
  commentNodes?: { [nodeId: NodeId]: XYPosition | undefined }
  nodes?: { [nodeId: NodeId]: XYPosition | undefined }
  pseudoNodes?: { [nodeId: NodeId]: XYPosition | undefined }
  viewport?: Viewport | undefined
}

export interface DesignerUIData {
  nodes?: { [nodeId: NodeId]: NodeUIPersistedData | undefined }
  pseudoNodes?: { [nodeId: NodeId]: NodeUIPersistedData | undefined }
  commentNodes?: { [nodeId: NodeId]: NodeUIPersistedData | undefined }
  viewport?: Viewport | undefined
  layouts?: Partial<Record<FlowDisplayMode, DesignerUILayout>>
}

export interface DesignerUIStoreProps {
  viewport: Val<Viewport | undefined>
  nodeStores: ReadonlyReactiveMap<NodeId, NodeStore>
  pseudoNodeStores?: ReadonlyReactiveMap<NodeId, NodeStore>
  commentNodeStores?: ReadonlyReactiveMap<NodeId, CommentNodeStore>
}

export class DesignerUIStore {
  public readonly dispose: DisposableStore = disposableStore()

  public readonly onChanged: AddEventListener<DesignerUIStore> = this.dispose.add(event<DesignerUIStore>())

  /** The viewport is persisted with the project UI data. */
  public readonly viewport$: Val<Viewport | undefined>

  private readonly nodeStores: ReadonlyReactiveMap<NodeId, NodeStore>
  private readonly pseudoNodeStores?: ReadonlyReactiveMap<NodeId, NodeStore>
  private readonly commentNodeStores?: ReadonlyReactiveMap<NodeId, CommentNodeStore>

  private readonly nodesData = new Map<NodeId, NodeUIPersistedData>()
  private readonly pseudoNodesData = new Map<NodeId, NodeUIPersistedData>()
  private readonly commentNodesData = new Map<NodeId, NodeUIPersistedData>()
  private readonly layouts = new Map<FlowDisplayMode, DesignerUILayout>()
  private readonly initializedLayouts = new Set<FlowDisplayMode>()
  private observedViewport: Viewport | undefined
  private activeDisplayMode: FlowDisplayMode = 'detail'

  public constructor({ viewport, nodeStores, pseudoNodeStores, commentNodeStores }: DesignerUIStoreProps) {
    this.viewport$ = this.dispose.add(viewport)
    this.observedViewport = viewport.value
    // DesignerStore owns nodeStores.
    this.nodeStores = nodeStores
    this.pseudoNodeStores = pseudoNodeStores
    this.commentNodeStores = commentNodeStores

    // Forward each collection's changes without eagerly serializing UI data.
    const onChange = () => send(this.onChanged, this)
    this.dispose.add(
      this.viewport$.reaction(() => {
        const currentViewport = this.viewport$.value
        if (!isSameViewport(this.observedViewport, currentViewport)) {
          this.observedViewport = currentViewport
          onChange()
        }
      }),
    )
    this.dispose.add(watchEach(nodeStores, (nodeStore) => nodeStore.uiStore.onChanged(onChange)))
    if (pseudoNodeStores) {
      this.dispose.add(watchEach(pseudoNodeStores, (nodeStore) => nodeStore.uiStore.onChanged(onChange)))
    }
    if (commentNodeStores) {
      this.dispose.add(watchEach(commentNodeStores, (commentNodeStore) => commentNodeStore.uiStore.onChanged(onChange)))
    }
  }

  public setCommentNodeUIData(nodeId: NodeId, data: NodeUIPersistedData): this {
    this.commentNodeStores?.get(nodeId)?.uiStore.setUIData(data)
    this.commentNodesData.set(nodeId, data)
    return this
  }

  public takeCommentNodeUIData(nodeId: NodeId): NodeUIPersistedData | undefined {
    const data = this.commentNodesData.get(nodeId)
    this.commentNodesData.delete(nodeId)
    return data
  }

  public getInitialCommentNodeIds(): NodeId[] {
    return Array.from(this.commentNodesData.keys())
  }

  public setNodeUIData(nodeId: NodeId, data: NodeUIPersistedData): this {
    this.nodeStores.get(nodeId)?.uiStore.setUIData(data)
    this.nodesData.set(nodeId, data)
    return this
  }

  public setNewNodeUIData(nodeId: NodeId, data: NodeUIPersistedData): this {
    this.setNodeUIData(nodeId, data)
    // Autosave is debounced, so the new node exists when its cached UI data is serialized.
    send(this.onChanged, this)
    return this
  }

  public takeNodeUIData(nodeId: NodeId): NodeUIPersistedData | undefined {
    const data = this.nodesData.get(nodeId)
    this.nodesData.delete(nodeId)
    return data
  }

  public peekNodeUIData(nodeId: NodeId): NodeUIPersistedData | undefined {
    return this.nodesData.get(nodeId)
  }

  public takePseudoNodeUIData(nodeId: NodeId): NodeUIPersistedData | undefined {
    const data = this.pseudoNodesData.get(nodeId)
    this.pseudoNodesData.delete(nodeId)
    return data
  }

  public peekPseudoNodeUIData(nodeId: NodeId): NodeUIPersistedData | undefined {
    return this.pseudoNodesData.get(nodeId)
  }

  public loadDesignerUIData(data: DesignerUIData): this
  public loadDesignerUIData(data: unknown): this
  public loadDesignerUIData(data: unknown, displayMode?: FlowDisplayMode): this
  public loadDesignerUIData(data: unknown, displayMode: FlowDisplayMode = 'detail'): this {
    this.activeDisplayMode = displayMode
    const uiData = toPlainObject(data)
    if (uiData) {
      const layouts = parseLayouts(uiData.layouts)
      for (const [mode, layout] of layouts) {
        this.layouts.set(mode, layout)
        this.initializedLayouts.add(mode)
      }
      const activeLayout = this.layouts.get(displayMode)
      if (!activeLayout && hasPersistedPositions(uiData.nodes, uiData.pseudoNodes, uiData.commentNodes)) {
        this.initializedLayouts.add(displayMode)
      }
      if (activeLayout) this.applyLayout(activeLayout)
      const viewport = activeLayout?.viewport ?? uiData.viewport
      if (isViewport(viewport)) {
        this.observedViewport = viewport
        this.viewport$.set(viewport)
      }
      if (isPlainObject(uiData.nodes)) {
        for (const [nodeId, nodeUIData] of Object.entries(uiData.nodes)) {
          this.nodesData.set(nodeId as NodeId, withPosition(nodeUIData, activeLayout?.nodes?.[nodeId as NodeId]))
        }
      }
      if (isPlainObject(uiData.pseudoNodes)) {
        for (const [nodeId, nodeUIData] of Object.entries(uiData.pseudoNodes)) {
          this.pseudoNodesData.set(nodeId as NodeId, withPosition(nodeUIData, activeLayout?.pseudoNodes?.[nodeId as NodeId]))
        }
      }
      if (isPlainObject(uiData.commentNodes)) {
        for (const [nodeId, nodeUIData] of Object.entries(uiData.commentNodes)) {
          this.commentNodesData.set(nodeId as NodeId, withPosition(nodeUIData, activeLayout?.commentNodes?.[nodeId as NodeId]))
        }
      }
    }
    return this
  }

  /**
   * Saves the outgoing layout and restores the target layout when one exists.
   * Returns false when the target layout was seeded from the outgoing mode and
   * still needs its measured node sizes to resolve overlaps.
   */
  public switchDisplayMode(previousMode: FlowDisplayMode, nextMode: FlowDisplayMode): boolean {
    this.captureLayout(previousMode)
    this.activeDisplayMode = nextMode
    const source = this.layouts.get(previousMode)
    const existingTarget = this.layouts.get(nextMode)
    const target = existingTarget && mergeMissingPositions(existingTarget, source)
    if (target) {
      const targetChanged = !sameLayoutMembership(existingTarget, target)
      this.layouts.set(nextMode, target)
      this.applyLayout(target)
      if (targetChanged) send(this.onChanged, this)
      return this.initializedLayouts.has(nextMode)
    }

    const seeded = cloneLayout(source)
    if (hasLayoutData(seeded)) this.layouts.set(nextMode, seeded)
    this.initializedLayouts.delete(nextMode)
    this.applyLayout(seeded)
    if (hasLayoutData(seeded)) send(this.onChanged, this)
    return false
  }

  public captureActiveLayout(): void {
    this.captureLayout(this.activeDisplayMode)
  }

  public completeActiveLayout(): void {
    this.captureActiveLayout()
    this.initializedLayouts.add(this.activeDisplayMode)
  }

  public isActiveLayoutInitialized(): boolean {
    return this.initializedLayouts.has(this.activeDisplayMode)
  }

  public renameNodeLayout(oldNodeId: NodeId, newNodeId: NodeId): void {
    for (const layout of this.layouts.values()) {
      const position = layout.nodes?.[oldNodeId]
      if (!position) continue
      ;(layout.nodes ??= {})[newNodeId] = position
      delete layout.nodes[oldNodeId]
    }
  }

  public removeNodeLayouts(nodeIds: Iterable<NodeId>): void {
    const ids = [...nodeIds]
    for (const layout of this.layouts.values()) {
      for (const nodeId of ids) {
        if (layout.nodes) delete layout.nodes[nodeId]
      }
    }
  }

  public toUIData(): DesignerUIData | undefined {
    this.captureActiveLayout()
    const nodes = this.nodeStores.size
      ? Object.fromEntries([...this.nodeStores].map(([nodeId, nodeStore]) => [nodeId, nodeStore.uiStore.toUIData()] as const))
      : undefined

    const pseudoNodes = this.pseudoNodeStores?.size
      ? Object.fromEntries([...this.pseudoNodeStores].map(([nodeId, nodeStore]) => [nodeId, nodeStore.uiStore.toUIData()] as const))
      : undefined

    const commentNodes = this.commentNodeStores?.size
      ? Object.fromEntries([...this.commentNodeStores].map(([nodeId, commentNodeStore]) => [nodeId, commentNodeStore.uiStore.toUIData()] as const))
      : undefined

    const viewport = this.viewport$.value
    const persistedLayouts = [...this.layouts].filter(([, layout]) => hasLayoutData(layout))
    const layouts = persistedLayouts.length > 0 ? Object.fromEntries(persistedLayouts) : undefined
    if (nodes || pseudoNodes || commentNodes || viewport || layouts) {
      return { nodes, pseudoNodes, commentNodes, viewport, layouts }
    }
  }

  private captureLayout(mode: FlowDisplayMode): void {
    const nodes = positionsOf(this.nodeStores)
    const pseudoNodes = this.pseudoNodeStores && positionsOf(this.pseudoNodeStores)
    const commentNodes = this.commentNodeStores && positionsOf(this.commentNodeStores)
    const viewport = this.viewport$.value
    if (nodes || pseudoNodes || commentNodes || viewport) {
      const previous = this.layouts.get(mode)
      this.layouts.set(mode, {
        commentNodes: commentNodes ?? previous?.commentNodes,
        nodes: nodes ?? previous?.nodes,
        pseudoNodes: pseudoNodes ?? previous?.pseudoNodes,
        viewport: viewport && { ...viewport },
      })
    }
  }

  private applyLayout(layout: DesignerUILayout): void {
    applyPositions(this.nodeStores, layout.nodes)
    if (this.commentNodeStores) applyPositions(this.commentNodeStores, layout.commentNodes)
    if (this.pseudoNodeStores) applyPositions(this.pseudoNodeStores, layout.pseudoNodes)
    if (layout.viewport) {
      this.observedViewport = layout.viewport
      this.viewport$.set({ ...layout.viewport })
    }
  }
}

function positionsOf<T extends NodeStore | CommentNodeStore>(stores: ReadonlyReactiveMap<NodeId, T>): DesignerUILayout['nodes'] {
  if (stores.size === 0) return
  return Object.fromEntries([...stores].map(([nodeId, store]) => [nodeId, { ...store.$.position.value }]))
}

function applyPositions<T extends NodeStore | CommentNodeStore>(stores: ReadonlyReactiveMap<NodeId, T>, positions: DesignerUILayout['nodes']): void {
  if (!positions) return
  for (const [nodeId, store] of stores) {
    const position = positions[nodeId]
    if (position) store.$$.position.set({ ...position })
  }
}

function withPosition(data: unknown, position: XYPosition | undefined): NodeUIPersistedData {
  const uiData = toPlainObject(data) ?? {}
  if (!position) return uiData as NodeUIPersistedData
  return {
    ...uiData,
    rfNode: {
      ...toPlainObject(uiData.rfNode),
      position: { ...position },
    },
  } as NodeUIPersistedData
}

function parseLayouts(data: unknown): Map<FlowDisplayMode, DesignerUILayout> {
  const source = toPlainObject(data)
  const result = new Map<FlowDisplayMode, DesignerUILayout>()
  for (const mode of FLOW_DISPLAY_MODES) {
    const layout = toPlainObject(source?.[mode])
    if (!layout) continue
    const commentNodes = parsePositions(layout.commentNodes)
    const nodes = parsePositions(layout.nodes)
    const pseudoNodes = parsePositions(layout.pseudoNodes)
    const viewport = isViewport(layout.viewport) ? { ...layout.viewport } : undefined
    if (commentNodes || nodes || pseudoNodes || viewport) result.set(mode, { commentNodes, nodes, pseudoNodes, viewport })
  }
  return result
}

function parsePositions(data: unknown): DesignerUILayout['nodes'] {
  const source = toPlainObject(data)
  if (!source) return
  const positions = Object.entries(source).flatMap(([nodeId, position]) => (isXYPosition(position) ? ([[nodeId as NodeId, { ...position }]] as const) : []))
  return positions.length > 0 ? Object.fromEntries(positions) : undefined
}

function hasPersistedPositions(...collections: unknown[]): boolean {
  return collections.some((collection) => {
    const nodes = toPlainObject(collection)
    return nodes && Object.values(nodes).some((node) => isXYPosition(toPlainObject(toPlainObject(node)?.rfNode)?.position))
  })
}

function cloneLayout(layout: DesignerUILayout | undefined): DesignerUILayout {
  return {
    commentNodes: clonePositions(layout?.commentNodes),
    nodes: clonePositions(layout?.nodes),
    pseudoNodes: clonePositions(layout?.pseudoNodes),
    viewport: layout?.viewport && { ...layout.viewport },
  }
}

function clonePositions(positions: DesignerUILayout['nodes']): DesignerUILayout['nodes'] {
  if (!positions) return
  return Object.fromEntries(Object.entries(positions).map(([nodeId, position]) => [nodeId, position && { ...position }])) as DesignerUILayout['nodes']
}

function mergeMissingPositions(target: DesignerUILayout, source: DesignerUILayout | undefined): DesignerUILayout {
  const commentNodes = { ...target.commentNodes }
  const nodes = { ...target.nodes }
  const pseudoNodes = { ...target.pseudoNodes }
  for (const [nodeId, position] of Object.entries(source?.commentNodes ?? {})) {
    if (commentNodes[nodeId as NodeId] == null && position) commentNodes[nodeId as NodeId] = { ...position }
  }
  for (const [nodeId, position] of Object.entries(source?.nodes ?? {})) {
    if (nodes[nodeId as NodeId] == null && position) nodes[nodeId as NodeId] = { ...position }
  }
  for (const [nodeId, position] of Object.entries(source?.pseudoNodes ?? {})) {
    if (pseudoNodes[nodeId as NodeId] == null && position) pseudoNodes[nodeId as NodeId] = { ...position }
  }
  return {
    commentNodes: Object.keys(commentNodes).length > 0 ? commentNodes : undefined,
    nodes: Object.keys(nodes).length > 0 ? nodes : undefined,
    pseudoNodes: Object.keys(pseudoNodes).length > 0 ? pseudoNodes : undefined,
    viewport: target.viewport && { ...target.viewport },
  }
}

function sameLayoutMembership(a: DesignerUILayout, b: DesignerUILayout): boolean {
  return samePositionKeys(a.commentNodes, b.commentNodes) && samePositionKeys(a.nodes, b.nodes) && samePositionKeys(a.pseudoNodes, b.pseudoNodes)
}

function samePositionKeys(a: DesignerUILayout['nodes'], b: DesignerUILayout['nodes']): boolean {
  const aKeys = Object.keys(a ?? {})
  const bKeys = Object.keys(b ?? {})
  return aKeys.length == bKeys.length && aKeys.every((key) => b?.[key as NodeId] != null)
}

function hasLayoutData(layout: DesignerUILayout): boolean {
  return layout.commentNodes != null || layout.nodes != null || layout.pseudoNodes != null || layout.viewport != null
}
