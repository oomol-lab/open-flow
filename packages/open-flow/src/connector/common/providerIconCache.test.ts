import type { JsonValue } from '../../types/index.ts'
import type { CacheDelegate, ProviderIconRequest } from './providerIconCache.ts'

import { afterEach, expect, it, vi } from 'vitest'
import { ProviderIconCache } from './providerIconCache.ts'

const image = (body = '<svg xmlns="http://www.w3.org/2000/svg"/>', headers: HeadersInit = {}) =>
  new Response(body, { headers: { 'content-type': 'image/svg+xml', ...headers } })
const sprite = (version = 'v1', theme: 'light' | 'dark' = 'light'): Extract<ProviderIconRequest, { kind: 'sprite' }> => ({
  kind: 'sprite',
  theme,
  version,
  url: `https://example.test/${version}/${theme}.svg`,
})
const original: ProviderIconRequest = { kind: 'image', providerId: 'mail', url: 'https://example.test/mail.svg' }
function storage() {
  const records = new Map<string, JsonValue>()
  const delegate: CacheDelegate = {
    get: vi.fn(async (key) => records.get(key)),
    set: vi.fn(async (key, value) => {
      records.set(key, structuredClone(value))
    }),
    delete: vi.fn(async (key) => {
      records.delete(key)
    }),
  }
  return { records, delegate }
}
afterEach(() => vi.useRealTimers())

it('shares complete image bytes across instances without fetching again', async () => {
  const { records, delegate } = storage()
  const fetch = vi.fn(async () => image())
  const options = { scope: 'test', delegate, fetch }
  const result = await new ProviderIconCache(options).get(sprite())
  expect(result).toBe(`data:image/svg+xml;base64,${btoa(await image().text())}`)
  expect(await new ProviderIconCache(options).get(sprite())).toBe(result)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect([...records.values()]).toEqual([expect.objectContaining({ sourceUrl: sprite().url, spriteVersion: 'v1', body: expect.any(String) })])
})

it('retains only two theme slots across sprite versions and never uses mismatched bytes offline', async () => {
  const { records, delegate } = storage()
  const fetch = vi.fn(async (url: RequestInfo | URL) => image(`<svg>${url}</svg>`))
  const cache = new ProviderIconCache({ scope: 'test', delegate, fetch })
  for (const version of ['v1', 'v2', 'v3']) for (const theme of ['light', 'dark'] as const) await cache.get(sprite(version, theme))
  expect(records.size).toBe(2)
  expect([...records.values()]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sourceUrl: sprite('v3', 'light').url, spriteVersion: 'v3' }),
      expect.objectContaining({ sourceUrl: sprite('v3', 'dark').url, spriteVersion: 'v3' }),
    ]),
  )
  await expect(cache.get(sprite('v2'), { allowNetwork: false })).rejects.toThrow('not cached')
  await expect(cache.get({ ...sprite('v3'), version: 'v4' }, { allowNetwork: false })).rejects.toThrow('not cached')
  await expect(cache.get({ ...sprite('v3'), url: 'https://other.test/light.svg' }, { allowNetwork: false })).rejects.toThrow('not cached')
  expect(fetch).toHaveBeenCalledTimes(6)
})

it('conditionally revalidates expired original images and retains bytes on 304', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const { delegate } = storage()
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(image('first', { 'etag': '"one"', 'cache-control': 'max-age=2' }))
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
  const cache = new ProviderIconCache({ scope: 'test', delegate, fetch })
  const first = await cache.get(original)
  vi.setSystemTime(2999)
  expect(await cache.get(original)).toBe(first)
  expect(fetch).toHaveBeenCalledTimes(1)
  vi.setSystemTime(3000)
  expect(await cache.get(original)).toBe(first)
  expect(new Headers(fetch.mock.calls[1]![1]?.headers).get('if-none-match')).toBe('"one"')
  expect(await cache.get(original)).toBe(first)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('uses a 24-hour default for originals and never forwards an old URL validator', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const fetch = vi.fn<typeof globalThis.fetch>(async () => image('body', { etag: '"one"' }))
  const { delegate, records } = storage()
  const cache = new ProviderIconCache({ scope: 'test', delegate, fetch })
  await cache.get(original)
  vi.setSystemTime(1000 + 24 * 60 * 60 * 1000 - 1)
  await cache.get(original)
  expect(fetch).toHaveBeenCalledTimes(1)
  vi.setSystemTime(1000 + 24 * 60 * 60 * 1000)
  await cache.get(original)
  expect(fetch).toHaveBeenCalledTimes(2)
  await cache.get({ ...original, url: 'https://example.test/new.svg' })
  expect(fetch.mock.calls[2]![1]?.headers).toEqual({})
  expect(records.size).toBe(1)
})

