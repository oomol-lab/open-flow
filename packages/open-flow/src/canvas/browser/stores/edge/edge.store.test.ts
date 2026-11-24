import type { NodeId } from '../../../../schema/index.ts'
import type { FlowCanvasViewEdge } from '../../graph/FlowCanvas/model.ts'
import type { NodeContent } from '../../graph/FlowCanvas/nodeContent.ts'

import { val } from 'value-enhancer'
import { reactiveMap } from 'value-enhancer/collections'
import { describe, expect, it } from 'vitest'
import { NODE_TYPE } from '../node/constants.ts'
import { NodeStore } from '../node/node.store.ts'
import { EdgeStore, getRFEdgeId } from './edge.store.ts'

function createNode(id: string, content: Record<string, unknown> = {}) {
  const content$ = val<NodeContent>({
    id,
    kind: 'task',
    title: id,
    reference: 'task',
    inputs: [],
    outputs: [],
    ...content,
  } as NodeContent)
  const node = new NodeStore(id as NodeId, NODE_TYPE.TaskNode, { ignoredNodeIds: val([]), content$, position: { x: 0, y: 0 } })
  return { node, content$ }
}

describe('EdgeStore execution state', () => {
  it('keeps default edge colors when no run has executed', () => {
    const nodes = reactiveMap<NodeId, NodeStore>()
    const source = createNode('a')
    const target = createNode('b')
    nodes.set('a' as NodeId, source.node)
    nodes.set('b' as NodeId, target.node)
    const connection: FlowCanvasViewEdge = { id: 'a-b', source: 'a', sourceHandle: '$out', target: 'b', targetHandle: '$in' }
    const edge = new EdgeStore(getRFEdgeId(connection), { nodes, connection, hasRun: val(false) })

    expect(edge.$.sourceGradientColor.value).toBe('var(--edge-primitive)')
    expect(edge.$.targetGradientColor.value).toBe('var(--edge-primitive)')
    expect(edge.$.connectionMeta.value).toBeUndefined()

    edge.dispose()
    source.node.dispose()
    target.node.dispose()
    nodes.dispose()
  })

  it('colors executed edges green and transitions to red when target fails', () => {
    const nodes = reactiveMap<NodeId, NodeStore>()
    const source = createNode('a', { run: { status: 'success' } })
    const target = createNode('b', { run: { status: 'success' } })
    nodes.set('a' as NodeId, source.node)
    nodes.set('b' as NodeId, target.node)
    const connection: FlowCanvasViewEdge = { id: 'a-b', source: 'a', sourceHandle: '$out', target: 'b', targetHandle: '$in' }
    const edge = new EdgeStore(getRFEdgeId(connection), { nodes, connection, hasRun: val(true) })

    expect(edge.$.sourceGradientColor.value).toBe('var(--edge-executed)')
    expect(edge.$.targetGradientColor.value).toBe('var(--edge-executed)')
    expect(edge.$.connectionMeta.value).toEqual({ executed: true })

    target.content$.set({ ...target.content$.value, run: { status: 'error' } })
    expect(edge.$.sourceGradientColor.value).toBe('var(--edge-executed)')
    expect(edge.$.targetGradientColor.value).toBe('var(--_open-flow-error-stroke)')
    expect(edge.$.connectionMeta.value).toEqual({ executed: true })

    target.node.$$.selected.set(true)
    expect(edge.$.targetGradientColor.value).toBe('var(--accent-red-1)')

    edge.dispose()
    source.node.dispose()
    target.node.dispose()
    nodes.dispose()
  })

  it('uses releasedHandles to distinguish taken vs untaken branches even on fan-in', () => {
    const nodes = reactiveMap<NodeId, NodeStore>()
    const cond = createNode('cond', {
      kind: 'condition',
      matchMode: 'first',
      cases: [],
      defaultOutput: 'otherwise',
      outputs: [{ handle: 'matched' }, { handle: 'otherwise' }],
      run: { status: 'success', releasedHandles: ['matched'] },
    })
    const merge = createNode('merge', { run: { status: 'success' } })
    nodes.set('cond' as NodeId, cond.node)
    nodes.set('merge' as NodeId, merge.node)

    const takenConn: FlowCanvasViewEdge = { id: 'taken', source: 'cond', sourceHandle: '$branch:matched', target: 'merge', targetHandle: '$in' }
    const untakenConn: FlowCanvasViewEdge = { id: 'untaken', source: 'cond', sourceHandle: '$branch:otherwise', target: 'merge', targetHandle: '$in' }
    const hasRun = val(true)
    const takenEdge = new EdgeStore(getRFEdgeId(takenConn), { nodes, connection: takenConn, hasRun })
    const untakenEdge = new EdgeStore(getRFEdgeId(untakenConn), { nodes, connection: untakenConn, hasRun })

    expect(takenEdge.$.sourceGradientColor.value).toBe('var(--edge-executed)')
    expect(takenEdge.$.targetGradientColor.value).toBe('var(--edge-executed)')
    expect(takenEdge.$.connectionMeta.value).toEqual({ executed: true })

    expect(untakenEdge.$.sourceGradientColor.value).toBe('var(--edge-primitive)')
    expect(untakenEdge.$.targetGradientColor.value).toBe('var(--edge-primitive)')
    expect(untakenEdge.$.connectionMeta.value).toEqual({ runMuted: true })

    takenEdge.dispose()
    untakenEdge.dispose()
    cond.node.dispose()
    merge.node.dispose()
    nodes.dispose()
  })

  it('falls back to outputs keys for branch edges when releasedHandles is absent', () => {
    const nodes = reactiveMap<NodeId, NodeStore>()
    const waitNode = createNode('wait', {
      kind: 'approval',
      outputs: [{ handle: 'approved' }, { handle: 'rejected' }],
      run: { status: 'success', outputs: { approved: { ok: true } } },
    })
    const nextNode = createNode('next', { run: { status: 'success' } })
    nodes.set('wait' as NodeId, waitNode.node)
    nodes.set('next' as NodeId, nextNode.node)

    const approvedConn: FlowCanvasViewEdge = { id: 'a', source: 'wait', sourceHandle: '$branch:approved', target: 'next', targetHandle: '$in' }
    const rejectedConn: FlowCanvasViewEdge = { id: 'r', source: 'wait', sourceHandle: '$branch:rejected', target: 'next', targetHandle: '$in' }
    const hasRun = val(true)
    const approvedEdge = new EdgeStore(getRFEdgeId(approvedConn), { nodes, connection: approvedConn, hasRun })
    const rejectedEdge = new EdgeStore(getRFEdgeId(rejectedConn), { nodes, connection: rejectedConn, hasRun })

    expect(approvedEdge.$.connectionMeta.value).toEqual({ executed: true })
    expect(rejectedEdge.$.connectionMeta.value).toEqual({ runMuted: true })

    approvedEdge.dispose()
    rejectedEdge.dispose()
    waitNode.node.dispose()
    nextNode.node.dispose()
    nodes.dispose()
  })
})
