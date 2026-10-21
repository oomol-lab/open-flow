// @vitest-environment happy-dom
import { act } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemberSettingsPage, SessionCard, SettingsPage, useConfiguration, serviceConfigurationMissing } from '../browser/settings.tsx'
import { useUnsavedChanges } from '../browser/unsaved-changes.tsx'
import { button, click, input, render, submit } from './support/render.tsx'

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'open').mockReturnValue(null)
})

function unload() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

function profile() {
  return { connectorOrigin: '', connectorTokenConfigured: false, consoleOrigin: '', llmOrigin: '', llmTokenConfigured: false }
}
function config(revision: number) {
  return {
    version: 1,
    revision,
    services: { mode: 'oomol' as 'oomol' | 'custom' | null, managed: false, profiles: { oomol: profile(), custom: profile() } },
    connector: {
      runtime: { configured: false, source: 'none' as const, tokenConfigured: false, origin: '' },
      console: { configured: false, source: 'none' as const, origin: '' },
    },
    llm: { configured: false, source: 'none' as const, tokenConfigured: false, origin: '' },
    integration: { configured: false, source: 'none' as const, origin: '' },
  }
}

async function page(current = config(1)) {
  const fetcher = vi.fn().mockImplementation(async () => Response.json(current))
  vi.stubGlobal('fetch', fetcher)
  const changed = vi.fn()
  const unauthorized = vi.fn()
  let configuration: ReturnType<typeof useConfiguration>
  function Host() {
    configuration = useConfiguration(unauthorized)
    return (
      <SettingsPage
        user={{ userId: 'operator', role: 'admin', email: null }}
        configuration={configuration}
        onSignOut={vi.fn()}
        onConnectorChange={changed}
        onUnauthorized={unauthorized}
      />
    )
  }
  const view = render(<Host />)
  await act(async () => {})
  fetcher.mockClear()
  return { ...view, fetcher, changed, unauthorized, configuration: () => configuration! }
}

async function service(mode: 'oomol' | 'custom', current = config(1), automatic = false) {
  const view = await page(current)
  const radio = view.container.querySelector<HTMLInputElement>(`input[value="${mode}"]`)!
  await click(radio.closest('label')!.parentElement!.querySelector('button')!)
  if (mode === 'oomol' && !automatic && document.querySelector('#service-connectorToken') == null) await click(button(view.i18n.t('settings.oomolManualKey')))
  return view
}
function field(id: string) {
  return document.getElementById(id) as HTMLInputElement
}
function dialog() {
  return document.querySelector<HTMLElement>('[role=dialog]')!
}
const session = { code: 'ABC123', id: 'login-id', url: 'https://console.oomol.com/login/device?user_code=ABC123', version: 1 }
const authorized = { connectorOrigin: 'https://connector.oomol.com', apiKey: 'authorized-key', status: 'authorized', version: 1 }

it('ignores an older refresh that finishes after the latest refresh', async () => {
  const view = await page()
  const older = Promise.withResolvers<Response>()
  const newer = Promise.withResolvers<Response>()
  view.fetcher.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
  act(() => window.dispatchEvent(new Event('focus')))
  act(() => window.dispatchEvent(new Event('focus')))
  await act(async () => newer.resolve(Response.json(config(3))))
  await act(async () => older.resolve(Response.json(config(2))))
  expect(view.configuration().current?.revision).toBe(3)
})

it.each(['response', 'failure', 'unauthorized', 'unmount'])('ignores an obsolete refresh after save or unmount: %s', async (outcome) => {
  const view = await page()
  const pending = Promise.withResolvers<Response>()
  view.fetcher.mockReturnValueOnce(pending.promise)
  act(() => window.dispatchEvent(new Event('focus')))
  if (outcome === 'unmount') view.unmount()
  else act(() => view.configuration().saved(config(3)))
  await act(async () => {
    if (outcome === 'failure') pending.reject(new Error('offline'))
    else pending.resolve(outcome === 'unauthorized' ? new Response(null, { status: 401 }) : Response.json(config(2)))
  })
  expect(view.configuration().current?.revision).toBe(outcome === 'unmount' ? 1 : 3)
  expect(toast.error).not.toHaveBeenCalled()
  expect(view.unauthorized).not.toHaveBeenCalled()
})

