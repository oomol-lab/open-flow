import { expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { actionWithConnections } from '../workspace.ts'
import { CatalogStores } from './catalogStores.ts'
import { resourceValue } from './resource.ts'

const connection = { connectionId: 'account', serviceId: 'mail', displayName: 'Account', isDefault: true, status: 'active' }
const action = {
  actionId: 'mail.send',
  serviceId: 'mail',
  serviceName: 'Mail',
  name: 'Send',
  description: 'Send mail',
  authenticated: true,
  inputs: {},
  outputs: {},
}
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
function setup() {
  const localStorage = storage()
  const sessionStorage = storage()
  const request = vi.fn(async (path: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = new URL(String(path), 'https://test.invalid')
    const data = url.pathname.endsWith('/providers')
      ? { providers: [{ serviceId: 'mail', serviceName: url.searchParams.get('locale')! }] }
      : url.pathname.endsWith('/action-metadata')
        ? { actions: [action] }
        : { connections: [connection], ...(url.pathname.endsWith('/mail') ? { serviceId: 'mail' } : {}) }
    return Response.json({ version: 1, ...data }, { headers: { etag: '"one"' } })
  })
  const create = () => new CatalogStores(new WorkbenchClient(request), { namespace: 'test', localStorage, sessionStorage })
  return { create, localStorage, sessionStorage, request }
}

it('stores Providers and Action lists locally, Connections in session storage, and no connection snapshots in Actions', async () => {
  const test = setup()
  const stores = test.create()
  await resourceValue(stores.providers.get('flow', 'en'))
  await resourceValue(stores.actions.get('mail', 'flow', 'en'))
  await resourceValue(stores.connections.get('mail', 'flow'))
  const detail = stores.actions.detail('mail.send', 'flow', 'en')
  expect(detail).toBe(stores.actions.detail('mail.send', 'flow', 'en'))
  expect(detail.value.data).not.toHaveProperty('defaultConnection')
  expect(test.request).toHaveBeenCalledTimes(3)
  expect(test.localStorage.entries.size).toBe(2)
  expect(test.sessionStorage.entries.size).toBe(1)
  const persisted = [...test.localStorage.entries].find(([key]) => key.includes(':actions:'))![1]
  expect(persisted).not.toContain('defaultConnection')
  expect(persisted).not.toContain('account')
  stores.dispose()
})

it('isolates locales, services and scopes and restores the matching validator across sessions', async () => {
  const test = setup()
  const first = test.create()
  for (const flow of ['a', 'b']) for (const locale of ['en', 'zh-CN']) await resourceValue(first.providers.get(flow, locale))
  first.dispose()
  test.request.mockImplementation(async (_path, init) => {
    expect(new Headers(init?.headers).get('if-none-match')).toBe('"one"')
    return new Response(null, { status: 304, headers: { etag: 'W/"two"' } })
  })
  const second = test.create()
  const state = second.providers.get('a', 'zh-CN')
  expect(state.value.data?.[0]?.serviceName).toBe('zh-CN')
  await vi.waitFor(() => expect([...test.localStorage.entries.values()].some((raw) => JSON.parse(raw).etag == 'W/"two"')).toBe(true))
  test.request.mockImplementation(async (_path, init) => {
    expect(new Headers(init?.headers).get('if-none-match')).toBe('W/"two"')
    return Response.json({ version: 1, providers: [] })
  })
  second.providers.get('a', 'zh-CN', true)
  await vi.waitFor(() => expect(state.value.data).toEqual([]))
  expect([...test.localStorage.entries.values()].some((raw) => JSON.parse(raw).etag === null)).toBe(true)
  second.dispose()
})

it('keeps searches transient and connection refresh independent of Action data', async () => {
  const test = setup()
  const stores = test.create()
  const list = stores.actions.get('mail', 'flow', 'en')
  await resourceValue(list)
  const before = list.value.data
  const controller = new AbortController()
  const search = stores.actions.search('send', 'flow', 'en', controller.signal)
  await resourceValue(search.get())
  await resourceValue(stores.connections.get('mail', 'flow'))
  await resourceValue(stores.connections.get(undefined, 'flow'))
  expect(list.value.data).toBe(before)
  expect(test.localStorage.entries.size).toBe(1)
  expect(test.sessionStorage.entries.size).toBe(2)
  controller.abort()
  stores.dispose()
})

it('ignores invalid stored data and tolerates unavailable storage', async () => {
  const test = setup()
  test.localStorage.getItem = () => '{broken'
  test.localStorage.setItem = () => {
    throw new Error('quota')
  }
  const stores = test.create()
  expect(await resourceValue(stores.providers.get('flow', 'en'))).toHaveLength(1)
  expect(new Headers(test.request.mock.calls[0]?.[1]?.headers).has('if-none-match')).toBe(false)
  stores.dispose()
})

it('updates the selected account from Connections without changing Action metadata or its validator', async () => {
  const test = setup()
  const stores = test.create()
  const metadata = await resourceValue(stores.actions.get('mail', 'flow', 'en'))
  const source = stores.connections.get('mail', 'flow')
  const initial = await resourceValue(source)
  // Let the initial request finish before changing the account in this scenario.
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(actionWithConnections(metadata[0]!, initial).defaultConnection?.connectionId).toBe('account')
  const persisted = [...test.localStorage.entries]
  test.request.mockImplementation(async () => Response.json({ version: 1, serviceId: 'mail', connections: [{ ...connection, connectionId: 'new-account' }] }))
  stores.connections.get('mail', 'flow', true)
  await vi.waitFor(() => expect(source.value.data?.[0]?.connectionId).toBe('new-account'))
  expect(actionWithConnections(metadata[0]!, source.value.data).defaultConnection?.connectionId).toBe('new-account')
  expect(stores.actions.get('mail', 'flow', 'en').value.data).toBe(metadata)
  expect(metadata[0]).not.toHaveProperty('defaultConnection')
  expect([...test.localStorage.entries]).toEqual(persisted)
  expect(actionWithConnections(metadata[0]!, []).defaultConnection).toBeUndefined()
  expect(actionWithConnections({ ...metadata[0]!, authenticated: false }, source.value.data).defaultConnection).toBeUndefined()
  stores.dispose()
})

it('rejects account snapshots in Action responses instead of silently stripping them', async () => {
  const test = setup()
  test.request.mockImplementation(async () => Response.json({ version: 1, actions: [{ ...action, defaultConnection: connection }] }))
  const stores = test.create()
  await expect(resourceValue(stores.actions.get('mail', 'flow', 'en'))).rejects.toThrow()
  expect(test.localStorage.entries.size).toBe(0)
  stores.dispose()
})

it('does not reuse the old combined Action validator for the metadata endpoint', async () => {
  const test = setup()
  test.localStorage.setItem('open-flow:actions:v2:test:["flow","mail","en"]', JSON.stringify({ data: [action], etag: '"combined"' }))
  const stores = test.create()
  await resourceValue(stores.actions.get('mail', 'flow', 'en'))
  expect(String(test.request.mock.calls[0]?.[0])).toBe('/v1/connector/action-metadata?flowId=flow&service=mail&locale=en')
  expect(new Headers(test.request.mock.calls[0]?.[1]?.headers).has('if-none-match')).toBe(false)
  expect([...test.localStorage.entries.keys()].some((key) => key.startsWith('open-flow:actions:v3:'))).toBe(true)
  stores.dispose()
})
