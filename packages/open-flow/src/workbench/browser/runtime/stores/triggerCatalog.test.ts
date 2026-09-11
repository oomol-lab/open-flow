import type { TriggerCatalog, TriggerCatalogCache } from '../../../../control/common/triggerCatalog.ts'
import type { TriggerCatalogStorage } from './triggerCatalog.ts'

import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { browserTriggerCatalogStorage, TriggerCatalogStore } from './triggerCatalog.ts'

const catalog: TriggerCatalog = { version: 1, locale: 'en', definitions: [], display: {} }
function storage(): TriggerCatalogStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}
function setup(request: (path: string, init?: RequestInit) => Promise<Response>, local = storage(), namespace = 'test') {
  return new TriggerCatalogStore(new WorkbenchClient(request), 'en', { triggerCatalogCache: { namespace, storage: local } })
}
function seed(local: TriggerCatalogStorage, entry: TriggerCatalogCache = { data: catalog, etag: '"old"' }) {
  browserTriggerCatalogStorage('test', local).setItem(entry.data.locale, JSON.stringify(entry))
}

describe('Trigger catalog cache', () => {
  it('displays persisted data immediately while revalidating with its ETag across sessions', async () => {
    const local = storage()
    const first = setup(async () => Response.json(catalog, { headers: { etag: 'W/"one"' } }), local)
    await first.refresh()
    first.dispose()
    let finish!: (value: Response) => void
    const request = vi.fn(
      (_path: string, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    const next = setup(request, local)
    try {
      next.open()
      expect(await next.get()).toEqual(catalog)
      expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('if-none-match')).toBe('W/"one"')
      finish(new Response(null, { status: 304 }))
      expect((await next.refresh()).data).toEqual(catalog)
    } finally {
      next.dispose()
    }
  })

  it('sends the cached validator, merges concurrent refreshes and persists a new response', async () => {
    const local = storage()
    seed(local)
    let finish!: (value: Response) => void
    const request = vi.fn(
      (_path: string, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    const store = setup(request, local)
    try {
      const pending = store.refresh()
      expect(store.refresh()).toBe(pending)
      expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('if-none-match')).toBe('"old"')
      finish(Response.json(catalog, { headers: { etag: '"new"' } }))
      await pending
      expect(JSON.parse(browserTriggerCatalogStorage('test', local).getItem('en')!).etag).toBe('"new"')
      expect(store.state.value.revision).toBe(1)
    } finally {
      store.dispose()
    }
  })

  it('isolates deployments and languages and ignores a late response after switching language', async () => {
    const local = storage()
    seed(local)
    let finish!: (value: Response) => void
    const request = vi.fn((path: string, _init?: RequestInit) =>
      path.endsWith('en')
        ? new Promise<Response>((resolve) => {
            finish = resolve
          })
        : Promise.resolve(Response.json({ ...catalog, locale: 'zh-CN' })),
    )
    const store = setup(request, local, 'another')
    try {
      const old = store.refresh()
      const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' })
      expect(new Headers(request.mock.calls[0]?.[1]?.headers).has('if-none-match')).toBe(false)
      store.setLanguage('zh-CN')
      expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
      await store.refresh()
      finish(Response.json(catalog))
      await rejected
      expect((await store.get()).locale).toBe('zh-CN')
      expect(browserTriggerCatalogStorage('another', local).getItem('en')).toBeNull()
    } finally {
      store.dispose()
    }
  })

  it.each([
    '{broken',
    JSON.stringify({ data: { ...catalog, version: 2 }, etag: 'old' }),
    JSON.stringify({ data: { ...catalog, display: { extra: {} } }, etag: null }),
  ])('ignores invalid persisted data: %s', async (raw) => {
    const local = storage()
    browserTriggerCatalogStorage('test', local).setItem('en', raw)
    const request = vi.fn(async (_path: string, _init?: RequestInit) => Response.json(catalog))
    const store = setup(request, local)
    try {
      expect(await store.get()).toEqual(catalog)
      expect(new Headers(request.mock.calls[0]?.[1]?.headers).has('if-none-match')).toBe(false)
    } finally {
      store.dispose()
    }
  })

  it('tolerates unavailable storage and caches successful responses without an ETag', async () => {
    const request = vi.fn(async () => Response.json(catalog))
    const store = setup(request, {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('full')
      },
    })
    try {
      await store.refresh()
      expect(await store.get()).toEqual(catalog)
      expect(request).toHaveBeenCalledTimes(1)
    } finally {
      store.dispose()
    }
  })

  it('keeps cached data on failure and reports failure without triggering a reload loop', async () => {
    const local = storage()
    seed(local)
    const store = setup(async () => {
      throw new Error('offline')
    }, local)
    try {
      await expect(store.refresh()).rejects.toThrow('offline')
      expect(await store.get()).toEqual(catalog)
      expect(store.state.value).toEqual({ failed: true, revision: 0 })
    } finally {
      store.dispose()
    }
  })

  it('rejects an unexpected 304 without a cached representation', async () => {
    const store = setup(async () => new Response(null, { status: 304 }))
    try {
      await expect(store.get()).rejects.toThrow()
    } finally {
      store.dispose()
    }
  })
})