it('requests a service selection and keeps an explicitly selected unconfigured service selected', async () => {
  const current = config(1)
  current.services.mode = null
  const view = await page(current)
  expect(serviceConfigurationMissing(undefined)).toBe(false)
  expect(serviceConfigurationMissing(view.configuration().current)).toBe(true)
  expect(view.container.textContent).toContain(view.i18n.t('settings.serviceSelectionRequired'))
  expect(view.container.querySelector('input:checked')).toBeNull()
  const next = config(2)
  next.services.mode = 'custom'
  view.fetcher.mockImplementation(async () => Response.json(next))
  await click(view.container.querySelector<HTMLInputElement>('input[value=custom]')!)
  expect(view.changed).toHaveBeenCalledOnce()
  expect(view.container.querySelector<HTMLInputElement>('input[value=custom]')!.checked).toBe(true)
  expect(view.container.querySelector('input[value=custom]')!.getAttribute('aria-invalid')).toBe('true')
})

it.each(['https://connector.oomol.com', 'https://connector.oomol.dev'])('saves a hosted API key without changing the selected service: %s', async (origin) => {
  const current = config(1)
  current.services.mode = 'custom'
  current.services.profiles.oomol.connectorOrigin = origin
  const view = await service('oomol', current)
  await input(field('service-connectorToken'), 'oomol-key')
  await submit(dialog().querySelector('form')!)
  expect(view.fetcher).toHaveBeenCalledOnce()
  expect(view.fetcher.mock.calls[0]![0]).toBe('/config/services/oomol')
  expect(JSON.parse(view.fetcher.mock.calls[0]![1].body)).toMatchObject({ connectorOrigin: origin, connectorToken: 'oomol-key', expectedRevision: 1 })
  expect(view.changed).toHaveBeenCalledOnce()
  expect(view.configuration().current?.services.mode).toBe('custom')
})

it.each([200, 401, 409, 500])('saves the custom service form once and handles status %s', async (status) => {
  const view = await service('custom')
  const draft = {
    connectorOrigin: 'https://connector.example.com',
    connectorToken: 'connector-secret',
    consoleOrigin: 'https://console.example.com',
    llmOrigin: 'https://models.example.com',
    llmToken: 'llm-secret',
  }
  for (const [key, value] of Object.entries(draft)) await input(field(`service-${key}`), value)
  view.fetcher.mockImplementation(async () => Response.json(config(2))).mockImplementationOnce(async () => Response.json(config(2), { status }))
  await submit(dialog().querySelector('form')!)
  expect(view.fetcher.mock.calls[0]![0]).toBe('/config/services/custom')
  expect(JSON.parse(view.fetcher.mock.calls[0]![1].body)).toEqual({ ...draft, expectedRevision: 1, version: 1 })
  expect(view.fetcher).toHaveBeenCalledTimes(status === 409 ? 2 : 1)
  expect(view.changed).toHaveBeenCalledTimes(status === 200 ? 1 : 0)
  expect(view.unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0)
  if (status === 409) expect(view.fetcher.mock.calls[1]![0]).toBe('/config')
  if (status === 500) expect(toast.error).toHaveBeenCalledWith(view.i18n.t('settings.saveFailed'))
})

it('focuses missing public address and callback key fields without saving', async () => {
  const view = await page()
  await click(button(view.i18n.t('settings.configure')))
  await submit(dialog().querySelector('form')!)
  expect(document.activeElement).toBe(field('/config/integration-origin'))
  await input(field('/config/integration-origin'), 'https://flows.example.com')
  await submit(dialog().querySelector('form')!)
  expect(document.activeElement).toBe(field('/config/integration-secret'))
  expect(field('/config/integration-secret').getAttribute('aria-invalid')).toBe('true')
  expect(view.fetcher).not.toHaveBeenCalled()
  await click(button(view.i18n.t('settings.cancel'), dialog()))
})

