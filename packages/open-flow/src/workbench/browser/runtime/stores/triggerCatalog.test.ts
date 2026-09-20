import { expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { resourceValue } from './resource.ts'
import { TriggerCatalogStore, browserTriggerCatalogStorage } from './triggerCatalog.ts'

it('restores local data, retains replacement 304 ETags and separates languages', async () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
  const local = browserTriggerCatalogStorage('test', storage)
  local.setItem('en', JSON.stringify({ data: { version: 2, locale: 'en', definitions: [], display: {} }, etag: '"old"' }))
  const request = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    expect(new Headers(init?.headers).get('if-none-match')).toBe('"old"')
    return new Response(null, { status: 304, headers: { etag: 'W/"new"' } })
  })
  const store = new TriggerCatalogStore(new WorkbenchClient(request), 'en', { triggerCatalogCache: { namespace: 'test', storage } })
  const state = store.get()
  expect(state.value.data?.locale).toBe('en')
  await store.refresh()
  expect(JSON.parse(local.getItem('en')!).etag).toBe('W/"new"')
  request.mockImplementation(async (_path, init) => {
    expect(new Headers(init?.headers).has('if-none-match')).toBe(false)
    return Response.json({ version: 2, locale: 'zh-CN', definitions: [], display: {} })
  })
  store.setLanguage('zh-CN')
  expect((await resourceValue(store.get())).locale).toBe('zh-CN')
  store.setLanguage('en')
  expect(store.get().value.data?.locale).toBe('en')
  expect(values.size).toBe(2)
  store.dispose()
})

it('rejects a mismatched locale without persisting or publishing it', async () => {
  const storage = { getItem: () => null, setItem: vi.fn() }
  const store = new TriggerCatalogStore(new WorkbenchClient(async () => Response.json({ version: 2, locale: 'en', definitions: [], display: {} })), 'zh-CN', {
    triggerCatalogCache: { namespace: 'test', storage },
  })
  await store.refresh()
  expect(store.state.value.data).toBeUndefined()
  expect(store.state.value.error).toBeInstanceOf(Error)
  expect(storage.setItem).not.toHaveBeenCalled()
  store.dispose()
})
