import type { WorkbenchHost } from './contract.ts'

import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from './api.ts'
import { cachedConnectorActions, cachedConnectorConnections, cachedConnectorProviders } from './connectorCache.ts'

function storage() {
  const entries = new Map<string, string>()
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value)
    },
  }
}
const provider = { serviceId: 'mail', serviceName: 'Mail' }
const action = { actionId: 'mail.send', authenticated: true, description: '', inputs: {}, outputs: {}, name: 'Send', ...provider }
const connection = { connectionId: 'one', displayName: 'Work', isDefault: true, serviceId: 'mail', status: 'active' }
const cases = [
  { kind: 'providers', body: { providers: [provider], version: 1 }, read: (client: WorkbenchClient) => client.listConnectorProviders(undefined, 'flow') },
  { kind: 'actions', body: { actions: [action], version: 1 }, read: (client: WorkbenchClient) => client.listConnectorActions('mail', undefined, 'flow', 'en') },
  { kind: 'action detail', body: { action, version: 1 }, read: (client: WorkbenchClient) => client.getConnectorAction('mail.send', undefined, 'flow', 'en') },
  {
    kind: 'search',
    body: { actions: [action], version: 1 },
    read: (client: WorkbenchClient) => client.searchConnectorActions('send', undefined, 'flow', 'en'),
  },
  {
    kind: 'connections',
    body: { connections: [connection], serviceId: 'mail', version: 1 },
    read: (client: WorkbenchClient) => client.listConnectorConnections('mail', undefined, 'flow'),
  },
  {
    kind: 'all connections',
    body: { connections: [connection], version: 1 },
    read: (client: WorkbenchClient) => client.listAllConnectorConnections(undefined, 'flow'),
  },
]
function setup() {
  const localStorage = storage()
  const sessionStorage = storage()
  const options = { namespace: 'deployment', localStorage, sessionStorage }
  const request = vi.fn(async (_path: string, _init?: RequestInit): Promise<Response> => Response.json(cases[0]!.body, { headers: { etag: '"one"' } }))
  const client = (cache: WorkbenchHost['connectorCache'] = options) => new WorkbenchClient(request, undefined, undefined, cache)
  return { client, localStorage, sessionStorage, options, request }
}

const entry = (data: unknown) => ({ data, etag: null })

const readFreshConnections = (client: WorkbenchClient) => client.listConnectorConnections('mail', undefined, 'flow', true)

