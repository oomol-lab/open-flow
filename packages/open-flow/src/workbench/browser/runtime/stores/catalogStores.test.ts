import { expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
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
  defaultConnection: connection,
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
      : url.pathname.endsWith('/actions')
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
