// @vitest-environment happy-dom
import type { ReactFlowInstance, Viewport } from '@xyflow/react'
import type { NodeId } from '../../../../schema/index.ts'
import type { CanvasCommand, CanvasCommandSubscriber } from '../../../common/commands.ts'
import type { FlowCanvasProps } from './FlowCanvas.tsx'
import type { FlowCanvasViewCommentNode, FlowCanvasViewModel, FlowCanvasViewProps, FlowCanvasViewTaskNode, FlowCanvasViewValueNode } from './model.ts'

import { StrictMode } from 'react'
import { val } from 'value-enhancer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '../../../../../test/support/render.tsx'
import { FlowCanvasView } from './FlowCanvasView.tsx'

const boundary = vi.hoisted(() => ({ props: undefined as FlowCanvasProps | undefined }))
vi.mock('./FlowCanvas.tsx', () => ({
  FlowCanvas: (viewProps: FlowCanvasProps) => {
    boundary.props = viewProps
    return null
  },
}))
let mounted: ReturnType<typeof render> | undefined
function renderView(viewProps: FlowCanvasViewProps) {
  if (mounted == null) mounted = render(<FlowCanvasView {...viewProps} />)
  else mounted.rerender(<FlowCanvasView {...viewProps} />)
  return { props: boundary.props! }
}
beforeEach(() => {
  mounted = undefined
})

const task = (inputs: FlowCanvasViewTaskNode['inputs']): FlowCanvasViewTaskNode => ({
  id: 'target',
  inputs,
  kind: 'task',
  outputs: [{ handle: 'result', jsonSchema: {} }],
  position: { x: 200, y: 0 },
  reference: 'task',
  title: 'Task',
})

const source: FlowCanvasViewTaskNode = {
  id: 'source',
  inputs: [],
  kind: 'task',
  outputs: [{ handle: 'result', jsonSchema: {} }],
  position: { x: 0, y: 0 },
  reference: 'source-task',
  title: 'Source',
}

const model = (nodes: FlowCanvasViewModel['nodes']): FlowCanvasViewModel => ({
  edges:
    nodes.some((node) => node.id == 'source') && nodes.some((node) => node.id == 'target')
      ? [{ id: 'execution', source: 'source', sourceHandle: '$out', target: 'target', targetHandle: '$in' }]
      : [],
  nodes,
  viewport: { x: 0, y: 0, zoom: 1 },
})

const valueNode = (content: unknown): FlowCanvasViewValueNode => ({
  id: 'value',
  inputs: [],
  kind: 'value',
  outputs: [{ handle: 'value', jsonSchema: {} }],
  position: { x: 0, y: 0 },
  title: 'Value',
  values: [{ handle: 'value', jsonSchema: {}, value: content }],
})

const commentNode = (title: string): FlowCanvasViewCommentNode => ({
  content: '',
  id: 'comment',
  kind: 'comment',
  position: { x: 0, y: 100 },
  title,
})

function props(value: FlowCanvasViewModel, overrides: Partial<FlowCanvasViewProps> = {}): FlowCanvasViewProps {
  return {
    editable: true,
    ignoredNodeIds: [],
    onIgnoreNodes: () => {},
    identity: 'flow:main',
    model: value,
    onAddNode: () => undefined,
    onConnect: () => undefined,
    onDeleteNodes: () => undefined,
    onDisconnect: () => undefined,
    onDuplicate: () => undefined,
    onMoveNodes: () => undefined,
    onMoveViewport: () => undefined,
    onCopy: () => undefined,
    onPaste: () => undefined,
    onSelectionChange: () => undefined,
    selectedNodeIds: [],
    ...overrides,
  }
}

