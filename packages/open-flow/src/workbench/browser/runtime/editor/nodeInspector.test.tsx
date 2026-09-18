import type { ReactElement, ReactNode } from 'react'

import { Children, isValidElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { NodeInspector } from './nodeInspector.tsx'

vi.mock('use-value-enhancer', () => ({ useVal: (value: { value: unknown }) => value.value }))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: vi.fn(),
  useMemo: (create: () => unknown) => create(),
  useRef: (value: unknown) => ({ current: value }),
  useState: vi.fn((initial: unknown) => [typeof initial == 'function' ? initial() : initial, vi.fn()]),
}))

vi.mock('val-i18n-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('val-i18n-react')>()),
  useLang: () => 'en',
  useTranslate: () => (key: string) => key,
}))

function find(element: ReactElement, predicate: (item: ReactElement) => boolean): ReactElement | undefined {
  if (predicate(element)) return element
  for (const child of Children.toArray((element.props as { readonly children?: ReactNode }).children)) {
    if (!isValidElement(child)) continue
    const match = find(child, predicate)
    if (match != null) return match
  }
}

function resolutionDefinition(
  node: { readonly kind: 'approval' | 'wait' } & Readonly<Record<string, unknown>>,
  revision: unknown,
  saveResolution: ReturnType<typeof vi.fn>,
): ReactElement {
  const view = { graph: () => ({ nodes: { wait: node } }), ...(revision as object) }
  const element = NodeInspector({
    variables: { enabled: true, names: [], loaded: false, loading: false, onOpen: vi.fn() },
    activeConnectorConnections: [],
    connectorAuthorizationPending: false,
    connectorLoading: false,
    connectors: {} as never,
    disabled: false,
    revision: view as never,
    selection: { id: 'wait', kind: node.kind, node } as never,
    store: { $: { flowId: { value: 'flow' } }, saveResolution } as never,
    target: { kind: 'flow' },
    theme: 'light',
    triggerAuthorizationPending: false,
    triggerConnectionLoading: false,
    triggers: {} as never,
  })
  const resolution = find(element, (item) => typeof item.type == 'function' && item.type.name == 'ResolutionDefinition')
  if (resolution == null || typeof resolution.type != 'function') throw new Error('Expected resolution settings.')
  return (resolution.type as (props: unknown) => ReactElement)(resolution.props)
}

describe('Resolution Inspector', () => {
  it.each(['approval', 'wait'] as const)('saves the latest %s prompt on blur and preserves the node name', (kind) => {
    const saveResolution = vi.fn().mockResolvedValue(true)
    const definition = resolutionDefinition(
      { inputDefinitions: [{ handle: 'value', jsonSchema: {}, nullable: true }], inputs: {}, kind, name: 'Renamed', prompt: 'Continue?' },
      {},
      saveResolution,
    )
    const input = find(definition, (item) => (item.props as { readonly id?: string }).id == 'wait-wait-prompt')
    if (input == null) throw new Error('Expected prompt.')
    const blur = (input.props as { readonly onBlur: (event: { currentTarget: { value: string } }) => void }).onBlur
    blur({ currentTarget: { value: 'Continue?' } })
    expect(saveResolution).not.toHaveBeenCalled()
    blur({ currentTarget: { value: '  Review this request  ' } })
    expect(saveResolution).toHaveBeenCalledWith('wait', {
      name: 'Renamed',
      prompt: 'Review this request',
    })
    saveResolution.mockClear()
    blur({ currentTarget: { value: '  ' } })
    expect(saveResolution).not.toHaveBeenCalled()
  })
})

