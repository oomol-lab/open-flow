import { afterEach, expect, it, vi } from 'vitest'
import { signInFromDevelopmentLink } from '../browser/development-login.ts'

afterEach(() => vi.unstubAllGlobals())

function browser(hash: string) {
  const replaceState = vi.fn()
  vi.stubGlobal('window', { location: { hash, pathname: '/agents', search: '?view=list' }, history: { replaceState } })
  const fetch = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  return { replaceState, fetch }
}

it('clears the credential before exchanging it and waits for the session', async () => {
  const { replaceState, fetch } = browser('#dev-token=a%2Bb%26c&section=details')
  let complete!: () => void
  fetch.mockImplementation(async () => {
    expect(replaceState).toHaveBeenCalledWith(null, '', '/agents?view=list#section=details')
    await new Promise<void>((resolve) => {
      complete = resolve
    })
    return new Response(null, { status: 204 })
  })
  let finished = false
  const pending = signInFromDevelopmentLink().then(() => {
    finished = true
  })
  expect(finished).toBe(false)
  expect(fetch).toHaveBeenCalledWith('/auth/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, token: 'a+b&c' }),
  })
  complete()
  await pending
  expect(finished).toBe(true)
})

it('leaves ordinary navigation and login unchanged', async () => {
  const { replaceState, fetch } = browser('#section=details')
  await signInFromDevelopmentLink()
  expect(replaceState).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['rejected', 'unavailable'])('allows normal startup when login is %s', async (failure) => {
  const { replaceState, fetch } = browser('#dev-token=invalid')
  fetch.mockImplementation(async () => {
    if (failure == 'unavailable') throw new Error('offline')
    return new Response(null, { status: 401 })
  })
  await expect(signInFromDevelopmentLink()).resolves.toBeUndefined()
  expect(replaceState).toHaveBeenCalledWith(null, '', '/agents?view=list')
})
