import type { ProxyResponse } from './proxyCatalog.ts'

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
  const entries = new Map<string, { data: ProxyResponse; etag: string | null }>()
  const cache = {
    entries,
    get: async (key: string): Promise<unknown> => entries.get(key),
    set: async (key: string, value: unknown): Promise<void> => {
      entries.set(key, value as { data: ProxyResponse; etag: string | null })
    },
  }
  const sessionStorage = storage()
  const request = vi.fn(async (path: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = new URL(String(path), 'https://test.invalid')
    if (url.pathname == '/v1/connector/connections') return Response.json({ version: 1, connections: [connection] }, { headers: { etag: '"one"' } })
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
  const create = () => new CatalogStores(new WorkbenchClient(request), { storage: cache }, { storage: sessionStorage })
  return { create, cache, sessionStorage, request }
}

it('persists Provider and Action response objects, Connections in session storage, and no connection snapshots in Actions', async () => {
  const test = setup()
  const stores = test.create()
  await resourceValue(stores.providers.get('flow', 'en'))
  await resourceValue(stores.actions.get('mail', 'flow', 'en'))
  await resourceValue(stores.connections.get('mail', 'flow'))
  const detail = stores.actions.detail('mail.send', 'flow', 'en')
  expect(detail).toBe(stores.actions.detail('mail.send', 'flow', 'en'))
  expect(await resourceValue(detail)).not.toHaveProperty('defaultConnection')
  expect(test.request).toHaveBeenCalledTimes(3)
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(test.cache.entries.size).toBe(2)
  expect(test.sessionStorage.entries.size).toBe(1)
  const persisted = [...test.cache.entries].find(([key]) => key.startsWith('actions:'))![1]
  expect(JSON.stringify(persisted)).not.toContain('defaultConnection')
  expect(JSON.stringify(persisted)).not.toContain('account')
  stores.dispose()
})

it('isolates locales, services and scopes and restores the matching validator across sessions', async () => {
  const test = setup()
  const first = test.create()
  for (const flow of ['a', 'b']) for (const locale of ['en', 'zh-CN']) await resourceValue(first.providers.get(flow, locale))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  first.dispose()
  test.request.mockImplementation(async (_path, init) => {
    expect(new Headers(init?.headers).get('if-none-match')).toBe('"one"')
    return new Response(null, { status: 304, headers: { etag: 'W/"two"' } })
  })
  const second = test.create()
  const state = second.providers.get('a', 'zh-CN')
  await vi.waitFor(() => expect(state.value.data).toBeDefined())
  expect(state.value.data?.[0]?.serviceName).toBe('zh-CN')
  await vi.waitFor(() => expect([...test.cache.entries.values()].some((raw) => raw.etag == 'W/"two"')).toBe(true))
  test.request.mockImplementation(async (_path, init) => {
    expect(new Headers(init?.headers).get('if-none-match')).toBe('W/"two"')
    return Response.json({ success: true, data: [] })
  })
  second.providers.get('a', 'zh-CN', true)
  await vi.waitFor(() => expect(state.value.data).toEqual([]))
  expect([...test.cache.entries.values()].some((raw) => raw.etag === null)).toBe(true)
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
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(test.cache.entries.size).toBe(2)
  expect(test.sessionStorage.entries.size).toBe(1)
  controller.abort()
  stores.dispose()
})

it('ignores invalid stored data and tolerates unavailable storage', async () => {
  const test = setup()
  test.cache.get = async () => ({ invalid: true })
  test.cache.set = async () => {
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
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  const persisted = [...test.cache.entries]
  test.request.mockImplementation(async () => Response.json({ version: 1, connections: [{ ...connection, connectionId: 'new-account' }] }))
  stores.connections.get('mail', 'flow', true)
  await vi.waitFor(() => expect(source.value.data?.[0]?.connectionId).toBe('new-account'))
  expect(actionWithConnections(metadata[0]!, source.value.data).defaultConnection?.connectionId).toBe('new-account')
  expect(stores.actions.get('mail', 'flow', 'en').value.data).toBe(metadata)
  expect(metadata[0]).not.toHaveProperty('defaultConnection')
  expect([...test.cache.entries]).toEqual(persisted)
  expect(actionWithConnections(metadata[0]!, []).defaultConnection).toBeUndefined()
  expect(actionWithConnections({ ...metadata[0]!, authenticated: false }, source.value.data).defaultConnection).toBeUndefined()
  stores.dispose()
})

it('rejects old Flow envelopes at Proxy endpoints', async () => {
  const test = setup()
  test.request.mockImplementation(async () => Response.json({ version: 1, actions: [{ ...action, defaultConnection: connection }] }))
  const stores = test.create()
  await expect(resourceValue(stores.actions.get('mail', 'flow', 'en'))).rejects.toThrow()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(test.cache.entries.size).toBe(0)
  stores.dispose()
})

it('preserves upstream response fields in storage and shares one scoped Connections response across service views', async () => {
  const test = setup()
  const stores = test.create()
  await resourceValue(stores.providers.get('flow', 'en'))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  const persisted = [...test.cache.entries.values()][0]!.data
  expect(persisted).toMatchObject({ success: true, data: [{ extra: 'preserved', authTypes: ['oauth2'] }] })
  const all = stores.connections.get(undefined, 'flow')
  const mail = stores.connections.get('mail', 'flow')
  const other = stores.connections.get('other', 'flow')
  await Promise.all([resourceValue(all), resourceValue(mail), resourceValue(other)])
  expect(all.value.data).toEqual(mail.value.data)
  expect(other.value.data).toEqual([])
  expect(test.request.mock.calls.filter(([path]) => String(path).includes('/connections'))).toHaveLength(1)
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  test.request.mockImplementation(async () =>
    Response.json({
      version: 1,
      connections: [{ connectionId: 'other', serviceId: 'other', displayName: 'Built in', status: 'active', isDefault: true, builtInAccount: true }],
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
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(test.cache.entries.size).toBe(0)
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
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  expect(test.cache.entries.size).toBe(0)
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
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  const persisted = [...test.cache.entries].find(([key]) => key.startsWith('actions:'))![1].data
  expect(persisted.data[0]).not.toHaveProperty('authenticated')
  expect(persisted.data[0]).not.toHaveProperty('serviceName')
  expect(persisted.data[0]).toHaveProperty('inputSchema')
  stores.dispose()
})

it('preserves operation types through proxy lists, cached responses and metadata search', async () => {
  const test = setup()
  const first = test.create()
  expect(await resourceValue(first.actions.get('mail', 'flow', 'en'))).toMatchObject([{ operationType: 'write' }])
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  first.dispose()
  const restored = test.create()
  expect(await resourceValue(restored.actions.get('mail', 'flow', 'en'))).toMatchObject([{ operationType: 'write' }])
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
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(test.cache.entries.size).toBe(0)
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

it('shares one provider response across Actions, concurrent detail reads, and list browsing without reading Connections', async () => {
  const test = setup()
  const request = test.request.getMockImplementation()!
  test.request.mockImplementation(async (path, init) => {
    const response = await request(path, init)
    if (!String(path).includes('/proxy/actions?')) return response
    const body = await response.json()
    body.data.push({ ...body.data[0], id: 'mail.read', name: 'Read' })
    return Response.json(body)
  })
  const stores = test.create()
  const [send, read, list] = await Promise.all([
    resourceValue(stores.actions.detail('mail.send', 'flow', 'en')),
    resourceValue(stores.actions.detail('mail.read', 'flow', 'en')),
    resourceValue(stores.actions.get('mail', 'flow', 'en')),
  ])
  expect(send.actionId).toBe('mail.send')
  expect(read.actionId).toBe('mail.read')
  expect(list).toEqual([send, read])
  await resourceValue(stores.actions.detail('mail.send', 'flow', 'en'))
  expect(test.request.mock.calls.map(([path]) => String(path)).toSorted()).toEqual([
    '/v1/connector/proxy/actions?flowId=flow&service=mail&locale=en',
    '/v1/connector/proxy/providers?flowId=flow&locale=en',
  ])
  stores.dispose()
})

it('keeps Action detail scopes and locales independent and retries a failed provider list immediately', async () => {
  const test = setup()
  const request = test.request.getMockImplementation()!
  test.request.mockImplementation(async (path, init) => {
    const response = await request(path, init)
    if (!String(path).includes('/proxy/actions?')) return response
    const body = await response.json()
    const params = new URL(String(path), 'https://test.invalid').searchParams
    body.data[0].description = `${params.get('flowId')}:${params.get('locale')}`
    return Response.json(body)
  })
  const stores = test.create()
  expect((await resourceValue(stores.actions.detail('mail.send', 'a', 'en'))).description).toBe('a:en')
  expect((await resourceValue(stores.actions.detail('mail.send', 'b', 'en'), undefined, true)).description).toBe('b:en')
  expect((await resourceValue(stores.actions.detail('mail.send', 'a', 'zh-CN'))).description).toBe('a:zh-CN')
  test.request.mockResolvedValueOnce(Response.json({ error: { code: 'connector.unavailable', message: 'Unavailable.' }, version: 1 }, { status: 502 }))
  const failed = stores.actions.detail('mail.send', 'c', 'en')
  await expect(resourceValue(failed, undefined, true)).rejects.toMatchObject({ code: 'connector.unavailable' })
  stores.actions.detail('mail.send', 'c', 'en', true)
  await vi.waitFor(() => expect(failed.value.data?.description).toBe('c:en'))
  expect(failed.value.error).toBeUndefined()
  stores.dispose()
})

it('reports a missing Action without preventing other Actions in the provider from loading', async () => {
  const test = setup()
  const stores = test.create()
  await expect(resourceValue(stores.actions.detail('mail.removed', 'flow', 'en'))).rejects.toMatchObject({ code: 'connector.action-not-found' })
  expect((await resourceValue(stores.actions.detail('mail.send', 'flow', 'en'))).actionId).toBe('mail.send')
  expect(test.request).toHaveBeenCalledTimes(2)
  stores.dispose()
})

it('keeps valid Actions when individual records cannot be decoded and retries them on refresh', async () => {
  let repaired = false
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const valid = { id: 'notion.search', service: 'notion', name: 'Search', description: '', inputSchema: { type: 'object' }, outputSchema: { type: 'object' } }
  const stores = new CatalogStores(
    new WorkbenchClient(async (path) =>
      Response.json({
        success: true,
        data: String(path).includes('/providers')
          ? [{ service: 'notion', displayName: 'Notion', authTypes: ['oauth2'] }]
          : repaired
            ? [valid, { ...valid, id: 'notion.update' }]
            : [valid, null, { ...valid, id: 'notion.update', inputSchema: { oneOf: [{ type: 'object' }] } }, { ...valid, service: 'other' }],
      }),
    ),
  )
  try {
    expect((await resourceValue(stores.actions.get('notion'))).map((item) => item.actionId)).toEqual(['notion.search'])
    expect(warning).toHaveBeenCalledTimes(3)
    await expect(resourceValue(stores.actions.detail('notion.update'))).rejects.toMatchObject({ code: 'connector.action-not-found' })
    repaired = true
    const refreshed = stores.actions.get('notion', undefined, 'en', true)
    await vi.waitFor(() => expect(refreshed.value.data?.map((item) => item.actionId)).toEqual(['notion.search', 'notion.update']))
  } finally {
    stores.dispose()
    warning.mockRestore()
  }
})

it('uses only Flow-authorized accounts for selection and defaults, and refreshes after revocation', async () => {
  const test = setup()
  const unauthorized = { ...connection, connectionId: 'unauthorized', isDefault: true }
  const authorized = { ...connection, isDefault: false }
  let revoked = false
  test.request.mockImplementation(async (path) => {
    const url = new URL(String(path), 'https://test.invalid')
    if (url.pathname != '/v1/connector/connections') throw new Error(`Unexpected account source: ${path}`)
    return Response.json({ version: 1, connections: url.searchParams.get('flowId') == 'flow' ? (revoked ? [] : [authorized]) : [unauthorized] })
  })
  const stores = test.create()
  try {
    const selected = stores.connections.get('mail', 'flow')
    expect(selected.value.data).toBeUndefined()
    expect(await resourceValue(selected)).toEqual([authorized])
    expect(actionWithConnections(action, selected.value.data).defaultConnection?.connectionId).toBe('account')
    expect(await resourceValue(stores.connections.get('mail', 'other-flow'))).toEqual([unauthorized])
    expect(selected.value.data).toEqual([authorized])
    revoked = true
    stores.connections.refreshFlow('flow')
    await vi.waitFor(() => expect(selected.value.data).toEqual([]))
    expect(actionWithConnections(action, selected.value.data).defaultConnection).toBeUndefined()
    expect(stores.connections.get('mail', 'other-flow').value.data).toEqual([unauthorized])
  } finally {
    stores.dispose()
  }
})

it('restores scoped Connections and revalidates with their own validator', async () => {
  const test = setup()
  const first = test.create()
  await resourceValue(first.connections.get('mail', 'flow'))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  first.dispose()
  test.request.mockImplementation(async (_path, init) => {
    expect(new Headers(init?.headers).get('if-none-match')).toBe('"one"')
    return new Response(null, { status: 304 })
  })
  const restored = test.create()
  try {
    const source = restored.connections.get('mail', 'flow')
    await vi.waitFor(() => expect(source.value.data).toEqual([connection]))
    await vi.waitFor(() => expect(test.request).toHaveBeenCalledTimes(2))
    expect(await resourceValue(source, undefined, true)).toEqual([connection])
  } finally {
    restored.dispose()
  }
})

it('preserves sprite metadata in raw caches and derives it for Providers and Actions after restoration', async () => {
  const test = setup()
  const iconSprite = {
    version: 'v1',
    pixelRatio: 2,
    iconSize: 48,
    bleed: 2,
    width: 104,
    height: 52,
    lightUrl: 'https://example.com/light.png',
    darkUrl: 'https://example.com/dark.png',
  }
  const iconSpritePosition = { x: 54, y: 2 }
  const original = test.request.getMockImplementation()!
  test.request.mockImplementation(async (path, init) => {
    const response = await original(path, init)
    if (!String(path).includes('/providers')) return response
    const body = await response.json()
    body.meta = { iconSprite }
    body.data[0].iconSpritePosition = iconSpritePosition
    return Response.json(body, { headers: response.headers })
  })
  const first = test.create()
  expect((await resourceValue(first.providers.get()))![0]).toMatchObject({ iconSprite, iconSpritePosition })
  expect((await resourceValue(first.actions.get('mail')))![0]).toMatchObject({ iconSprite, iconSpritePosition })
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  first.dispose()
  test.request.mockImplementation(async () => new Response(null, { status: 304 }))
  const second = test.create()
  expect((await resourceValue(second.providers.get()))![0]).toMatchObject({ iconSprite, iconSpritePosition })
  expect((await resourceValue(second.actions.get('mail')))![0]).toMatchObject({ iconSprite, iconSpritePosition })
  second.dispose()
})

it('shares persisted catalogs across Flows while preserving Flow-scoped requests and memory resources', async () => {
  const values = new Map<string, unknown>()
  const cache = {
    storage: {
      get: async (key: string) => values.get(key),
      set: async (key: string, value: unknown) => {
        values.set(key, value)
      },
    },
  }
  const provider = { service: 'mail', displayName: 'Mail', authTypes: ['oauth2'] }
  const metadata = { id: 'mail.send', service: 'mail', name: 'Send', description: 'Send mail', inputSchema: {}, outputSchema: {} }
  const request = vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
    if (String(path).includes('flowId=b')) {
      expect(new Headers(init?.headers).get('if-none-match')).toBe('"catalog"')
      return new Response(null, { status: 304 })
    }
    return Response.json({ success: true, data: [String(path).includes('/providers?') ? provider : metadata] }, { headers: { etag: '"catalog"' } })
  })
  const stores = new CatalogStores(new WorkbenchClient(request), cache)
  try {
    const first = stores.actions.get('mail', 'a', 'en')
    await resourceValue(first, undefined, true)
    await vi.waitFor(() => expect(values.size).toBe(2))
    const second = stores.actions.get('mail', 'b', 'en')
    expect(second).not.toBe(first)
    expect(await resourceValue(second, undefined, true)).toEqual(first.value.data)
    expect(request.mock.calls.map(([path]) => String(path)).toSorted()).toEqual([
      '/v1/connector/proxy/actions?flowId=a&service=mail&locale=en',
      '/v1/connector/proxy/actions?flowId=b&service=mail&locale=en',
      '/v1/connector/proxy/providers?flowId=a&locale=en',
      '/v1/connector/proxy/providers?flowId=b&locale=en',
    ])
    expect(values.size).toBe(2)
    expect([...values.keys()].every((key) => !key.includes('flowId'))).toBe(true)
  } finally {
    stores.dispose()
  }
})
