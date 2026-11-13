import type { ProviderIconStorage, ProviderIconRequest } from './providerIconCache.ts'

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
  const records = new Map<string, unknown>()
  const delegate: ProviderIconStorage = {
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

it('reads and persists binary artwork without Base64 encoding through JSON delegates', async () => {
  const records = new Map()
  const delegate = {
    get: async (key: string) => records.get(key),
    set: async (key: string, value: unknown) => {
      records.set(key, JSON.parse(JSON.stringify(value)))
    },
    delete: async (key: string) => {
      records.delete(key)
    },
  }
  const fetch = vi.fn(async () => image('sprite bytes'))
  const encode = vi.spyOn(globalThis, 'btoa')
  try {
    await new ProviderIconCache({ scope: 'json', delegate, fetch }).getBlob(sprite())
    const cached = await new ProviderIconCache({ scope: 'json', delegate, fetch, mode: 'offline' }).getBlob(sprite())
    expect(await cached.text()).toBe('sprite bytes')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(encode).not.toHaveBeenCalled()
  } finally {
    encode.mockRestore()
  }
})

it('reads published cache records and retains the legacy data-URL API', async () => {
  const records = new Map()
  const delegate = {
    get: async (key: string) => records.get(key),
    set: async (key: string, value: unknown) => {
      records.set(key, value)
    },
    delete: async (key: string) => {
      records.delete(key)
    },
  }
  const fetch = vi.fn(async () => image('legacy bytes'))
  const first = new ProviderIconCache({ scope: 'legacy', delegate, fetch })
  const legacy = await first.get(sprite())
  expect(legacy).toBe(`data:image/svg+xml;base64,${btoa('legacy bytes')}`)
  for (const [key, entry] of records) records.set(key, { ...entry, formatVersion: 1, body: btoa('legacy bytes') })
  const cached = await new ProviderIconCache({ scope: 'legacy', delegate, fetch, mode: 'offline' }).getBlob(sprite())
  expect(await cached.text()).toBe('legacy bytes')
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each(['', '/relative/icon.svg', 'https://[invalid'])('rejects malformed Provider icon URLs asynchronously (%j)', async (url) => {
  const fetch = vi.fn(async () => image())
  const cache = new ProviderIconCache({ scope: 'test', fetch })
  const result = cache.getBlob({ ...original, url })
  await expect(result).rejects.toBeInstanceOf(TypeError)
  expect(fetch).not.toHaveBeenCalled()
})

it.each(['ftp://example.test/icon.svg', 'file:///icon.svg'])('rejects unsupported Provider icon URLs asynchronously (%j)', async (url) => {
  const fetch = vi.fn(async () => image())
  const cache = new ProviderIconCache({ scope: 'test', fetch })
  const result = cache.getBlob({ ...original, url })
  await expect(result).rejects.toThrow('Unsupported Provider icon URL.')
  expect(fetch).not.toHaveBeenCalled()
})

it('shares complete image bytes across instances without fetching again', async () => {
  const { records, delegate } = storage()
  const fetch = vi.fn(async () => image())
  const options = { scope: 'test', storage: delegate, fetch }
  const result = await new ProviderIconCache(options).getBlob(sprite())
  expect(await result.text()).toBe(await image().text())
  expect(await (await new ProviderIconCache(options).getBlob(sprite())).text()).toBe(await result.text())
  expect(fetch).toHaveBeenCalledTimes(1)
  expect([...records.values()]).toEqual([expect.objectContaining({ sourceUrl: sprite().url, spriteVersion: 'v1', body: expect.any(Blob) })])
})

it('retains only two theme slots across sprite versions and never uses mismatched bytes offline', async () => {
  const { records, delegate } = storage()
  const fetch = vi.fn(async (url: RequestInfo | URL) => image(`<svg>${url}</svg>`))
  const cache = new ProviderIconCache({ scope: 'test', storage: delegate, fetch })
  for (const version of ['v1', 'v2', 'v3']) for (const theme of ['light', 'dark'] as const) await cache.getBlob(sprite(version, theme))
  expect(records.size).toBe(2)
  expect([...records.values()]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sourceUrl: sprite('v3', 'light').url, spriteVersion: 'v3' }),
      expect.objectContaining({ sourceUrl: sprite('v3', 'dark').url, spriteVersion: 'v3' }),
    ]),
  )
  await expect(cache.getBlob(sprite('v2'), { allowNetwork: false })).rejects.toThrow('not cached')
  await expect(cache.getBlob({ ...sprite('v3'), version: 'v4' }, { allowNetwork: false })).rejects.toThrow('not cached')
  await expect(cache.getBlob({ ...sprite('v3'), url: 'https://other.test/light.svg' }, { allowNetwork: false })).rejects.toThrow('not cached')
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
  const cache = new ProviderIconCache({ scope: 'test', storage: delegate, fetch })
  const first = await cache.getBlob(original)
  vi.setSystemTime(2999)
  expect(await cache.getBlob(original)).toBe(first)
  expect(fetch).toHaveBeenCalledTimes(1)
  vi.setSystemTime(3000)
  expect(await cache.getBlob(original)).toBe(first)
  expect(new Headers(fetch.mock.calls[1]![1]?.headers).get('if-none-match')).toBe('"one"')
  expect(await cache.getBlob(original)).toBe(first)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('uses a 24-hour default for originals and never forwards an old URL validator', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  const fetch = vi.fn<typeof globalThis.fetch>(async () => image('body', { etag: '"one"' }))
  const { delegate, records } = storage()
  const cache = new ProviderIconCache({ scope: 'test', storage: delegate, fetch })
  await cache.getBlob(original)
  vi.setSystemTime(1000 + 24 * 60 * 60 * 1000 - 1)
  await cache.getBlob(original)
  expect(fetch).toHaveBeenCalledTimes(1)
  vi.setSystemTime(1000 + 24 * 60 * 60 * 1000)
  await cache.getBlob(original)
  expect(fetch).toHaveBeenCalledTimes(2)
  await cache.getBlob({ ...original, url: 'https://example.test/new.svg' })
  expect(fetch.mock.calls[2]![1]?.headers).toEqual({})
  expect(records.size).toBe(1)
})

