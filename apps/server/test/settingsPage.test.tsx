import type { FormEvent, ReactElement, ReactNode } from 'react'
import type { SessionUser } from '../common/users.ts'

import { Dialog, Input } from '@oomol-lab/open-flow/ui'
import { Children, isValidElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SessionCard, MemberSettingsPage, SettingsPage as SettingsView, useConfiguration, serviceConfigurationMissing } from '../browser/settings.tsx'
import { useUnsavedChanges } from '../browser/unsaved-changes.tsx'

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
vi.mock('val-i18n-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('val-i18n-react')>()),
  useTranslate: () => (key: string) => key,
}))

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

function SettingsPage(props: { user?: SessionUser; onSignOut?: () => void; onConnectorChange: () => void; onUnauthorized: () => void }) {
  return SettingsView({
    user: { userId: 'operator', role: 'admin', email: null },
    ...props,
    onSignOut: props.onSignOut ?? vi.fn(),
    configuration: useConfiguration(props.onUnauthorized),
  })
}

function connectorSettings(current = config(1)) {
  hooks.stateIndex = 0
  hooks.refIndex = 0
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
    hooks.refIndex = 0
    return (item.type as (props: typeof item.props) => ReactElement)(item.props)
  }
  return { changed, render, unauthorized }
}

function serviceEditor(mode: 'oomol' | 'custom', current = config(1)) {
  const { render, changed, unauthorized } = connectorSettings(current)
  const view = render()
  const option = find(
    view,
    (element) =>
      element.type == 'div' &&
      Children.toArray(element.props.children as ReactNode).some(
        (child) =>
          isValidElement(child) &&
          child.type == 'label' &&
          find(child as ReactElement<Record<string, unknown>>, (input) => input.type == 'input' && input.props.value == mode) != null,
      ),
  )
  find(option!, (element) => element.props.children == 'settings.edit')!.props.onClick()
  const item = find(render(), (element) => element.props.mode == mode && element.props.current != null)!
  hooks.states = []
  hooks.refs = []
  const editor = (props = item.props): ReactElement => {
    hooks.stateIndex = 0
    hooks.refIndex = 0
    return (item.type as (props: typeof item.props) => ReactElement)(props)
  }
  return { item, editor, changed, unauthorized }
}

function oomolLogin() {
  const { changed, editor, unauthorized } = serviceEditor('oomol')
  const item = find(editor(), (element) => typeof element.props.onAuthorized == 'function')
  if (item == null || typeof item.type != 'function') throw new Error('OOMOL connection is missing.')
  const conflicted = vi.fn().mockResolvedValue(undefined)
  hooks.states = [false, undefined, undefined]
  hooks.refs = []
  hooks.effects = true
  const render = (): ReactElement => {
    hooks.stateIndex = 0
    hooks.refIndex = 0
    return (item.type as (props: typeof item.props) => ReactElement)({ ...item.props, onConflict: conflicted, onAuthorized: changed, onPendingChange: vi.fn() })
  }
  return { changed, conflicted, render, unauthorized }
}

it('connects OOMOL automatically when a popup is blocked', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ code: 'ABC123', id: 'login-id', url: 'https://console.oomol.com/login/device?user_code=ABC123', version: 1 }))
    .mockResolvedValueOnce(Response.json({ connectorOrigin: 'https://connector.oomol.com', apiKey: 'authorized-key', status: 'authorized', version: 1 }))
  vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('window', { open: vi.fn().mockReturnValue(null) })
  const { render, changed } = oomolLogin()
  const button = find(render(), (element) => Children.toArray(element.props.children).includes('settings.oomolAutoAuthorize'))
  button?.props.onClick()
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(fetcher.mock.calls.map((call) => call[1].method)).toEqual(['POST', 'PUT'])
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ expectedRevision: 1, version: 1 })
  expect(hooks.states).toEqual([false, undefined, undefined])
  expect(hooks.success).not.toHaveBeenCalled()
})

it.each(['https://connector.oomol.com', 'https://connector.oomol.dev'])('saves a hosted API key without changing the selected service: %s', async (origin) => {
  const current = config(1)
  current.services.mode = 'custom'
  current.services.profiles.oomol.connectorOrigin = origin
  const { editor, item, changed } = serviceEditor('oomol', current)
  hooks.states = [{ connectorOrigin: origin, connectorToken: 'oomol-key', consoleOrigin: '', llmOrigin: '', llmToken: '' }, false]
  const form = find(editor({ ...item.props, onSaved: changed }), (element) => element.type == 'form')!
  const fetcher = vi.fn().mockResolvedValue(Response.json(config(2)))
  vi.stubGlobal('fetch', fetcher)
  expect(find(form, (element) => element.type == Input && element.props.type == 'url')).toBeUndefined()
  form.props.onSubmit({ preventDefault: vi.fn() })
  await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
  expect(fetcher.mock.calls[0]![0]).toBe('/config/services/oomol')
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({ connectorOrigin: origin, connectorToken: 'oomol-key' })
  expect(current.services.mode).toBe('custom')
})

