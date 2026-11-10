import type { ControlCacheDelegate, ControlCacheOptions, ControlCacheRead, JsonValue } from './api.ts'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ControlClient } from './api.ts'

const action = {
  actionId: 'example.read',
  name: 'Read',
  serviceId: 'example',
  serviceName: 'Example',
  authenticated: true,
  description: '',
  inputSchema: { type: 'object', properties: {} },
  outputSchema: { type: 'object', additionalProperties: true },
  inputs: {},
  outputs: { output: { jsonSchema: { type: 'object', additionalProperties: true }, nullable: false } },
}
const body = { version: 1, action, upstreamExtension: { nested: [0, false, null, { value: 'retained' }] } }

function storage() {
  const records = new Map<string, JsonValue>()
  const delegate: ControlCacheDelegate = {
    get: vi.fn(async (key) => records.get(key)),
    set: vi.fn(async (key, value) => {
      records.set(key, structuredClone(value))
    }),
    delete: vi.fn(async (key) => {
      records.delete(key)
    }),
  }
  return { delegate, records }
}

afterEach(() => vi.useRealTimers())

describe('delegated Flow catalog caching', () => {
  it('reads Provider metadata cache-only without joining or starting online requests', async () => {
    const { delegate } = storage()
    const request = vi.fn(async () => Response.json({ version: 1, providers: [{ serviceId: 'mail', serviceName: 'Mail' }] }))
    const client = new ControlClient(request, 'api', { cache: { delegate, scope: 'provider', maxAgeMs: 0 } })
    await expect(client.listConnectorProviders(undefined, undefined, 'en', { cacheOnly: true })).rejects.toMatchObject({ code: 'catalog.cache-miss' })
    expect(request).not.toHaveBeenCalled()
    const providers = await client.listConnectorProviders(undefined, undefined, 'en')
    expect(await client.listConnectorProviders(undefined, undefined, 'en', { cacheOnly: true })).toEqual(providers)
    expect(request).toHaveBeenCalledTimes(1)
    await expect(new ControlClient(request).listConnectorProviders(undefined, undefined, 'en', { cacheOnly: true })).rejects.toMatchObject({
      code: 'catalog.cache-miss',
    })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('stores the complete response and shares persisted reads across client instances', async () => {
    const { delegate, records } = storage()
    const reads: ControlCacheRead[] = []
    const request = vi.fn(async () => Response.json(body, { headers: { etag: '"one"' } }))
    const options: ControlCacheOptions = { delegate, scope: 'server/actor', onRead: (read) => reads.push(read) }
    const first = new ControlClient(request, 'api', { cache: options })
    expect(await first.getConnectorActionMetadata(action.actionId)).toEqual(action)
    const second = new ControlClient(request, 'api', { cache: options })
    expect(await second.getConnectorActionMetadata(action.actionId)).toEqual(action)
    expect(request).toHaveBeenCalledTimes(1)
    expect([...records.values()]).toEqual([{ version: 1, body, etag: '"one"', validatedAt: expect.any(Number) }])
    expect(reads.map((read) => read.source)).toEqual(['network', 'cache'])
    expect(reads[1]?.body).toEqual(body)
  })

  it('conditionally revalidates expired responses and retains the body on 304', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const { delegate } = storage()
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (request.mock.calls.length == 1) return Response.json(body, { headers: { etag: '"one"' } })
      expect(new Headers(init?.headers).get('if-none-match')).toBe('"one"')
      return new Response(null, { status: 304 })
    })
    const reads: ControlCacheRead[] = []
    const client = new ControlClient(request, 'api', { cache: { delegate, scope: 'server', onRead: (read) => reads.push(read) } })
    await client.getConnectorActionMetadata(action.actionId)
    vi.setSystemTime(31_001)
    expect(await client.getConnectorActionMetadata(action.actionId)).toEqual(action)
    await client.getConnectorActionMetadata(action.actionId)
    expect(request).toHaveBeenCalledTimes(2)
    expect(reads[1]).toMatchObject({ source: 'revalidated', etag: '"one"', validatedAt: 31_001, body })
  })

  it('refreshes fresh data explicitly and preserves the old record when loading fails', async () => {
    const { delegate, records } = storage()
    const request = vi.fn(async () => Response.json(body))
    const client = new ControlClient(request, 'api', { cache: { delegate, scope: 'server' } })
    await client.getConnectorActionMetadata(action.actionId)
    await client.getConnectorActionMetadata(action.actionId, undefined, undefined, undefined, true)
    expect(request).toHaveBeenCalledTimes(2)
    const before = structuredClone([...records.entries()])
    request.mockResolvedValueOnce(Response.json({ error: { code: 'authentication.required', message: 'Sign in.' } }, { status: 401 }))
    await expect(client.getConnectorActionMetadata(action.actionId, undefined, undefined, undefined, true)).rejects.toMatchObject({
      code: 'authentication.required',
    })
    expect([...records.entries()]).toEqual(before)
  })

  it('uses compatible stale data offline, reports misses, and never makes unrelated requests', async () => {
    const { delegate } = storage()
    const request = vi.fn(async () => Response.json(body))
    await new ControlClient(request, 'api', { cache: { delegate, scope: 'server' } }).getConnectorActionMetadata(action.actionId)
    const offlineRequest = vi.fn(async () => {
      throw new Error('Must stay offline')
    })
    const reads: ControlCacheRead[] = []
    const offline = new ControlClient(offlineRequest, 'api', {
      cache: { delegate, scope: 'server', mode: 'offline', maxAgeMs: 0, onRead: (read) => reads.push(read) },
    })
    expect(await offline.getConnectorActionMetadata(action.actionId)).toEqual(action)
    expect(reads[0]).toMatchObject({ source: 'cache', stale: true })
    await expect(offline.getConnectorActionMetadata('example.missing')).rejects.toMatchObject({ code: 'catalog.cache-miss' })
    await expect(offline.getFlow('flow')).rejects.toMatchObject({ code: 'control.offline' })
    expect(offlineRequest).not.toHaveBeenCalled()
  })

  it('isolates sources, locales, and list/detail request identities', async () => {
    const { delegate } = storage()
    const request = vi.fn(async (path: string) => (path.includes('q=') ? Response.json({ version: 1, actions: [action] }) : Response.json(body)))
    const a = new ControlClient(request, 'api', { cache: { delegate, scope: 'a' } })
    const b = new ControlClient(request, 'api', { cache: { delegate, scope: 'b' } })
    await a.searchConnectorActionMetadata('read')
    await a.getConnectorActionMetadata(action.actionId)
    await b.getConnectorActionMetadata(action.actionId)
    await a.getConnectorActionMetadata(action.actionId, undefined, undefined, 'zh-CN')
    expect(request).toHaveBeenCalledTimes(4)
    await a.searchConnectorActionMetadata('read')
    expect(request).toHaveBeenCalledTimes(4)
  })

  it.each(['envelope', 'body'] as const)('evicts a corrupt %s and does not send its validator', async (corruption) => {
    const { delegate, records } = storage()
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('if-none-match')).toBe(false)
      return Response.json(body, { headers: { etag: '"one"' } })
    })
    const client = new ControlClient(request, 'api', { cache: { delegate, scope: 'a' } })
    await client.getConnectorActionMetadata(action.actionId)
    const key = [...records.keys()][0]!
    records.set(key, corruption == 'envelope' ? { version: 99 } : { version: 1, body: { version: 1, action: {} }, etag: '"corrupt"', validatedAt: Date.now() })
    expect(await client.getConnectorActionMetadata(action.actionId)).toEqual(action)
    expect(delegate.delete).toHaveBeenCalledWith(key)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not persist invalid responses or silently reinterpret a mismatched Action', async () => {
    const { delegate, records } = storage()
    const client = new ControlClient(async () => Response.json({ version: 1, action: { ...action, actionId: 'different' } }), 'api', {
      cache: { delegate, scope: 'a' },
    })
    await expect(client.getConnectorActionMetadata(action.actionId)).rejects.toMatchObject({ code: 'response.invalid' })
    expect(records.size).toBe(0)
  })

  it('preserves successful network results when storage is unavailable', async () => {
    const delegate: ControlCacheDelegate = {
      get: async () => {
        throw new Error('Read failed')
      },
      set: async () => {
        throw new Error('Write failed')
      },
      delete: async () => {
        throw new Error('Delete failed')
      },
    }
    const client = new ControlClient(async () => Response.json(body), 'api', { cache: { delegate, scope: 'a' } })
    expect(await client.getConnectorActionMetadata(action.actionId)).toEqual(action)
  })

  it('coalesces requests without allowing one cancelled caller to cancel another', async () => {
    const { delegate } = storage()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const request = vi.fn(async () => {
      await gate
      return Response.json(body)
    })
    const client = new ControlClient(request, 'api', { cache: { delegate, scope: 'a' } })
    const controller = new AbortController()
    const first = client.getConnectorActionMetadata(action.actionId)
    const cancelled = client.getConnectorActionMetadata(action.actionId, controller.signal)
    controller.abort(new Error('Cancelled'))
    await expect(cancelled).rejects.toThrow('Cancelled')
    release()
    expect(await first).toEqual(action)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('keeps account selections and Flow mutations outside the metadata cache', async () => {
    const { delegate } = storage()
    const request = vi.fn(async () =>
      Response.json({
        version: 1,
        action: { ...action, defaultConnection: { connectionId: 'account', serviceId: 'example', displayName: 'Account', isDefault: true, status: 'active' } },
      }),
    )
    const client = new ControlClient(request, 'api', { cache: { delegate, scope: 'a' } })
    await client.getConnectorAction(action.actionId)
    await client.getConnectorAction(action.actionId)
    expect(request).toHaveBeenCalledTimes(2)
    expect(delegate.set).not.toHaveBeenCalled()
  })

  it('retains uncached behavior when no delegate is supplied', async () => {
    const request = vi.fn(async () => Response.json(body))
    const client = new ControlClient(request)
    await client.getConnectorActionMetadata(action.actionId)
    await client.getConnectorActionMetadata(action.actionId)
    expect(request).toHaveBeenCalledTimes(2)
  })
})