it.each([
  { secret: 'a'.repeat(31), accepted: false },
  { secret: 'a'.repeat(32), accepted: true },
  { secret: '中'.repeat(10), accepted: false },
  { secret: '中'.repeat(11), accepted: true },
])('validates callback keys in UTF-8 bytes: %j', async ({ secret, accepted }) => {
  const view = await page()
  await click(button(view.i18n.t('settings.configure')))
  await input(field('/config/integration-origin'), 'https://flows.example.com')
  await input(field('/config/integration-secret'), secret)
  expect(field('/config/integration-secret').getAttribute('aria-invalid')).toBe(String(!accepted))
  await submit(dialog().querySelector('form')!)
  expect(view.fetcher).toHaveBeenCalledTimes(accepted ? 1 : 0)
})

it.each(['oomol', 'custom'] as const)('updates required field errors while editing %s', async (mode) => {
  const view = await service(mode)
  const target = field(mode === 'oomol' ? 'service-connectorToken' : 'service-connectorOrigin')
  expect(target.getAttribute('aria-invalid')).toBe('true')
  await input(target, mode === 'oomol' ? 'key' : 'https://connector.example.com')
  expect(target.getAttribute('aria-invalid')).toBe('false')
  expect(view.fetcher).not.toHaveBeenCalled()
})

it.each([false, true])('preserves or explicitly clears a stored key on save (clear: %s)', async (clear) => {
  const current = config(1)
  current.services.profiles.oomol.connectorTokenConfigured = true
  const view = await service('oomol', current)
  expect(field('service-connectorToken').placeholder).toBe('••••••••')
  if (clear) {
    await click(button(view.i18n.t('settings.clearApiKey')))
    expect(field('service-connectorToken').placeholder).toBe('')
    expect(field('service-connectorToken').getAttribute('aria-invalid')).toBe('true')
  }
  await submit(dialog().querySelector('form')!)
  expect(JSON.parse(view.fetcher.mock.calls[0]![1].body).connectorToken).toBe(clear ? '' : null)
})

it('preserves manual drafts across authorization mode changes and confirms unsaved edits once', async () => {
  const view = await service('oomol', config(1), true)
  expect(dialog().querySelector('input')).toBeNull()
  await click(button(view.i18n.t('settings.oomolManualKey')))
  await input(field('service-connectorToken'), 'manual-draft')
  await click(button(view.i18n.t('settings.oomolBackToAuthorization')))
  expect(dialog().querySelector('input')).toBeNull()
  await click(button(view.i18n.t('settings.oomolManualKey')))
  expect(field('service-connectorToken').value).toBe('manual-draft')
  await click(button(view.i18n.t('settings.cancel'), dialog()))
  const confirmation = [...document.querySelectorAll<HTMLElement>('[role=dialog]')].find((element) =>
    element.textContent?.includes(view.i18n.t('settings.unsavedTitle')),
  )!
  await click(button(view.i18n.t('settings.save'), confirmation))
  expect(view.fetcher).toHaveBeenCalledOnce()
  expect(view.changed).toHaveBeenCalledOnce()
  expect(document.querySelector('[role=dialog]')).toBeNull()
})

it('opens manual editing directly for a nonstandard hosted origin', async () => {
  const current = config(1)
  current.services.profiles.oomol.connectorOrigin = 'https://hosted.example.com'
  const view = await service('oomol', current, true)
  expect(field('service-connectorToken')).not.toBeNull()
  expect(dialog().textContent).not.toContain(view.i18n.t('settings.oomolBackToAuthorization'))
})

it.each([200, 500])('automatically authorizes with a blocked popup and retries only persistence after status %s', async (status) => {
  const view = await service('oomol', config(1), true)
  const save = Promise.withResolvers<Response>()
  view.fetcher.mockResolvedValueOnce(Response.json(session)).mockResolvedValueOnce(Response.json(authorized)).mockReturnValueOnce(save.promise)
  await click(button(view.i18n.t('settings.oomolAutoAuthorize')))
  expect(dialog().textContent).toContain(view.i18n.t('settings.oomolSaving'))
  expect(view.changed).not.toHaveBeenCalled()
  await act(async () => save.resolve(Response.json(config(2), { status })))
  if (status === 500) {
    expect(dialog().textContent).toContain(view.i18n.t('settings.oomolSaveFailed'))
    view.fetcher.mockImplementation(async () => Response.json(config(2)))
    await click(button(view.i18n.t('settings.oomolRetrySave')))
    expect(view.fetcher.mock.calls[3]![1].body).toBe(view.fetcher.mock.calls[2]![1].body)
  }
  expect(view.fetcher.mock.calls.map((call) => call[1].method)).toEqual(status === 500 ? ['POST', 'PUT', 'PUT', 'PUT'] : ['POST', 'PUT', 'PUT'])
  expect(JSON.parse(view.fetcher.mock.calls[2]![1].body)).toMatchObject({ connectorOrigin: authorized.connectorOrigin, connectorToken: authorized.apiKey })
  expect(view.changed).toHaveBeenCalledOnce()
  expect(document.querySelector('[role=dialog]')).toBeNull()
})

