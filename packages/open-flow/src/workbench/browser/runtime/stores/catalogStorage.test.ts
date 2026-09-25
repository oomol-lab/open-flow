import { IDBFactory } from 'fake-indexeddb'
import { afterEach, expect, it, vi } from 'vitest'
import { catalogPersistence } from './catalogStorage.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('persists complete objects in IndexedDB and restores through another cache instance', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  const first = catalogPersistence({}, 'actions', 'service=mail&locale=en')!
  const value = { data: { success: true, data: [{ schema: { type: 'object' }, extra: ['preserved'] }] }, etag: '"one"' }
  await first.storage.set(first.key, value)
  const second = catalogPersistence({}, 'actions', 'service=mail&locale=en')!
  expect(await second.storage.get(second.key)).toEqual(value)
  for (const query of ['service=mail&locale=zh-CN', 'service=other&locale=en']) {
    const other = catalogPersistence({}, 'actions', query)!
    expect(await other.storage.get(other.key)).toBeUndefined()
  }
})
