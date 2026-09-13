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

describe('upstream Provider conditional requests', () => {
  it('revalidates every read, handles bodyless 304s and keeps replacement ETags', async () => {
    const { fetcher, client } = setup()
    fetcher.mockResolvedValueOnce(response('Mail', 'W/"one"'))
    expect(await client.listProviders()).toEqual([{ serviceId: 'mail', serviceName: 'Mail' }])
    fetcher.mockResolvedValueOnce(new Response(null, { status: 304, headers: { etag: 'W/"two"' } }))
    expect(await client.listProviders()).toEqual([{ serviceId: 'mail', serviceName: 'Mail' }])
    expect(validator(fetcher.mock.calls[1]?.[1])).toBe('W/"one"')
    fetcher.mockResolvedValueOnce(response('Updated', '"three"'))
    expect(await client.listProviders()).toEqual([{ serviceId: 'mail', serviceName: 'Updated' }])
    expect(validator(fetcher.mock.calls[2]?.[1])).toBe('W/"two"')
    fetcher.mockResolvedValueOnce(new Response(null, { status: 304 }))
    expect(await client.listProviders()).toEqual([{ serviceId: 'mail', serviceName: 'Updated' }])
    expect(validator(fetcher.mock.calls[3]?.[1])).toBe('"three"')
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(`${origin}/v1/providers`)
  })

  it('isolates Team scopes and client credentials and origins', async () => {
    const { fetcher, client } = setup()
    fetcher.mockImplementation(async () => response('Mail', '"tag"'))
    await client.listProviders(undefined, 'team-a')
    await client.listProviders(undefined, 'team-b')
    await client.listProviders()
    await new ConnectorClient(origin, 'other-token').listProviders(undefined, 'team-a')
    await new ConnectorClient('https://other.example', 'token').listProviders(undefined, 'team-a')
    expect(fetcher.mock.calls.every((call) => validator(call[1]) == null)).toBe(true)
    await client.listProviders(undefined, 'team-a')
    expect(validator(fetcher.mock.calls[5]?.[1])).toBe('"tag"')
    expect(new Headers(fetcher.mock.calls[5]?.[1]?.headers).get('x-oo-team-id')).toBe('team-a')
  })

  it('drops the previous validator when a new response has no ETag', async () => {
    const { fetcher, client } = setup()
    fetcher.mockResolvedValueOnce(response('Mail', '"tag"'))
    await client.listProviders()
    fetcher.mockResolvedValueOnce(response('Changed'))
    expect(await client.listProviders()).toEqual([{ serviceId: 'mail', serviceName: 'Changed' }])
    fetcher.mockResolvedValueOnce(response('Latest'))
    await client.listProviders()
    expect(validator(fetcher.mock.calls[2]?.[1])).toBeNull()
  })

  it('rejects unexpected 304s, failures and invalid data without returning cached success', async () => {
    const { fetcher, client } = setup()
    fetcher.mockResolvedValueOnce(new Response(null, { status: 304 }))
    await expect(client.listProviders()).rejects.toMatchObject({ code: 'connector.unavailable' })
    fetcher.mockResolvedValueOnce(response('Mail', '"good"'))
    await client.listProviders()
    fetcher.mockResolvedValueOnce(Response.json({ success: false }, { status: 403 }))
    await expect(client.listProviders()).rejects.toMatchObject({ code: 'connector.unavailable' })
    fetcher.mockResolvedValueOnce(Response.json({ success: true, data: [{}] }, { headers: { etag: '"bad"' } }))
    await expect(client.listProviders()).rejects.toMatchObject({ code: 'connector.unavailable' })
    fetcher.mockResolvedValueOnce(new Response(null, { status: 304 }))
    expect(await client.listProviders()).toEqual([{ serviceId: 'mail', serviceName: 'Mail' }])
    expect(validator(fetcher.mock.calls[4]?.[1])).toBe('"good"')
  })

  it('does not let a late response overwrite a newer request cache', async () => {
    const { fetcher, client } = setup()
    const old = Promise.withResolvers<Response>()
    fetcher.mockReturnValueOnce(old.promise).mockResolvedValueOnce(response('New', '"new"'))
    const earlier = client.listProviders()
    expect(await client.listProviders()).toEqual([{ serviceId: 'mail', serviceName: 'New' }])
    old.resolve(response('Old', '"old"'))
    expect(await earlier).toEqual([{ serviceId: 'mail', serviceName: 'Old' }])
    fetcher.mockResolvedValueOnce(new Response(null, { status: 304 }))
    expect(await client.listProviders()).toEqual([{ serviceId: 'mail', serviceName: 'New' }])
    expect(validator(fetcher.mock.calls[2]?.[1])).toBe('"new"')
  })

  it('does not cache a cancelled response', async () => {
    const { fetcher, client } = setup()
    const controller = new AbortController()
    fetcher.mockImplementationOnce(async () => {
      controller.abort()
      return response('Cancelled', '"cancelled"')
    })
    await expect(client.listProviders(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    fetcher.mockResolvedValueOnce(response('Mail', '"good"'))
    await client.listProviders()
    expect(validator(fetcher.mock.calls[1]?.[1])).toBeNull()
  })
})
