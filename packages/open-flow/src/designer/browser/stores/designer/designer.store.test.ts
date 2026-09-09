import type { reactiveMap } from 'value-enhancer/collections'
import type { NodeId } from '../../../../schema/index.ts'
import type { FlowDesignerViewEdge } from '../../graph/FlowDesigner/model.ts'
import type { NodeContent } from '../../graph/FlowDesigner/nodeContent.ts'
import type { NodeType } from '../node/constants.ts'

import { val } from 'value-enhancer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommentNodeStore } from '../node/commentNode.store.ts'
import { NODE_TYPE } from '../node/constants.ts'
import { NodeStore } from '../node/node.store.ts'
import { DesignerStore } from './designer.store.ts'

interface TestSetup {
  readonly store: DesignerStore
  readonly nodes: ReturnType<typeof reactiveMap<NodeId, NodeStore>>
  createNode(nodeId: NodeId, nodeType?: NodeType): NodeStore
  dispose(): void
}

function createTestSetup(connections = val<readonly FlowDesignerViewEdge[]>([]), autoLayout = true): TestSetup {
  const store = new DesignerStore(
    { nodes: [], edges: connections.value, viewport: { x: 0, y: 0, zoom: 1 } },
    true,
    'en',
    [],
    {
      onAddNode: async () => undefined,
      onDeleteNodes: () => {},
      onConnect: vi.fn(),
      onDisconnect: () => {},
      onDuplicate: () => {},
      onMoveNodes: () => {},
      onPaste: () => {},
      onChangeComment: undefined,
      provideAddItems: undefined,
    },
    autoLayout,
  )
  const nodes = store.$$.nodes
  const createdNodes: NodeStore[] = []
  return {
    store,
    nodes,
    createNode(nodeId, nodeType = NODE_TYPE.TaskNode) {
      const content$ = val<NodeContent>({ id: nodeId, kind: 'task', title: nodeId, reference: 'task', inputs: [], outputs: [] })
      const node = new NodeStore(nodeId, nodeType, { content$, position: { x: 0, y: 0 } })
      createdNodes.push(node)
      return node
    },
    dispose() {
      createdNodes.forEach((node) => node.dispose())
      store.dispose()
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('DesignerStore.waitNode', () => {
  it('cancels all pending waits on disposal without logging timeouts', async () => {
    vi.useFakeTimers()
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const setup = createTestSetup()
    const first = setup.store.waitNode('first' as NodeId)
    const second = setup.store.waitNode('second' as NodeId)

    setup.dispose()

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(5000)
    expect(logError).not.toHaveBeenCalled()
    setup.dispose()
  })

  it('does not start waits or return existing nodes after disposal', async () => {
    vi.useFakeTimers()
    const setup = createTestSetup()
    const node = setup.createNode('existing' as NodeId)
    setup.nodes.set(node.nodeId, node)
    setup.dispose()

    await expect(setup.store.waitNode(node.nodeId)).resolves.toBeUndefined()
    await expect(setup.store.waitNode('missing' as NodeId)).resolves.toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    expect(setup.store.dispose.size()).toBe(0)
  })

  it.each(['success', 'timeout'] as const)('releases completed %s waits from the disposal list', async (outcome) => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const setup = createTestSetup()
    const size = setup.store.dispose.size()
    const nodeId = 'node' as NodeId
    const result = setup.store.waitNode(nodeId)

    if (outcome == 'success') setup.nodes.set(nodeId, setup.createNode(nodeId))
    else await vi.advanceTimersByTimeAsync(5000)
    await result

    expect(setup.store.dispose.size()).toBe(size)
    expect(vi.getTimerCount()).toBe(0)
    setup.dispose()
  })

  it('returns an existing node immediately', async () => {
    const setup = createTestSetup()
    const nodeId = 'existing' as NodeId
    const node = setup.createNode(nodeId)
    setup.nodes.set(nodeId, node)

    await expect(setup.store.waitNode(nodeId)).resolves.toBe(node)
    setup.dispose()
  })

  it('resolves when a node appears in the reactive map', async () => {
    const setup = createTestSetup()
    const nodeId = 'later' as NodeId
    const result = setup.store.waitNode(nodeId)
    const node = setup.createNode(nodeId)

    setup.nodes.set(nodeId, node)

    await expect(result).resolves.toBe(node)
    setup.dispose()
  })

  it('settles once with undefined after the timeout', async () => {
    vi.useFakeTimers()
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const setup = createTestSetup()
    const nodeId = 'missing' as NodeId
    const result = setup.store.waitNode(nodeId)

    await vi.advanceTimersByTimeAsync(5000)

    await expect(result).resolves.toBeUndefined()
    setup.nodes.set(nodeId, setup.createNode(nodeId))
    await vi.runAllTimersAsync()
    expect(logError).toHaveBeenCalledTimes(1)
    setup.dispose()
  })
})

describe('DesignerStore graph projection', () => {
  it('does not republish nodes for an unchanged measurement', async () => {
    const setup = createTestSetup()
    const node = setup.createNode('node' as NodeId)
    setup.nodes.set(node.nodeId, node)
    const change = { dimensions: { height: 120, width: 240 }, id: node.rfNodeId, type: 'dimensions' as const }

    await setup.store.handleNodesChange([change])
    const measured = setup.store.$.rfNodes.value
    expect(measured[0]?.measured).toEqual(change.dimensions)
    await setup.store.handleNodesChange([change])

    expect(setup.store.$.rfNodes.value).toBe(measured)
    setup.dispose()
  })

  it('does not republish nodes for an unchanged position', async () => {
    const setup = createTestSetup()
    const node = setup.createNode('node' as NodeId)
    setup.nodes.set(node.nodeId, node)
    const nodes = setup.store.$.rfNodes.value

    await setup.store.handleNodesChange([{ id: node.rfNodeId, position: { ...node.$.position.value }, type: 'position' }])

    expect(setup.store.$.rfNodes.value).toBe(nodes)
    setup.dispose()
  })
})

describe('DesignerStore layout', () => {
  it('updates comment positions independently of viewport state', () => {
    const note = new CommentNodeStore('note' as NodeId, { position: { x: 10, y: 20 }, onSaveContent: () => undefined })
    note.$$.position.set({ x: 100, y: 200 })
    expect(note.$.position.value).toEqual({ x: 100, y: 200 })
    note.dispose()
  })

  it('tracks positions and the current viewport', async () => {
    const setup = createTestSetup()

    const first = setup.createNode('first' as NodeId)
    const second = setup.createNode('second' as NodeId)
    setup.nodes.set(first.nodeId, first)
    setup.nodes.set(second.nodeId, second)
    first.$$.rfNode.set({ ...first.$.rfNode.value, measured: { width: 100, height: 40 } })
    second.$$.rfNode.set({ ...second.$.rfNode.value, measured: { width: 100, height: 40 } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    await new Promise((resolve) => setTimeout(resolve, 0))
    first.$$.position.set({ x: 40, y: 50 })
    second.$$.position.set({ x: 300, y: 50 })
    setup.store.$$.viewport.set({ x: 50, y: 60, zoom: 1.4 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(first.$.position.value).toEqual({ x: 40, y: 50 })
    expect(second.$.position.value).toEqual({ x: 300, y: 50 })
    expect(setup.store.$.viewport.value).toEqual({ x: 50, y: 60, zoom: 1.4 })

    setup.dispose()
  })

  it('runs the normal graph layout when the initial mode has no positions', async () => {
    const setup = createTestSetup()
    const first = setup.createNode('first' as NodeId)
    const second = setup.createNode('second' as NodeId)
    setup.nodes.set(first.nodeId, first)
    setup.nodes.set(second.nodeId, second)
    first.$$.rfNode.set({ ...first.$.rfNode.value, measured: { width: 200, height: 80 } })
    second.$$.rfNode.set({ ...second.$.rfNode.value, measured: { width: 200, height: 80 } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(setup.store.completeLayout()).toBe('relayout')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(first.$.position.value).not.toEqual(second.$.position.value)

    setup.dispose()
  })

  it('leaves enough horizontal space for edge turns between connected nodes', async () => {
    const firstId = 'first' as NodeId
    const secondId = 'second' as NodeId
    const setup = createTestSetup(
      val([
        {
          id: 'edge',
          source: firstId,
          sourceHandle: 'output',
          target: secondId,
          targetHandle: 'input',
        },
      ] as readonly FlowDesignerViewEdge[]),
    )
    const first = setup.createNode(firstId)
    const second = setup.createNode(secondId)
    setup.nodes.set(first.nodeId, first)
    setup.nodes.set(second.nodeId, second)
    first.$$.rfNode.set({ ...first.$.rfNode.value, measured: { width: 200, height: 80 } })
    second.$$.rfNode.set({ ...second.$.rfNode.value, measured: { width: 200, height: 80 } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(setup.store.completeLayout()).toBe('relayout')
    expect(second.$.position.value.x - first.$.position.value.x - 200).toBe(80)
    setup.dispose()
  })

  it('does not repeat automatic layout after measurement completes', async () => {
    const setup = createTestSetup()

    const first = setup.createNode('first' as NodeId)
    const second = setup.createNode('second' as NodeId)
    setup.nodes.set(first.nodeId, first)
    setup.nodes.set(second.nodeId, second)
    first.$$.rfNode.set({ ...first.$.rfNode.value, measured: { width: 200, height: 80 } })
    second.$$.rfNode.set({ ...second.$.rfNode.value, measured: { width: 200, height: 80 } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(setup.store.completeLayout()).toBe('relayout')
    expect(first.$.position.value).not.toEqual(second.$.position.value)
    expect(setup.store.completeLayout()).toBe(true)
    setup.dispose()
  })

  it('finalizes an unmeasured layout after bounded attempts', async () => {
    const setup = createTestSetup()
    const node = setup.createNode('node' as NodeId)
    setup.nodes.set(node.nodeId, node)
    await new Promise((resolve) => setTimeout(resolve, 0))

    for (let attempt = 0; attempt < 5; attempt++) {
      expect(setup.store.completeLayout()).toBe(false)
    }
    expect(setup.store.completeLayout()).toBe(true)
    expect(setup.store.completeLayout()).toBe(true)
    setup.dispose()
  })

  it('keeps newly added nodes and existing positions stable', async () => {
    const setup = createTestSetup(undefined, false)

    const first = setup.createNode('first' as NodeId)
    first.$$.position.set({ x: 100, y: 200 })
    setup.nodes.set(first.nodeId, first)
    await new Promise((resolve) => setTimeout(resolve, 0))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(setup.store.completeLayout()).toBe(true)
    const added = setup.createNode('added' as NodeId)
    setup.nodes.set(added.nodeId, added)
    await new Promise((resolve) => setTimeout(resolve, 0))
    added.$$.rfNode.set({ ...added.$.rfNode.value, position: { x: 300, y: 40 } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(added.$.position.value).toEqual({ x: 300, y: 40 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(first.$.position.value).toEqual({ x: 100, y: 200 })
    expect(added.$.position.value).toEqual({ x: 300, y: 40 })
    expect(setup.store.completeLayout()).toBe(true)
    setup.dispose()
  })
})