it('forces refresh and removes no-store images from both persistent and memory storage', async () => {
  const { delegate, records } = storage()
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(image())
    .mockImplementation(async () => image('private', { 'cache-control': 'no-store' }))
  await new ProviderIconCache({ scope: 'test', delegate, fetch }).get(sprite())
  const cache = new ProviderIconCache({ scope: 'test', delegate, fetch, mode: 'refresh' })
  await cache.get(sprite())
  expect(records.size).toBe(0)
  await expect(cache.get(sprite(), { allowNetwork: false })).rejects.toThrow('not cached')
  await cache.get(sprite())
  expect(fetch).toHaveBeenCalledTimes(3)
})

it('coalesces matching online reads while offline reads never join a network request', async () => {
  let finish!: (response: Response) => void
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve
      }),
  )
  const cache = new ProviderIconCache({ scope: 'test', fetch })
  const first = cache.get(sprite())
  const second = cache.get(sprite())
  await expect(cache.get(sprite(), { allowNetwork: false })).rejects.toThrow('not cached')
  finish(image())
  expect(await second).toBe(await first)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('keeps the most recently requested slot when an older download completes late', async () => {
  let finish!: (response: Response) => void
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValue(image('new'))
  const { records, delegate } = storage()
  const cache = new ProviderIconCache({ scope: 'test', delegate, fetch })
  const old = cache.get(sprite('v1'))
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  await cache.get(sprite('v2'))
  finish(image('old'))
  expect(await old).toContain(btoa('old'))
  expect([...records.values()]).toEqual([expect.objectContaining({ spriteVersion: 'v2' })])
})

it('preserves a previous successful slot on failure and permits retrying the failed identity', async () => {
  const { records, delegate } = storage()
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(image())
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValue(image('new'))
  const cache = new ProviderIconCache({ scope: 'test', delegate, fetch })
  await cache.get(sprite())
  await expect(cache.get(sprite('v2'))).rejects.toThrow('503')
  expect([...records.values()]).toEqual([expect.objectContaining({ spriteVersion: 'v1' })])
  await cache.get(sprite('v2'))
  expect(fetch).toHaveBeenCalledTimes(3)
})

it('deletes malformed records and keeps successful loads in memory when storage fails', async () => {
  const { delegate, records } = storage()
  const fetch = vi.fn(async () => image())
  const cache = new ProviderIconCache({ scope: 'test', delegate, fetch })
  await cache.get(sprite())
  const key = [...records.keys()][0]!
  records.set(key, { formatVersion: 1, body: 'broken' })
  await new ProviderIconCache({ scope: 'test', delegate, fetch }).get(sprite())
  expect(delegate.delete).toHaveBeenCalledWith(key)
  vi.mocked(delegate.set).mockRejectedValue(new Error('Disk full'))
  vi.mocked(delegate.get).mockRejectedValue(new Error('Storage unavailable'))
  const source = await cache.get(sprite('v2'))
  expect(await cache.get(sprite('v2'), { allowNetwork: false })).toBe(source)
  expect(fetch).toHaveBeenCalledTimes(3)
})

it('isolates scopes and supports offline mode with stale matching images', async () => {
  const { delegate } = storage()
  const fetch = vi.fn(async () => image('body', { 'cache-control': 'max-age=0' }))
  const source = await new ProviderIconCache({ scope: 'a', delegate, fetch }).get(original)
  expect(await new ProviderIconCache({ scope: 'a', delegate, fetch, mode: 'offline' }).get(original)).toBe(source)
  await expect(new ProviderIconCache({ scope: 'b', delegate, fetch, mode: 'offline' }).get(original)).rejects.toThrow('not cached')
  expect(fetch).toHaveBeenCalledTimes(1)
})
