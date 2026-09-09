import type { NodeId } from '../../../../schema/index.ts'
import type { FlowDesignerProps } from './FlowDesigner.tsx'
import type { FlowDesignerViewCommentNode, FlowDesignerViewModel, FlowDesignerViewProps, FlowDesignerViewTaskNode, FlowDesignerViewValueNode } from './model.ts'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FlowDesignerView } from './FlowDesignerView.tsx'

const hooks = vi.hoisted(() => ({
  cleanups: [] as ((() => void) | undefined)[],
  effectIndex: 0,
  effects: [] as (readonly unknown[] | undefined)[],
  memo: undefined as unknown,
  memoDependencies: undefined as readonly unknown[] | undefined,
  refIndex: 0,
  refs: [] as { current: unknown }[],
}))

vi.mock('virtual:uno.css', () => ({}))

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>()
  const effect = (callback: () => void | (() => void), dependencies?: readonly unknown[]) => {
    const index = hooks.effectIndex++
    const previous = hooks.effects[index]
    hooks.effects[index] = dependencies
    if (
      dependencies == null ||
      previous == null ||
      dependencies.length != previous.length ||
      dependencies.some((dependency, dependencyIndex) => dependency !== previous[dependencyIndex])
    ) {
      hooks.cleanups[index]?.()
      const cleanup = callback()
      hooks.cleanups[index] = typeof cleanup == 'function' ? cleanup : undefined
    }
  }
  return {
    ...original,
    useCallback: <T,>(callback: T) => callback,
    useEffect: effect,
    useLayoutEffect: effect,
    useMemo: <T,>(factory: () => T, dependencies?: readonly unknown[]) => {
      hooks.effectIndex = 0
      hooks.refIndex = 0
      const previous = hooks.memoDependencies
      if (
        hooks.memo === undefined ||
        dependencies == null ||
        previous == null ||
        dependencies.length != previous.length ||
        dependencies.some((dependency, dependencyIndex) => dependency !== previous[dependencyIndex])
      ) {
        hooks.memo = factory()
        hooks.memoDependencies = dependencies
      }
      return hooks.memo as T
    },
    useRef: <T,>(value: T) => {
      const index = hooks.refIndex++
      return (hooks.refs[index] ??= { current: value }) as { current: T }
    },
  }
})

const task = (inputs: FlowDesignerViewTaskNode['inputs']): FlowDesignerViewTaskNode => ({
  id: 'target',
  inputs,
  kind: 'task',
  outputs: [{ handle: 'result', jsonSchema: {} }],
  position: { x: 200, y: 0 },
  reference: 'task',
  title: 'Task',
})

const source: FlowDesignerViewTaskNode = {
  id: 'source',
  inputs: [],
  kind: 'task',
  outputs: [{ handle: 'result', jsonSchema: {} }],
  position: { x: 0, y: 0 },
  reference: 'source-task',
  title: 'Source',
}

const model = (nodes: FlowDesignerViewModel['nodes']): FlowDesignerViewModel => ({
  edges:
    nodes.some((node) => node.id == 'source') && nodes.some((node) => node.id == 'target')
      ? [{ id: 'execution', source: 'source', sourceHandle: '$out', target: 'target', targetHandle: '$in' }]
      : [],
  nodes,
  viewport: { x: 0, y: 0, zoom: 1 },
})

const valueNode = (content: unknown): FlowDesignerViewValueNode => ({
  id: 'value',
  inputs: [],
  kind: 'value',
  outputs: [{ handle: 'value', jsonSchema: {} }],
  position: { x: 0, y: 0 },
  title: 'Value',
  values: [{ handle: 'value', jsonSchema: {}, value: content }],
})

const commentNode = (title: string): FlowDesignerViewCommentNode => ({
  content: '',
  id: 'comment',
  kind: 'comment',
  position: { x: 0, y: 100 },
  title,
})

function props(value: FlowDesignerViewModel, overrides: Partial<FlowDesignerViewProps> = {}): FlowDesignerViewProps {
  return {
    addItems: [],
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
    onPaste: () => undefined,
    onSelectionChange: () => undefined,
    selectedNodeIds: [],
    ...overrides,
  }
}

