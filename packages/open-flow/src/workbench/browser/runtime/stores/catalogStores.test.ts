import { expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { actionWithConnections } from '../connectionCatalog.ts'
import { CatalogStores } from './catalogStores.ts'
import { resourceValue } from './resource.ts'

const connection = { connectionId: 'account', serviceId: 'mail', displayName: 'Account', isDefault: true, status: 'active' }
const action = {
  operationType: 'write',
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
    if (url.pathname.includes('/action-metadata/')) return Response.json({ version: 1, action })
    const data = url.pathname.endsWith('/providers')
      ? [{ service: 'mail', displayName: url.searchParams.get('locale')!, authTypes: ['oauth2'], extra: 'preserved' }]
      : url.pathname.endsWith('/actions')
        ? [
            {
              operationType: 'write',
              id: 'mail.send',
              service: 'mail',
              name: 'Send',
              description: 'Send mail',
              inputSchema: { type: 'object', properties: {} },
              outputSchema: { type: 'object', properties: {} },
            },
          ]
        : [{ id: 'account', service: 'mail', displayName: 'Account', isDefault: true, status: 'active' }]
    return Response.json(url.pathname.endsWith('/action-metadata') ? { version: 1, actions: [action] } : { success: true, data }, {
      headers: { etag: '"one"' },
    })
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
  expect(await resourceValue(detail)).not.toHaveProperty('defaultConnection')
  expect(test.request).toHaveBeenCalledTimes(4)
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
    return Response.json({ success: true, data: [] })
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
  expect(test.localStorage.entries.size).toBe(2)
  expect(test.sessionStorage.entries.size).toBe(1)
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
  test.request.mockImplementation(async () => Response.json({ success: true, data: [{ ...connection, id: 'new-account', service: 'mail' }] }))
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

it('rejects old Flow envelopes at Proxy endpoints', async () => {
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
  expect(String(test.request.mock.calls[0]?.[0])).toBe('/v1/connector/proxy/actions?flowId=flow&service=mail&locale=en')
  expect(new Headers(test.request.mock.calls[0]?.[1]?.headers).has('if-none-match')).toBe(false)
  expect([...test.localStorage.entries.keys()].some((key) => key.startsWith('open-flow:proxy:actions:v1:'))).toBe(true)
  stores.dispose()
})

it('preserves upstream response fields in storage and shares one Apps response across service views', async () => {
  const test = setup()
  const stores = test.create()
  await resourceValue(stores.providers.get('flow', 'en'))
  const persisted = JSON.parse([...test.localStorage.entries.values()][0]!).data
  expect(persisted).toMatchObject({ success: true, data: [{ extra: 'preserved', authTypes: ['oauth2'] }] })
  const all = stores.connections.get(undefined, 'flow')
  const mail = stores.connections.get('mail', 'flow')
  const other = stores.connections.get('other', 'flow')
  await Promise.all([resourceValue(all), resourceValue(mail), resourceValue(other)])
  expect(all.value.data).toEqual(mail.value.data)
  expect(other.value.data).toEqual([])
  expect(test.request.mock.calls.filter(([path]) => String(path).includes('/proxy/apps'))).toHaveLength(1)
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  test.request.mockImplementation(async () =>
    Response.json({
      success: true,
      data: [{ id: 'other', service: 'other', displayName: 'Built in', status: 'active', isDefault: true, marketplace: { id: 'oomol' } }],
    }),
  )
  stores.connections.get('mail', 'flow', true)
  await vi.waitFor(() => expect(other.value.data?.[0]).toMatchObject({ connectionId: 'other', builtInAccount: true }))
  expect(mail.value.data).toEqual([])
  expect(all.value.data).toEqual(other.value.data)
  stores.dispose()
})

it('requests repeated searches without validators or persistence', async () => {
  const test = setup()
  const stores = test.create()
  for (let i = 0; i < 2; i++) {
    const controller = new AbortController()
    await resourceValue(stores.actions.search('send', 'flow', 'en', controller.signal).get())
    controller.abort()
  }
  expect(test.request).toHaveBeenCalledTimes(2)
  for (const [path, init] of test.request.mock.calls) {
    expect(path).toBe('/v1/connector/action-metadata?flowId=flow&q=send&locale=en')
    expect(new Headers(init?.headers).has('if-none-match')).toBe(false)
  }
  expect(test.localStorage.entries.size).toBe(0)
  expect(test.sessionStorage.entries.size).toBe(0)
  stores.dispose()
})

it.each([
  [403, { success: false, errorCode: 'permission_denied', message: 'No access' }, 'permission_denied'],
  [503, { error: { code: 'connector.unconfigured', message: 'Not configured' } }, 'connector.unconfigured'],
  [200, { success: false, errorCode: 'catalog_failed', message: 'Unavailable' }, 'catalog_failed'],
])('retains proxy and Flow error codes for status %s', async (status, body, code) => {
  const test = setup()
  test.request.mockImplementation(async () => Response.json(body, { status }))
  const stores = test.create()
  await expect(resourceValue(stores.providers.get('flow', 'en'))).rejects.toMatchObject({ code })
  expect(test.localStorage.entries.size).toBe(0)
  stores.dispose()
})

it('derives Action ports and authentication from independent Proxy responses', async () => {
  const test = setup()
  test.request.mockImplementation(async (path) =>
    Response.json({
      success: true,
      data: String(path).includes('/providers')
        ? [{ service: 'mail', displayName: 'Mail', authTypes: ['no_auth', 'api_key'] }]
        : [
            {
              id: 'mail.send',
              service: 'mail',
              name: 'Send',
              description: '',
              inputSchema: { type: 'object', properties: { to: { type: 'string' }, limit: { type: 'integer', default: 10 } }, required: ['to'] },
              outputSchema: { type: 'object', properties: { sent: { type: 'boolean' } }, required: ['sent'] },
            },
          ],
    }),
  )
  const stores = test.create()
  const [item] = await resourceValue(stores.actions.get('mail', 'flow', 'en'))
  expect(item).toMatchObject({
    authenticated: false,
    inputs: { to: { nullable: false }, limit: { nullable: true, value: 10 } },
    outputs: { sent: { nullable: false } },
  })
  expect(item).not.toHaveProperty('noSetup')
  const persisted = JSON.parse([...test.localStorage.entries].find(([key]) => key.includes(':actions:'))![1]).data
  expect(persisted.data[0]).not.toHaveProperty('authenticated')
  expect(persisted.data[0]).not.toHaveProperty('serviceName')
  expect(persisted.data[0]).toHaveProperty('inputSchema')
  stores.dispose()
})

it('preserves operation types through proxy lists, cached responses and metadata search', async () => {
  const test = setup()
  const first = test.create()
  expect(await resourceValue(first.actions.get('mail', 'flow', 'en'))).toMatchObject([{ operationType: 'write' }])
  first.dispose()
  const restored = test.create()
  expect(restored.actions.get('mail', 'flow', 'en').value.data).toMatchObject([{ operationType: 'write' }])
  const controller = new AbortController()
  const search = restored.actions.search('Send', 'flow', 'en', controller.signal)
  expect(await resourceValue(search.get())).toMatchObject([{ operationType: 'write' }])
  controller.abort()
  restored.dispose()
})

it('reuses search responses within one panel and refreshes them without hiding cached data', async () => {
  const test = setup()
  const stores = test.create()
  const panel = new AbortController()
  try {
    const first = stores.actions.search('send', 'flow', 'en', panel.signal)
    await resourceValue(first.get())
    await first.refresh()
    let complete!: (response: Response) => void
    test.request.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve
        }),
    )
    const repeated = stores.actions.search(' send ', 'flow', 'en', panel.signal)
    expect(repeated).toBe(first)
    expect(repeated.get().value.data?.[0]?.name).toBe('Send')
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'))
    expect(repeated.state.value.refreshing).toBe(true)
    complete(Response.json({ version: 1, actions: [{ ...action, name: 'Updated' }] }))
    await resourceValue(repeated.state, undefined, true)
    await repeated.refresh()
    expect(repeated.state.value.data?.[0]?.name).toBe('Updated')

    test.request.mockRejectedValueOnce(new Error('Offline'))
    stores.actions.search('send', 'flow', 'en', panel.signal)
    await vi.waitFor(() => expect(repeated.state.value.error).toBeInstanceOf(Error))
    expect(repeated.state.value.data?.[0]?.name).toBe('Updated')
    expect(test.localStorage.entries.size).toBe(0)
  } finally {
    panel.abort()
    stores.dispose()
  }
})

