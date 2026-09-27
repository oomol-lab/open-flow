import { expect, it, vi } from 'vitest'
import { actorResolver } from './actorResolver.ts'
import { ActorStore } from './stores/actorStore.ts'

it.each(['com', 'dev'])('queries the OOMOL %s upstream directly and caches the mapped profile', async (domain) => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ 'user/a': { nickname: 'Alex', username: 'alex', url: 'https://example.com/alex.png' } }))
  const store = new ActorStore(actorResolver({}, `https://console.oomol.${domain}`, request))
  await expect(store.get('user/a')).resolves.toEqual({ name: 'Alex', avatarUrl: 'https://example.com/alex.png' })
  await expect(store.get('user/a')).resolves.toEqual({ name: 'Alex', avatarUrl: 'https://example.com/alex.png' })
  expect(request).toHaveBeenCalledTimes(1)
  expect(String(request.mock.calls[0]![0])).toBe(`https://api.oomol.${domain}/v1/users/summaries?user_ids=user%2Fa`)
  expect(request.mock.calls[0]![1]).toEqual({ credentials: 'include', signal: expect.any(AbortSignal) })
  const signal = request.mock.calls[0]![1]!.signal!
  store.dispose()
  expect(signal.aborted).toBe(true)
})

it('keeps custom and local identities out of the OOMOL directory', async () => {
  const request = vi.fn<typeof fetch>()
  for (const origin of [undefined, 'http://localhost:5173', 'https://example.com', 'https://console.oomol.com.example.com']) {
    const store = new ActorStore(actorResolver({}, origin, request))
    await expect(store.get('operator')).resolves.toBeNull()
    store.dispose()
  }
  const host = { resolveActor: vi.fn(async () => ({ name: 'Custom user' })) }
  const resolve = actorResolver(host, 'https://console.oomol.com', request)!
  const signal = new AbortController().signal
  await expect(resolve('user', signal)).resolves.toEqual({ name: 'Custom user' })
  expect(host.resolveActor).toHaveBeenCalledWith('user', signal)
  expect(request).not.toHaveBeenCalled()
})

it('handles missing profiles and retries upstream and invalid-response failures', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ user: { nickname: '', username: 'Alex', url: '' } }))
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ broken: { nickname: 1 } }))
    .mockResolvedValueOnce(Response.json({ broken: { nickname: 'Recovered', username: '', url: '' } }))
  const store = new ActorStore(actorResolver({}, 'https://console.oomol.com', request))
  await expect(store.get('user')).resolves.toEqual({ name: 'Alex', avatarUrl: undefined })
  await expect(store.get('missing')).resolves.toBeNull()
  await expect(store.get('missing')).resolves.toBeNull()
  await expect(store.get('broken')).rejects.toThrow('503')
  await expect(store.get('broken')).rejects.toThrow('Invalid OOMOL user summary')
  await expect(store.get('broken')).resolves.toEqual({ name: 'Recovered', avatarUrl: undefined })
  expect(request).toHaveBeenCalledTimes(5)
  store.dispose()
})
