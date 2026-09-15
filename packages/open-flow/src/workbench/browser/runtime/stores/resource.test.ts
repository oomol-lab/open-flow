import type { ConditionalResult } from '../../../../control/common/api.ts'

import { compute } from 'value-enhancer'
import { afterEach, expect, it, vi } from 'vitest'
import { Resource, resourceData, resourceValue } from './resource.ts'

afterEach(() => vi.restoreAllMocks())

it.each(['200', '304', 'error'])('waits for a post-invalidation read after an older %s response', async (response) => {
  const old = Promise.withResolvers<ConditionalResult<string[]>>()
  const fresh = Promise.withResolvers<ConditionalResult<string[]>>()
  const read = vi
    .fn<() => Promise<ConditionalResult<string[]>>>()
    .mockResolvedValueOnce({ modified: true, data: ['cached'], etag: '"cached"' })
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(fresh.promise)
  const storage = { getItem: () => null, setItem: vi.fn() }
  const resource = new Resource(read, 30_000, { key: 'test', storage: () => storage, decode: (data) => data as string[] })
  await resource.refresh()
  storage.setItem.mockClear()
  const pending = resource.refresh()
  await Promise.resolve()
  const state = resource.get(true)
  resource.get(true)
  let settled = false
  const value = resourceValue(state, undefined, true).then((data) => {
    settled = true
    return data
  })
  if (response == 'error') old.reject(new Error('Old request failed'))
  else old.resolve(response == '304' ? { modified: false, etag: '"old"' } : { modified: true, data: ['old'], etag: '"old"' })
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3))
  expect(settled).toBe(false)
  expect(state.value).toMatchObject({ data: ['cached'], refreshing: true, error: undefined })
  expect(storage.setItem).not.toHaveBeenCalled()
  expect(read.mock.calls[2]).toEqual(['"cached"', expect.any(AbortSignal)])
  fresh.resolve({ modified: true, data: ['new-account'], etag: '"new"' })
  expect(await value).toEqual(['new-account'])
  await pending
  expect(read).toHaveBeenCalledTimes(3)
  expect(JSON.parse(storage.setItem.mock.calls[0]![1])).toEqual({ data: ['new-account'], etag: '"new"' })
  resource.dispose()
})

it('publishes a failed replacement request instead of accepting the invalidated result', async () => {
  const old = Promise.withResolvers<ConditionalResult<string[]>>()
  const read = vi.fn<() => Promise<ConditionalResult<string[]>>>().mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error('Replacement failed'))
  const resource = new Resource(read, 30_000)
  const pending = resource.refresh()
  await Promise.resolve()
  const value = resourceValue(resource.get(true), undefined, true)
  const failed = expect(value).rejects.toThrow('Replacement failed')
  old.resolve({ modified: true, data: ['old'], etag: '"old"' })
  await pending
  await failed
  expect(resource.state.value.data).toBeUndefined()
  resource.dispose()
})

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
  late.get(true)
  late.dispose()
  pending.resolve({ modified: true, data: ['late'], etag: null })
  await request
  expect(storage.setItem).not.toHaveBeenCalled()
})

it('isolates data computations from refresh status, errors and unchanged responses', async () => {
  const read = vi.fn<() => Promise<ConditionalResult<string[]>>>().mockResolvedValueOnce({ modified: true, data: ['one'], etag: '"one"' })
  const resource = new Resource(read, 30_000)
  await resource.refresh()
  const data = resourceData(resource.state)
  expect(resourceData(resource.state)).toBe(data)
  const project = vi.fn((items: string[] | undefined) => items?.join(','))
  const derived = compute((get) => project(get(data)))
  const stop = derived.subscribe(() => {})
  expect(derived.value).toBe('one')
  project.mockClear()
  try {
    const pending = Promise.withResolvers<ConditionalResult<string[]>>()
    read.mockReturnValueOnce(pending.promise)
    const refresh = resource.refresh()
    await Promise.resolve()
    expect(resource.state.value.refreshing).toBe(true)
    expect(derived.value).toBe('one')
    pending.resolve({ modified: false, etag: '"one"' })
    await refresh
    expect(derived.value).toBe('one')
    expect(project).not.toHaveBeenCalled()

    read.mockRejectedValueOnce(new Error('offline'))
    await resource.refresh()
    expect(resource.state.value.error).toEqual(new Error('offline'))
    expect(derived.value).toBe('one')
    expect(project).not.toHaveBeenCalled()

    read.mockResolvedValueOnce({ modified: true, data: ['two'], etag: '"two"' })
    await resource.refresh()
    expect(derived.value).toBe('two')
    expect(project).toHaveBeenCalledOnce()
  } finally {
    stop()
    derived.dispose()
    resource.dispose()
  }
})

it('does not subscribe when cached data already satisfies the consumer', async () => {
  const resource = new Resource(async () => ({ modified: true as const, data: ['one'], etag: null }), 30_000)
  await resource.refresh()
  const subscribe = vi.spyOn(resource.state, 'subscribe')
  try {
    expect(await resourceValue(resource.state)).toEqual(['one'])
    expect(await resourceValue(resource.state, undefined, true)).toEqual(['one'])
    const controller = new AbortController()
    controller.abort()
    await expect(resourceValue(resource.state, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(subscribe).not.toHaveBeenCalled()
  } finally {
    resource.dispose()
  }
})

it('skips persistence for unchanged 304 responses but saves a replacement ETag', async () => {
  const storage = { getItem: () => null, setItem: vi.fn() }
  const read = vi
    .fn<() => Promise<ConditionalResult<string[]>>>()
    .mockResolvedValueOnce({ modified: true, data: ['one'], etag: '"one"' })
    .mockResolvedValueOnce({ modified: false, etag: '"one"' })
    .mockResolvedValueOnce({ modified: false, etag: '"two"' })
  const resource = new Resource(read, 30_000, { key: 'test', storage: () => storage, decode: (data) => data as string[] })
  try {
    await resource.refresh()
    storage.setItem.mockClear()
    await resource.refresh()
    expect(storage.setItem).not.toHaveBeenCalled()
    await resource.refresh()
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith('test', JSON.stringify({ data: ['one'], etag: '"two"' }))
  } finally {
    resource.dispose()
  }
})
