import { afterEach, expect, it, vi } from 'vitest'
import { Resource, resourceValue } from './resource.ts'

afterEach(() => vi.restoreAllMocks())

it('returns a stable Val, merges reads and checks freshness only on access', async () => {
  let now = 1_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const read = vi.fn(async () => ({ modified: true as const, data: ['one'], etag: '"one"' }))
  const resource = new Resource(read, 30_000)
  const state = resource.get()
  expect(resource.get()).toBe(state)
  expect(state.value.data).toBeUndefined()
  await resource.refresh()
  expect(state.value.data).toEqual(['one'])
  expect(read).toHaveBeenCalledTimes(1)
  now += 30_000
  expect(read).toHaveBeenCalledTimes(1)
  resource.get()
  await resource.refresh()
  expect(read).toHaveBeenCalledTimes(2)
  resource.get()
  expect(read).toHaveBeenCalledTimes(2)
  resource.dispose()
})

it('keeps stale data and errors, backs off failures and permits forced retry', async () => {
  let now = 1_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const read = vi.fn(async () => ({ modified: true as const, data: ['one'], etag: null }))
  const resource = new Resource(read, 30_000)
  await resource.refresh()
  read.mockRejectedValueOnce(new Error('offline'))
  await resource.refresh()
  expect(resource.get().value).toMatchObject({ data: ['one'], refreshing: false, error: new Error('offline') })
  expect(read).toHaveBeenCalledTimes(2)
  now += 29_999
  resource.get()
  expect(read).toHaveBeenCalledTimes(2)
  await resource.refresh()
  expect(resource.state.value.error).toBeUndefined()
  expect(read).toHaveBeenCalledTimes(3)
  resource.dispose()
})

it('does not let cancellation of a consumer cancel the shared request', async () => {
  const pending = Promise.withResolvers<{ modified: true; data: string[]; etag: null }>()
  const resource = new Resource(() => pending.promise, 30_000)
  const controller = new AbortController()
  const first = resourceValue(resource.get(), controller.signal)
  const failed = expect(first).rejects.toMatchObject({ name: 'AbortError' })
  const second = resourceValue(resource.get())
  controller.abort()
  await failed
  pending.resolve({ modified: true, data: [], etag: null })
  expect(await second).toEqual([])
  resource.dispose()
})

it('rejects a cold 304 and prevents late writes after disposal', async () => {
  const resource = new Resource<string[]>(async () => ({ modified: false, etag: '"one"' }), 30_000)
  await resource.refresh()
  expect(resource.state.value.error).toBeInstanceOf(Error)
  resource.dispose()
  const pending = Promise.withResolvers<{ modified: true; data: string[]; etag: null }>()
  const storage = { getItem: () => null, setItem: vi.fn() }
  const late = new Resource(() => pending.promise, 30_000, { key: 'one', storage: () => storage, decode: (value) => value as string[] })
  const request = late.refresh()
  await Promise.resolve()
  late.dispose()
  pending.resolve({ modified: true, data: ['late'], etag: null })
  await request
  expect(storage.setItem).not.toHaveBeenCalled()
})