describe('Node execution settings', () => {
  it('saves execution limits and timeout, preserves sibling settings, and rejects invalid values', () => {
    const saveNodeSettings = vi.fn()
    const node = { inputs: {}, kind: 'subflow', name: 'Review', subflowId: 'review', timeoutMs: 100, maxExecutions: 25 }
    const revision = {
      graph: () => ({ nodes: { current: node, other: { inputs: {}, kind: 'value', name: 'Review', values: [] } } }),
    }
    const element = NodeInspector({
      variables: { enabled: true, names: [], loaded: false, loading: false, onOpen: vi.fn() },
      activeConnectorConnections: [],
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: {} as never,
      disabled: false,
      revision: revision as never,
      selection: { id: 'current', kind: 'subflow', node, definition: { inputs: [], outputs: [] } } as never,
      store: { $: { flowId: { value: 'flow' } }, saveNodeSettings } as never,
      target: { kind: 'flow' },
      theme: 'light',
      triggerAuthorizationPending: false,
      triggerConnectionLoading: false,
      triggers: {} as never,
    })
    const settings = find(element, (item) => typeof item.type == 'function' && item.type.name == 'GeneralSettings')
    if (settings == null || typeof settings.type != 'function') throw new Error('Expected general settings.')
    const rendered = (settings.type as (props: unknown) => ReactElement)(settings.props)
    const input = find(rendered, (item) => (item.props as { readonly id?: string }).id == 'node-current-timeout')
    if (input == null) throw new Error('Expected timeout input.')
    const blur = (input.props as { readonly onBlur: (event: { currentTarget: { value: string } }) => void }).onBlur
    for (const value of ['100', '0', '-1', '1.5', 'Infinity']) blur({ currentTarget: { value } })
    expect(saveNodeSettings).not.toHaveBeenCalled()
    blur({ currentTarget: { value: '200' } })
    expect(saveNodeSettings).toHaveBeenLastCalledWith('current', { name: 'Review', timeoutMs: 200, maxExecutions: 25 })
    blur({ currentTarget: { value: '' } })
    expect(saveNodeSettings).toHaveBeenLastCalledWith('current', { name: 'Review', maxExecutions: 25 })
    const limit = find(rendered, (item) => (item.props as { readonly id?: string }).id == 'node-current-limit')
    if (limit == null) throw new Error('Expected execution limit input.')
    const saveLimit = (limit.props as { readonly onBlur: (event: { currentTarget: { value: string } }) => void }).onBlur
    saveNodeSettings.mockClear()
    for (const value of ['25', '0', '-1', '1.5', 'Infinity', '9007199254740992']) saveLimit({ currentTarget: { value } })
    expect(saveNodeSettings).not.toHaveBeenCalled()
    saveLimit({ currentTarget: { value: '1000' } })
    expect(saveNodeSettings).toHaveBeenLastCalledWith('current', { name: 'Review', timeoutMs: 100, maxExecutions: 1000 })
    saveLimit({ currentTarget: { value: '' } })
    expect(saveNodeSettings).toHaveBeenLastCalledWith('current', { name: 'Review', timeoutMs: 100, maxExecutions: undefined })
  })
})

describe('Code task sections', () => {
  it('renders Code and Node settings as consecutive sections instead of tabs', () => {
    const node = {
      kind: 'task',
      name: 'Transform',
      inputs: {},
      task: { name: 'Transform', moduleId: 'module', inputs: [], outputs: [] },
    }
    const definition = node.task
    const moduleEditor: {
      value: { moduleId: string; source: string; status: 'failed' | 'saved' }
    } = {
      value: { moduleId: 'module', source: 'export default () => ({})', status: 'saved' },
    }
    const element = NodeInspector({
      variables: { enabled: true, names: [], loaded: true, loading: false, onOpen: vi.fn() },
      activeConnectorConnections: [],
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: { $: { actions: { value: {} } } } as never,
      disabled: false,
      revision: { graph: () => ({ nodes: { task: node } }) } as never,
      selection: {
        id: 'task',
        kind: 'task',
        node,
        definition,
        module: { name: 'Transform', imports: [], source: 'export default () => ({})' },
      } as never,
      store: {
        $: {
          flowId: { value: 'flow' },
          moduleEditor,
        },
      } as never,
      target: { kind: 'flow' },
      theme: 'light',
      triggerAuthorizationPending: false,
      triggerConnectionLoading: false,
      triggers: {} as never,
    })
    const task = find(element, (item) => typeof item.type == 'function' && item.type.name == 'TaskDefinition')
    if (task == null || typeof task.type != 'function') throw new Error('Expected task definition.')
    const rendered = (task.type as (props: unknown) => ReactElement)(task.props)
    const sections = Children.toArray((rendered.props as { readonly children?: ReactNode }).children)

    expect(sections).toHaveLength(2)
    expect(isValidElement(sections[0]) && sections[0].props['data-inspector-section']).toBe('module')
    expect(isValidElement(sections[1]) && find(sections[1], (item) => typeof item.type == 'function' && item.type.name == 'GeneralSettings')).toBeDefined()
    expect(find(rendered, (item) => item.props.className == 'form-actions code-actions')).toBeUndefined()

    moduleEditor.value = { ...moduleEditor.value, status: 'failed' }
    const failed = (task.type as (props: unknown) => ReactElement)(task.props)
    expect(find(failed, (item) => item.props.className == 'form-actions code-actions')).toBeDefined()
    expect(find(failed, (item) => item.props.role == 'status')).toBeUndefined()
  })
})