it('forces refresh and removes no-store images from both persistent and memory storage', async () => {
  const { delegate, records } = storage()
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(image())
    .mockImplementation(async () => image('private', { 'cache-control': 'no-store' }))
  await new ProviderIconCache({ scope: 'test', storage: delegate, fetch }).getBlob(sprite())
  const cache = new ProviderIconCache({ scope: 'test', storage: delegate, fetch, mode: 'refresh' })
  await cache.getBlob(sprite())
  expect(records.size).toBe(0)
  await expect(cache.getBlob(sprite(), { allowNetwork: false })).rejects.toThrow('not cached')
  await cache.getBlob(sprite())
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
  const first = cache.getBlob(sprite())
  const second = cache.getBlob(sprite())
  await expect(cache.getBlob(sprite(), { allowNetwork: false })).rejects.toThrow('not cached')
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
  const cache = new ProviderIconCache({ scope: 'test', storage: delegate, fetch })
  const old = cache.getBlob(sprite('v1'))
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  await cache.getBlob(sprite('v2'))
  finish(image('old'))
  expect(await (await old).text()).toBe('old')
  expect([...records.values()]).toEqual([expect.objectContaining({ spriteVersion: 'v2' })])
})

it('preserves a previous successful slot on failure and permits retrying the failed identity', async () => {
  const { records, delegate } = storage()
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(image())
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValue(image('new'))
  const cache = new ProviderIconCache({ scope: 'test', storage: delegate, fetch })
  await cache.getBlob(sprite())
  await expect(cache.getBlob(sprite('v2'))).rejects.toThrow('503')
  expect([...records.values()]).toEqual([expect.objectContaining({ spriteVersion: 'v1' })])
  await cache.getBlob(sprite('v2'))
  expect(fetch).toHaveBeenCalledTimes(3)
})

it('deletes malformed records and keeps successful loads in memory when storage fails', async () => {
  const { delegate, records } = storage()
  const fetch = vi.fn(async () => image())
  const cache = new ProviderIconCache({ scope: 'test', storage: delegate, fetch })
  await cache.getBlob(sprite())
  const key = [...records.keys()][0]!
  records.set(key, { formatVersion: 1, body: 'broken' })
  await new ProviderIconCache({ scope: 'test', storage: delegate, fetch }).getBlob(sprite())
  expect(delegate.delete).toHaveBeenCalledWith(key)
  vi.mocked(delegate.set).mockRejectedValue(new Error('Disk full'))
  vi.mocked(delegate.get).mockRejectedValue(new Error('Storage unavailable'))
  const source = await cache.getBlob(sprite('v2'))
  expect(await cache.getBlob(sprite('v2'), { allowNetwork: false })).toBe(source)
  expect(fetch).toHaveBeenCalledTimes(3)
})

it('isolates scopes and supports offline mode with stale matching images', async () => {
  const { delegate } = storage()
  const fetch = vi.fn(async () => image('body', { 'cache-control': 'max-age=0' }))
  const source = await new ProviderIconCache({ scope: 'a', storage: delegate, fetch }).getBlob(original)
  expect(await (await new ProviderIconCache({ scope: 'a', storage: delegate, fetch, mode: 'offline' }).getBlob(original)).text()).toBe(await source.text())
  await expect(new ProviderIconCache({ scope: 'b', storage: delegate, fetch, mode: 'offline' }).getBlob(original)).rejects.toThrow('not cached')
  expect(fetch).toHaveBeenCalledTimes(1)
})