it('switches to an unconfigured service and keeps its radio selected', async () => {
  const current = config(1)
  Object.assign(current.connector.runtime, { configured: true, origin: 'https://connector.oomol.com', tokenConfigured: true })
  const next = config(2)
  next.services.mode = 'custom'
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(next)))
  const { render, changed } = connectorSettings(current)
  find(render(), (element) => element.type == 'input' && element.props.value == 'custom')!.props.onChange()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(changed).toHaveBeenCalledOnce()
  expect(hooks.toast).not.toHaveBeenCalled()
  expect(serviceConfigurationMissing(next)).toBe(true)
  const selected = connectorSettings(next).render()
  const radio = find(selected, (element) => element.type == 'input' && element.props.value == 'custom')!
  expect(radio.props.checked).toBe(true)
  expect(radio.props['aria-invalid']).toBe(true)
  expect(find(selected, (element) => element.type == 'input' && element.props.value == 'oomol')?.props.checked).toBe(false)
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
  find(render(), (element) => Children.toArray(element.props.children).includes('settings.oomolAutoAuthorize'))?.props.onClick()
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  const waiting = render()
  expect(find(waiting, (element) => element.type == 'a')?.props.href).toBe('https://console.oomol.com/login/device?user_code=ABC123')
  find(waiting, (element) => element.props.children == 'settings.cancel')?.props.onClick()
  expect(fetcher.mock.calls[1]![1].signal.aborted).toBe(true)
  expect(fetcher.mock.calls[2]![1].method).toBe('DELETE')
  pending.resolve(Response.json({ connectorOrigin: 'https://connector.oomol.com', apiKey: 'authorized-key', status: 'authorized', version: 1 }))
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
  find(render(), (element) => Children.toArray(element.props.children).includes('settings.oomolAutoAuthorize'))?.props.onClick()
  await vi.waitFor(() => expect(hooks.states).toEqual([false, undefined, 'expired']))
  expect(popup.opener).toBeNull()
  expect(popup.location.replace).toHaveBeenCalledWith('https://console.oomol.com/login/device?user_code=ABC123')
  expect(find(render(), (element) => element.props.role == 'alert' && element.props.children == 'settings.oomolExpired')?.props.children).toBe(
    'settings.oomolExpired',
  )
  expect(changed).not.toHaveBeenCalled()
})

it.each([401, 409])('resets OOMOL authorization after a session or configuration error: %s', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })))
  const popup = { opener: {}, close: vi.fn() }
  vi.stubGlobal('window', { open: vi.fn().mockReturnValue(popup) })
  const { render, conflicted, unauthorized } = oomolLogin()
  find(render(), (element) => Children.toArray(element.props.children).includes('settings.oomolAutoAuthorize'))?.props.onClick()
  await vi.waitFor(() => expect(popup.close).toHaveBeenCalledOnce())
  expect(hooks.states).toEqual([false, undefined, undefined])
  expect(unauthorized).toHaveBeenCalledTimes(status == 401 ? 1 : 0)
  expect(conflicted).toHaveBeenCalledTimes(status == 409 ? 1 : 0)
})
afterEach(() => {
  hooks.cleanup?.()
  vi.unstubAllGlobals()
})

function emptyProfile() {
  return { connectorOrigin: '', connectorTokenConfigured: false, consoleOrigin: '', llmOrigin: '', llmTokenConfigured: false }
}

function config(revision: number) {
  return {
    version: 1,
    revision,
    services: { mode: 'oomol', managed: false, profiles: { oomol: emptyProfile(), custom: emptyProfile() } },
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
  const item = find(page, (element) => element.props.current != null)
  if (item == null) throw new Error('Service settings are missing.')
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

it.each([200, 401, 409, 500])('saves the custom service form once and handles status %s', async (status) => {
  const { item, editor, unauthorized } = serviceEditor('custom')
  const saved = vi.fn()
  const conflict = vi.fn().mockResolvedValue(undefined)
  const draft = {
    connectorOrigin: 'https://connector.example.com',
    connectorToken: 'connector-secret',
    consoleOrigin: 'https://console.example.com',
    llmOrigin: 'https://models.example.com',
    llmToken: 'llm-secret',
  }
  hooks.states = [draft, false]
  hooks.stateIndex = 0
  const fetcher = vi.fn().mockResolvedValue(Response.json(config(2), { status }))
  vi.stubGlobal('fetch', fetcher)
  const view = editor({ ...item.props, onSaved: saved, onConflict: conflict })
  const form = find(view, (element) => element.type == 'form')
  if (form == null) throw new Error('Custom service form is missing.')
  form.props.onSubmit({ preventDefault: vi.fn() })
  await vi.waitFor(() => expect(hooks.states[1]).toBe(false))
  expect(fetcher).toHaveBeenCalledOnce()
  expect(fetcher.mock.calls[0]![0]).toBe('/config/services/custom')
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ ...draft, expectedRevision: 1, version: 1 })
  expect(saved).toHaveBeenCalledTimes(status == 200 ? 1 : 0)
  expect(unauthorized).toHaveBeenCalledTimes(status == 401 ? 1 : 0)
  expect(conflict).toHaveBeenCalledTimes(status == 409 ? 1 : 0)
  if (status == 500) expect(hooks.toast).toHaveBeenCalledWith('settings.saveFailed')
})