it.each(['cancel', 'unmount'] as const)('cancels starting authorization on %s and ignores its late response', async (action) => {
  const view = await service('oomol', config(1), true)
  const pending = Promise.withResolvers<Response>()
  const popup = { opener: {}, close: vi.fn() }
  vi.mocked(window.open).mockReturnValue(popup as unknown as Window)
  view.fetcher.mockReturnValueOnce(pending.promise)
  await click(button(view.i18n.t('settings.oomolAutoAuthorize')))
  if (action === 'cancel') await click(button(view.i18n.t('settings.oomolCancelAuthorization')))
  else view.unmount()
  expect(view.fetcher.mock.calls[0]![1].signal.aborted).toBe(true)
  expect(popup.close).toHaveBeenCalledOnce()
  await act(async () => pending.resolve(Response.json(session)))
  expect(view.changed).not.toHaveBeenCalled()
  expect(view.fetcher).toHaveBeenCalledOnce()
})

it('offers a verification link, aborts polling on cancel, and ignores late authorization', async () => {
  const view = await service('oomol', config(1), true)
  const pending = Promise.withResolvers<Response>()
  view.fetcher.mockResolvedValueOnce(Response.json(session)).mockReturnValueOnce(pending.promise)
  await click(button(view.i18n.t('settings.oomolAutoAuthorize')))
  expect(dialog().textContent).toContain(session.code)
  expect(dialog().querySelector('a')!.href).toBe(session.url)
  await click(button(view.i18n.t('settings.oomolCancelAuthorization')))
  expect(view.fetcher.mock.calls[1]![1].signal.aborted).toBe(true)
  expect(view.fetcher.mock.calls[2]![1].method).toBe('DELETE')
  await act(async () => pending.resolve(Response.json(authorized)))
  expect(view.changed).not.toHaveBeenCalled()
})

it('allows another attempt after expired authorization', async () => {
  const view = await service('oomol', config(1), true)
  const popup = { opener: {}, location: { replace: vi.fn() }, close: vi.fn() }
  vi.mocked(window.open).mockReturnValue(popup as unknown as Window)
  view.fetcher.mockResolvedValueOnce(Response.json(session)).mockResolvedValueOnce(new Response(null, { status: 410 }))
  await click(button(view.i18n.t('settings.oomolAutoAuthorize')))
  expect(popup.opener).toBeNull()
  expect(popup.location.replace).toHaveBeenCalledWith(session.url)
  expect(dialog().textContent).toContain(view.i18n.t('settings.oomolExpired'))
  view.fetcher.mockResolvedValueOnce(Response.json(session)).mockResolvedValueOnce(Response.json(authorized))
  await click(button(view.i18n.t('settings.oomolRetryAuthorize')))
  expect(view.changed).toHaveBeenCalledOnce()
})

it.each([401, 409])('handles authorization session/configuration errors: %s', async (status) => {
  const view = await service('oomol', config(1), true)
  view.fetcher.mockResolvedValueOnce(new Response(null, { status }))
  await click(button(view.i18n.t('settings.oomolAutoAuthorize')))
  expect(view.unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0)
  expect(view.fetcher).toHaveBeenCalledTimes(status === 409 ? 2 : 1)
  expect(view.changed).not.toHaveBeenCalled()
})