describe('Node input ownership', () => {
  it('resolves the selected upstream output description from the graph definition', () => {
    const input = { handle: 'message', jsonSchema: { type: 'string' }, nullable: false }
    const node = {
      kind: 'wait',
      name: 'Condition',
      inputDefinitions: [input],
      inputs: { message: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'upstream', output: 'title' }] } },
      cases: [],
    }
    const graph = {
      nodes: {
        condition: node,
        upstream: {
          kind: 'value',
          name: 'Source',
          values: [{ handle: 'title', description: 'The complete upstream title.', jsonSchema: { type: 'string' }, nullable: false }],
        },
      },
    }
    const element = NodeInspector({
      variables: { enabled: true, names: [], loaded: true, loading: false, onOpen: vi.fn() },
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: {} as never,
      disabled: false,
      revision: {
        graph: () => graph,
        inputSource: () => ({ check: vi.fn(), candidates: vi.fn() }),
        outputDescription: () => 'The complete upstream title.',
      } as never,
      selection: { id: 'condition', kind: 'wait', node } as never,
      store: { $: { flowId: { value: 'flow' } } } as never,
      target: { kind: 'flow' },
      theme: 'light',
      triggerAuthorizationPending: false,
      triggerConnectionLoading: false,
      triggers: {} as never,
    })
    const inputs = find(element, (item) => typeof item.type === 'function' && item.type.name === 'NodeInputs')
    const upstream = (inputs!.props as { renderSource: (handle: string) => { current: unknown[] } }).renderSource('message')

    expect(upstream.current).toEqual([
      {
        check: undefined,
        description: 'The complete upstream title.',
        icon: undefined,
        nodeId: 'upstream',
        nodeName: 'Source',
        output: 'title',
      },
    ])
  })

  it('does not expose a deleted upstream node ID as its display name', () => {
    const input = { handle: 'message', jsonSchema: { type: 'string' }, nullable: false }
    const node = {
      kind: 'wait',
      name: 'Condition',
      inputDefinitions: [input],
      inputs: { message: { kind: 'sources', sources: [{ kind: 'node', nodeId: '0199b784-internal', output: 'title' }] } },
      cases: [],
    }
    const element = NodeInspector({
      variables: { enabled: true, names: [], loaded: true, loading: false, onOpen: vi.fn() },
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: {} as never,
      disabled: false,
      revision: {
        graph: () => ({ nodes: { condition: node } }),
        inputSource: () => ({ check: vi.fn(), candidates: vi.fn() }),
        outputDescription: () => undefined,
      } as never,
      selection: { id: 'condition', kind: 'wait', node } as never,
      store: { $: { flowId: { value: 'flow' } } } as never,
      target: { kind: 'flow' },
      theme: 'light',
      triggerAuthorizationPending: false,
      triggerConnectionLoading: false,
      triggers: {} as never,
    })
    const inputs = find(element, (item) => typeof item.type === 'function' && item.type.name === 'NodeInputs')
    const upstream = (inputs!.props as { renderSource: (handle: string) => { current: { nodeName?: string }[] } }).renderSource('message')

    expect(upstream.current[0]?.nodeName).toBeUndefined()
  })

  it.each(['approval', 'wait', 'subflow', 'task'] as const)('resolves %s variable bindings and sends edits directly to the workspace', (kind) => {
    const setInputSource = vi.fn()
    const setInputValue = vi.fn()
    const setInputVariable = vi.fn()
    const node = {
      kind: 'wait',
      name: 'Condition',
      input: { handle: 'message', jsonSchema: { type: 'string' }, nullable: false },
      inputDefinitions: [{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false }],
      inputs: { message: { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'binding' }] } },
      cases: [],
    }
    const element = NodeInspector({
      variables: { enabled: true, names: ['API_TOKEN'], loaded: true, loading: false, onOpen: vi.fn() },
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: {} as never,
      disabled: false,
      revision: {
        binding: () => ({ kind: 'variable', target: 'API_TOKEN' }),
        graph: () => ({ nodes: { upstream: { name: 'Source' } } }),
        inputSource: () => ({ check: vi.fn(), candidates: vi.fn() }),
      } as never,
      selection: { id: 'condition', kind, node: { ...node, kind }, definition: { inputs: [node.input] } } as never,
      store: {
        $: { flowId: { value: 'flow' } },
        setInputSource,
        setInputValue,
        setInputVariable,
      } as never,
      target: { kind: 'flow' },
      theme: 'light',
      triggerAuthorizationPending: false,
      triggerConnectionLoading: false,
      triggers: {} as never,
    })
    const input = find(element, (item) => typeof item.type === 'function' && item.type.name === 'NodeInputs')
    expect(input).toBeDefined()
    const props = input!.props as {
      allowAddGroup: boolean
      renderSource: (handle: string) => {
        groups: unknown[]
        describeGroups: (outputs: Record<string, { output: string; check: { kind: 'available' } }[]>) => unknown[]
        onChange: (source: { nodeId: string; output: string }) => void
      }
      entries: { variableName: string; connected: boolean }[]
      onValue: (handle: string, value: unknown) => void
      onVariable: (handle: string, name: string | undefined) => void
    }
    expect(props.allowAddGroup).toBe(kind !== 'wait' && kind !== 'approval')
    const upstream = props.renderSource('message')
    expect(upstream.groups).toEqual([])
    const outputs = [{ output: 'text', check: { kind: 'available' as const } }]
    expect(upstream.describeGroups({ upstream: outputs })).toEqual([{ icon: undefined, nodeId: 'upstream', nodeName: 'Source', outputs }])
    upstream.onChange({ nodeId: 'upstream', output: 'text' })
    expect(setInputSource).toHaveBeenCalledWith('condition', 'message', { nodeId: 'upstream', output: 'text' })
    expect(props.entries[0]!.variableName).toBe('API_TOKEN')
    expect(props.entries[0]!.connected).toBe(false)
    props.onValue('message', null)
    props.onVariable('message', undefined)
    expect(setInputValue).toHaveBeenCalledWith('condition', 'message', null, undefined)
    expect(setInputVariable).toHaveBeenCalledWith('condition', 'message', undefined)
  })
})
