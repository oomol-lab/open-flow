import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const init = vi.hoisted(() => vi.fn())
vi.mock('posthog-js', () => ({ default: { init } }))

beforeEach(() => {
  vi.resetModules()
  init.mockClear()
  vi.stubEnv('VITE_POSTHOG_KEY', undefined)
  vi.stubEnv('VITE_POSTHOG_HOST', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it.each(['localhost', '127.0.0.1', 'private.example.com', 'openflow.run.example.com'])(
  'leaves analytics disabled on %s without configuration',
  async (hostname) => {
    vi.stubGlobal('location', { hostname })
    expect((await import('../browser/posthog.ts')).posthog).toBeUndefined()
    expect(init).not.toHaveBeenCalled()
  },
)

it.each(['openflow.run', 'www.openflow.run'])('uses the hosted project on %s without a local env file', async (hostname) => {
  vi.stubGlobal('location', { hostname })
  expect((await import('../browser/posthog.ts')).posthog).toBeDefined()
  expect(init).toHaveBeenCalledWith(
    'phc_u8CbakAX3kxotvT6UY2ZZK7LFNURiYToJtc4cfKRWzQX',
    expect.objectContaining({
      api_host: 'https://us.i.posthog.com',
      autocapture: false,
      disable_session_recording: true,
    }),
  )
})

it('allows a separate deployment to select its own project', async () => {
  vi.stubGlobal('location', { hostname: 'private.example.com' })
  vi.stubEnv('VITE_POSTHOG_KEY', 'test-project')
  vi.stubEnv('VITE_POSTHOG_HOST', 'https://analytics.example.com')
  await import('../browser/posthog.ts')
  expect(init).toHaveBeenCalledWith('test-project', expect.objectContaining({ api_host: 'https://analytics.example.com' }))
})

it('allows an explicit empty key to disable hosted analytics', async () => {
  vi.stubGlobal('location', { hostname: 'openflow.run' })
  vi.stubEnv('VITE_POSTHOG_KEY', '')
  expect((await import('../browser/posthog.ts')).posthog).toBeUndefined()
  expect(init).not.toHaveBeenCalled()
})
