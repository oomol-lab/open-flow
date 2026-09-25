import { expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { catalogPersistence } from './catalogStorage.ts'
import { resourceValue } from './resource.ts'
import { TriggerCatalogStore } from './triggerCatalog.ts'

it('restores local data, retains replacement 304 ETags and separates languages', async () => {
  const values = new Map<string, unknown>()
  const storage = {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      values.set(key, value)
    },
  }
  const key = catalogPersistence({ storage }, 'triggers', 'en')!.key
  await storage.set(key, { data: { version: 3, locale: 'en', definitions: [], display: {} }, etag: '"old"' })
  const request = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    expect(new Headers(init?.headers).get('if-none-match')).toBe('"old"')
    return new Response(null, { status: 304, headers: { etag: 'W/"new"' } })
  })
  const store = new TriggerCatalogStore(new WorkbenchClient(request), 'en', { catalogCache: { storage } })
  const state = store.get()
  await vi.waitFor(() => expect(state.value.data).toBeDefined())
  expect(state.value.data?.locale).toBe('en')
  await store.refresh()
  await vi.waitFor(() => expect(values.get(key)).toMatchObject({ etag: 'W/"new"' }))
  request.mockImplementation(async (_path, init) => {
    expect(new Headers(init?.headers).has('if-none-match')).toBe(false)
    return Response.json({ version: 3, locale: 'zh-CN', definitions: [], display: {} })
  })
  store.setLanguage('zh-CN')
  expect((await resourceValue(store.get())).locale).toBe('zh-CN')
  store.setLanguage('en')
  expect(store.get().value.data?.locale).toBe('en')
  await vi.waitFor(() => expect(values.size).toBe(2))
  expect(values.size).toBe(2)
  store.dispose()
})

it('rejects a mismatched locale without persisting or publishing it', async () => {
  const storage = { get: async () => null, set: vi.fn(async () => {}) }
  const store = new TriggerCatalogStore(new WorkbenchClient(async () => Response.json({ version: 3, locale: 'en', definitions: [], display: {} })), 'zh-CN', {
    catalogCache: { storage },
  })
  await store.refresh()
  expect(store.state.value.data).toBeUndefined()
  expect(store.state.value.error).toBeInstanceOf(Error)
  expect(storage.set).not.toHaveBeenCalled()
  store.dispose()
})