describe('Connector browser caches', () => {
  it('returns persisted providers before the network completes and publishes changed data', async () => {
    const test = setup()
    await test.client().listConnectorProviders()
    const pending = Promise.withResolvers<Response>()
    test.request.mockImplementation(() => pending.promise)
    const client = test.client()
    const changed = vi.fn()
    const stop = client.connectorCache.providers.reaction(changed)
    expect(await client.listConnectorProviders()).toEqual([provider])
    expect(await client.listConnectorProviders()).toEqual([provider])
    expect(test.request).toHaveBeenCalledTimes(2)
    changed.mockClear()
    const updated = { ...provider, serviceName: 'Updated mail' }
    pending.resolve(Response.json({ providers: [updated], version: 1 }, { headers: { etag: '"two"' } }))
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(await client.listConnectorProviders()).toEqual([updated])
    expect(test.request).toHaveBeenCalledTimes(2)
    stop()
  })

  it('uses the latest revalidated Connection snapshot even when its content is unchanged', async () => {
    const test = setup()
    const client = test.client()
    test.request.mockImplementation(async (path) =>
      Response.json(path.includes('/connections/mail') ? { connections: [], serviceId: 'mail', version: 1 } : { connections: [connection], version: 1 }),
    )
    await client.listAllConnectorConnections(undefined, 'flow')
    await client.listConnectorConnections('mail', undefined, 'flow')
    expect(cachedConnectorConnections(client.connectorCache.connections.value, 'flow').mail).toEqual([])
    await client.listAllConnectorConnections(undefined, 'flow', true)
    expect(cachedConnectorConnections(client.connectorCache.connections.value, 'flow').mail).toEqual([connection])
  })

  it('combines full and newer per-service connection snapshots within the current Flow', () => {
    const entries = new Map([
      ['/v1/connector/connections/mail?flowId=flow', entry({ connections: [connection], serviceId: 'mail', version: 1 })],
      ['/v1/connector/connections?flowId=other', entry({ connections: [{ ...connection, serviceId: 'private' }], version: 1 })],
      ['/v1/connector/connections?flowId=flow', entry({ connections: [{ ...connection, serviceId: 'drive' }], version: 1 })],
    ])
    expect(cachedConnectorConnections(entries, 'flow')).toEqual({ mail: [], drive: [{ ...connection, serviceId: 'drive' }] })
    entries.delete('/v1/connector/connections/mail?flowId=flow')
    entries.set('/v1/connector/connections/mail?flowId=flow', entry({ connections: [connection], serviceId: 'mail', version: 1 }))
    expect(cachedConnectorConnections(entries, 'flow')).toEqual({ mail: [connection], drive: [{ ...connection, serviceId: 'drive' }] })
    entries.delete('/v1/connector/connections?flowId=flow')
    entries.set('/v1/connector/connections?flowId=flow', entry({ connections: [], version: 1 }))
    expect(Object.values(cachedConnectorConnections(entries, 'flow')).flat()).toEqual([])
  })

  it('retains cached providers after background failure and backs off retries', async () => {
    const test = setup()
    await test.client().listConnectorProviders()
    test.request.mockRejectedValue(new Error('offline'))
    const client = test.client()
    expect(await client.listConnectorProviders()).toEqual([provider])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await client.listConnectorProviders()).toEqual([provider])
    expect(test.request).toHaveBeenCalledTimes(2)
  })

  it.each(cases)('persists $kind in the appropriate storage and revalidates across clients', async ({ kind, body, read }) => {
    const test = setup()
    test.request.mockImplementation(async () => Response.json(body, { headers: { etag: '"one"' } }))
    const expected = await read(test.client())
    expect(test.localStorage.entries.size).toBe(kind == 'providers' ? 1 : 0)
    expect(test.sessionStorage.entries.size).toBe(kind == 'providers' ? 0 : 1)
    test.request.mockImplementation(async () => new Response(null, { status: 304 }))
    expect(await read(test.client())).toEqual(expected)
    expect(new Headers(test.request.mock.calls[1]?.[1]?.headers).get('if-none-match')).toBe('"one"')
  })

  it.each(cases)('returns cached $kind while its request remains pending', async ({ body, read }) => {
    const test = setup()
    test.request.mockImplementation(async () => Response.json(body))
    const expected = await read(test.client())
    const pending = Promise.withResolvers<Response>()
    test.request.mockImplementation(() => pending.promise)
    const client = test.client()
    expect(await read(client)).toEqual(expected)
    expect(await read(client)).toEqual(expected)
    expect(test.request).toHaveBeenCalledTimes(2)
    pending.resolve(Response.json(body))
  })

  it('publishes changed actions and connections without another caller request', async () => {
    const test = setup()
    test.request.mockImplementation(async (path) => Response.json(path.includes('/connections/') ? cases[4]!.body : cases[2]!.body))
    await cases[2]!.read(test.client())
    await cases[4]!.read(test.client())
    const client = test.client()
    const actionResponse = Promise.withResolvers<Response>()
    const connectionResponse = Promise.withResolvers<Response>()
    test.request.mockImplementation((path) => (path.includes('/connections/') ? connectionResponse.promise : actionResponse.promise))
    expect(await cases[2]!.read(client)).toEqual(action)
    expect(await cases[4]!.read(client)).toEqual([connection])
    actionResponse.resolve(Response.json({ action: { ...action, name: 'Updated' }, version: 1 }))
    connectionResponse.resolve(Response.json({ connections: [], serviceId: 'mail', version: 1 }))
    await vi.waitFor(() => {
      expect(cachedConnectorActions(client.connectorCache.actions.value, 'flow', 'en')['mail.send']?.name).toBe('Updated')
      expect(cachedConnectorConnections(client.connectorCache.connections.value, 'flow')['mail']).toEqual([])
    })
    expect(cachedConnectorActions(client.connectorCache.actions.value, 'other', 'en')).toEqual({})
    expect(cachedConnectorActions(client.connectorCache.actions.value, 'flow', 'zh-CN')).toEqual({})
    expect(cachedConnectorConnections(client.connectorCache.connections.value, 'other')).toEqual({})
  })

  it('isolates deployments, flows, languages, services and search queries', async () => {
    const test = setup()
    test.request.mockImplementation(async () => Response.json({ actions: [action], version: 1 }, { headers: { etag: '"one"' } }))
    await test.client().listConnectorActions('mail', undefined, 'flow', 'en')
    await test.client({ ...test.options, namespace: 'another' }).listConnectorActions('mail', undefined, 'flow', 'en')
    await test.client().listConnectorActions('mail', undefined, 'other', 'en')
    await test.client().listConnectorActions('mail', undefined, 'flow', 'zh-CN')
    await test.client().listConnectorActions('other', undefined, 'flow', 'en')
    await test.client().searchConnectorActions('send', undefined, 'flow', 'en')
    for (const [, init] of test.request.mock.calls) expect(new Headers(init?.headers).has('if-none-match')).toBe(false)
  })

  it.each(['{broken', JSON.stringify({ etag: '"one"', data: { providers: [{}], version: 1 } })])('ignores invalid cache data: %s', async (raw) => {
    const test = setup()
    await test.client().listConnectorProviders()
    for (const key of test.localStorage.entries.keys()) test.localStorage.entries.set(key, raw)
    expect(await test.client().listConnectorProviders()).toEqual([provider])
    expect(new Headers(test.request.mock.calls[1]?.[1]?.headers).has('if-none-match')).toBe(false)
  })

  it('requires fresh connections for explicit refresh and replaces the reactive cache', async () => {
    const test = setup()
    test.request.mockImplementation(async () => Response.json(cases[4]!.body, { headers: { etag: '"one"' } }))
    await readFreshConnections(test.client())
    test.request.mockImplementation(async () => Response.json({ error: { message: 'Signed out' } }, { status: 401 }))
    await expect(readFreshConnections(test.client())).rejects.toMatchObject({ status: 401 })
    test.request.mockImplementation(async () => Response.json({ connections: [], serviceId: 'mail', version: 1 }, { headers: { etag: '"two"' } }))
    expect(await readFreshConnections(test.client())).toEqual([])
    test.request.mockImplementation(async () => new Response(null, { status: 304 }))
    expect(await readFreshConnections(test.client())).toEqual([])
    expect(new Headers(test.request.mock.calls[3]?.[1]?.headers).get('if-none-match')).toBe('"two"')
  })

  it.each(['older-first', 'newer-first'])('resolves concurrent cold connection reads without exposing cache supersession: %s', async (order) => {
    const test = setup()
    const older = Promise.withResolvers<Response>()
    const newer = Promise.withResolvers<Response>()
    test.request.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise)
    const client = test.client()
    const first = cases[4]!.read(client)
    const second = cases[4]!.read(client)
    const olderResponse = Response.json(cases[4]!.body)
    const newerResponse = Response.json({ connections: [], serviceId: 'mail', version: 1 })
    if (order == 'older-first') {
      older.resolve(olderResponse)
      await expect(first).resolves.toEqual([connection])
      newer.resolve(newerResponse)
    } else {
      newer.resolve(newerResponse)
      await expect(second).resolves.toEqual([])
      older.resolve(olderResponse)
    }
    await expect(first).resolves.toEqual([connection])
    await expect(second).resolves.toEqual([])
    expect(cachedConnectorConnections(client.connectorCache.connections.value, 'flow')['mail']).toEqual([])
  })

  it('does not let an older background response overwrite a forced refresh', async () => {
    const test = setup()
    test.request.mockImplementation(async () => Response.json(cases[4]!.body))
    await cases[4]!.read(test.client())
    const pending = Promise.withResolvers<Response>()
    test.request.mockImplementationOnce(() => pending.promise)
    const client = test.client()
    expect(await cases[4]!.read(client)).toEqual([connection])
    test.request.mockImplementation(async () => Response.json({ connections: [], serviceId: 'mail', version: 1 }))
    expect(await readFreshConnections(client)).toEqual([])
    pending.resolve(Response.json(cases[4]!.body))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(cachedConnectorConnections(client.connectorCache.connections.value, 'flow')['mail']).toEqual([])
  })

  it('tolerates unavailable storage and responses without ETags', async () => {
    const test = setup()
    const blocked = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('full')
      },
    }
    expect(await test.client({ namespace: 'test', localStorage: blocked }).listConnectorProviders()).toEqual([provider])
    test.request.mockImplementation(async () => Response.json(cases[0]!.body))
    await test.client().listConnectorProviders()
    await test.client().listConnectorProviders()
    expect(new Headers(test.request.mock.calls[2]?.[1]?.headers).has('if-none-match')).toBe(false)
  })

  it('rejects unexpected 304s and does not persist invalid or cancelled responses', async () => {
    const test = setup()
    test.request.mockImplementation(async () => new Response(null, { status: 304 }))
    await expect(test.client().listConnectorProviders()).rejects.toThrow()
    test.request.mockImplementation(async () => Response.json({ providers: [{}], version: 1 }))
    await expect(test.client().listConnectorProviders()).rejects.toThrow()
    const controller = new AbortController()
    test.request.mockImplementation(async () => {
      controller.abort()
      return Response.json(cases[0]!.body)
    })
    await expect(test.client().listConnectorProviders(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(test.localStorage.entries.size).toBe(0)
  })
})

it('scopes provider display names to the active Flow', () => {
  const entries = new Map([
    ['/v1/connector/providers?flowId=one', { etag: null, data: { providers: [{ serviceId: 'github', serviceName: 'GitHub' }] } }],
    ['/v1/connector/providers?flowId=two', { etag: null, data: { providers: [{ serviceId: 'github', serviceName: 'Other name' }] } }],
  ])
  expect(cachedConnectorProviders(entries, 'one').github?.serviceName).toBe('GitHub')
  expect(cachedConnectorProviders(entries, 'two').github?.serviceName).toBe('Other name')
  expect(cachedConnectorProviders(entries, undefined)).toEqual({})
})