function update(initial: FlowCanvasViewProps, next: FlowCanvasViewProps): FlowCanvasProps['flowCanvasStore'] {
  const view = renderView(initial)
  renderView(next)
  return view.props.flowCanvasStore
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('FlowCanvasView model synchronization', () => {
  it('forwards updated annotation context without creating a new canvas store or changing selection', () => {
    const initial = props(model([source]), {
      annotationContext: { flowId: 'flow', revisionId: 'r1', syncState: 'saved' },
      selectedNodeIds: ['source'],
      onSelectionChange: vi.fn(),
    })
    const first = renderView(initial)
    const next = { ...initial, annotationContext: { flowId: 'flow', revisionId: 'r2', syncState: 'dirty' as const } }
    const second = renderView(next)
    expect(second.props.annotationContext).toEqual(next.annotationContext)
    expect(second.props.flowCanvasStore).toBe(first.props.flowCanvasStore)
    expect(initial.onSelectionChange).not.toHaveBeenCalled()
    expect(second.props.flowCanvasStore.$.rfNodes.value.find((node) => node.data.store?.nodeId == 'source')?.selected).toBe(true)
  })

  it('keeps a host-owned interaction mode when the canvas identity changes', () => {
    const interactiveMode$ = val<'mouse' | 'touchpad'>('mouse')
    const first = renderView(props(model([]), { interactiveMode$ }))
    expect(first.props.flowCanvasStore.$$.interactiveMode).toBe(interactiveMode$)
    const second = renderView(props(model([]), { identity: 'flow:next', interactiveMode$ }))
    expect(second.props.flowCanvasStore.$$.interactiveMode).toBe(interactiveMode$)
    second.props.flowCanvasStore.dispose()
    interactiveMode$.set('touchpad')
    expect(interactiveMode$.value).toBe('touchpad')
    interactiveMode$.dispose()
  })

  it('reads ignored state from the owner and sends changes without mutating the graph', () => {
    const graph = model([task([])])
    const onIgnoreNodes = vi.fn()
    const initial = props(graph, { onIgnoreNodes })
    const view = renderView(initial)
    const store = view.props.flowCanvasStore
    const node = store.$.nodes.get('target' as NodeId)!
    node.setIgnored(true)
    expect(onIgnoreNodes).toHaveBeenCalledWith(['target'], true)
    expect(node.ignore.value).toBe(false)
    renderView({ ...initial, ignoredNodeIds: ['target'] })
    expect(node.ignore.value).toBe(true)
    expect(store.$.nodes.get('target' as NodeId)).toBe(node)
    expect(graph.nodes[0]).not.toHaveProperty('ignored')
    renderView(initial)
    expect(node.ignore.value).toBe(false)
    store.dispose()
  })

  it('decodes React Flow connection identifiers once at the canvas boundary', () => {
    const onConnect = vi.fn()
    const view = renderView(props(model([task([])]), { onConnect }))
    view.props.flowCanvasStore.onRFConnect({ source: 'm:source:one', sourceHandle: 'h:$branch:matched', target: 'm:target', targetHandle: 'h:$in' })
    expect(onConnect).toHaveBeenCalledExactlyOnceWith({ source: 'source:one', sourceHandle: '$branch:matched', target: 'target', targetHandle: '$in' })
    view.props.flowCanvasStore.dispose()
  })

  it.each(['edges-first', 'nodes-first'] as const)('coalesces %s deletion callbacks without redundant incident-edge removal', (order) => {
    vi.useFakeTimers()
    const graph = model([{ ...task([]), id: 'source' }, task([]), { ...task([]), id: 'other' }, { ...task([]), id: 'leaf' }])
    const independent = { id: 'independent', source: 'other', sourceHandle: '$out', target: 'leaf', targetHandle: '$in' }
    const onDeleteNodes = vi.fn()
    const onDisconnect = vi.fn()
    const view = renderView(props({ ...graph, edges: [...graph.edges, independent] }, { onDeleteNodes, onDisconnect }))
    const store = view.props.flowCanvasStore
    const node = store.$.nodes.get('target' as NodeId)!
    const edges = store.$.rfEdges.value.map((edge) => ({ type: 'remove' as const, id: edge.id }))
    const removeNodes = () => store.handleNodesChange([{ type: 'remove', id: node.rfNodeId }])
    if (order == 'nodes-first') removeNodes()
    store.handleEdgesChange(edges)
    store.handleEdgesChange(edges)
    if (order == 'edges-first') removeNodes()
    expect(onDeleteNodes).not.toHaveBeenCalled()
    expect(onDisconnect).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(onDeleteNodes).toHaveBeenCalledExactlyOnceWith(['target'])
    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(onDisconnect.mock.calls[0]?.[0]).toMatchObject({ source: 'other', target: 'leaf' })
    store.dispose()
  })

  it.each(['dispose', 'effect-cleanup'] as const)('cancels queued deletions on %s', (lifecycle) => {
    vi.useFakeTimers()
    const onDeleteNodes = vi.fn()
    const onDisconnect = vi.fn()
    const view = renderView(props(model([{ ...task([]), id: 'source' }, task([])]), { onDeleteNodes, onDisconnect }))
    const store = view.props.flowCanvasStore
    store.handleEdgesChange(store.$.rfEdges.value.map((edge) => ({ type: 'remove', id: edge.id })))
    store.handleNodesChange([{ type: 'remove', id: store.$.nodes.get('target' as NodeId)!.rfNodeId }])
    if (lifecycle == 'dispose') store.dispose()
    else mounted!.unmount()
    vi.runAllTimers()
    expect(onDeleteNodes).not.toHaveBeenCalled()
    expect(onDisconnect).not.toHaveBeenCalled()
    store.dispose()
  })

  it('reconciles after StrictMode replays effect setup and cleanup', () => {
    const initial = props(model([task([])]), { editable: false })
    const strictView = render(
      <StrictMode>
        <FlowCanvasView {...initial} />
      </StrictMode>,
    )
    strictView.rerender(
      <StrictMode>
        <FlowCanvasView {...initial} editable />
      </StrictMode>,
    )
    expect(boundary.props!.flowCanvasStore.$.editable.value).toBe(true)
  })

  it('disposes the adapter replaced by a new identity', () => {
    const first = renderView(props(model([])))
    const disposed = vi.fn()
    first.props.flowCanvasStore.dispose.add(disposed)

    const second = renderView(props(model([]), { identity: 'flow:next' }))

    expect(second.props.flowCanvasStore).not.toBe(first.props.flowCanvasStore)
    expect(disposed).toHaveBeenCalledOnce()
    second.props.flowCanvasStore.dispose()
  })

  it('duplicates from the current Designer position', async () => {
    const onDuplicate = vi.fn()
    const editable = task([])
    const view = renderView(props(model([editable]), { onDuplicate }))
    const node = [...view.props.flowCanvasStore.$.nodes.values()][0]!
    node.$$.position.set({ x: 320, y: 180 })

    await node.duplicateNode?.()

    expect(onDuplicate).toHaveBeenCalledWith(
      ['target'],
      { x: 24, y: 24 },
      {
        target: { x: 320, y: 180 },
      },
    )
    view.props.flowCanvasStore.dispose()
  })

  it('forwards copy and keyboard or positioned paste to the current host callbacks', () => {
    const oldCopy = vi.fn()
    const onCopy = vi.fn()
    const onPaste = vi.fn()
    const initial = props(model([task([])]), { onCopy: oldCopy })
    const view = renderView(initial)
    renderView({ ...initial, onCopy, onPaste })
    const store = view.props.flowCanvasStore

    store.onCopy(['target' as NodeId])
    store.onPaste()
    store.onPaste({ x: 100, y: 80 })

    expect(oldCopy).not.toHaveBeenCalled()
    expect(onCopy).toHaveBeenCalledExactlyOnceWith(['target'])
    expect(onPaste.mock.calls).toEqual([[undefined], [{ x: 100, y: 80 }]])
    store.dispose()
  })

  it('duplicates a mixed selection including triggers and comments in one operation', async () => {
    const onDuplicate = vi.fn()
    const nodes: FlowCanvasViewModel['nodes'] = [
      { ...task([]), id: 'trigger', kind: 'trigger' },
      task([]),
      { id: 'note', kind: 'comment', title: 'Note', content: 'Keep this', position: { x: 40, y: 90 } },
    ]
    const view = renderView(props(model(nodes), { onDuplicate, selectedNodeIds: ['trigger', 'target', 'note'] }))
    const store = view.props.flowCanvasStore
    expect(store.$.nodes.get('trigger' as NodeId)?.duplicateNode).toBeTypeOf('function')

    await store.duplicateNodes()

    expect(onDuplicate).toHaveBeenCalledExactlyOnceWith(
      ['trigger', 'target', 'note'],
      { x: 24, y: 24 },
      { trigger: { x: 200, y: 0 }, target: { x: 200, y: 0 }, note: { x: 40, y: 90 } },
    )
    store.dispose()
  })

  it('updates node error state from model diagnostics', () => {
    const initial = props(model([{ ...task([]), diagnostics: 2 }]))
    const changed = props(model([{ ...task([]), diagnostics: 0 }]))
    const view = renderView(initial)
    expect([...view.props.flowCanvasStore.$.nodes.values()][0]?.$.hasError.value).toBe(true)
    renderView(changed)
    const store = view.props.flowCanvasStore
    expect([...store.$.nodes.values()][0]?.$.hasError.value).toBe(false)
    store.dispose()
  })

  it('reflects model-owned metadata in the canvas', () => {
    const initial = { ...task([]), description: 'Before', icon: ':carbon:circle:', title: 'Before' }
    const changed = { ...initial, description: 'After', icon: ':carbon:star:', title: 'After' }
    const store = update(props(model([initial])), props(model([changed])))
    const node = [...store.$.nodes.values()][0]
    expect(node?.content$.value.description).toBe('After')
    expect(node?.content$.value.title).toBe('After')
    expect(node?.content$.value.icon).toBe(':carbon:star:')
    store.dispose()
  })

  it('keeps the current node position when editability changes', () => {
    const value = model([task([])])
    const initial = props(value)
    const view = renderView(initial)
    const node = [...view.props.flowCanvasStore.$.nodes.values()][0]!
    node.$$.position.set({ x: 320, y: 180 })

    renderView({ ...initial, editable: false })
    expect([...view.props.flowCanvasStore.$.nodes.values()][0]?.$.position.value).toEqual({ x: 320, y: 180 })

    renderView(initial)
    expect([...view.props.flowCanvasStore.$.nodes.values()][0]?.$.position.value).toEqual({ x: 320, y: 180 })

    const moved = { ...task([]), position: { x: 500, y: 400 } }
    renderView(props(model([moved]), { editable: false }))
    expect([...view.props.flowCanvasStore.$.nodes.values()][0]?.$.position.value).toEqual(moved.position)
    view.props.flowCanvasStore.dispose()
  })

  it('updates the Wait notice without recreating the node', () => {
    const wait = {
      id: 'wait',
      inputs: [{ handle: 'value', jsonSchema: {}, nullable: true }],
      kind: 'wait' as const,
      notice: { icon: ':service:feishu:', text: 'Notification · Feishu Custom Bot · Send text message' },
      outputs: [
        { handle: 'approve', jsonSchema: {}, nullable: true },
        { handle: 'reject', jsonSchema: {}, nullable: true },
      ],
      position: { x: 0, y: 0 },
      title: 'Wait',
    }
    const store = update(props(model([{ ...wait, notice: undefined }])), props(model([wait])))
    const node = [...store.$.nodes.values()][0]

    const view = renderView(props(model([{ ...wait, notice: { ...wait.notice } }])))
    expect(view.props.flowCanvasStore.$.nodes.get(node!.nodeId)).toBe(node)
    const current = node?.content$.value
    expect(current?.kind == 'wait' ? current.notice : undefined).toEqual(wait.notice)
    store.dispose()
  })

  it('publishes node content atomically and keeps its interaction identity during reconciliation', () => {
    const wait = {
      id: 'wait',
      inputs: [{ handle: 'value', jsonSchema: {}, nullable: true }],
      kind: 'wait' as const,
      outputs: [
        { handle: 'approve', jsonSchema: {}, nullable: true },
        { handle: 'reject', jsonSchema: {}, nullable: true },
      ],
      position: { x: 0, y: 0 },
      title: 'Wait',
    }
    const target = task([{ handle: 'value', jsonSchema: {}, sources: [{ nodeId: 'wait', output: 'approve' }] }])
    const view = renderView(props(model([wait, target])))
    const node = [...view.props.flowCanvasStore.$.nodes.values()].find((item) => item.nodeId == 'wait')
    if (node == null) throw new Error('Expected a Wait node.')
    const changes: unknown[] = []
    const stop = node.content$.reaction((content) => changes.push(content), true)

    renderView(props(model([{ ...wait, notice: { icon: ':service:feishu:', text: 'Notification · Feishu Custom Bot · Send text message' } }, { ...target }])))

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ inputs: wait.inputs, outputs: wait.outputs, notice: { icon: ':service:feishu:' } })
    expect(view.props.flowCanvasStore.$.nodes.get(node.nodeId)).toBe(node)
    stop()
    view.props.flowCanvasStore.dispose()
  })

  it.each(['wait', 'task'] as const)('preserves %s input values in the canvas projection', (kind) => {
    const view = renderView(
      props(
        model([
          {
            id: 'node',
            ...(kind === 'wait' ? { kind } : { kind, reference: 'child' }),
            inputs: [{ handle: 'value', jsonSchema: {}, value: 42 }],
            outputs: [{ handle: 'result', jsonSchema: {} }],
            position: { x: 0, y: 0 },
            title: kind,
          },
        ]),
      ),
    )
    const node = [...view.props.flowCanvasStore.$.nodes.values()][0]!
    expect(node.content$.value.inputs).toEqual([{ handle: 'value', jsonSchema: {}, value: 42 }])
    view.props.flowCanvasStore.dispose()
  })

  it('does not echo model-owned Value and Comment updates back to the host', async () => {
    const onChangeComment = vi.fn()
    const store = update(
      props(model([valueNode('before'), commentNode('Before')]), {
        onChangeComment,
      }),
      props(model([valueNode('after'), commentNode('After')]), {
        onChangeComment,
      }),
    )

    await Promise.resolve()

    expect(onChangeComment).not.toHaveBeenCalled()
    store.dispose()
  })

  it('commits comment content separately from local typing and includes the current title', () => {
    const onChangeComment = vi.fn()
    const view = renderView(props(model([commentNode('Note')]), { onChangeComment }))
    const comment = [...view.props.flowCanvasStore.$.commentNodes!.values()][0]!
    comment.$$.content.set('## Draft')
    expect(onChangeComment).not.toHaveBeenCalled()
    comment.saveContent(comment.$$.content.value ?? '')
    expect(onChangeComment).toHaveBeenCalledWith('comment', { title: 'Note', content: '## Draft' })
    view.props.flowCanvasStore.dispose()
  })

  it('routes Comment title edits to the host', () => {
    const onChangeComment = vi.fn()
    const view = renderView(props(model([commentNode('Before')]), { onChangeComment }))
    const comment = [...view.props.flowCanvasStore.$.commentNodes!.values()][0]
    if (comment == null) throw new Error('Expected a Comment node.')

    comment.$$.title.set('After')

    expect(onChangeComment).toHaveBeenCalledWith('comment', { content: '', title: 'After' })
    view.props.flowCanvasStore.dispose()
  })

  it('does not rewrite an unchanged controlled selection when the host recreates the model', () => {
    const value = model([task([])])
    const view = renderView(props(value, { selectedNodeIds: ['target'] }))
    const node = [...view.props.flowCanvasStore.$.nodes.values()][0]!
    node.$$.selected.set(false)
    const setSelection = vi.spyOn(node.$$.selected, 'set')
    const replaceNodes = vi.spyOn(view.props.flowCanvasStore.$$.nodes, 'replace')

    renderView(props({ ...value }, { selectedNodeIds: ['target'] }))

    expect(setSelection).not.toHaveBeenCalled()
    expect(replaceNodes).not.toHaveBeenCalled()
    view.props.flowCanvasStore.dispose()
  })

  it('moves the controlled selection to a copied node', () => {
    const original = task([])
    const copy = { ...task([]), id: 'copy', position: { x: 560, y: 0 }, title: 'Task (2)' }
    const view = renderView(props(model([original]), { selectedNodeIds: ['target'] }))

    renderView(props(model([original, copy]), { selectedNodeIds: ['copy'] }))

    expect(view.props.flowCanvasStore.$.nodes.get('target' as NodeId)?.$.selected.value).toBe(false)
    expect(view.props.flowCanvasStore.$.nodes.get('copy' as NodeId)?.$.selected.value).toBe(true)
    view.props.flowCanvasStore.dispose()
  })

  it('does not echo an unchanged controlled selection in React Flow order', () => {
    const onSelectionChange = vi.fn()
    const view = renderView(
      props(model([source, task([])]), {
        onSelectionChange,
        selectedNodeIds: ['source', 'target'],
      }),
    )
    const nodes = [...view.props.flowCanvasStore.$.nodes.values()]

    view.props.onSelectionChange?.({
      edges: [],
      nodes: nodes.toReversed().map((node) => ({ data: { store: node } }) as never),
    })

    expect(onSelectionChange).not.toHaveBeenCalled()
    view.props.flowCanvasStore.dispose()
  })

  it('ignores a queued selection snapshot after controlled deselection and still accepts user selection', async () => {
    const onSelectionChange = vi.fn()
    const initial = props(model([source, task([])]), { onSelectionChange, selectedNodeIds: ['target'] })
    const view = renderView(initial)
    const store = view.props.flowCanvasStore
    const previousSelection = store.$.rfNodes.value.filter((node) => node.selected)

    const next = renderView(props(initial.model, { onSelectionChange }))
    next.props.onSelectionChange?.({ edges: [], nodes: previousSelection })

    expect(onSelectionChange).not.toHaveBeenCalled()
    expect(store.$.rfNodes.value.every((node) => !node.selected)).toBe(true)

    const node = store.$.nodes.get('target' as NodeId)!
    await store.handleNodesChange([{ id: node.rfNodeId, selected: true, type: 'select' }])
    next.props.onSelectionChange?.({ edges: [], nodes: [node.$.rfNode.value] })
    expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith(['target'], undefined)
    store.dispose()
  })

  it.each(['mount', 'update'])('preserves host selection when React Flow reports its initial empty snapshot on %s', async (phase) => {
    const onSelectionChange = vi.fn()
    const value = model([task([])])
    if (phase == 'update') renderView(props(value, { onSelectionChange }))
    const next = renderView(props(value, { onSelectionChange, selectedNodeIds: ['target'] }))
    const store = next.props.flowCanvasStore

    next.props.onSelectionChange?.({ edges: [], nodes: [] })
    next.props.onSelectionChange?.({ edges: [], nodes: store.$.rfNodes.value.filter((node) => node.selected) })

    expect(onSelectionChange).not.toHaveBeenCalled()
    const node = store.$.nodes.get('target' as NodeId)!
    expect(node.$.selected.value).toBe(true)

    await store.handleNodesChange([{ id: node.rfNodeId, selected: false, type: 'select' }])
    next.props.onSelectionChange?.({ edges: [], nodes: [] })
    expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith([], undefined)
    store.dispose()
  })

  it('selects a node after adding it', async () => {
    let next: FlowCanvasViewProps
    const onAddNode = vi.fn(async () => {
      renderView(next)
      return 'target'
    })
    const initial = props(model([source]), { onAddNode })
    next = props(model([source, task([])]), { onAddNode, selectedNodeIds: ['target'] })
    const view = renderView(initial)

    await view.props.onDropAddItem?.('task', { x: 200, y: 0 })
    await Promise.resolve()

    const target = view.props.flowCanvasStore.$.nodes.get('target' as NodeId)
    expect(target?.$.selected.value).toBe(true)
    view.props.flowCanvasStore.dispose()
  })

  it('does not replace Designer maps for a semantically unchanged model object', () => {
    const value = model([task([])])
    const view = renderView(props(value))
    const node = [...view.props.flowCanvasStore.$.nodes.values()][0]!
    const replaceNodes = vi.spyOn(view.props.flowCanvasStore.$$.nodes, 'replace')
    const replaceComments = vi.spyOn(view.props.flowCanvasStore.$$.commentNodes!, 'replace')
    const setPosition = vi.spyOn(node.$$.position, 'set')
    const setViewport = vi.spyOn(view.props.flowCanvasStore.$$.viewport, 'set')

    renderView(
      props({
        ...value,
        edges: [],
        nodes: value.nodes.map((item) => ({ ...item })),
        viewport: { ...value.viewport },
      }),
    )

    expect(replaceNodes).not.toHaveBeenCalled()
    expect(replaceComments).not.toHaveBeenCalled()
    expect(setPosition).not.toHaveBeenCalled()
    expect(setViewport).not.toHaveBeenCalled()
    view.props.flowCanvasStore.dispose()
  })

  it('keeps delayed remote end events transient through refresh and saves later manual moves', async () => {
    let execute: ((command: CanvasCommand) => void) | undefined
    const subscribeCanvasCommands: CanvasCommandSubscriber = (listener) => {
      execute = listener
      return () => {
        execute = undefined
      }
    }
    const onMoveViewport = vi.fn()
    const onSelectionChange = vi.fn()
    const initialProps = props(model([task([])]), { subscribeCanvasCommands, onMoveViewport, onSelectionChange, selectedNodeIds: ['target'] })
    const view = renderView(initialProps)
    const store = view.props.flowCanvasStore
    const ends: Viewport[] = []
    const move = async (next: Viewport) => {
      store.$$.viewport.set(next)
      view.props.onMove?.(null, next)
      ends.push(next)
      return true
    }
    const setCenter = vi.fn(async (x: number, y: number, options: { zoom: number }) => move({ x, y, zoom: options.zoom }))
    store.rfCommand.onRFInstance({
      viewportInitialized: true,
      getViewport: () => store.$.viewport.value,
      getZoom: () => store.$.viewport.value?.zoom ?? 1,
      setViewport: move,
      setCenter,
    } as unknown as ReactFlowInstance)
    execute?.({ type: 'focus', nodeId: 'target' })
    execute?.({ type: 'focus', nodeId: 'target' })
    execute?.({ type: 'pan', dx: 80, dy: -30 })
    await vi.waitFor(() => expect(store.$.viewport.value).toEqual({ x: 480, y: 70, zoom: 1 }))
    expect(store.rfCommand.remoteViewportChange).toBe(false)
    for (const viewport of ends) view.props.onMoveEnd?.(null, viewport)
    expect(setCenter).toHaveBeenCalledTimes(2)
    expect(onMoveViewport).not.toHaveBeenCalled()
    expect(onSelectionChange).not.toHaveBeenCalled()
    renderView({ ...initialProps, model: model([task([])]) })
    expect(store.$.viewport.value).toEqual({ x: 480, y: 70, zoom: 1 })
    await move({ x: 490, y: 70, zoom: 1 })
    // A stale remote end arriving after manual movement must not save the old viewport.
    view.props.onMoveEnd?.(null, ends[0]!)
    expect(onMoveViewport).not.toHaveBeenCalled()
    view.props.onMoveEnd?.(null, ends.at(-1)!)
    expect(onMoveViewport).toHaveBeenCalledExactlyOnceWith({ x: 490, y: 70, zoom: 1 })
    store.dispose()
  })

  it('converges when the host acknowledges React Flow movement and selection', async () => {
    const onMoveNodes = vi.fn()
    const onMoveViewport = vi.fn()
    const onSelectionChange = vi.fn()
    const initial = task([])
    const initialProps = props(model([initial]), { onMoveNodes, onMoveViewport, onSelectionChange })
    const view = renderView(initialProps)
    const store = view.props.flowCanvasStore
    const node = [...store.$.nodes.values()][0]
    if (node == null) throw new Error('Expected a Task node.')
    const position = { x: 320, y: 180 }
    const viewport = { x: 40, y: 60, zoom: 1.2 }

    await store.handleNodesChange([
      { id: node.rfNodeId, position, type: 'position' },
      { id: node.rfNodeId, selected: true, type: 'select' },
    ])
    store.$$.viewport.set(viewport)
    view.props.onNodeDragStop?.({} as never, node.$.rfNode.value, [])
    view.props.onMoveEnd?.(null, viewport)
    view.props.onSelectionChange?.({ edges: [], nodes: [node.$.rfNode.value] })
    const nodes = store.$.rfNodes.value
    const currentViewport = store.$.viewport.value
    renderView(
      props(
        { edges: [], nodes: [{ ...initial, position: { ...position } }], viewport: { ...viewport } },
        {
          onMoveNodes,
          onMoveViewport,
          onSelectionChange,
          selectedNodeIds: ['target'],
        },
      ),
    )

    expect(store.$.rfNodes.value).toBe(nodes)
    expect(store.$.viewport.value).toBe(currentViewport)
    expect(onMoveNodes).toHaveBeenCalledExactlyOnceWith({ target: position })
    expect(onMoveViewport).toHaveBeenCalledOnce()
    expect(onSelectionChange).toHaveBeenCalledOnce()
    store.dispose()
  })

  it('consumes one focus request once without changing selection and disables motion when requested by the user', () => {
    const onSelectionChange = vi.fn()
    const initial = props(model([task([])]), { onSelectionChange })
    const view = renderView(initial)
    const send = vi.spyOn(view.props.flowCanvasStore.rfCommand, 'send')
    const focusNodeRequest = { nodeId: 'target', requestId: 1 }
    const focused = props(model([task([])]), {
      focusNodeRequest,
      onSelectionChange,
    })
    const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    try {
      renderView(focused)
      renderView(focused)

      expect(send).toHaveBeenCalledOnce()
      expect(send).toHaveBeenCalledWith('focusNode', 'target', { duration: 0 })
      expect(onSelectionChange).not.toHaveBeenCalled()
    } finally {
      matchMedia.mockRestore()
      view.props.flowCanvasStore.dispose()
    }
  })

  it('forwards connection validation through React Flow identities', () => {
    const isValidConnection = vi.fn(() => false)
    const view = renderView(props(model([source, task([])]), { isValidConnection }))

    expect(
      view.props.isValidConnection?.({
        source: 'm:source',
        sourceHandle: 'h:result',
        target: 'm:target',
        targetHandle: 'h:value',
      }),
    ).toBe(false)
    expect(isValidConnection).toHaveBeenCalledWith({
      source: 'source',
      sourceHandle: 'result',
      target: 'target',
      targetHandle: 'value',
    })
    view.props.flowCanvasStore.dispose()
  })

  it('keeps execution edges independent of data ports', () => {
    const view = renderView(props(model([source, { ...task([]), inputs: [], outputs: [] }])))
    expect(view.props.flowCanvasStore.$.rfEdges.value).toHaveLength(1)
    renderView(props(model([source, task([])])))
    expect(view.props.flowCanvasStore.$.rfEdges.value).toHaveLength(1)
    view.props.flowCanvasStore.dispose()
  })

  it('forwards a generic dropped item at its Flow position without serializing the item', async () => {
    const onAddNode = vi.fn(() => Promise.resolve('created'))
    const view = renderView(props(model([]), { onAddNode }))

    const nodeId = await view.props.onDropAddItem?.('connector:github:create-issue', { x: 120, y: 80 })

    expect(onAddNode).toHaveBeenCalledWith('connector:github:create-issue', {
      x: 120,
      y: 80,
    })
    expect(nodeId).toBe('created')
    view.props.flowCanvasStore.dispose()
  })

  it('forwards the resolved theme to the Designer root', () => {
    const view = renderView(props(model([]), { dark: true }))

    expect(view.props.dark).toBe(true)
    view.props.flowCanvasStore.dispose()
  })

  it('runs the initial graph layout when requested by the host', () => {
    const view = renderView(props(model([task([])]), { autoLayout: true }))
    const store = view.props.flowCanvasStore
    const node = [...store.$.nodes.values()][0]
    if (node == null) throw new Error('Expected a Task node.')
    node.$$.rfNode.set({ ...node.$.rfNode.value, measured: { width: 420, height: 240 } })

    expect(store.completeLayout()).toBe('relayout')
    store.dispose()
  })

  it('sends automatic and requested layout positions to the host for persistence', () => {
    const onMoveNodes = vi.fn()
    const view = renderView(props(model([task([])]), { autoLayout: true, onMoveNodes }))
    const store = view.props.flowCanvasStore
    const node = [...store.$.nodes.values()][0]
    if (node == null) throw new Error('Expected a Task node.')
    node.$$.rfNode.set({ ...node.$.rfNode.value, measured: { width: 420, height: 240 } })
    store.completeLayout()
    expect(onMoveNodes).toHaveBeenLastCalledWith({ [node.nodeId]: node.$.position.value })
    node.$$.position.set({ x: 2000, y: 3000 })
    store.onRelayout()
    expect(node.$.position.value).not.toEqual({ x: 2000, y: 3000 })
    expect(onMoveNodes).toHaveBeenCalledTimes(2)
    expect(onMoveNodes).toHaveBeenLastCalledWith({ [node.nodeId]: node.$.position.value })
    store.dispose()
  })

  it('restores the viewport without replacing node positions', () => {
    const value: FlowCanvasViewModel = {
      edges: [],
      nodes: [task([]), commentNode('Comment')],
      viewport: { x: -800, y: -600, zoom: 0.6 },
    }

    const view = renderView(props(value))
    const store = view.props.flowCanvasStore
    const comment = [...(store.$.commentNodes?.values() ?? [])][0]
    if (comment == null) throw new Error('Expected a Comment node.')

    expect([...store.$.nodes.values()][0]?.$.position.value).toEqual({ x: 200, y: 0 })
    expect(comment.$.position.value).toEqual({ x: 0, y: 100 })
    expect(store.$.viewport.value).toEqual({ x: -800, y: -600, zoom: 0.6 })
    store.dispose()
  })

  it('preserves the viewport when an external update adds a node', () => {
    const initial = props(model([]))
    const next = props(model([task([])]))
    const store = update(initial, next)

    expect(store.$.viewport.value).toEqual(next.model.viewport)
    expect(store.$.nodes.size).toBe(1)
    store.dispose()
  })
})

it('reports repeated activation and the final canvas selection before selection effects run', () => {
  const onActivateSelection = vi.fn()
  const onSelectionEnd = vi.fn()
  const view = renderView(props(model([source, task([])]), { selectedNodeIds: ['source'], onActivateSelection, onSelectionEnd }))
  view.props.onActivateSelection?.()
  view.props.onActivateSelection?.()
  expect(onActivateSelection.mock.calls).toEqual([[['source']], [['source']]])
  const store = view.props.flowCanvasStore
  store.handleNodesChange(store.$.rfNodes.value.map((node) => ({ type: 'select', id: node.id, selected: node.data.store.nodeId === 'target' })))
  view.props.onSelectionEnd?.()
  expect(onSelectionEnd).toHaveBeenCalledExactlyOnceWith(['target'])
})
