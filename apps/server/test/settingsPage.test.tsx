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
  success: vi.fn(),
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
vi.mock('sonner', () => ({ toast: { error: hooks.toast, success: hooks.success } }))
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
  hooks.success.mockClear()
  vi.stubGlobal('addEventListener', (_type: string, callback: () => void) => {
    hooks.focus = callback
  })
  vi.stubGlobal('removeEventListener', vi.fn())
})

function connectorSettings(current = config(1)) {
  hooks.states = [current, false, false]
  hooks.effects = false
  const changed = vi.fn()
  const unauthorized = vi.fn()
  const page = SettingsPage({ onSignOut: vi.fn(), onConnectorChange: changed, onUnauthorized: unauthorized })
  const item = find(page, (element) => element.props.current != null)
  if (item == null || typeof item.type != 'function') throw new Error('Connector settings are missing.')
  hooks.states = [undefined]
  const render = (): ReactElement => {
    hooks.stateIndex = 0
    return (item.type as (props: typeof item.props) => ReactElement)(item.props)
  }
  return { changed, render, unauthorized }
}

function oomolLogin() {
  const { changed, render: connector, unauthorized } = connectorSettings()
  const item = find(connector(), (element) => typeof element.props.connected == 'boolean')
  if (item == null || typeof item.type != 'function') throw new Error('OOMOL connection is missing.')
  const conflicted = vi.fn().mockResolvedValue(undefined)
  hooks.states = [false, undefined, undefined]
  hooks.refs = []
  hooks.effects = true
  const render = (): ReactElement => {
    hooks.stateIndex = 0
    hooks.refIndex = 0
    return (item.type as (props: typeof item.props) => ReactElement)({ ...item.props, onConflict: conflicted, onSaved: changed })
  }
  return { changed, conflicted, render, unauthorized }
}

it('connects OOMOL automatically when a popup is blocked', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ code: 'ABC123', id: 'login-id', url: 'https://console.oomol.com/login/device?user_code=ABC123', version: 1 }))
    .mockResolvedValueOnce(Response.json({ configuration: config(2), status: 'saved', version: 1 }))
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('window', { open: vi.fn().mockReturnValue(null) })
  const { render, changed } = oomolLogin()
  const button = find(render(), (element) => element.props.children == 'settings.oomolConnect')
  button?.props.onClick()
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(fetcher.mock.calls.map((call) => call[1].method)).toEqual(['POST', 'PUT'])
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ expectedRevision: 1, version: 1 })
  expect(hooks.states).toEqual([false, undefined, undefined])
  expect(hooks.success).toHaveBeenCalledWith('settings.oomolConnected')
})

it.each(['https://connector.oomol.com', 'https://connector.oomol.dev'])(
  'saves a hosted OOMOL API key for %s without asking for either domain',
  async (origin) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(config(2)))
    vi.stubGlobal('fetch', fetcher)
    const current = config(1)
    if (origin.endsWith('.dev')) Object.assign(current.connector.runtime, { configured: true, origin, source: 'settings', tokenConfigured: true })
    const { render, changed } = connectorSettings(current)
    const hosted = render()
    expect(find(hosted, (element) => element.props.endpoint == '/config/connector-console')).toBeUndefined()
    const item = find(hosted, (element) => element.props.endpoint == '/config/connector')
    if (item == null || typeof item.type != 'function') throw new Error('OOMOL API key settings are missing.')
    hooks.stateIndex = 0
    hooks.states = [item.props.origin, true, false, false, 'oomol-api-key']
    const form = find((item.type as (props: typeof item.props) => ReactElement)({ ...item.props, onSaved: changed }), (element) => element.type == 'form')
    if (form == null) throw new Error('OOMOL API key form is missing.')
    expect(find(form, (element) => element.type == Input && element.props.type == 'url')).toBeUndefined()
    form.props.onSubmit({ preventDefault: vi.fn() })
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ expectedRevision: 1, origin, token: 'oomol-api-key', version: 1 })
  },
)

