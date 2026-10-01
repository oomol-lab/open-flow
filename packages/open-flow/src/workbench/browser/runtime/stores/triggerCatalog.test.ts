import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { resourceValue } from './resource.ts'
import { TriggerCatalogStore } from './triggerCatalog.ts'

describe('TriggerCatalogStore', () => {
  it('keeps locales in separate persistent-cache keys and rejects a mismatched response', async () => {
    const request = vi.fn(async (path: string) => {
      const locale = new URL(path, 'https://open-flow.invalid').searchParams.get('locale')
      return Response.json({ version: 3, locale, definitions: [], display: {} })
    })
    const store = new TriggerCatalogStore(new WorkbenchClient(request), 'en', `test-${crypto.randomUUID()}`)
    try {
      expect((await resourceValue(store.get())).locale).toBe('en')
      store.setLanguage('zh-CN')
      expect((await resourceValue(store.get())).locale).toBe('zh-CN')
      expect(request).toHaveBeenCalledTimes(2)
    } finally {
      store.dispose()
    }
  })

  it('publishes a decode error without writing invalid catalog data', async () => {
    const store = new TriggerCatalogStore(
      new WorkbenchClient(async () => Response.json({ version: 3, locale: 'en', definitions: [], display: {} })),
      'zh-CN',
      `test-${crypto.randomUUID()}`,
    )
    try {
      await store.refresh()
      expect(store.state.value.data).toBeUndefined()
      expect(store.state.value.error).toBeInstanceOf(Error)
    } finally {
      store.dispose()
    }
  })
})