it('isolates search identities and releases results when the panel closes', async () => {
  const test = setup()
  const stores = test.create()
  const panel = new AbortController()
  const nextPanel = new AbortController()
  try {
    const first = stores.actions.search('send', 'flow', 'en', panel.signal)
    await resourceValue(first.get())
    for (const [query, flow, locale] of [
      ['other', 'flow', 'en'],
      ['send', 'other-flow', 'en'],
      ['send', 'flow', 'zh-CN'],
    ] as const) {
      const separate = stores.actions.search(query, flow, locale, panel.signal)
      expect(separate).not.toBe(first)
      expect(separate.state.value.data).toBeUndefined()
    }
    panel.abort()
    expect(first.state.value.error).toBeDefined()
    const reopened = stores.actions.search('send', 'flow', 'en', nextPanel.signal)
    expect(reopened).not.toBe(first)
    expect(reopened.state.value.data).toBeUndefined()
    await resourceValue(reopened.get())
    expect(test.request).toHaveBeenCalledTimes(2)
  } finally {
    panel.abort()
    nextPanel.abort()
    stores.dispose()
  }
})

it('loads draft Action metadata when the Flow catalogs contain no authorized Providers or Actions', async () => {
  const test = setup()
  test.request.mockImplementation(async (path) => {
    if (String(path).includes('/action-metadata/mail.send?')) return Response.json({ version: 1, action })
    return Response.json({ success: true, data: [] })
  })
  const stores = test.create()
  expect(await resourceValue(stores.actions.get('mail', 'flow', 'en'))).toEqual([])
  expect(await resourceValue(stores.actions.detail('mail.send', 'flow', 'en'))).toEqual(action)
  expect(await resourceValue(stores.connections.get('mail', 'flow'))).toEqual([])
  stores.dispose()
})