it('selects a custom Connector from saved settings and does not save when the connection type changes', () => {
  const current = config(1)
  Object.assign(current.connector.runtime, { configured: true, origin: 'https://connector.example.com', source: 'settings', tokenConfigured: true })
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const { render } = connectorSettings(current)
  const custom = render()
  expect(find(custom, (element) => element.type == 'input' && element.props.value == 'custom')?.props.checked).toBe(true)
  expect(find(custom, (element) => element.props.endpoint == '/config/connector-console')).toBeDefined()
  expect(find(custom, (element) => typeof element.props.connected == 'boolean')).toBeUndefined()
  find(custom, (element) => element.type == 'input' && element.props.value == 'oomol')?.props.onChange()
  const hosted = render()
  expect(find(hosted, (element) => element.props.endpoint == '/config/connector-console')).toBeUndefined()
  expect(fetcher).not.toHaveBeenCalled()
  expect(current.connector.runtime).toMatchObject({ origin: 'https://connector.example.com', configured: true })
})

it('offers an authorization link and ignores a completed request after cancellation', async () => {
  const pending = Promise.withResolvers<Response>()
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ code: 'ABC123', id: 'login-id', url: 'https://console.oomol.com/login/device?user_code=ABC123', version: 1 }))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue(Response.json({ version: 1 }))
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('window', { open: vi.fn().mockReturnValue(null) })
  const { render, changed } = oomolLogin()
  find(render(), (element) => element.props.children == 'settings.oomolConnect')?.props.onClick()
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  const waiting = render()
  expect(find(waiting, (element) => element.type == 'a')?.props.href).toBe('https://console.oomol.com/login/device?user_code=ABC123')
  find(waiting, (element) => element.props.children == 'settings.cancel')?.props.onClick()
  expect(fetcher.mock.calls[1]![1].signal.aborted).toBe(true)
  expect(fetcher.mock.calls[2]![1].method).toBe('DELETE')
  pending.resolve(Response.json({ configuration: config(2), status: 'saved', version: 1 }))
  await pending.promise
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(changed).not.toHaveBeenCalled()
  expect(hooks.states).toEqual([false, undefined, undefined])
})

it('shows an expired authorization and allows another attempt', async () => {
  const popup = { opener: {}, location: { replace: vi.fn() }, close: vi.fn() }
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ code: 'ABC123', id: 'login-id', url: 'https://console.oomol.com/login/device?user_code=ABC123', version: 1 }))
    .mockResolvedValueOnce(new Response(null, { status: 410 }))
    .mockResolvedValue(Response.json({ version: 1 }))
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('window', { open: vi.fn().mockReturnValue(popup) })
  const { render, changed } = oomolLogin()
  find(render(), (element) => element.props.children == 'settings.oomolConnect')?.props.onClick()
  await vi.waitFor(() => expect(hooks.states).toEqual([false, undefined, 'expired']))
  expect(popup.opener).toBeNull()
  expect(popup.location.replace).toHaveBeenCalledWith('https://console.oomol.com/login/device?user_code=ABC123')
  expect(find(render(), (element) => element.props.role == 'alert')?.props.children).toBe('settings.oomolExpired')
  expect(changed).not.toHaveBeenCalled()
})

it.each([401, 409])('resets OOMOL authorization after a session or configuration error: %s', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))
  const popup = { opener: {}, close: vi.fn() }
  vi.stubGlobal('window', { open: vi.fn().mockReturnValue(popup) })
  const { render, conflicted, unauthorized } = oomolLogin()
  find(render(), (element) => element.props.children == 'settings.oomolConnect')?.props.onClick()
  await vi.waitFor(() => expect(popup.close).toHaveBeenCalledOnce())
  expect(hooks.states).toEqual([false, undefined, undefined])
  expect(unauthorized).toHaveBeenCalledTimes(status == 401 ? 1 : 0)
  expect(conflicted).toHaveBeenCalledTimes(status == 409 ? 1 : 0)
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
