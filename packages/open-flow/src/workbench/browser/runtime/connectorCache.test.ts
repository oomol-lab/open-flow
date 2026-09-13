import type { WorkbenchHost } from './contract.ts'

import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from './api.ts'

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
]
function setup() {
  const localStorage = storage()
  const sessionStorage = storage()
  const options = { namespace: 'deployment', localStorage, sessionStorage }
  const request = vi.fn(async (_path: string, _init?: RequestInit): Promise<Response> => Response.json(cases[0]!.body, { headers: { etag: '"one"' } }))
  const client = (cache: WorkbenchHost['connectorCache'] = options) => new WorkbenchClient(request, undefined, undefined, cache)
  return { client, localStorage, sessionStorage, options, request }
}

describe('Connector browser caches', () => {
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

  it('does not return stale connections on failure and replaces them after a successful refresh', async () => {
    const test = setup()
    const read = cases[4]!.read
    test.request.mockImplementation(async () => Response.json(cases[4]!.body, { headers: { etag: '"one"' } }))
    await read(test.client())
    test.request.mockImplementation(async () => Response.json({ error: { message: 'Signed out' } }, { status: 401 }))
    await expect(read(test.client())).rejects.toMatchObject({ status: 401 })
    test.request.mockImplementation(async () => Response.json({ connections: [], serviceId: 'mail', version: 1 }, { headers: { etag: '"two"' } }))
    expect(await read(test.client())).toEqual([])
    test.request.mockImplementation(async () => new Response(null, { status: 304 }))
    expect(await read(test.client())).toEqual([])
    expect(new Headers(test.request.mock.calls[3]?.[1]?.headers).get('if-none-match')).toBe('"two"')
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
