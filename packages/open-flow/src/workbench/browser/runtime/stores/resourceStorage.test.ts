import { afterEach, expect, it, vi } from 'vitest'
import { optionalStorage } from './resourceStorage.ts'

afterEach(() => vi.useRealTimers())

it('serializes writes for the same key without blocking other keys', async () => {
  const gate = Promise.withResolvers<void>()
  const values = new Map<string, unknown>()
  const backend = {
    get: async (key: string) => values.get(key),
    set: vi.fn(async (key: string, value: unknown) => {
      if (value === 'first') await gate.promise
      values.set(key, value)
    }),
  }
  const storage = optionalStorage(backend)
  expect(optionalStorage(backend)).toBe(storage)
  const first = storage.set('same', 'first')
  const second = storage.set('same', 'second')
  await storage.set('other', 'independent')
  expect(values.get('other')).toBe('independent')
  expect(backend.set.mock.calls.some(([, value]) => value === 'second')).toBe(false)
  gate.resolve()
  await Promise.all([first, second])
  expect(values.get('same')).toBe('second')
})

it.each(['get', 'set'] as const)('disables a hanging backend after a %s timeout', async (operation) => {
  vi.useFakeTimers()
  const gate = Promise.withResolvers<never>()
  const backend = { get: vi.fn(() => gate.promise), set: vi.fn(() => gate.promise) }
  const storage = optionalStorage(backend)
  const pending = operation === 'get' ? storage.get('key') : storage.set('key', 'value')
  await vi.advanceTimersByTimeAsync(1_000)
  await expect(pending).resolves.toBeUndefined()
  const calls = backend.get.mock.calls.length + backend.set.mock.calls.length
  await storage.get('another')
  await storage.set('another', 'ignored')
  expect(backend.get.mock.calls.length + backend.set.mock.calls.length).toBe(calls)
  gate.reject(new Error('late failure'))
  await vi.advanceTimersByTimeAsync(0)
})

it('tolerates synchronous throws and rejected operations and permits a later retry', async () => {
  const backend = {
    get: vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('denied')
      })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('restored'),
    set: vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValue(undefined),
  }
  const storage = optionalStorage(backend)
  expect(await storage.get('key')).toBeUndefined()
  expect(await storage.get('key')).toBeUndefined()
  expect(await storage.get('key')).toBe('restored')
  await storage.set('key', 'first')
  await storage.set('key', 'second')
  expect(backend.set).toHaveBeenCalledTimes(2)
})