it.each([true, false])('continues leaving the editor only after a successful save: %s', async (succeeded) => {
  hooks.effects = false
  const save = vi.fn().mockResolvedValue(succeeded)
  const proceed = vi.fn()
  const props = { dirty: true, pending: false, save, container: null }
  useUnsavedChanges(props).guard(proceed)
  expect(proceed).not.toHaveBeenCalled()
  hooks.stateIndex = 0
  hooks.refIndex = 0
  const { confirmation } = useUnsavedChanges(props)
  await find(confirmation, (element) => element.props.children == 'settings.save')!.props.onClick()
  expect(save).toHaveBeenCalledOnce()
  expect(proceed).toHaveBeenCalledTimes(succeeded ? 1 : 0)
})

it('keeps an unsaved editor open on cancel and proceeds only on explicit discard', () => {
  hooks.effects = false
  const proceed = vi.fn()
  const props = { dirty: true, pending: false, save: vi.fn(), container: null }
  useUnsavedChanges(props).guard(proceed)
  hooks.stateIndex = 0
  hooks.refIndex = 0
  const { confirmation, guard } = useUnsavedChanges(props)
  find(confirmation, (element) => element.props.children == 'settings.cancel')!.props.onClick()
  expect(proceed).not.toHaveBeenCalled()
  guard(proceed)
  find(confirmation, (element) => element.props.children == 'settings.discardChanges')!.props.onClick()
  expect(proceed).toHaveBeenCalledOnce()
  expect(props.save).not.toHaveBeenCalled()
})

it('protects browser unload only while the editor has unsaved changes', () => {
  const add = vi.fn()
  const remove = vi.fn()
  vi.stubGlobal('window', { addEventListener: add, removeEventListener: remove })
  useUnsavedChanges({ dirty: false, pending: false, save: vi.fn(), container: null })
  expect(add).not.toHaveBeenCalled()
  useUnsavedChanges({ dirty: true, pending: false, save: vi.fn(), container: null })
  expect(add.mock.calls[0]![0]).toBe('beforeunload')
  const event = { preventDefault: vi.fn(), returnValue: undefined }
  add.mock.calls[0]![1](event)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  hooks.cleanup?.()
  expect(remove).toHaveBeenCalledWith('beforeunload', add.mock.calls[0]![1])
})

it.each(['oomol', 'custom'] as const)('shows field errors immediately in an empty %s editor and updates them while editing', (mode) => {
  const { editor } = serviceEditor(mode)
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const view = editor()
  const id = mode == 'oomol' ? 'service-connectorToken' : 'service-connectorOrigin'
  const field = find(view, (element) => element.type == Input && element.props.id == id)!
  expect(field.props['aria-invalid']).toBe(true)
  expect(find(view, (element) => element.props.id == `${id}-error`)?.props.children).toBe('settings.validation.required')
  find(view, (element) => element.type == 'form')!.props.onSubmit({ preventDefault: vi.fn() })
  expect(fetcher).toHaveBeenCalledOnce()
  field.props.onChange({ currentTarget: { value: mode == 'oomol' ? 'test-key' : 'https://connector.example.com' } })
  const corrected = editor()
  expect(find(corrected, (element) => element.type == Input && element.props.id == id)?.props['aria-invalid']).toBe(false)
  expect(find(corrected, (element) => element.props.id == `${id}-error`)).toBeUndefined()
})