function update(initial: FlowDesignerViewProps, next: FlowDesignerViewProps): FlowDesignerProps['flowDesignerStore'] {
  const view = FlowDesignerView(initial) as React.ReactElement<FlowDesignerProps>
  FlowDesignerView(next)
  return view.props.flowDesignerStore
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('FlowDesignerView model synchronization', () => {
  beforeEach(() => {
    hooks.cleanups = []
    hooks.effectIndex = 0
    hooks.effects = []
    hooks.memo = undefined
    hooks.memoDependencies = undefined
    hooks.refIndex = 0
    hooks.refs = []
  })

  it('reads ignored state from the owner and sends changes without mutating the graph', () => {
    const graph = model([task([])])
    const onIgnoreNodes = vi.fn()
    const initial = props(graph, { onIgnoreNodes })
    const view = FlowDesignerView(initial) as React.ReactElement<FlowDesignerProps>
    const store = view.props.flowDesignerStore
    const node = store.$.nodes.get('target' as NodeId)!
    node.setIgnored(true)
    expect(onIgnoreNodes).toHaveBeenCalledWith(['target'], true)
    expect(node.ignore.value).toBe(false)
    FlowDesignerView({ ...initial, ignoredNodeIds: ['target'] })
    expect(node.ignore.value).toBe(true)
    expect(store.$.nodes.get('target' as NodeId)).toBe(node)
    expect(graph.nodes[0]).not.toHaveProperty('ignored')
    FlowDesignerView(initial)
    expect(node.ignore.value).toBe(false)
    store.dispose()
  })

  it('decodes React Flow connection identifiers once at the canvas boundary', () => {
    const onConnect = vi.fn()
    const view = FlowDesignerView(props(model([task([])]), { onConnect })) as React.ReactElement<FlowDesignerProps>
    view.props.flowDesignerStore.onRFConnect({ source: 'm:source:one', sourceHandle: 'h:$branch:matched', target: 'm:target', targetHandle: 'h:$in' })
    expect(onConnect).toHaveBeenCalledExactlyOnceWith({ source: 'source:one', sourceHandle: '$branch:matched', target: 'target', targetHandle: '$in' })
    view.props.flowDesignerStore.dispose()
  })

  it.each(['edges-first', 'nodes-first'] as const)('coalesces %s deletion callbacks without redundant incident-edge removal', (order) => {
    vi.useFakeTimers()
    const graph = model([{ ...task([]), id: 'source' }, task([]), { ...task([]), id: 'other' }, { ...task([]), id: 'leaf' }])
    const independent = { id: 'independent', source: 'other', sourceHandle: '$out', target: 'leaf', targetHandle: '$in' }
    const onDeleteNodes = vi.fn()
    const onDisconnect = vi.fn()
    const view = FlowDesignerView(
      props({ ...graph, edges: [...graph.edges, independent] }, { onDeleteNodes, onDisconnect }),
    ) as React.ReactElement<FlowDesignerProps>
    const store = view.props.flowDesignerStore
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
    const view = FlowDesignerView(
      props(model([{ ...task([]), id: 'source' }, task([])]), { onDeleteNodes, onDisconnect }),
    ) as React.ReactElement<FlowDesignerProps>
    const store = view.props.flowDesignerStore
    store.handleEdgesChange(store.$.rfEdges.value.map((edge) => ({ type: 'remove', id: edge.id })))
    store.handleNodesChange([{ type: 'remove', id: store.$.nodes.get('target' as NodeId)!.rfNodeId }])
    if (lifecycle == 'dispose') store.dispose()
    else for (const cleanup of hooks.cleanups) cleanup?.()
    vi.runAllTimers()
    expect(onDeleteNodes).not.toHaveBeenCalled()
    expect(onDisconnect).not.toHaveBeenCalled()
    store.dispose()
  })

  it('continues reconciling while React has effects unmounted', () => {
    vi.useFakeTimers()
    const initial = props(model([task([])]), { editable: false })
    const view = FlowDesignerView(initial) as React.ReactElement<FlowDesignerProps>
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      for (const cleanup of hooks.cleanups) cleanup?.()
      vi.runOnlyPendingTimers()
      FlowDesignerView(props(model([task([])]), { editable: true }))

      expect(error).not.toHaveBeenCalled()
      expect(view.props.flowDesignerStore.$.editable.value).toBe(true)
    } finally {
      error.mockRestore()
      view.props.flowDesignerStore.dispose()
    }
  })

  it('disposes the adapter replaced by a new identity', () => {
    const first = FlowDesignerView(props(model([]))) as React.ReactElement<FlowDesignerProps>
    const disposed = vi.fn()
    first.props.flowDesignerStore.dispose.add(disposed)

    const second = FlowDesignerView(props(model([]), { identity: 'flow:next' })) as React.ReactElement<FlowDesignerProps>

    expect(second.props.flowDesignerStore).not.toBe(first.props.flowDesignerStore)
    expect(disposed).toHaveBeenCalledOnce()
    second.props.flowDesignerStore.dispose()
  })

  it('duplicates from the current Designer position', async () => {
    const onDuplicate = vi.fn()
    const editable = task([])
    const view = FlowDesignerView(props(model([editable]), { onDuplicate })) as React.ReactElement<FlowDesignerProps>
    const node = [...view.props.flowDesignerStore.$.nodes.values()][0]!
    node.$$.position.set({ x: 320, y: 180 })

    await node.duplicateNode?.()

    expect(onDuplicate).toHaveBeenCalledWith(
      ['target'],
      { x: 24, y: 24 },
      {
        target: { x: 320, y: 180 },
      },
    )
    view.props.flowDesignerStore.dispose()
  })

  it('updates node error state from model diagnostics', () => {
    const initial = props(model([{ ...task([]), diagnostics: 2 }]))
    const changed = props(model([{ ...task([]), diagnostics: 0 }]))
    const view = FlowDesignerView(initial) as React.ReactElement<FlowDesignerProps>
    expect([...view.props.flowDesignerStore.$.nodes.values()][0]?.$.hasError.value).toBe(true)
    FlowDesignerView(changed)
    const store = view.props.flowDesignerStore
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
    const view = FlowDesignerView(initial) as React.ReactElement<FlowDesignerProps>
    const node = [...view.props.flowDesignerStore.$.nodes.values()][0]!
    node.$$.position.set({ x: 320, y: 180 })

    FlowDesignerView({ ...initial, editable: false })
    expect([...view.props.flowDesignerStore.$.nodes.values()][0]?.$.position.value).toEqual({ x: 320, y: 180 })

    FlowDesignerView(initial)
    expect([...view.props.flowDesignerStore.$.nodes.values()][0]?.$.position.value).toEqual({ x: 320, y: 180 })

    const moved = { ...task([]), position: { x: 500, y: 400 } }
    FlowDesignerView(props(model([moved]), { editable: false }))
    expect([...view.props.flowDesignerStore.$.nodes.values()][0]?.$.position.value).toEqual(moved.position)
    view.props.flowDesignerStore.dispose()
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

    const view = FlowDesignerView(props(model([{ ...wait, notice: { ...wait.notice } }]))) as React.ReactElement<FlowDesignerProps>
    expect(view.props.flowDesignerStore.$.nodes.get(node!.nodeId)).toBe(node)
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
    const view = FlowDesignerView(props(model([wait, target]))) as React.ReactElement<FlowDesignerProps>
    const node = [...view.props.flowDesignerStore.$.nodes.values()].find((item) => item.nodeId == 'wait')
    if (node == null) throw new Error('Expected a Wait node.')
    const changes: unknown[] = []
    const stop = node.content$.reaction((content) => changes.push(content), true)

    FlowDesignerView(
      props(model([{ ...wait, notice: { icon: ':service:feishu:', text: 'Notification · Feishu Custom Bot · Send text message' } }, { ...target }])),
    )

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ inputs: wait.inputs, outputs: wait.outputs, notice: { icon: ':service:feishu:' } })
    expect(view.props.flowDesignerStore.$.nodes.get(node.nodeId)).toBe(node)
    stop()
    view.props.flowDesignerStore.dispose()
  })

  it.each(['subflow', 'wait', 'task'] as const)('preserves %s input values in the canvas projection', (kind) => {
    const view = FlowDesignerView(
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
    ) as React.ReactElement<FlowDesignerProps>
    const node = [...view.props.flowDesignerStore.$.nodes.values()][0]!
    expect(node.content$.value.inputs).toEqual([{ handle: 'value', jsonSchema: {}, value: 42 }])
    view.props.flowDesignerStore.dispose()
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
    const view = FlowDesignerView(props(model([commentNode('Note')]), { onChangeComment })) as React.ReactElement<FlowDesignerProps>
    const comment = [...view.props.flowDesignerStore.$.commentNodes!.values()][0]!
    comment.$$.content.set('## Draft')
    expect(onChangeComment).not.toHaveBeenCalled()
    comment.saveContent(comment.$$.content.value ?? '')
    expect(onChangeComment).toHaveBeenCalledWith('comment', { title: 'Note', content: '## Draft' })
    view.props.flowDesignerStore.dispose()
  })

  it('routes Comment title edits to the host', () => {
    const onChangeComment = vi.fn()
    const view = FlowDesignerView(props(model([commentNode('Before')]), { onChangeComment })) as React.ReactElement<FlowDesignerProps>
    const comment = [...view.props.flowDesignerStore.$.commentNodes!.values()][0]
    if (comment == null) throw new Error('Expected a Comment node.')

    comment.$$.title.set('After')

    expect(onChangeComment).toHaveBeenCalledWith('comment', { content: '', title: 'After' })
    view.props.flowDesignerStore.dispose()
  })

  it('does not rewrite an unchanged controlled selection when the host recreates the model', () => {
    const value = model([task([])])
    const view = FlowDesignerView(props(value, { selectedNodeIds: ['target'] })) as React.ReactElement<FlowDesignerProps>
    const node = [...view.props.flowDesignerStore.$.nodes.values()][0]!
    node.$$.selected.set(false)
    const setSelection = vi.spyOn(node.$$.selected, 'set')
    const replaceNodes = vi.spyOn(view.props.flowDesignerStore.$$.nodes, 'replace')

    FlowDesignerView(props({ ...value }, { selectedNodeIds: ['target'] }))

    expect(setSelection).not.toHaveBeenCalled()
    expect(replaceNodes).not.toHaveBeenCalled()
    view.props.flowDesignerStore.dispose()
  })

  it('moves the controlled selection to a copied node', () => {
    const original = task([])
    const copy = { ...task([]), id: 'copy', position: { x: 560, y: 0 }, title: 'Task (2)' }
    const view = FlowDesignerView(props(model([original]), { selectedNodeIds: ['target'] })) as React.ReactElement<FlowDesignerProps>

    FlowDesignerView(props(model([original, copy]), { selectedNodeIds: ['copy'] }))

    expect(view.props.flowDesignerStore.$.nodes.get('target' as NodeId)?.$.selected.value).toBe(false)
    expect(view.props.flowDesignerStore.$.nodes.get('copy' as NodeId)?.$.selected.value).toBe(true)
    view.props.flowDesignerStore.dispose()
  })

  it('does not echo an unchanged controlled selection in React Flow order', () => {
    const onSelectionChange = vi.fn()
    const view = FlowDesignerView(
      props(model([source, task([])]), {
        onSelectionChange,
        selectedNodeIds: ['source', 'target'],
      }),
    ) as React.ReactElement<FlowDesignerProps>
    const nodes = [...view.props.flowDesignerStore.$.nodes.values()]

    view.props.onSelectionChange?.({
      edges: [],
      nodes: nodes.toReversed().map((node) => ({ data: { store: node } }) as never),
    })

    expect(onSelectionChange).not.toHaveBeenCalled()
    view.props.flowDesignerStore.dispose()
  })

  it('ignores a queued selection snapshot after controlled deselection and still accepts user selection', async () => {
    const onSelectionChange = vi.fn()
    const initial = props(model([source, task([])]), { onSelectionChange, selectedNodeIds: ['target'] })
    const view = FlowDesignerView(initial) as React.ReactElement<FlowDesignerProps>
    const store = view.props.flowDesignerStore
    const previousSelection = store.$.rfNodes.value.filter((node) => node.selected)

    const next = FlowDesignerView(props(initial.model, { onSelectionChange })) as React.ReactElement<FlowDesignerProps>
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
    if (phase == 'update') FlowDesignerView(props(value, { onSelectionChange }))
    const next = FlowDesignerView(props(value, { onSelectionChange, selectedNodeIds: ['target'] })) as React.ReactElement<FlowDesignerProps>
    const store = next.props.flowDesignerStore

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
    let next: FlowDesignerViewProps
    const onAddNode = vi.fn(async () => {
      FlowDesignerView(next)
      return 'target'
    })
    const initial = props(model([source]), { onAddNode })
    next = props(model([source, task([])]), { onAddNode, selectedNodeIds: ['target'] })
    const view = FlowDesignerView(initial) as React.ReactElement<FlowDesignerProps>

    await view.props.onDropAddItem?.('task', { x: 200, y: 0 })
    await Promise.resolve()

    const target = view.props.flowDesignerStore.$.nodes.get('target' as NodeId)
    expect(target?.$.selected.value).toBe(true)
    view.props.flowDesignerStore.dispose()
  })

  it('does not replace Designer maps for a semantically unchanged model object', () => {
    const value = model([task([])])
    const view = FlowDesignerView(props(value)) as React.ReactElement<FlowDesignerProps>
    const node = [...view.props.flowDesignerStore.$.nodes.values()][0]!
    const replaceNodes = vi.spyOn(view.props.flowDesignerStore.$$.nodes, 'replace')
    const replaceComments = vi.spyOn(view.props.flowDesignerStore.$$.commentNodes!, 'replace')
    const setPosition = vi.spyOn(node.$$.position, 'set')
    const setViewport = vi.spyOn(view.props.flowDesignerStore.$$.viewport, 'set')

    FlowDesignerView(
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
    view.props.flowDesignerStore.dispose()
  })

  it('converges when the host acknowledges React Flow movement and selection', async () => {
    const onMoveNodes = vi.fn()
    const onMoveViewport = vi.fn()
    const onSelectionChange = vi.fn()
    const initial = task([])
    const initialProps = props(model([initial]), { onMoveNodes, onMoveViewport, onSelectionChange })
    const view = FlowDesignerView(initialProps) as React.ReactElement<FlowDesignerProps>
    const store = view.props.flowDesignerStore
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
    FlowDesignerView(
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
    const view = FlowDesignerView(initial) as React.ReactElement<FlowDesignerProps>
    const send = vi.spyOn(view.props.flowDesignerStore.rfCommand, 'send')
    const focusNodeRequest = { nodeId: 'target', requestId: 1 }
    const focused = props(model([task([])]), {
      focusNodeRequest,
      onSelectionChange,
    })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    try {
      FlowDesignerView(focused)
      FlowDesignerView(focused)

      expect(send).toHaveBeenCalledOnce()
      expect(send).toHaveBeenCalledWith('focusNode', 'target', { duration: 0 })
      expect(onSelectionChange).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      view.props.flowDesignerStore.dispose()
    }
  })

  it('forwards connection validation through React Flow identities', () => {
    const isValidConnection = vi.fn(() => false)
    const view = FlowDesignerView(props(model([source, task([])]), { isValidConnection })) as React.ReactElement<FlowDesignerProps>

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
    view.props.flowDesignerStore.dispose()
  })

  it('keeps execution edges independent of data ports', () => {
    const view = FlowDesignerView(props(model([source, { ...task([]), inputs: [], outputs: [] }]))) as React.ReactElement<FlowDesignerProps>
    expect(view.props.flowDesignerStore.$.rfEdges.value).toHaveLength(1)
    FlowDesignerView(props(model([source, task([])])))
    expect(view.props.flowDesignerStore.$.rfEdges.value).toHaveLength(1)
    view.props.flowDesignerStore.dispose()
  })

  it('forwards a generic dropped item at its Flow position without serializing the item', async () => {
    const onAddNode = vi.fn(() => Promise.resolve('created'))
    const view = FlowDesignerView(props(model([]), { onAddNode })) as React.ReactElement<FlowDesignerProps>

    const nodeId = await view.props.onDropAddItem?.('connector:github:create-issue', { x: 120, y: 80 })

    expect(onAddNode).toHaveBeenCalledWith('connector:github:create-issue', {
      x: 120,
      y: 80,
    })
    expect(nodeId).toBe('created')
    view.props.flowDesignerStore.dispose()
  })

  it('forwards the resolved theme to the Designer root', () => {
    const view = FlowDesignerView(props(model([]), { dark: true })) as React.ReactElement<FlowDesignerProps>

    expect(view.props.dark).toBe(true)
    view.props.flowDesignerStore.dispose()
  })

  it('runs the initial graph layout when requested by the host', () => {
    const view = FlowDesignerView(props(model([task([])]), { autoLayout: true })) as React.ReactElement<FlowDesignerProps>
    const store = view.props.flowDesignerStore
    const node = [...store.$.nodes.values()][0]
    if (node == null) throw new Error('Expected a Task node.')
    node.$$.rfNode.set({ ...node.$.rfNode.value, measured: { width: 420, height: 240 } })

    expect(store.completeLayout()).toBe('relayout')
    store.dispose()
  })

  it('sends automatic and requested layout positions to the host for persistence', () => {
    const onMoveNodes = vi.fn()
    const view = FlowDesignerView(props(model([task([])]), { autoLayout: true, onMoveNodes })) as React.ReactElement<FlowDesignerProps>
    const store = view.props.flowDesignerStore
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
    const value: FlowDesignerViewModel = {
      edges: [],
      nodes: [task([]), commentNode('Comment')],
      viewport: { x: -800, y: -600, zoom: 0.6 },
    }

    const view = FlowDesignerView(props(value)) as React.ReactElement<FlowDesignerProps>
    const store = view.props.flowDesignerStore
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
