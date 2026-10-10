import type { ControlClient, VariableReferences } from '@oomol-lab/open-flow/control-api'
import type { ReactElement, ReactNode } from 'react'

import { Children, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { useVariableReferences, VariableDeletionDialog, VariableReferenceResults, VariableReferencesButton } from '../browser/variable-references.tsx'

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as (() => () => void)[] }))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = hooks.index++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [
      hooks.values[index],
      (next: unknown) => {
        hooks.values[index] = typeof next == 'function' ? next(hooks.values[index]) : next
      },
    ]
  },
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => () => void) => {
    hooks.effects.push(effect)
  },
}))
vi.mock('val-i18n-react', () => ({ useTranslate: () => (key: string) => key }))
beforeEach(() => {
  hooks.values = []
  hooks.index = 0
  hooks.effects = []
})
const empty: VariableReferences = { version: 1, references: [], unknown: [] }

function find(element: ReactElement, predicate: (props: Record<string, unknown>) => boolean): ReactElement | undefined {
  if (predicate(element.props as Record<string, unknown>)) return element
  for (const child of Children.toArray((element.props as { children?: ReactNode }).children)) {
    if (isValidElement(child)) {
      const found = find(child, predicate)
      if (found != null) return found
    }
  }
}

it('only requests references once opened and ignores responses after cleanup', async () => {
  const first = Promise.withResolvers<VariableReferences>()
  const next = Promise.withResolvers<VariableReferences>()
  const getVariableReferences = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise)
  const client = { getVariableReferences } as unknown as ControlClient
  VariableReferencesButton({ client, name: 'TOKEN', container: null, disabled: false })
  expect(getVariableReferences).not.toHaveBeenCalled()
  hooks.values = []
  hooks.index = 0
  useVariableReferences(client, 'TOKEN')
  const close = hooks.effects[0]!()
  const signal = getVariableReferences.mock.calls[0]![1] as AbortSignal
  close()
  expect(signal.aborted).toBe(true)
  hooks.index = 0
  useVariableReferences(client, 'OTHER')
  const cleanup = hooks.effects[1]!()
  next.resolve(empty)
  await next.promise
  await Promise.resolve()
  first.resolve({ ...empty, unknown: [{ flowId: 'old', flowName: 'Old', scope: 'draft' }] })
  await first.promise
  await Promise.resolve()
  expect(hooks.values[0]).toEqual(empty)
  expect(hooks.values[1]).toBe(false)
  cleanup()
})

it('shows version links, disabled publications and incomplete results without claiming no references', () => {
  const html = renderToStaticMarkup(
    <VariableReferenceResults
      state={{
        result: {
          version: 1,
          references: [
            { flowId: 'both', flowName: 'Both', draft: true, live: { publicationId: 'p', enabled: false } },
            { flowId: 'live', flowName: 'Live only', draft: false, live: { publicationId: 'q', enabled: true } },
          ],
          unknown: [{ flowId: 'broken', flowName: 'Broken', scope: 'draft' }],
        },
        loading: false,
        failed: false,
        retry: vi.fn(),
      }}
    />,
  )
  expect(html).toContain('href="/flows/both/design"')
  expect(html).toContain('href="/flows/both/publications"')
  expect(html).toContain('href="/flows/live/publications"')
  expect(html).toContain('variables.referenceDisabled')
  expect(html).toContain('variables.referencesIncomplete')
  expect(html).not.toContain('variables.referencesEmpty')
  const unknownOnly = renderToStaticMarkup(
    <VariableReferenceResults
      state={{ result: { ...empty, unknown: [{ flowId: 'broken', flowName: 'Broken', scope: 'live' }] }, loading: false, failed: false, retry: vi.fn() }}
    />,
  )
  expect(unknownOnly).not.toContain('variables.referencesEmpty')
})

it.each([
  { loading: true, failed: false, disabled: true },
  { loading: false, failed: true, disabled: false },
  { loading: false, failed: false, disabled: false },
])('controls deletion while checking references: %j', ({ loading, failed, disabled }) => {
  hooks.values = [undefined, loading, failed, 0]
  const getVariableReferences = vi.fn().mockResolvedValue(empty)
  const onDelete = vi.fn()
  const dialog = VariableDeletionDialog({
    client: { getVariableReferences } as unknown as ControlClient,
    name: 'TOKEN',
    container: null,
    pending: false,
    onClose: vi.fn(),
    onDelete,
    finalFocus: () => null,
  })
  const button = find(dialog, (props) => props.children == 'variables.delete')!
  expect(button.props.disabled).toBe(disabled)
  if (!disabled) {
    button.props.onClick()
    expect(onDelete).toHaveBeenCalledOnce()
  }
  hooks.effects[0]!()
  expect(getVariableReferences).toHaveBeenCalledWith('TOKEN', expect.any(AbortSignal))
})

it('offers retry after a failed reference request', async () => {
  const client = { getVariableReferences: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as ControlClient
  const state = useVariableReferences(client, 'TOKEN')
  const cleanup = hooks.effects[0]!()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  expect(hooks.values[1]).toBe(false)
  expect(hooks.values[2]).toBe(true)
  state.retry()
  expect(hooks.values[1]).toBe(true)
  expect(hooks.values[3]).toBe(1)
  cleanup()
})

it.each([
  { result: empty, loading: false, failed: false, message: 'variables.deleteUnreferenced' },
  {
    result: { ...empty, references: [{ flowId: 'flow', flowName: 'Flow', draft: true, live: null }] },
    loading: false,
    failed: false,
    message: 'variables.deleteReferencesImpact',
  },
  { result: { ...empty, unknown: [{ flowId: 'flow', flowName: 'Flow', scope: 'draft' }] }, loading: false, failed: false, message: undefined },
  { result: undefined, loading: true, failed: false, message: undefined },
  { result: undefined, loading: false, failed: true, message: undefined },
])('only describes deletion impact supported by the query: %j', ({ result, loading, failed, message }) => {
  hooks.values = [result, loading, failed, 0]
  const dialog = VariableDeletionDialog({
    client: {} as ControlClient,
    name: 'TOKEN',
    container: null,
    pending: false,
    onClose: vi.fn(),
    onDelete: vi.fn(),
    finalFocus: () => null,
  })
  for (const key of ['variables.deleteUnreferenced', 'variables.deleteReferencesImpact']) {
    expect(find(dialog, (props) => props.children === key) != null).toBe(key === message)
  }
})
