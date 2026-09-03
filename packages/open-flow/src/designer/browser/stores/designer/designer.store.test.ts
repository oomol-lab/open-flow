import type { NodeId } from '../../../../schema/index.ts'
import type { NodeStatus, NodeType } from '../node/constants.ts'
import type { NodeStoreDisplay$ } from '../node/node.store.ts'
import type { InteractiveMode } from './designer.store.ts'

import { val } from 'value-enhancer'
import { reactiveMap } from 'value-enhancer/collections'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommentNodeStore } from '../node/commentNode.store.ts'
import { NODE_STATUS, NODE_TYPE } from '../node/constants.ts'
import { NodeStore } from '../node/node.store.ts'
import { DesignerStore } from './designer.store.ts'
import { DesignerUIStore } from './designerUI.store.ts'
import { NodeMiniMapPhase } from './nodeMiniMap.ts'
import { createRFCommand } from './rfCommand.ts'
import { DESIGNER_TYPE, FLOW_RUN_STATUS } from './typings.ts'

interface TestSetup {
  readonly store: DesignerStore
  readonly nodes: ReturnType<typeof reactiveMap<NodeId, NodeStore>>
  createNode(nodeId: NodeId, nodeType?: NodeType): NodeStore
  dispose(): void
}

function createTestSetup(): TestSetup {
  const nodes = reactiveMap<NodeId, NodeStore>()
  const viewport = val<{ x: number; y: number; zoom: number } | undefined>()
  const designerUIStore = new DesignerUIStore({ viewport, nodeStores: nodes })
  const store = new DesignerStore(DESIGNER_TYPE.Flow, true, {
    lang$: val('en'),
    rfCommand: createRFCommand(nodes),
    miniMapExpanded: val(),
    interactiveMode: val<InteractiveMode>('mouse'),
    viewport,
    settingsPanelWidth: val(),
    nodes,
    runStatus: val(FLOW_RUN_STATUS.Idle),
    designerUIStore,
    showConfirmDialog: async () => true,
    bindValidateConnection: () => {},
    onAddNode: async () => undefined,
    onDeleteNodes: () => {},
    onConnect: () => {},
    onDisconnect: () => {},
    onDuplicate: async () => {},
  })
  const createdNodes: NodeStore[] = []
  return {
    store,
    nodes,
    createNode(nodeId, nodeType = NODE_TYPE.TaskNode) {
      const display$: NodeStoreDisplay$ = {
        icon: val(),
        title: val(),
        description: val(),
        status: val<NodeStatus>(NODE_STATUS.Idle),
        progress: val(),
        showSettings: val(),
        ignore: val(),
        sections: val([]),
        inputs_def: val(),
        outputs_def: val(),
      }
      const node = new NodeStore(nodeId, nodeType, { display$, designerUIStore })
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

describe('DesignerStore.nodeMiniMapPhase', () => {
  it('disables minimap rendering in overview mode', () => {
    const setup = createTestSetup()
    const node = setup.createNode('node' as NodeId)
    setup.nodes.set(node.nodeId, node)

    setup.store.$$.viewport.set({ x: 0, y: 0, zoom: 0.3 })
    expect(setup.store.$.nodeMiniMapPhase.value).toBe(NodeMiniMapPhase.Phase1)

    setup.store.$$.displayMode.set('overview')
    expect(setup.store.$.nodeMiniMapPhase.value).toBe(NodeMiniMapPhase.None)

    setup.store.$$.displayMode.set('detail')
    expect(setup.store.$.nodeMiniMapPhase.value).toBe(NodeMiniMapPhase.Phase1)
    setup.dispose()
  })
})

describe('DesignerStore graph projection', () => {
  it('publishes nodes and edges through one snapshot', () => {
    const setup = createTestSetup()
    const initial = setup.store.$.renderedRFGraph.value
    const node = setup.createNode('node' as NodeId)

    setup.nodes.set(node.nodeId, node)
    const next = setup.store.$.renderedRFGraph.value

    expect(next).not.toBe(initial)
    expect(next.nodes).toBe(setup.store.$.rfNodes.value)
    expect(next.edges).toBe(setup.store.$.renderedRFEdges.value)
    expect(next.nodes).toEqual([node.$.rfNode.value])
    setup.dispose()
  })

  it('does not republish nodes for an unchanged measurement', async () => {
    const setup = createTestSetup()
    const node = setup.createNode('node' as NodeId)
    setup.nodes.set(node.nodeId, node)
    const change = { dimensions: { height: 120, width: 240 }, id: node.rfNodeId, type: 'dimensions' as const }

    await setup.store.handleNodesChange([change])
    const measured = setup.store.$.renderedRFGraph.value
    expect(measured.nodes[0]?.measured).toEqual(change.dimensions)
    await setup.store.handleNodesChange([change])

    expect(setup.store.$.renderedRFGraph.value).toBe(measured)
    setup.dispose()
  })

  it('does not republish nodes for an unchanged position', async () => {
    const setup = createTestSetup()
    const node = setup.createNode('node' as NodeId)
    setup.nodes.set(node.nodeId, node)
    const graph = setup.store.$.renderedRFGraph.value

    await setup.store.handleNodesChange([{ id: node.rfNodeId, position: { ...node.$.position.value }, type: 'position' }])

    expect(setup.store.$.renderedRFGraph.value).toBe(graph)
    setup.dispose()
  })
})

describe('DesignerStore display mode', () => {
  it('shares comment positions across display modes', () => {
    const nodes = reactiveMap<NodeId, NodeStore>()
    const comments = reactiveMap<NodeId, CommentNodeStore>()
    const viewport = val<{ x: number; y: number; zoom: number } | undefined>()
    const ui = new DesignerUIStore({ commentNodeStores: comments, nodeStores: nodes, viewport })
    ui.loadDesignerUIData({ commentNodes: { note: { rfNode: { position: { x: 10, y: 20 } } } } }, 'detail')
    const note = new CommentNodeStore('note' as NodeId, {
      designerUIStore: ui,
      lang: val('en'),
      mountCodeEditor: () => undefined,
      preview: val(null),
    })
    comments.set(note.nodeId, note)

    ui.switchDisplayMode('detail', 'overview')
    note.$$.position.set({ x: 100, y: 200 })
    ui.switchDisplayMode('overview', 'detail')

    expect(note.$.position.value).toEqual({ x: 100, y: 200 })
    expect(ui.toUIData()?.commentNodes?.['note' as NodeId]?.rfNode?.position).toEqual({ x: 100, y: 200 })
    expect(ui.toUIData()?.layouts).toBeUndefined()
    note.dispose()
    ui.dispose()
  })

  it('does not persist session display changes in project UI data', () => {
    const setup = createTestSetup()
    const onUIChanged = vi.fn()
    const stop = setup.store.designerUIStore.onChanged(onUIChanged)

    setup.store.$$.displayMode.set('overview')

    expect(setup.store.$.displayMode.value).toBe('overview')
    expect(onUIChanged).not.toHaveBeenCalled()
    expect(setup.store.designerUIStore.toUIData()).toBeUndefined()
    stop()
    setup.dispose()
  })

  it('shares positions and keeps independent viewports across display modes', async () => {
    const setup = createTestSetup()
    setup.store.designerUIStore.loadDesignerUIData(
      {
        nodes: {
          first: { rfNode: { position: { x: 0, y: 0 } } },
          second: { rfNode: { position: { x: 150, y: 0 } } },
        },
        layouts: {
          detail: { viewport: { x: 10, y: 20, zoom: 0.8 } },
          overview: { viewport: { x: 30, y: 40, zoom: 1.2 } },
        },
      },
      'detail',
    )
    const first = setup.createNode('first' as NodeId)
    const second = setup.createNode('second' as NodeId)
    setup.nodes.set(first.nodeId, first)
    setup.nodes.set(second.nodeId, second)
    first.$$.rfNode.set({ ...first.$.rfNode.value, measured: { width: 100, height: 40 } })
    second.$$.rfNode.set({ ...second.$.rfNode.value, measured: { width: 100, height: 40 } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    setup.store.$$.displayMode.set('overview')
    await new Promise((resolve) => setTimeout(resolve, 0))
    first.$$.position.set({ x: 40, y: 50 })
    second.$$.position.set({ x: 300, y: 50 })
    setup.store.$$.viewport.set({ x: 50, y: 60, zoom: 1.4 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    setup.store.$$.displayMode.set('detail')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(first.$.position.value).toEqual({ x: 40, y: 50 })
    expect(second.$.position.value).toEqual({ x: 300, y: 50 })
    expect(setup.store.$.viewport.value).toEqual({ x: 10, y: 20, zoom: 0.8 })
    expect(setup.store.designerUIStore.toUIData()?.nodes).toMatchObject({
      first: { rfNode: { position: { x: 40, y: 50 } } },
      second: { rfNode: { position: { x: 300, y: 50 } } },
    })
    expect(setup.store.designerUIStore.toUIData()?.layouts).toEqual({
      detail: { viewport: { x: 10, y: 20, zoom: 0.8 } },
      overview: { viewport: { x: 50, y: 60, zoom: 1.4 } },
    })
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

    expect(setup.store.completeDisplayModeLayout()).toBe('relayout')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(first.$.position.value).not.toEqual(second.$.position.value)
    expect(setup.store.designerUIStore.toUIData()?.nodes).toMatchObject({
      first: { rfNode: { position: first.$.position.value } },
      second: { rfNode: { position: second.$.position.value } },
    })
    setup.dispose()
  })

  it('runs the normal graph layout when any layout node has no saved position', async () => {
    const setup = createTestSetup()
    setup.store.designerUIStore.loadDesignerUIData({
      commentNodes: { note: { rfNode: { position: { x: 10, y: 20 } } } },
      nodes: { first: { rfNode: { position: { x: 30, y: 40 } } } },
    })
    const first = setup.createNode('first' as NodeId)
    const second = setup.createNode('second' as NodeId)
    setup.nodes.set(first.nodeId, first)
    setup.nodes.set(second.nodeId, second)
    first.$$.rfNode.set({ ...first.$.rfNode.value, measured: { width: 200, height: 80 } })
    second.$$.rfNode.set({ ...second.$.rfNode.value, measured: { width: 200, height: 80 } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(setup.store.completeDisplayModeLayout()).toBe('relayout')
    expect(first.$.position.value).not.toEqual(second.$.position.value)
    setup.dispose()
  })

  it('finalizes an unmeasured layout after bounded attempts', async () => {
    const setup = createTestSetup()
    const node = setup.createNode('node' as NodeId)
    setup.nodes.set(node.nodeId, node)
    await new Promise((resolve) => setTimeout(resolve, 0))

    for (let attempt = 0; attempt < 5; attempt++) {
      expect(setup.store.completeDisplayModeLayout()).toBe(false)
    }
    expect(setup.store.completeDisplayModeLayout()).toBe(true)
    expect(setup.store.completeDisplayModeLayout()).toBe(true)
    setup.dispose()
  })

  it('keeps a newly added node in place across display modes', async () => {
    const setup = createTestSetup()
    setup.store.designerUIStore.loadDesignerUIData(
      {
        nodes: {
          first: { rfNode: { position: { x: 100, y: 200 } } },
        },
        layouts: {
          overview: { viewport: { x: 30, y: 40, zoom: 1.2 } },
          detail: { viewport: { x: 10, y: 20, zoom: 0.8 } },
        },
      },
      'detail',
    )
    const first = setup.createNode('first' as NodeId)
    setup.nodes.set(first.nodeId, first)
    await new Promise((resolve) => setTimeout(resolve, 0))

    setup.store.$$.displayMode.set('overview')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const added = setup.createNode('added' as NodeId)
    setup.nodes.set(added.nodeId, added)
    await new Promise((resolve) => setTimeout(resolve, 0))
    added.$$.rfNode.set({ ...added.$.rfNode.value, position: { x: 300, y: 40 } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(added.$.position.value).toEqual({ x: 300, y: 40 })
    setup.store.$$.displayMode.set('detail')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(first.$.position.value).toEqual({ x: 100, y: 200 })
    expect(added.$.position.value).toEqual({ x: 300, y: 40 })
    expect(setup.store.completeDisplayModeLayout()).toBe(true)
    setup.dispose()
  })
})
