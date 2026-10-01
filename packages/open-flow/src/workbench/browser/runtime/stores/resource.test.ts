import type { ResourceCache } from '@oomol-lab/resource-cache'

import { describe, expect, it, vi } from 'vitest'
import { CacheResource, resourceValue } from './resource.ts'

function cacheFixture() {
  let value: string | undefined
  let fresh = false
  let loading: Promise<string> | undefined
  let loads = 0
  const cache: ResourceCache<string, void> = {
    async get(_query, _options) {
      if (loading == null) {
        loads++
        loading = Promise.resolve(`value-${loads}`).then((result) => {
          value = result
          fresh = true
          loading = undefined
          return result
        })
      }
      return loading
    },
    async peek() {
      return value == null ? undefined : { data: value, etag: null, validatedAt: Date.now(), fresh }
    },
    async invalidate() {},
    async remove() {},
    async clear() {},
    async dispose() {},
  }
  return {
    cache,
    get loads() {
      return loads
    },
    markStale: () => {
      fresh = false
    },
  }
}

describe('CacheResource', () => {
  it('maps a cache promise into the reactive resource state and preserves stale data while refreshing', async () => {
    const fixture = cacheFixture()
    const resource = new CacheResource(async () => fixture.cache, undefined)

    expect(await resourceValue(resource.get())).toBe('value-1')
    resource.get()
    resource.get()
    await Promise.resolve()
    expect(fixture.loads).toBe(1)
    fixture.markStale()
    const state = resource.refresh().then(() => resource.state)
    await state
    expect(await resourceValue(resource.state, undefined, true)).toBe('value-2')
    expect(fixture.loads).toBe(2)
    resource.dispose()
  })

  it('delegates concurrent refreshes to the cache and lets callers cancel their wait', async () => {
    let resolve!: (value: string) => void
    const pending = new Promise<string>((done) => {
      resolve = done
    })
    let calls = 0
    const cache: ResourceCache<string, void> = {
      get: async () => {
        calls++
        return pending
      },
      peek: async () => undefined,
      invalidate: async () => {},
      remove: async () => {},
      clear: async () => {},
      dispose: async () => {},
    }
    const resource = new CacheResource(async () => cache, undefined)
    const first = resource.refresh()
    const forced = resource.refresh(true)
    const controller = new AbortController()
    const cancelled = resourceValue(resource.state, controller.signal)
    controller.abort(new Error('cancelled'))
    await expect(cancelled).rejects.toThrow('cancelled')
    resolve('ready')
    await first
    await forced
    expect(calls).toBe(2)
    resource.dispose()
  })

  it('revalidates when a previously loaded value is accessed after its freshness interval', async () => {
    const fixture = cacheFixture()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const resource = new CacheResource(async () => fixture.cache, undefined, false, 100)
    try {
      await resourceValue(resource.get())
      await resource.refresh()
      fixture.markStale()
      clock.mockReturnValue(1_100)
      const state = resource.get()
      await vi.waitFor(() => expect(fixture.loads).toBe(2))
      expect(state.value.data).toBe('value-2')
    } finally {
      resource.dispose()
      clock.mockRestore()
    }
  })
})