it('rejects an authorization result from an unrelated origin', async () => {
  const view = await service('oomol', config(1), true)
  view.fetcher
    .mockResolvedValueOnce(Response.json(session))
    .mockResolvedValueOnce(Response.json({ ...authorized, connectorOrigin: 'https://unrelated.example.com' }))
  await click(button(view.i18n.t('settings.oomolAutoAuthorize')))
  expect(view.fetcher).toHaveBeenCalledTimes(2)
  expect(view.changed).not.toHaveBeenCalled()
})

it.each([true, false])('leaves an unsaved editor only after a successful save: %s', async (succeeded) => {
  const save = vi.fn().mockResolvedValue(succeeded)
  const proceed = vi.fn()
  function Host() {
    const { guard, confirmation } = useUnsavedChanges({ dirty: true, pending: false, save, container: document.body })
    return (
      <>
        <button onClick={() => guard(proceed)}>Leave</button>
        {confirmation}
      </>
    )
  }
  const view = render(<Host />)
  await click(button('Leave'))
  expect(proceed).not.toHaveBeenCalled()
  await click(button(view.i18n.t('settings.save'), dialog()))
  expect(save).toHaveBeenCalledOnce()
  expect(proceed).toHaveBeenCalledTimes(succeeded ? 1 : 0)
})

it('cancels or discards unsaved changes and protects unload only while dirty', async () => {
  const proceed = vi.fn()
  const save = vi.fn()
  function Host({ dirty }: { dirty: boolean }) {
    const { guard, confirmation } = useUnsavedChanges({ dirty, pending: false, save, container: document.body })
    return (
      <>
        <button onClick={() => guard(proceed)}>Leave</button>
        {confirmation}
      </>
    )
  }
  const view = render(<Host dirty={false} />)
  expect(unload()).toBe(false)
  view.rerender(<Host dirty />)
  expect(unload()).toBe(true)
  await click(button('Leave'))
  await click(button(view.i18n.t('settings.cancel'), dialog()))
  expect(proceed).not.toHaveBeenCalled()
  await click(button('Leave'))
  await click(button(view.i18n.t('settings.discardChanges'), dialog()))
  expect(proceed).toHaveBeenCalledOnce()
  expect(save).not.toHaveBeenCalled()
  view.unmount()
  expect(unload()).toBe(false)
})

it.each([
  { userId: 'operator', role: 'admin' as const, email: null },
  { userId: 'admin-member', role: 'admin' as const, email: 'admin@example.com' },
  { userId: 'member', role: 'user' as const, email: 'member@example.com' },
])('shows session identity and signs out $userId', async (user) => {
  const signOut = vi.fn()
  const view = render(user.role === 'user' ? <MemberSettingsPage user={user} onSignOut={signOut} /> : <SessionCard user={user} onSignOut={signOut} />)
  expect(view.container.textContent).toContain(view.i18n.t(`users.${user.role}`))
  if (user.email) expect(view.container.textContent).toContain(user.email)
  if (user.role === 'user') expect(view.container.querySelector('h1')?.textContent).toBe(view.i18n.t('shell.memberSettings'))
  await click(button(view.i18n.t('session.signOut')))
  expect(signOut).toHaveBeenCalledOnce()
})

it('stops authorization before confirming whether to discard a manual draft', async () => {
  const view = await service('oomol')
  await input(field('service-connectorToken'), 'manual-draft')
  await click(button(view.i18n.t('settings.oomolBackToAuthorization')))
  const pending = Promise.withResolvers<Response>()
  view.fetcher.mockReturnValueOnce(pending.promise)
  await click(button(view.i18n.t('settings.oomolAutoAuthorize')))
  await click(button(view.i18n.t('settings.cancel'), dialog()))
  expect(view.fetcher.mock.calls[0]![1].signal.aborted).toBe(true)
  const confirmation = [...document.querySelectorAll<HTMLElement>('[role=dialog]')].find((element) =>
    element.textContent?.includes(view.i18n.t('settings.unsavedTitle')),
  )!
  expect(confirmation).toBeDefined()
  await click(button(view.i18n.t('settings.cancel'), confirmation))
  await act(async () => pending.resolve(Response.json(session)))
  expect(view.fetcher).toHaveBeenCalledOnce()
  expect(view.changed).not.toHaveBeenCalled()
  expect(document.querySelector('[role=dialog]')).not.toBeNull()
})
