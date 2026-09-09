import type { FormEvent, ReactElement, ReactNode } from 'react'

import { Input } from '@oomol-lab/open-flow/ui'
import { Children, isValidElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SettingsPage } from '../browser/settings.tsx'

const hooks = vi.hoisted(() => ({
  cleanup: undefined as (() => void) | undefined,
  focus: undefined as (() => void) | undefined,
  stateIndex: 0,
  refIndex: 0,
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: true,
  toast: vi.fn(),
}))

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>()
  return {
    ...original,
    useCallback: <T,>(callback: T) => callback,
    useEffect: (callback: () => void | (() => void)) => {
      if (hooks.effects) hooks.cleanup = callback() ?? undefined
    },
    useRef: <T,>(value: T) => {
      const index = hooks.refIndex++
      return (hooks.refs[index] ??= { current: value }) as { current: T }
    },
    useState: <T,>(initial: T) => {
      const index = hooks.stateIndex++
      if (!(index in hooks.states)) hooks.states[index] = initial
      return [
        hooks.states[index],
        (value: T | ((current: T) => T)) => {
          hooks.states[index] = typeof value == 'function' ? (value as (current: T) => T)(hooks.states[index] as T) : value
        },
      ] as const
    },
  }
})
vi.mock('sonner', () => ({ toast: { error: hooks.toast } }))
vi.mock('val-i18n-react', () => ({ useTranslate: () => (key: string) => key }))

beforeEach(() => {
  hooks.cleanup = undefined
  hooks.focus = undefined
  hooks.stateIndex = 0
  hooks.refIndex = 0
  hooks.states = []
  hooks.refs = []
  hooks.effects = true
  hooks.toast.mockClear()
  vi.stubGlobal('addEventListener', (_type: string, callback: () => void) => {
    hooks.focus = callback
  })
  vi.stubGlobal('removeEventListener', vi.fn())
})
afterEach(() => {
  hooks.cleanup?.()
  vi.unstubAllGlobals()
})

function config(revision: number) {
  return {
    version: 1,
    revision,
    connector: { runtime: { configured: false, source: 'none', tokenConfigured: false }, console: { configured: false, source: 'none' } },
    llm: { configured: false, source: 'none', tokenConfigured: false },
    integration: { configured: false, source: 'none' },
  }
}

function find(element: ReactElement, predicate: (item: ReactElement) => boolean): ReactElement | undefined {
  if (predicate(element)) return element
  for (const child of Children.toArray((element.props as { readonly children?: ReactNode }).children)) {
    if (!isValidElement(child)) continue
    const result = find(child, predicate)
    if (result != null) return result
  }
}

it('ignores an older refresh that finishes after the latest refresh', async () => {
  const older = Promise.withResolvers<Response>()
  const newer = Promise.withResolvers<Response>()
  vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise))
  SettingsPage({ onConnectorChange: vi.fn(), onUnauthorized: vi.fn() })
  hooks.focus?.()
  newer.resolve(Response.json(config(2)))
  await vi.waitFor(() => expect(hooks.states[0]).toMatchObject({ revision: 2 }))
  older.resolve(Response.json(config(1)))
  await older.promise
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(hooks.states[0]).toMatchObject({ revision: 2 })
})

it.each(['response', 'failure', 'unauthorized', 'unmount'])('ignores an obsolete refresh after save or unmount: %s', async (outcome) => {
  hooks.states = [config(1), false, false]
  const pending = Promise.withResolvers<Response>()
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending.promise))
  const unauthorized = vi.fn()
  const page = SettingsPage({ onConnectorChange: vi.fn(), onUnauthorized: unauthorized })
  const item = find(page, (element) => element.props.endpoint == '/config/llm')
  if (item == null) throw new Error('LLM settings are missing.')
  const props = item.props as { readonly onSaved: (value: ReturnType<typeof config>) => void }
  if (outcome == 'unmount') hooks.cleanup?.()
  else props.onSaved(config(3))
  if (outcome == 'failure') pending.reject(new Error('Network failed.'))
  else pending.resolve(outcome == 'unauthorized' ? new Response(null, { status: 401 }) : Response.json(config(2)))
  await pending.promise.catch(() => {})
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(hooks.states[0]).toMatchObject({ revision: outcome == 'unmount' ? 1 : 3 })
  expect(hooks.toast).not.toHaveBeenCalled()
  expect(unauthorized).not.toHaveBeenCalled()
})

it.each([
  { secret: 'a'.repeat(31), accepted: false },
  { secret: 'a'.repeat(32), accepted: true },
  { secret: '\u4e2d'.repeat(10), accepted: false },
  { secret: '\u4e2d'.repeat(11), accepted: true },
])('validates Integration callback keys in UTF-8 bytes: %j', async ({ secret, accepted }) => {
  hooks.states = [config(1), false, false]
  hooks.effects = false
  const fetcher = vi.fn().mockResolvedValue(Response.json(config(2)))
  vi.stubGlobal('fetch', fetcher)
  const page = SettingsPage({ onConnectorChange: vi.fn(), onUnauthorized: vi.fn() })
  const item = find(page, (element) => element.props.endpoint == '/config/integration')
  if (item == null || typeof item.type != 'function') throw new Error('Integration settings are missing.')
  hooks.states = ['https://example.invalid', true, false, false, secret]
  hooks.stateIndex = 0
  const render = item.type as (props: typeof item.props) => ReactElement
  const form = find(render(item.props), (element) => element.type == 'form')
  if (form == null) throw new Error('Integration form is missing.')
  const props = form.props as { readonly onSubmit: (event: FormEvent) => void }
  props.onSubmit({ preventDefault: vi.fn() } as unknown as FormEvent)
  expect(fetcher).toHaveBeenCalledTimes(accepted ? 1 : 0)
  const field = find(form, (element) => element.type == Input && element.props.type == 'password')
  expect(field?.props['aria-invalid']).toBe(!accepted)
  await new Promise((resolve) => setTimeout(resolve, 0))
})
