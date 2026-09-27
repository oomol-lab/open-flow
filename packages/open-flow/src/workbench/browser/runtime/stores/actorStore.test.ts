import { expect, it, vi } from 'vitest'
import { ActorStore } from './actorStore.ts'

it('deduplicates concurrent requests and evicts the least recently used actor', async () => {
  const resolve = vi.fn(async (name: string) => ({ name }))
  const store = new ActorStore(resolve, 2)
  const first = store.get('a')
  expect(store.get('a')).toBe(first)
  await first
  await store.get('b')
  await store.get('a')
  await store.get('c')
  await store.get('a')
  expect(resolve.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c'])
  await store.get('b')
  expect(resolve.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c', 'b'])
  store.dispose()
})

it('expires profiles and missing results, but never caches failures', async () => {
  let now = 0
  const resolve = vi.fn(async (name: string) => (name === 'missing' ? null : { name }))
  const store = new ActorStore(resolve, 2, 100, () => now)
  await store.get('a')
  await store.get('missing')
  await store.get('missing')
  expect(resolve).toHaveBeenCalledTimes(2)
  now = 100
  await store.get('a')
  await store.get('missing')
  expect(resolve).toHaveBeenCalledTimes(4)
  resolve.mockRejectedValueOnce(new Error('Offline'))
  await expect(store.get('b')).rejects.toThrow('Offline')
  await expect(store.get('b')).resolves.toEqual({ name: 'b' })
  store.dispose()
})

it('isolates sessions, aborts disposal and works without a host identity provider', async () => {
  let finish!: (value: { name: string }) => void
  let signal!: AbortSignal
  const resolve = vi.fn((_id: string, requestSignal: AbortSignal) => {
    signal = requestSignal
    return new Promise<{ name: string }>((done) => {
      finish = done
    })
  })
  const store = new ActorStore(resolve)
  const pending = store.get('a')
  await Promise.resolve()
  store.dispose()
  expect(signal.aborted).toBe(true)
  finish({ name: 'Old user' })
  await pending
  await expect(store.get('a')).resolves.toBeNull()
  const fresh = new ActorStore(async () => ({ name: 'New user' }))
  await expect(fresh.get('a')).resolves.toEqual({ name: 'New user' })
  await expect(new ActorStore().get('operator')).resolves.toBeNull()
  fresh.dispose()
})
