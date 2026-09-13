import { expect, it, vi } from 'vitest'
import { connectorProvidersQuery } from '../../../control/common/connectorQueries.ts'
import { WorkbenchClient } from './api.ts'
import { cachedResponse } from './requestCache.ts'

it('keeps persisted Provider responses and validators separate by locale', async () => {
  const entries = new Map<string, string>()
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value)
    },
  }
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    const locale = new URL(path, 'https://test.invalid').searchParams.get('locale')
    const etag = new Headers(init?.headers).get('if-none-match')
    if (etag) {
      expect(etag).toBe(`"${locale}"`)
      return new Response(null, { status: 304 })
    }
    return Response.json(
      { version: 1, providers: [{ serviceId: 'mail', serviceName: locale == 'zh-CN' ? '邮件' : 'Mail' }] },
      { headers: { etag: `"${locale}"` } },
    )
  })
  const create = () => new WorkbenchClient(request, undefined, undefined, { namespace: 'test', localStorage: storage, sessionStorage: storage })
  const original = create()
  await original.listConnectorProviders(undefined, 'flow', 'en')
  await original.listConnectorProviders(undefined, 'flow', 'zh-CN')
  const restored = create()
  expect((await restored.listConnectorProviders(undefined, 'flow', 'en'))[0]?.serviceName).toBe('Mail')
  expect((await restored.listConnectorProviders(undefined, 'flow', 'zh-CN'))[0]?.serviceName).toBe('邮件')
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4))
  expect(cachedResponse(restored.requestCache.responses.value, connectorProvidersQuery('flow', 'en'))?.[0]?.serviceName).toBe('Mail')
  expect(cachedResponse(restored.requestCache.responses.value, connectorProvidersQuery('flow', 'zh-CN'))?.[0]?.serviceName).toBe('邮件')
  expect(entries.size).toBe(2)
})
