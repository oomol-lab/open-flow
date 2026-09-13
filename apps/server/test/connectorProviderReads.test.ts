import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectorClient } from '../node/deployment/connector.ts'

const origin = 'https://connector.example'
function body(name = 'Mail') {
  return { success: true, data: [{ service: 'mail', displayName: name, authTypes: ['oauth2'] }] }
}
function response(name = 'Mail', etag?: string) {
  return Response.json(body(name), { headers: etag == null ? {} : { etag } })
}
function setup() {
  const fetcher = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
  vi.stubGlobal('fetch', fetcher)
  return { fetcher, client: new ConnectorClient(origin, 'token') }
}
function validator(init?: RequestInit) {
  return new Headers(init?.headers).get('if-none-match')
}
afterEach(() => vi.unstubAllGlobals())

describe('upstream Provider reads', () => {
  it('reads current data without sending validators even when upstream supplies ETags', async () => {
    const { fetcher, client } = setup()
    fetcher.mockResolvedValueOnce(response('Mail', '"same"'))
    expect(await client.listProviders(undefined, 'team-a', 'en')).toEqual([{ serviceId: 'mail', serviceName: 'Mail' }])
    fetcher.mockResolvedValueOnce(response('Updated', '"same"'))
    expect(await client.listProviders(undefined, 'team-a', 'en')).toEqual([{ serviceId: 'mail', serviceName: 'Updated' }])
    expect(fetcher).toHaveBeenCalledTimes(2)
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).toBe(`${origin}/v1/providers`)
      expect(validator(init)).toBeNull()
      expect(new Headers(init?.headers).get('x-oo-team-id')).toBe('team-a')
      expect(new Headers(init?.headers).get('accept-language')).toBe('en')
    }
  })

  it('rejects 304s, failures and invalid data after a successful read', async () => {
    const { fetcher, client } = setup()
    fetcher.mockResolvedValueOnce(response('Mail', '"good"'))
    await client.listProviders()
    for (const result of [
      new Response(null, { status: 304 }),
      Response.json({ success: false }, { status: 403 }),
      Response.json({ success: true, data: [{}] }, { headers: { etag: '"bad"' } }),
    ]) {
      fetcher.mockResolvedValueOnce(result)
      await expect(client.listProviders()).rejects.toMatchObject({ code: 'connector.unavailable' })
    }
    expect(fetcher.mock.calls.every((call) => validator(call[1]) == null)).toBe(true)
  })

  it('rejects a cancelled response', async () => {
    const { fetcher, client } = setup()
    const controller = new AbortController()
    fetcher.mockImplementationOnce(async () => {
      controller.abort()
      return response('Cancelled', '"cancelled"')
    })
    await expect(client.listProviders(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
