import type { NodeId } from '../../../../schema/index.ts'
import type { FlowCanvasViewModel } from '../../graph/FlowCanvas/model.ts'

import { afterEach, describe, expect, it } from 'vitest'
import { CanvasStore } from '../canvas/canvas.store.ts'

const noopCallbacks = {
  onIgnoreNodes: () => {},
  onAddNode: async () => undefined,
  onDeleteNodes: () => {},
  onConnect: () => {},
  onDisconnect: () => {},
  onDuplicate: () => {},
  onMoveNodes: () => {},
  onCopy: () => {},
  onPaste: () => {},
  onChangeComment: undefined,
} as const

function createModel(includeB = true): FlowCanvasViewModel {
  return {
    direction: 'vertical',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: 'a', kind: 'task', title: 'Node A', reference: 'lab/a', position: { x: 0, y: 0 }, inputs: [], outputs: [] },
      ...(includeB ? [{ id: 'b', kind: 'task' as const, title: 'Node B', reference: 'lab/b', position: { x: 0, y: 200 }, inputs: [], outputs: [] }] : []),
      { id: 'c', kind: 'task', title: 'Node C', reference: 'lab/c', position: { x: 400, y: 200 }, inputs: [], outputs: [] },
      { id: 'comment', kind: 'comment', title: 'Note', content: 'Side note', position: { x: 500, y: 0 } },
    ],
    edges: includeB
      ? [
          { id: 'ab', source: 'a', sourceHandle: '$out', target: 'b', targetHandle: '$in' },
          { id: 'ac', source: 'a', sourceHandle: '$out', target: 'c', targetHandle: '$in' },
        ]
      : [{ id: 'ac', source: 'a', sourceHandle: '$out', target: 'c', targetHandle: '$in' }],
  }
}

describe('EdgeStore & CanvasStore edge focus', () => {
  let store: CanvasStore | undefined

  afterEach(() => {
    store?.dispose()
    store = undefined
  })

  it('orders edge zIndex by default -> endpoint selected -> hovered -> edge selected', () => {
    store = new CanvasStore(createModel(), true, 'en', noopCallbacks)
    const edge = store.$.edges.value.find((item) => item.connection.target === 'b')!
    const nodeB = store.$.nodes.get('b' as NodeId)!

    expect(edge.$.rfEdge.value?.zIndex).toBe(0)

    nodeB.$$.selected.set(true)
    expect(edge.$.nodeSelected.value).toBe(true)
    expect(edge.$.rfEdge.value?.zIndex).toBe(1)

    store.$$.hoveredNodeId.set('b' as NodeId)
    expect(edge.$.hovered.value).toBe(true)
    expect(edge.$.rfEdge.value?.zIndex).toBe(2)

    store.$$.hoveredNodeId.set(undefined)
    store.$$.hoveredEdgeId.set(edge.edgeId)
    expect(edge.$.hovered.value).toBe(true)
    expect(edge.$.rfEdge.value?.zIndex).toBe(2)

    edge.$$.selected.set(true)
    expect(edge.$.rfEdge.value?.zIndex).toBe(3)
  })

  it('tracks hasEdgeFocus across semantic node selection, edge selection, hover, and node removal', () => {
    store = new CanvasStore(createModel(), true, 'en', noopCallbacks)
    const edgeAB = store.$.edges.value.find((item) => item.connection.target === 'b')!
    const nodeA = store.$.nodes.get('a' as NodeId)!
    const comment = store.$.commentNodes!.get('comment' as NodeId)!

    expect(store.$.hasEdgeFocus.value).toBe(false)

    // Comment-only selection should not dim workflow edges.
    comment.$$.selected.set(true)
    expect(store.$.hasEdgeFocus.value).toBe(false)
    comment.$$.selected.set(false)

    nodeA.$$.selected.set(true)
    expect(store.$.hasEdgeFocus.value).toBe(true)
    nodeA.$$.selected.set(false)
    expect(store.$.hasEdgeFocus.value).toBe(false)

    edgeAB.$$.selected.set(true)
    expect(store.$.hasEdgeFocus.value).toBe(true)
    edgeAB.$$.selected.set(false)
    expect(store.$.hasEdgeFocus.value).toBe(false)

    store.$$.hoveredEdgeId.set(edgeAB.edgeId)
    expect(store.$.hasEdgeFocus.value).toBe(true)
    store.$$.hoveredEdgeId.set(undefined)
    expect(store.$.hasEdgeFocus.value).toBe(false)

    // Deleting a hovered node must not leave hasEdgeFocus stuck true.
    store.$$.hoveredNodeId.set('b' as NodeId)
    expect(store.$.hasEdgeFocus.value).toBe(true)
    store.reconcile(createModel(false), true, 'en', [], [])
    expect(store.$.hasEdgeFocus.value).toBe(false)
  })
})
