import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectorClient } from '../node/deployment/connector.ts'

const provider = { service: 'mail', displayName: 'Mail', authTypes: ['oauth2'] }
const action = {
  id: 'mail.send',
  name: 'send',
  description: 'Send',
  service: 'mail',
  inputSchema: { type: 'object', properties: {} },
  outputSchema: { type: 'object', properties: {} },
}
const connection = { id: 'mail-1', service: 'mail', displayName: 'Mail', isDefault: true, status: 'active', alias: 'mail-account' }
const cases = [
  { path: '/v1/apps', read: (client: ConnectorClient) => client.listAllConnections(undefined, 'team-a') },
  { path: '/v1/apps/services/mail', read: (client: ConnectorClient) => client.listConnections('mail', undefined, 'team-a') },
  { path: '/v1/actions?service=mail', read: (client: ConnectorClient) => client.listActions('mail', undefined, 'team-a', 'en') },
  { path: '/v1/actions/search?q=send', read: (client: ConnectorClient) => client.searchActions('send', undefined, 'team-a', 'en') },
  { path: '/v1/actions/mail.send', read: (client: ConnectorClient) => client.getAction('mail.send', undefined, 'team-a', 'en') },
]
function setup() {
  const calls: { path: string; headers: Headers }[] = []
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const path = url.pathname + url.search
    const headers = new Headers(init?.headers)
    calls.push({ path, headers })
    if (headers.has('if-none-match')) return new Response(null, { status: 304, headers: { etag: 'W/"updated"' } })
    const data =
      url.pathname == '/v1/providers'
        ? [provider]
        : url.pathname.startsWith('/v1/apps')
          ? [connection]
          : url.pathname == '/v1/actions/mail.send'
            ? action
            : [action]
    return Response.json({ success: true, data }, { headers: { etag: '"initial"' } })
  })
  vi.stubGlobal('fetch', fetcher)
  return { client: new ConnectorClient('https://connector.example', 'token'), fetcher, calls }
}
afterEach(() => vi.unstubAllGlobals())

describe('upstream Action and Connection reads', () => {
  it.each(cases)('reads $path on every call without upstream validators', async ({ path, read }) => {
    const { client, calls } = setup()
    const first = await read(client)
    expect(await read(client)).toEqual(first)
    expect(await read(client)).toEqual(first)
    expect(calls.filter((call) => call.path == path).map((call) => call.headers.get('if-none-match'))).toEqual([null, null, null])
    expect(calls.every((call) => call.headers.get('x-oo-team-id') == 'team-a')).toBe(true)
  })

  it.each(cases)('rejects an upstream 304 for $path after a successful read', async ({ path, read }) => {
    const { client, fetcher } = setup()
    await read(client)
    const implementation = fetcher.getMockImplementation()!
    fetcher.mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname + url.search == path) return new Response(null, { status: 304 })
      return implementation(input, init)
    })
    await expect(read(client)).rejects.toMatchObject({ code: 'connector.unavailable' })
  })

  it('requests distinct paths, Team scopes and Action languages', async () => {
    const { client, calls } = setup()
    await client.searchActions('send', undefined, 'team-a', 'en')
    await client.searchActions('send', undefined, 'team-a', 'zh-CN')
    await client.searchActions('send', undefined, 'team-b', 'en')
    await client.searchActions('find', undefined, 'team-a', 'en')
    expect(calls.filter((call) => call.path.startsWith('/v1/actions')).every((call) => !call.headers.has('if-none-match'))).toBe(true)
    await client.listAllConnections(undefined, 'team-a')
    await client.listConnections('mail', undefined, 'team-a')
    expect(calls.at(-1)?.headers.has('if-none-match')).toBe(false)
  })

  it('reads Connections again after failures or malformed data', async () => {
    const { client, fetcher, calls } = setup()
    const first = await client.listAllConnections()
    fetcher.mockResolvedValueOnce(Response.json({ success: false }, { status: 403 }))
    await expect(client.listAllConnections()).rejects.toMatchObject({ code: 'connector.unavailable' })
    fetcher.mockResolvedValueOnce(Response.json({ success: true, data: [{}] }, { headers: { etag: '"invalid"' } }))
    await expect(client.listAllConnections()).rejects.toMatchObject({ code: 'connector.unavailable' })
    expect(await client.listAllConnections()).toEqual(first)
    expect(calls.at(-1)?.headers.get('if-none-match')).toBeNull()
  })

  it('keeps concurrent Connection reads independent and rejects cancellation', async () => {
    const { client, fetcher, calls } = setup()
    const pending = Promise.withResolvers<Response>()
    fetcher.mockReturnValueOnce(pending.promise)
    const first = client.listAllConnections()
    await client.listAllConnections()
    pending.resolve(Response.json({ success: true, data: [] }, { headers: { etag: '"late"' } }))
    await first
    const controller = new AbortController()
    fetcher.mockImplementationOnce(async () => {
      controller.abort()
      return Response.json({ success: true, data: [] }, { headers: { etag: '"cancelled"' } })
    })
    await expect(client.listAllConnections(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    await client.listAllConnections()
    expect(calls.at(-1)?.headers.get('if-none-match')).toBeNull()
  })

  it('enforces the combined Action catalog budget after previous successful reads', async () => {
    const client = new ConnectorClient('https://connector.example', 'token')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (new Headers(init?.headers).has('if-none-match')) return new Response(null, { status: 304 })
        const url = new URL(String(input))
        const service = url.searchParams.get('service')!
        const data =
          url.pathname == '/v1/providers'
            ? ['a', 'b'].map((id) => Object.assign({}, provider, { service: id }))
            : url.pathname.startsWith('/v1/apps')
              ? []
              : [{ ...action, id: `${service}.send`, service, description: 'x'.repeat(4_300_000) }]
        return Response.json({ success: true, data }, { headers: { etag: '"cached"' } })
      }),
    )
    await client.listActions('a')
    await client.listActions('b')
    await expect(client.listActions()).rejects.toMatchObject({ code: 'connector.unavailable' })
  })
})