it('keeps Action detail scopes and locales independent and retries a failed detail immediately', async () => {
  const test = setup()
  test.request.mockImplementation(async (path) => {
    const params = new URL(String(path), 'https://test.invalid').searchParams
    return Response.json({ version: 1, action: { ...action, description: `${params.get('flowId')}:${params.get('locale')}` } })
  })
  const stores = test.create()
  expect((await resourceValue(stores.actions.detail('mail.send', 'a', 'en'))).description).toBe('a:en')
  expect((await resourceValue(stores.actions.detail('mail.send', 'b', 'en'))).description).toBe('b:en')
  expect((await resourceValue(stores.actions.detail('mail.send', 'a', 'zh-CN'))).description).toBe('a:zh-CN')
  test.request.mockResolvedValueOnce(Response.json({ error: { code: 'connector.action-not-found', message: 'Removed action.' }, version: 1 }, { status: 404 }))
  const failed = stores.actions.detail('mail.send', 'c', 'en')
  await expect(resourceValue(failed)).rejects.toMatchObject({ code: 'connector.action-not-found' })
  stores.actions.detail('mail.send', 'c', 'en', true)
  await vi.waitFor(() => expect(failed.value.data?.description).toBe('c:en'))
  expect(failed.value.error).toBeUndefined()
  expect(test.localStorage.entries.size).toBe(0)
  stores.dispose()
})

it('rejects mismatched Action details', async () => {
  const test = setup()
  test.request.mockResolvedValue(Response.json({ version: 1, action: { ...action, actionId: 'mail.other' } }))
  const stores = test.create()
  await expect(resourceValue(stores.actions.detail('mail.send', 'flow', 'en'))).rejects.toThrow()
  stores.dispose()
})
