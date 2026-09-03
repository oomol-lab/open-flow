import type { DisposableStore } from '@wopjs/disposable'
import type { AddEventListener } from '@wopjs/event'
import type { Viewport } from '@xyflow/react'
import type { Val } from 'value-enhancer'
import type { ReadonlyReactiveMap } from 'value-enhancer/collections'
import type { NodeId } from '../../../../schema/index.ts'
import type { FlowDisplayMode } from '../../../common/flowDisplay.ts'
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
  viewport?: Viewport | undefined
}

export interface DesignerUIData {
  nodes?: { [nodeId: NodeId]: NodeUIPersistedData | undefined }
  pseudoNodes?: { [nodeId: NodeId]: NodeUIPersistedData | undefined }
  commentNodes?: { [nodeId: NodeId]: NodeUIPersistedData | undefined }
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
  private initialPositions = new Set<NodeId>()
  private initialized = false
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
      }
      this.initialized = false
      this.initialPositions = positionedIds(uiData.nodes, uiData.pseudoNodes)
      const activeLayout = this.layouts.get(displayMode)
      const viewport = activeLayout?.viewport ?? uiData.viewport
      if (isViewport(viewport)) {
        this.observedViewport = viewport
        this.viewport$.set({ ...viewport })
      }
      if (isPlainObject(uiData.nodes)) {
        for (const [nodeId, nodeUIData] of Object.entries(uiData.nodes)) {
          this.nodesData.set(nodeId as NodeId, (toPlainObject(nodeUIData) ?? {}) as NodeUIPersistedData)
        }
      }
      if (isPlainObject(uiData.pseudoNodes)) {
        for (const [nodeId, nodeUIData] of Object.entries(uiData.pseudoNodes)) {
          this.pseudoNodesData.set(nodeId as NodeId, (toPlainObject(nodeUIData) ?? {}) as NodeUIPersistedData)
        }
      }
      if (isPlainObject(uiData.commentNodes)) {
        for (const [nodeId, nodeUIData] of Object.entries(uiData.commentNodes)) {
          this.commentNodesData.set(nodeId as NodeId, (toPlainObject(nodeUIData) ?? {}) as NodeUIPersistedData)
        }
      }
    }
    return this
  }

  public switchDisplayMode(previousMode: FlowDisplayMode, nextMode: FlowDisplayMode): boolean {
    this.captureViewport(previousMode)
    this.activeDisplayMode = nextMode
    const viewport = this.layouts.get(nextMode)?.viewport
    if (viewport) {
      this.observedViewport = viewport
      this.viewport$.set({ ...viewport })
    }
    return this.isActiveLayoutInitialized()
  }

  public captureActiveLayout(): void {
    this.captureViewport(this.activeDisplayMode)
  }

  public completeActiveLayout(): void {
    this.captureActiveLayout()
    this.initialized = true
  }

  public isActiveLayoutInitialized(): boolean {
    if (!this.initialized) {
      const nodeIds = [...this.nodeStores.keys(), ...(this.pseudoNodeStores?.keys() ?? [])]
      this.initialized = nodeIds.length > 0 && nodeIds.every((nodeId) => this.initialPositions.has(nodeId))
    }
    return this.initialized
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

    const persistedLayouts = [...this.layouts].filter(([, layout]) => hasLayoutData(layout))
    const layouts = persistedLayouts.length > 0 ? Object.fromEntries(persistedLayouts) : undefined
    if (nodes || pseudoNodes || commentNodes || layouts) {
      return { nodes, pseudoNodes, commentNodes, layouts }
    }
  }

  private captureViewport(mode: FlowDisplayMode): void {
    const viewport = this.viewport$.value
    if (viewport) this.layouts.set(mode, { viewport: { ...viewport } })
  }
}

function parseLayouts(data: unknown): Map<FlowDisplayMode, DesignerUILayout> {
  const source = toPlainObject(data)
  const result = new Map<FlowDisplayMode, DesignerUILayout>()
  for (const mode of FLOW_DISPLAY_MODES) {
    const layout = toPlainObject(source?.[mode])
    if (!layout) continue
    const viewport = isViewport(layout.viewport) ? { ...layout.viewport } : undefined
    if (viewport) result.set(mode, { viewport })
  }
  return result
}

function positionedIds(...collections: unknown[]): Set<NodeId> {
  const result = new Set<NodeId>()
  for (const collection of collections) {
    for (const [nodeId, node] of Object.entries(toPlainObject(collection) ?? {})) {
      if (isXYPosition(toPlainObject(toPlainObject(node)?.rfNode)?.position)) result.add(nodeId as NodeId)
    }
  }
  return result
}

function hasLayoutData(layout: DesignerUILayout): boolean {
  return layout.viewport != null
}
