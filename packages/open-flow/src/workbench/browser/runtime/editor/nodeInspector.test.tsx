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

function waitDefinition(node: unknown, revision: unknown, saveWait: ReturnType<typeof vi.fn>): ReactElement {
  const view = { graph: () => ({ nodes: { wait: node } }), ...(revision as object) }
  const element = NodeInspector({
    variables: { enabled: true, names: [], loaded: false, loading: false, onOpen: vi.fn() },
    activeConnectorConnections: [],
    connectorAuthorizationPending: false,
    connectorLoading: false,
    connectors: {} as never,
    diagnostics: [],
    disabled: false,
    revision: view as never,
    selection: { id: 'wait', kind: 'wait', node } as never,
    store: { $: { flowId: { value: 'flow' }, inputSources: { value: {} } }, saveWait } as never,
    target: { kind: 'flow' },
    theme: 'light',
    triggerAuthorizationPending: false,
    triggerConnectionLoading: false,
    triggers: {} as never,
  })
  const wait = find(element, (item) => typeof item.type == 'function' && item.type.name == 'WaitDefinition')
  if (wait == null || typeof wait.type != 'function') throw new Error('Expected Wait settings.')
  return (wait.type as (props: unknown) => ReactElement)(wait.props)
}

describe('Wait Inspector', () => {
  it('saves a resolution change immediately', () => {
    const saveWait = vi.fn().mockResolvedValue(true)
    const definition = waitDefinition(
      { actions: ['continue'], input: { handle: 'value', jsonSchema: {}, nullable: true }, inputs: {}, kind: 'wait', name: 'Wait', prompt: 'Continue?' },
      {},
      saveWait,
    )
    const switcher = find(definition, (item) => (item.props as { readonly className?: string }).className == 'wait-mode-switcher')
    if (switcher == null) throw new Error('Expected resolution switcher.')

    ;(switcher.props as { readonly onValueChange: (values: readonly string[]) => void }).onValueChange(['approval'])

    expect(saveWait).toHaveBeenCalledWith('wait', {
      actions: ['approve', 'reject'],
      name: 'Wait',
      prompt: 'Continue?',
    })
  })

  it('saves the latest prompt on blur and preserves the node name', () => {
    const saveWait = vi.fn().mockResolvedValue(true)
    const definition = waitDefinition(
      { actions: ['continue'], input: { handle: 'value', jsonSchema: {}, nullable: true }, inputs: {}, kind: 'wait', name: 'Renamed', prompt: 'Continue?' },
      {},
      saveWait,
    )
    const input = find(definition, (item) => (item.props as { readonly id?: string }).id == 'wait-wait-prompt')
    if (input == null) throw new Error('Expected prompt.')
    const blur = (input.props as { readonly onBlur: (event: { currentTarget: { value: string } }) => void }).onBlur
    blur({ currentTarget: { value: 'Continue?' } })
    expect(saveWait).not.toHaveBeenCalled()
    blur({ currentTarget: { value: '  Review this request  ' } })
    expect(saveWait).toHaveBeenCalledWith('wait', {
      actions: ['continue'],
      name: 'Renamed',
      prompt: 'Review this request',
    })
    saveWait.mockClear()
    blur({ currentTarget: { value: '  ' } })
    expect(saveWait).not.toHaveBeenCalled()
  })
})

