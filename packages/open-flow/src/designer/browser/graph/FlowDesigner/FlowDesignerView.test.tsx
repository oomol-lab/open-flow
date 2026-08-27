import type { HandleName } from '../../../../schema/index.ts'
import type { FlowDesignerProps } from './FlowDesigner.tsx'
import type {
  FlowDesignerViewCommentNode,
  FlowDesignerViewConditionNode,
  FlowDesignerViewModel,
  FlowDesignerViewProps,
  FlowDesignerViewTaskNode,
  FlowDesignerViewValueNode,
} from './FlowDesignerView.tsx'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConditionsSectionStore } from '../../stores/node/nodeSection/conditionsSection.store.ts'
import { InputSectionStore } from '../../stores/node/nodeSection/inputSection.store.ts'
import { OutputSectionStore } from '../../stores/node/nodeSection/outputSection.store.ts'
import { HandleRowStore } from '../../stores/nodeHandle/handleRow.store.ts'
import { FlowDesignerView } from './FlowDesignerView.tsx'

const hooks = vi.hoisted(() => ({
  cleanups: [] as ((() => void) | undefined)[],
  effectIndex: 0,
  effects: [] as (readonly unknown[] | undefined)[],
  memo: undefined as unknown,
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
      const cleanup = callback()
      hooks.cleanups[index] = typeof cleanup == 'function' ? cleanup : undefined
    }
  }
  return {
    ...original,
    useCallback: <T,>(callback: T) => callback,
    useEffect: effect,
    useLayoutEffect: effect,
    useMemo: <T,>(factory: () => T) => {
      hooks.effectIndex = 0
      hooks.refIndex = 0
      return (hooks.memo ??= factory()) as T
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

const model = (nodes: FlowDesignerViewModel['nodes']): FlowDesignerViewModel => ({ nodes, viewport: { x: 0, y: 0, zoom: 1 } })

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

const conditionNode = (output = 'matched'): FlowDesignerViewConditionNode => ({
  cases: [
    {
      expressions: [{ input: 'value', operator: 'is true' }],
      output,
      relation: 'all',
    },
  ],
  defaultOutput: 'fallback',
  id: 'condition',
  inputs: [{ handle: 'value', jsonSchema: { type: 'boolean' }, nullable: false }],
  kind: 'condition',
  outputs: [
    { handle: output, jsonSchema: {}, nullable: true },
    { handle: 'fallback', jsonSchema: {}, nullable: true },
  ],
  position: { x: 0, y: 0 },
  title: 'Condition',
})

function props(value: FlowDesignerViewModel, overrides: Partial<FlowDesignerViewProps> = {}): FlowDesignerViewProps {
  return {
    addItems: [],
    editable: true,
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

describe('FlowDesignerView model synchronization', () => {
  beforeEach(() => {
    hooks.cleanups = []
    hooks.effectIndex = 0
    hooks.effects = []
    hooks.memo = undefined
    hooks.refIndex = 0
    hooks.refs = []
  })

  it('continues reconciling after React replays effect cleanup', () => {
    const initial = props(model([task([])]), { editable: false })
    const view = FlowDesignerView(initial) as React.ReactElement<FlowDesignerProps>
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      for (const cleanup of hooks.cleanups) cleanup?.()
      FlowDesignerView(props(model([task([])]), { editable: true }))

      expect(error).not.toHaveBeenCalled()
      expect(view.props.flowDesignerStore.$.editable.value).toBe(true)
    } finally {
      error.mockRestore()
      view.props.flowDesignerStore.dispose()
    }
  })

  it('does not clear an input value after the model replaces it with a connection', async () => {
    const onChangeInput = vi.fn()
    const initial = task([{ handle: 'value', jsonSchema: {}, value: null }])
    const connected = task([{ handle: 'value', jsonSchema: {}, sources: [{ nodeId: 'source', output: 'result' }] }])
    const store = update(props(model([source, initial]), { onChangeInput }), props(model([source, connected]), { onChangeInput }))

    await Promise.resolve()

    expect(onChangeInput).not.toHaveBeenCalled()
    store.dispose()
  })

  it('keeps handle definition values stable when only an input value changes', () => {
    const initial = task([{ handle: 'value', jsonSchema: {} }])
    const changed = task([{ handle: 'value', jsonSchema: {}, value: 'message' }])
    const view = FlowDesignerView(props(model([initial]))) as React.ReactElement<FlowDesignerProps>
    const node = [...view.props.flowDesignerStore.$.nodes.values()][0]!
    const inputSection = node.findSection<InputSectionStore>(InputSectionStore.TYPE)!
    const outputSection = node.findSection<OutputSectionStore>(OutputSectionStore.TYPE)!
    const inputDefs = inputSection.$.inputHandleDefs.value
    const outputDefs = outputSection.$.outputHandleDefs.value

    FlowDesignerView(props(model([changed])))

    expect(inputSection.$.inputHandleDefs.value).toBe(inputDefs)
    expect(outputSection.$.outputHandleDefs.value).toBe(outputDefs)
    view.props.flowDesignerStore.dispose()
  })

  it('projects deployment Variable state and routes Handle selections to the host', () => {
    const onChangeInputVariable = vi.fn()
    const onOpenVariables = vi.fn()
    const value: FlowDesignerViewModel = {
      nodes: [task([{ handle: 'value', jsonSchema: { type: 'string' }, variable: 'API_TOKEN', variableCompatible: true }])],
      variableNames: ['API_TOKEN', 'ENDPOINT'],
      variableNamesLoaded: true,
      variableNamesLoading: false,
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const view = FlowDesignerView(props(value, { onChangeInputVariable, onOpenVariables })) as React.ReactElement<FlowDesignerProps>
    const store = view.props.flowDesignerStore

    expect(store.$.variableInputs.value.get('target\0value')).toEqual({ compatible: true, name: 'API_TOKEN' })
    expect(store.$.variableNames.value).toEqual(['API_TOKEN', 'ENDPOINT'])
    expect(store.$.variableNamesLoaded.value).toBe(true)
    store.onOpenVariables?.()
    store.onChangeInputVariable?.('target', 'value', 'ENDPOINT')

    expect(onOpenVariables).toHaveBeenCalledOnce()
    expect(onChangeInputVariable).toHaveBeenCalledWith('target', 'value', 'ENDPOINT')
    store.dispose()
  })

  it('keeps an incompatible Variable binding available for clearing', () => {
    const onChangeInputVariable = vi.fn()
    const value = model([task([{ handle: 'value', jsonSchema: { type: 'number' }, variable: 'OLD_TOKEN', variableCompatible: false }])])
    const view = FlowDesignerView(props(value, { onChangeInputVariable })) as React.ReactElement<FlowDesignerProps>
    const store = view.props.flowDesignerStore

    expect(store.$.variableInputs.value.get('target\0value')).toEqual({ compatible: false, name: 'OLD_TOKEN' })
    store.onChangeInputVariable?.('target', 'value', undefined)

    expect(onChangeInputVariable).toHaveBeenCalledWith('target', 'value', undefined)
    store.dispose()
  })

  it('restores editable handle controls for inline code Tasks only', async () => {
    const onChangeTaskPorts = vi.fn()
    const editable = { ...task([{ handle: 'value', jsonSchema: {} }]), editablePorts: true }
    const view = FlowDesignerView(props(model([editable]), { onChangeTaskPorts })) as React.ReactElement<FlowDesignerProps>
    const node = [...view.props.flowDesignerStore.$.nodes.values()][0]!
    const inputSection = node.findSection<InputSectionStore>(InputSectionStore.TYPE)!
    const outputSection = node.findSection<OutputSectionStore>(OutputSectionStore.TYPE)!

    expect(inputSection.role).toBe('author')
    expect(outputSection.role).toBe('author')
    expect(inputSection.renameHandle('value' as HandleName, 'message' as HandleName)).toBe(true)
    expect(outputSection.renameHandle('result' as HandleName, 'text' as HandleName)).toBe(true)
    await Promise.resolve()

    expect(onChangeTaskPorts).toHaveBeenLastCalledWith(
      'target',
      [expect.objectContaining({ handle: 'message' })],
      [expect.objectContaining({ handle: 'text' })],
    )
    inputSection.addNewHandle()
    outputSection.deleteHandle('text' as HandleName)
    await Promise.resolve()
    expect(onChangeTaskPorts).toHaveBeenLastCalledWith(
      'target',
      [expect.objectContaining({ handle: 'message' }), expect.objectContaining({ handle: 'input' })],
      [],
    )
    view.props.flowDesignerStore.dispose()
  })

  it('persists inline code Task schema changes', async () => {
    const onChangeTaskPorts = vi.fn()
    const editable = { ...task([{ handle: 'value', jsonSchema: {} }]), editablePorts: true }
    const view = FlowDesignerView(props(model([editable]), { onChangeTaskPorts })) as React.ReactElement<FlowDesignerProps>
    const node = [...view.props.flowDesignerStore.$.nodes.values()][0]!
    const inputSection = node.findSection<InputSectionStore>(InputSectionStore.TYPE)!
    const row = inputSection.$.handles.value.find(HandleRowStore.is)

    row?.schema$.set({ type: 'number' })
    await Promise.resolve()

    expect(onChangeTaskPorts).toHaveBeenLastCalledWith(
      'target',
      [expect.objectContaining({ handle: 'value', jsonSchema: { type: 'number' } })],
      [expect.objectContaining({ handle: 'result' })],
    )
    view.props.flowDesignerStore.dispose()
  })

  it('duplicates from the current Designer position', async () => {
    const onDuplicate = vi.fn()
    const editable = { ...task([]), editablePorts: true }
    const view = FlowDesignerView(props(model([editable]), { onDuplicate })) as React.ReactElement<FlowDesignerProps>
    const node = [...view.props.flowDesignerStore.$.nodes.values()][0]!
    node.$$.position.set({ x: 320, y: 180 })

    await node.duplicateNode?.()

    expect(onDuplicate).toHaveBeenCalledWith(['target'], undefined, { target: { x: 320, y: 180 } })
    view.props.flowDesignerStore.dispose()
  })

  it('forwards inline node title and icon changes', async () => {
    const onChangeNodeIcon = vi.fn()
    const onChangeNodeTitle = vi.fn()
    const view = FlowDesignerView(props(model([task([])]), { onChangeNodeIcon, onChangeNodeTitle })) as React.ReactElement<FlowDesignerProps>
    const node = [...view.props.flowDesignerStore.$.nodes.values()][0]!

    node.manifest$!.title.set('Renamed task')
    node.manifest$!.icon.set(':carbon:star:')
    await Promise.resolve()

    expect(onChangeNodeTitle).toHaveBeenCalledWith('target', 'Renamed task')
    expect(onChangeNodeIcon).toHaveBeenCalledWith('target', ':carbon:star:')
    view.props.flowDesignerStore.dispose()
  })

  it('restores editable handle controls when a read-only view becomes editable', () => {
    const editable = { ...task([{ handle: 'value', jsonSchema: {} }]), editablePorts: true }
    const store = update(props(model([editable]), { editable: false }), props(model([editable]), { editable: true }))
    const node = [...store.$.nodes.values()][0]!

    expect(node.findSection<InputSectionStore>(InputSectionStore.TYPE)?.role).toBe('author')
    expect(node.findSection<OutputSectionStore>(OutputSectionStore.TYPE)?.role).toBe('author')
    store.dispose()
  })

  it('persists edits made through the inline Condition controls', () => {
    const onChangeCondition = vi.fn()
    const view = FlowDesignerView(props(model([conditionNode()]), { onChangeCondition })) as React.ReactElement<FlowDesignerProps>
    const node = [...view.props.flowDesignerStore.$.nodes.values()][0]!
    const section = node.findSection<ConditionsSectionStore>(ConditionsSectionStore.TYPE)!

    expect(section.role).toBe('author')
    expect(section.renameHandle('matched' as HandleName, 'accepted' as HandleName)).toBe(true)

    expect(onChangeCondition).toHaveBeenLastCalledWith('condition', {
      cases: [
        {
          expressions: [{ input: 'value', operator: 'is true' }],
          output: 'accepted',
          relation: 'all',
        },
      ],
      defaultOutput: 'fallback',
      input: { description: undefined, handle: 'value', jsonSchema: { type: 'boolean' }, nullable: false },
    })
    view.props.flowDesignerStore.dispose()
  })

  it('does not echo model-owned Condition updates back to the host', () => {
    const onChangeCondition = vi.fn()
    const store = update(props(model([conditionNode()]), { onChangeCondition }), props(model([conditionNode('accepted')]), { onChangeCondition }))

    expect(onChangeCondition).not.toHaveBeenCalled()
    store.dispose()
  })

  it('does not echo model-owned Value and Comment updates back to the host', async () => {
    const onChangeComment = vi.fn()
    const onChangeValue = vi.fn()
    const store = update(
      props(model([valueNode('before'), commentNode('Before')]), { onChangeComment, onChangeValue }),
      props(model([valueNode('after'), commentNode('After')]), { onChangeComment, onChangeValue }),
    )

    await Promise.resolve()

    expect(onChangeComment).not.toHaveBeenCalled()
    expect(onChangeValue).not.toHaveBeenCalled()
    store.dispose()
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

  it('does not echo an unchanged controlled selection in React Flow order', () => {
    const onSelectionChange = vi.fn()
    const view = FlowDesignerView(
      props(model([source, task([])]), { onSelectionChange, selectedNodeIds: ['source', 'target'] }),
    ) as React.ReactElement<FlowDesignerProps>
    const nodes = [...view.props.flowDesignerStore.$.nodes.values()]

    view.props.onSelectionChange?.({ edges: [], nodes: nodes.toReversed().map((node) => ({ data: { store: node } }) as never) })

    expect(onSelectionChange).not.toHaveBeenCalled()
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

    FlowDesignerView(props({ ...value, nodes: value.nodes.map((item) => ({ ...item })), viewport: { ...value.viewport } }))

    expect(replaceNodes).not.toHaveBeenCalled()
    expect(replaceComments).not.toHaveBeenCalled()
    expect(setPosition).not.toHaveBeenCalled()
    expect(setViewport).not.toHaveBeenCalled()
    view.props.flowDesignerStore.dispose()
  })

  it('routes user edits through the latest host callbacks', () => {
    const previous = vi.fn()
    const current = vi.fn()
    const value = model([conditionNode()])
    const view = FlowDesignerView(props(value, { onChangeCondition: previous })) as React.ReactElement<FlowDesignerProps>
    const node = [...view.props.flowDesignerStore.$.nodes.values()][0]!
    const section = node.findSection<ConditionsSectionStore>(ConditionsSectionStore.TYPE)!

    FlowDesignerView(props({ ...value }, { onChangeCondition: current }))
    section.renameHandle('matched' as HandleName, 'accepted' as HandleName)

    expect(previous).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledOnce()
    view.props.flowDesignerStore.dispose()
  })

  it('consumes one focus request once without changing selection and disables motion when requested by the user', () => {
    const onSelectionChange = vi.fn()
    const initial = props(model([task([])]), { onSelectionChange })
    const view = FlowDesignerView(initial) as React.ReactElement<FlowDesignerProps>
    const send = vi.spyOn(view.props.flowDesignerStore.rfCommand, 'send')
    const focusNodeRequest = { nodeId: 'target', requestId: 1 }
    const focused = props(model([task([])]), { focusNodeRequest, onSelectionChange })
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
    expect(isValidConnection).toHaveBeenCalledWith({ source: 'source', sourceHandle: 'result', target: 'target', targetHandle: 'value' })
    view.props.flowDesignerStore.dispose()
  })

  it('does not project a connection until both handles exist', () => {
    const missingOutput = { ...source, outputs: [] }
    const connected = task([{ handle: 'value', jsonSchema: {}, sources: [{ nodeId: 'source', output: 'result' }] }])
    const view = FlowDesignerView(props(model([missingOutput, connected]))) as React.ReactElement<FlowDesignerProps>

    expect(view.props.flowDesignerStore.$.renderedRFEdges.value).toEqual([])
    FlowDesignerView(props(model([source, connected])))
    expect(view.props.flowDesignerStore.$.renderedRFEdges.value).toHaveLength(1)
    view.props.flowDesignerStore.dispose()
  })

  it('forwards a generic dropped item at its Flow position without serializing the item', () => {
    const onAddNode = vi.fn()
    const view = FlowDesignerView(props(model([]), { onAddNode })) as React.ReactElement<FlowDesignerProps>

    view.props.onDropAddItem?.('connector:github:create-issue', { x: 120, y: 80 })

    expect(onAddNode).toHaveBeenCalledWith('connector:github:create-issue', { x: 120, y: 80 })
    view.props.flowDesignerStore.dispose()
  })

  it('forwards the resolved theme to the Designer root', () => {
    const view = FlowDesignerView(props(model([]), { dark: true })) as React.ReactElement<FlowDesignerProps>

    expect(view.props.dark).toBe(true)
    view.props.flowDesignerStore.dispose()
  })

  it('starts each independent Flow view in overview mode', () => {
    const view = FlowDesignerView(props(model([]))) as React.ReactElement<FlowDesignerProps>

    expect(view.props.flowDesignerStore.$.displayMode.value).toBe('overview')
    view.props.flowDesignerStore.dispose()
  })

  it('keeps the persisted detail viewport when overview has no saved layout', async () => {
    const value: FlowDesignerViewModel = {
      layouts: {
        detail: {
          viewport: { x: 10, y: 20, zoom: 0.8 },
        },
      },
      nodes: [task([])],
      viewport: { x: 10, y: 20, zoom: 0.8 },
    }
    const view = FlowDesignerView(props(value)) as React.ReactElement<FlowDesignerProps>
    const store = view.props.flowDesignerStore

    expect(store.completeDisplayModeLayout()).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 0))
    store.$$.viewport.set({ x: 30, y: 40, zoom: 1.2 })
    store.$$.displayMode.set('detail')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.$.viewport.value).toEqual({ x: 10, y: 20, zoom: 0.8 })
    store.dispose()
  })
})
