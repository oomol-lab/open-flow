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
  const element = NodeInspector({
    activeConnectorConnections: [],
    connectorAuthorizationPending: false,
    connectorLoading: false,
    connectors: {} as never,
    diagnostics: [],
    disabled: false,
    onChooseWaitNotification: vi.fn(),
    revision: revision as never,
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
      { actions: ['continue'], concurrency: 1, input: { handle: 'value', jsonSchema: {}, nullable: true }, inputs: {}, kind: 'wait', prompt: 'Continue?' },
      {},
      saveWait,
    )
    const switcher = find(definition, (item) => (item.props as { readonly className?: string }).className == 'wait-mode-switcher')
    if (switcher == null) throw new Error('Expected resolution switcher.')

    ;(switcher.props as { readonly onValueChange: (values: readonly string[]) => void }).onValueChange(['approval'])

    expect(saveWait).toHaveBeenCalledWith('wait', {
      actions: ['approve', 'reject'],
      notification: undefined,
      prompt: 'Continue?',
    })
  })

  it('removes a notification immediately', () => {
    const saveWait = vi.fn().mockResolvedValue(true)
    const node = {
      actions: ['continue'],
      concurrency: 1,
      input: { handle: 'value', jsonSchema: {}, nullable: true },
      inputs: {},
      kind: 'wait',
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
      notification: undefined,
      prompt: 'Continue?',
    })
  })
})
