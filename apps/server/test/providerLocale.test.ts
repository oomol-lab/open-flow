import type { ControlService } from '../node/application/control-service.ts'

import { afterEach, expect, it, vi } from 'vitest'
import { ConnectorClient } from '../node/deployment/connector.ts'
import { createControlApp } from '../node/transport/control.ts'

afterEach(() => vi.unstubAllGlobals())

it('forwards language on every upstream read and localizes Action service names', async () => {
  const requests: { path: string; locale: string | null; etag: string | null }[] = []
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    const headers = new Headers(init?.headers)
    const locale = headers.get('Accept-Language')
    const etag = headers.get('If-None-Match')
    requests.push({ path, locale, etag })
    if (etag) return new Response(null, { status: 304 })
    const data =
      path == '/v1/providers'
        ? [{ service: 'mail', displayName: locale == 'zh-CN' ? '邮件' : 'Mail', authTypes: ['oauth2'] }]
        : path == '/v1/actions'
          ? [
              {
                id: 'mail.send',
                name: 'send',
                description: 'Send',
                service: 'mail',
                inputSchema: { type: 'object', properties: {} },
                outputSchema: { type: 'object', properties: {} },
              },
            ]
          : []
    return Response.json({ success: true, data }, { headers: { etag: `"${locale ?? 'default'}"` } })
  })
  vi.stubGlobal('fetch', fetcher)
  const client = new ConnectorClient('https://connector.example', 'token')
  expect((await client.listProviders(undefined, 'team', 'en'))[0]?.serviceName).toBe('Mail')
  expect((await client.listProviders(undefined, 'team', 'zh-CN'))[0]?.serviceName).toBe('邮件')
  expect((await client.listProviders(undefined, 'team', 'en'))[0]?.serviceName).toBe('Mail')
  expect((await client.listProviders(undefined, 'team', 'zh-CN'))[0]?.serviceName).toBe('邮件')
  expect((await client.listActions('mail', undefined, 'team', 'zh-CN'))[0]?.serviceName).toBe('邮件')
  expect(requests.filter((request) => request.path == '/v1/providers').map(({ locale, etag }) => ({ locale, etag }))).toEqual([
    { locale: 'en', etag: null },
    { locale: 'zh-CN', etag: null },
    { locale: 'en', etag: null },
    { locale: 'zh-CN', etag: null },
    { locale: 'zh-CN', etag: null },
  ])
})

it('forwards Provider locale and varies the HTTP representation', async () => {
  const listConnectorProviders = vi.fn(async (_flowId?: string, _signal?: AbortSignal, locale?: string) => [
    { serviceId: 'mail', serviceName: locale == 'zh-CN' ? '邮件' : 'Mail' },
  ])
  const app = createControlApp({ listConnectorProviders } as unknown as ControlService, () => 'actor')
  const english = await app.request('/connector/providers?flowId=flow&locale=en')
  const chinese = await app.request('/connector/providers?flowId=flow&locale=zh-CN', { headers: { 'if-none-match': english.headers.get('etag')! } })
  expect(chinese.status).toBe(200)
  expect(chinese.headers.get('content-language')).toBe('zh-CN')
  expect(chinese.headers.get('vary')).toContain('Accept-Language')
  expect(await chinese.json()).toMatchObject({ providers: [{ serviceName: '邮件' }] })
  expect(listConnectorProviders).toHaveBeenLastCalledWith('flow', undefined, 'zh-CN')
  await app.request('/connector/providers?flowId=flow', { headers: { 'Accept-Language': 'zh-CN' } })
  expect(listConnectorProviders).toHaveBeenLastCalledWith('flow', undefined, 'zh-CN')
})