it.each([200, 500])('saves the authorized API key and closes only after a successful save (%s)', async (status) => {
  const { editor, item } = serviceEditor('oomol')
  const saved = vi.fn()
  const closed = vi.fn()
  const props = { ...item.props, onSaved: saved, onClose: closed }
  const fetcher = vi.fn().mockResolvedValue(Response.json(config(2), { status }))
  vi.stubGlobal('fetch', fetcher)
  const view = editor(props)
  const authorization = find(view, (element) => typeof element.props.onAuthorized == 'function')!
  authorization.props.onAuthorized({ connectorOrigin: 'https://connector.oomol.dev', apiKey: 'new-key' })
  const filled = editor(props)
  expect(find(filled, (element) => element.type == Input && element.props.id == 'service-connectorToken')?.props.value).toBe('new-key')
  expect(closed).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(hooks.states[1]).toBe(false))
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({ connectorOrigin: 'https://connector.oomol.dev', connectorToken: 'new-key' })
  expect(saved).toHaveBeenCalledTimes(status == 200 ? 1 : 0)
  expect(closed).toHaveBeenCalledTimes(status == 200 ? 1 : 0)
})

it('clears a stored API key into an invalid draft instead of silently retaining it', () => {
  const current = config(1)
  current.services.profiles.oomol.connectorTokenConfigured = true
  const { editor } = serviceEditor('oomol', current)
  const savedInput = find(editor(), (element) => element.type == Input && element.props.id == 'service-connectorToken')!
  expect(savedInput.props.type).toBe('password')
  expect(savedInput.props.placeholder).toBe('••••••••')
  find(editor(), (element) => element.props['aria-label'] == 'settings.clearApiKey')!.props.onClick()
  const cleared = editor()
  const input = find(cleared, (element) => element.type == Input && element.props.id == 'service-connectorToken')!
  expect(input.props.value).toBe('')
  expect(input.props['aria-invalid']).toBe(true)
  expect(input.props.placeholder).toBe('')
})

it('does not offer automatic authorization for a custom Connector', () => {
  const { editor } = serviceEditor('custom')
  expect(find(editor(), (element) => typeof element.props.onAuthorized == 'function')).toBeUndefined()
})

it.each([
  { userId: 'operator', role: 'admin' as const, email: null },
  { userId: 'admin-member', role: 'admin' as const, email: 'admin@example.com' },
  { userId: 'member', role: 'user' as const, email: 'member@example.com' },
])('shows the session identity for $userId', (user) => {
  hooks.effects = false
  hooks.states = [config(1), false, false]
  const session = SessionCard({ user, onSignOut: vi.fn() })
  const subtitle = find(session, (element) => element.type == 'p')!
  expect(text(subtitle)).toBe(`users.${user.role}${user.email == null ? '' : ` · ${user.email}`}`)
})

function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => (isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : String(child)))
    .join('')
}

it('gives members a settings page with their session and sign-out action', () => {
  const user = { userId: 'member', role: 'user' as const, email: 'member@example.com' }
  const signOut = vi.fn()
  const page = MemberSettingsPage({ user, onSignOut: signOut })
  expect(find(page, (element) => element.type == 'h1')?.props.children).toBe('shell.memberSettings')
  const card = find(page, (element) => element.type == SessionCard)!
  expect(card.props.user).toEqual(user)
  const session = SessionCard(card.props as Parameters<typeof SessionCard>[0])
  find(session, (element) => element.props.children == 'session.signOut')!.props.onClick()
  expect(signOut).toHaveBeenCalledOnce()
})

it('saves and closes once when confirming unsaved service edits', async () => {
  const { editor, item } = serviceEditor('oomol')
  const closed = vi.fn()
  const saved = vi.fn()
  const props = { ...item.props, onSaved: saved, onClose: closed }
  const fetcher = vi.fn().mockResolvedValue(Response.json(config(2)))
  vi.stubGlobal('fetch', fetcher)
  const view = editor(props)
  find(view, (element) => element.type == Input)!.props.onChange({ currentTarget: { value: 'new-key' } })
  const changed = editor(props)
  find(changed, (element) => element.type == Dialog)!.props.onOpenChange(false)
  const confirmed = editor(props)
  // The confirmation uses a button click; the editor's Save uses form submission.
  const save = find(confirmed, (element) => element.props.children == 'settings.save' && typeof element.props.onClick == 'function')!
  await save.props.onClick()
  expect(fetcher).toHaveBeenCalledOnce()
  expect(saved).toHaveBeenCalledOnce()
  expect(closed).toHaveBeenCalledOnce()
})

it('validates an authorization result through the same persistence rules as manual edits', async () => {
  const { editor, item } = serviceEditor('oomol')
  const closed = vi.fn()
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const authorization = find(editor({ ...item.props, onClose: closed }), (element) => typeof element.props.onAuthorized == 'function')!
  await authorization.props.onAuthorized({ connectorOrigin: 'https://unrelated.example.com', apiKey: 'new-key' })
  expect(fetcher).not.toHaveBeenCalled()
  expect(closed).not.toHaveBeenCalled()
})