describe('Node timeout settings', () => {
  it('saves timeout on blur, preserves the name, and rejects invalid values', () => {
    const saveNodeSettings = vi.fn()
    const node = { inputs: {}, kind: 'subflow', name: 'Review', subflowId: 'review', timeoutMs: 100 }
    const revision = {
      graph: () => ({ nodes: { current: node, other: { inputs: {}, kind: 'value', name: 'Review', values: [] } } }),
      inputSources: () => [],
    }
    const element = NodeInspector({
      variables: { enabled: true, names: [], loaded: false, loading: false, onOpen: vi.fn() },
      activeConnectorConnections: [],
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: {} as never,
      diagnostics: [],
      disabled: false,
      revision: revision as never,
      selection: { id: 'current', kind: 'subflow', node, definition: { inputs: [], outputs: [] } } as never,
      store: { $: { flowId: { value: 'flow' }, inputSources: { value: {} } }, saveNodeSettings } as never,
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
    expect(saveNodeSettings).toHaveBeenLastCalledWith('current', { name: 'Review', timeoutMs: 200 })
    blur({ currentTarget: { value: '' } })
    expect(saveNodeSettings).toHaveBeenLastCalledWith('current', { name: 'Review' })
  })
})

it('renders diagnostics directly and removes them when cleared', () => {
  const element = NodeInspector({
    variables: { enabled: true, names: [], loaded: false, loading: false, onOpen: vi.fn() },
    connectorAuthorizationPending: false,
    connectorLoading: false,
    connectors: {} as never,
    diagnostics: [],
    disabled: false,
    revision: {} as never,
    selection: undefined,
    store: { $: { flowId: { value: 'flow' }, inputSources: { value: {} } } } as never,
    target: { kind: 'flow' },
    theme: 'light',
    triggerAuthorizationPending: false,
    triggerConnectionLoading: false,
    triggers: {} as never,
  })
  const item = find(element, (node) => typeof node.type == 'function' && node.type.name == 'Diagnostics')
  if (item == null || typeof item.type != 'function') throw new Error('Expected diagnostics.')
  const render = item.type as (props: unknown) => ReactElement | null
  const previous = [{ code: 'trigger.config-incomplete', message: 'Missing events', path: '/document/graph/nodes/github', line: 1, column: 0 }]
  expect(JSON.stringify(render({ diagnostics: previous }))).toContain('trigger.config-incomplete')
  expect(render({ diagnostics: [] })).toBeNull()
})

describe('Node input ownership', () => {
  it.each(['condition', 'wait', 'subflow', 'task'] as const)('resolves %s variable bindings and sends edits directly to the workspace', (kind) => {
    const setInputSource = vi.fn()
    const setInputValue = vi.fn()
    const setInputVariable = vi.fn()
    const node = {
      kind: 'condition',
      name: 'Condition',
      input: { handle: 'message', jsonSchema: { type: 'string' }, nullable: false },
      inputs: { message: { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'binding' }] } },
      cases: [],
    }
    const element = NodeInspector({
      variables: { enabled: true, names: ['API_TOKEN'], loaded: true, loading: false, onOpen: vi.fn() },
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: {} as never,
      diagnostics: [],
      disabled: false,
      revision: {
        binding: () => ({ kind: 'variable', target: 'API_TOKEN' }),
        graph: () => ({ nodes: { upstream: { name: 'Source' } } }),
        inputSources: () => {
          throw new Error('Input sources must come from the workspace derivation')
        },
      } as never,
      selection: { id: 'condition', kind, node: { ...node, kind, actions: ['continue'] }, definition: { inputs: [node.input] } } as never,
      store: {
        $: { flowId: { value: 'flow' }, inputSources: { value: { message: { handle: 'message', outputs: { upstream: ['text'] } } } } },
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
      renderSource: (handle: string) => { groups: unknown[]; onChange: (source: { nodeId: string; output: string }) => void }
      entries: { variableName: string; connected: boolean }[]
      onValue: (handle: string, value: unknown) => void
      onVariable: (handle: string, name: string | undefined) => void
    }
    const upstream = props.renderSource('message')
    expect(upstream.groups).toEqual([{ icon: undefined, nodeId: 'upstream', nodeName: 'Source', outputs: ['text'] }])
    upstream.onChange({ nodeId: 'upstream', output: 'text' })
    expect(setInputSource).toHaveBeenCalledWith('condition', 'message', { nodeId: 'upstream', output: 'text' })
    expect(props.entries[0]!.variableName).toBe('API_TOKEN')
    expect(props.entries[0]!.connected).toBe(false)
    props.onValue('message', null)
    props.onVariable('message', undefined)
    expect(setInputValue).toHaveBeenCalledWith('condition', 'message', null)
    expect(setInputVariable).toHaveBeenCalledWith('condition', 'message', undefined)
  })
})
