import { expect, it, vi } from 'vitest'
import { createDevelopmentCommandHost } from '../scripts/flow-host.ts'

const token = 'development-token-for-flow-host-tests-0001'

it('uses the development API and token while opening the frontend origin', async () => {
  const readToken = vi.fn(async () => `${token}\n`)
  const fetcher = vi.fn(async () => new Response('{}'))
  const host = createDevelopmentCommandHost({}, { readToken, fetch: fetcher })
  await host.cloudRequest!('/v1/flows')
  await host.cloudRequest!('/v1/flows?limit=2')
  expect(readToken).toHaveBeenCalledTimes(1)
  const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit]
  expect(url.href).toBe('http://127.0.0.1:3001/v1/flows')
  expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${token}`)
  expect(await host.getWorkbenchUrl!('flow name')).toBe('http://localhost:5174/flows/flow%20name/design')
})

it('retries failed connection resolution and caches a successful retry', async () => {
  const readToken = vi.fn(async () => token).mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  const fetcher = vi.fn(async () => new Response('{}'))
  const host = createDevelopmentCommandHost({}, { readToken, fetch: fetcher })
  await Promise.all([
    expect(host.cloudRequest!('/v1/flows')).rejects.toThrow('Development operator token is missing'),
    expect(host.getWorkbenchUrl!()).rejects.toThrow('Development operator token is missing'),
  ])
  expect(readToken).toHaveBeenCalledTimes(1)
  expect(fetcher).not.toHaveBeenCalled()

  expect((await host.cloudRequest!('/v1/flows')).status).toBe(200)
  expect(await host.getWorkbenchUrl!()).toBe('http://localhost:5174/flows')
  expect(readToken).toHaveBeenCalledTimes(2)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('uses environment credentials and the configured development port', async () => {
  const readToken = vi.fn()
  const fetcher = vi.fn(async (_url: URL, _init: RequestInit) => new Response('{}'))
  const host = createDevelopmentCommandHost({ OPEN_FLOW_PORT: '3012', OPEN_FLOW_TOKEN: token }, { readToken, fetch: fetcher })
  await host.cloudRequest!('/v1/flows', { headers: { 'authorization': 'wrong', 'cookie': 'secret', 'x-oo-team-id': 'wrong' } })
  const [url, init] = fetcher.mock.calls[0]!
  expect(url.origin).toBe('http://127.0.0.1:3012')
  expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${token}`)
  expect(new Headers(init.headers).has('cookie')).toBe(false)
  expect(new Headers(init.headers).has('x-oo-team-id')).toBe(false)
  expect(init.redirect).toBe('error')
  expect(readToken).not.toHaveBeenCalled()
})

it('requires explicit credentials for an explicit Server and never reads the development token', async () => {
  const readToken = vi.fn()
  const host = createDevelopmentCommandHost({ OPEN_FLOW_URL: 'https://flows.example.test' }, { readToken })
  await expect(host.cloudRequest!('/v1/flows')).rejects.toThrow('requires OPEN_FLOW_TOKEN')
  expect(readToken).not.toHaveBeenCalled()
})

it('keeps remote Workbench navigation on the selected origin without credentials', async () => {
  const host = createDevelopmentCommandHost({ OPEN_FLOW_URL: 'https://flows.example.test', OPEN_FLOW_TOKEN: token })
  expect(await host.getWorkbenchUrl!()).toBe('https://flows.example.test/flows')
})

it('rejects escaped API requests before sending credentials', async () => {
  const fetcher = vi.fn()
  const host = createDevelopmentCommandHost({ OPEN_FLOW_TOKEN: token }, { fetch: fetcher })
  for (const target of ['https://other.test/v1/flows', '/config', '/v1/../config', '/v1/flows#fragment']) {
    await expect(host.cloudRequest!(target)).rejects.toThrow('selected Server /v1/')
  }
  expect(fetcher).not.toHaveBeenCalled()
})

it('reports missing or invalid tokens and does not create one', async () => {
  const missing = createDevelopmentCommandHost(
    {},
    {
      readToken: async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      },
    },
  )
  await expect(missing.cloudRequest!('/v1/flows')).rejects.toThrow('Start bun run dev')
  const invalid = createDevelopmentCommandHost({}, { readToken: async () => '' })
  await expect(invalid.cloudRequest!('/v1/flows')).rejects.toThrow('32 UTF-8 bytes')
})

it('preserves authentication errors and reports connection failures without secrets', async () => {
  const denied = createDevelopmentCommandHost({ OPEN_FLOW_TOKEN: token }, { fetch: async () => new Response('{}', { status: 401 }) })
  expect((await denied.cloudRequest!('/v1/flows')).status).toBe(401)
  const down = createDevelopmentCommandHost(
    { OPEN_FLOW_TOKEN: token },
    {
      fetch: async () => {
        throw new Error('connect failure')
      },
    },
  )
  await expect(down.cloudRequest!('/v1/flows')).rejects.toThrow('Could not reach Open Flow Server at http://127.0.0.1:3001')
})
