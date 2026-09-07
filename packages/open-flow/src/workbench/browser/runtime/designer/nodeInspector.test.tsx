import type { ReactElement, ReactNode } from 'react'

import { Children, isValidElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { NodeInspector } from './nodeInspector.tsx'

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: vi.fn(),
  useMemo: (create: () => unknown) => create(),
  useRef: (value: unknown) => ({ current: value }),
  useState: (initial: unknown) => [typeof initial == 'function' ? initial() : initial, vi.fn()],
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
    activeConnectorConnections: [],
    connectorAuthorizationPending: false,
    connectorLoading: false,
    connectors: {} as never,
    diagnostics: [],
    disabled: false,
    onChooseWaitNotification: vi.fn(),
    revision: view as never,
    selection: { id: 'wait', kind: 'wait', node } as never,
    store: { saveWait } as never,
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
      notification: undefined,
      prompt: 'Continue?',
    })
  })

  it('removes a notification immediately', () => {
    const saveWait = vi.fn().mockResolvedValue(true)
    const node = {
      actions: ['continue'],

      input: { handle: 'value', jsonSchema: {}, nullable: true },
      inputs: {},
      kind: 'wait',
      name: 'Wait',
      notification: { inputs: {}, messageHandle: 'text', taskId: 'notify' },
      prompt: 'Continue?',
    }
    const definition = waitDefinition(
      node,
      {
        task: () => ({
          executor: { action: 'send', kind: 'connector' },
          inputs: [{ handle: 'text', jsonSchema: {}, nullable: false }],
          name: 'Send',
          outputs: [],
        }),
      },
      saveWait,
    )
    const remove = find(definition, (item) => (item.props as { readonly 'aria-label'?: string })['aria-label'] == 'inspector.wait.removeNotification')
    if (remove == null) throw new Error('Expected remove notification button.')

    ;(remove.props as { readonly onClick: () => void }).onClick()

    expect(saveWait).toHaveBeenCalledWith('wait', {
      actions: ['continue'],
      name: 'Wait',
      notification: undefined,
      prompt: 'Continue?',
    })
  })
})

describe('Node name validation', () => {
  it('marks a duplicate name invalid and prevents saving', () => {
    const saveNodeSettings = vi.fn()
    const node = { inputs: {}, kind: 'value', name: 'Review', values: [] }
    const revision = {
      graph: () => ({ nodes: { current: node, other: { inputs: {}, kind: 'value', name: 'Review', values: [] } } }),
      inputSources: () => [],
    }
    const element = NodeInspector({
      activeConnectorConnections: [],
      connectorAuthorizationPending: false,
      connectorLoading: false,
      connectors: {} as never,
      diagnostics: [],
      disabled: false,
      onChooseWaitNotification: vi.fn(),
      revision: revision as never,
      selection: { id: 'current', kind: 'value', node } as never,
      store: { saveNodeSettings } as never,
      target: { kind: 'flow' },
      theme: 'light',
      triggerAuthorizationPending: false,
      triggerConnectionLoading: false,
      triggers: {} as never,
    })
    const settings = find(element, (item) => typeof item.type == 'function' && item.type.name == 'GeneralSettings')
    if (settings == null || typeof settings.type != 'function') throw new Error('Expected general settings.')
    const rendered = (settings.type as (props: unknown) => ReactElement)(settings.props)
    const input = find(rendered, (item) => (item.props as { readonly id?: string }).id == 'node-current-name')
    const form = find(rendered, (item) => item.type == 'form')
    const save = find(rendered, (item) => item.type != 'form' && (item.props as { readonly type?: string }).type == 'submit')

    expect(input?.props).toMatchObject({ 'aria-invalid': true })
    expect(save?.props).toMatchObject({ disabled: true })
    if (form == null) throw new Error('Expected settings form.')
    ;(form.props as { readonly onSubmit: (event: { preventDefault(): void }) => void }).onSubmit({ preventDefault() {} })
    expect(saveNodeSettings).not.toHaveBeenCalled()
  })
})
