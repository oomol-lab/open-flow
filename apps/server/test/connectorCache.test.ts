import type { ControlService } from '../node/application/control-service.ts'

import { describe, expect, it, vi } from 'vitest'
import { ConnectorClient } from '../node/deployment/connector.ts'
import { ControlError } from '../node/error.ts'
import { createControlApp } from '../node/transport/control.ts'

const routes = [
  '/connector/providers',
  '/connector/actions?service=mail&locale=en',
  '/connector/actions?q=send&locale=en',
  '/connector/actions/mail.send?locale=en',
  '/connector/action-metadata?service=mail&locale=en',
  '/connector/action-metadata?q=send&locale=en',
  '/connector/action-metadata/mail.send?locale=en',
  '/connector/connections/mail',
  '/connector/connections?flowId=flow',
]

it.each(['/connector/action-metadata', '/connector/action-metadata?service=mail', '/connector/action-metadata?q=send', '/connector/action-metadata/mail.send'])(
  'keeps %s independent of Connection changes and failures',
  async (route) => {
    let name = 'Before'
    let failed = false
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname
      if (path.startsWith('/v1/apps')) {
        if (failed) return Response.json({ success: false }, { status: 503 })
        return Response.json({ success: true, data: [{ id: 'account', service: 'mail', displayName: name, isDefault: true, status: 'active' }] })
      }
      const action = {
        id: 'mail.send',
        name: 'send',
        description: 'Send',
        service: 'mail',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      }
      const data =
        path == '/v1/providers' ? [{ service: 'mail', displayName: 'Mail', authTypes: ['oauth2'] }] : path == '/v1/actions/mail.send' ? action : [action]
      return Response.json({ success: true, data })
    })
    vi.stubGlobal('fetch', fetcher)
    try {
      const client = new ConnectorClient('https://connector.example', 'token')
      const service = {
        listConnectorActionMetadata: (serviceId?: string) => client.listActions(serviceId),
        searchConnectorActionMetadata: (query: string) => client.searchActions(query),
        getConnectorActionMetadata: (id: string) => client.getAction(id),
      } as unknown as ControlService
      const app = createControlApp(service, () => 'actor')
      const first = await app.request(route)
      expect(first.status).toBe(200)
      const body = await first.json()
      for (const action of body.actions ?? [body.action]) expect(action).not.toHaveProperty('defaultConnection')
      const headers = { 'if-none-match': first.headers.get('etag')! }
      name = 'After'
      expect((await app.request(route, { headers })).status).toBe(304)
      failed = true
      expect((await app.request(route, { headers })).status).toBe(304)
      expect(fetcher.mock.calls.every(([input]) => !String(input).includes('/v1/apps'))).toBe(true)
      await expect(client.listConnections('mail')).rejects.toMatchObject({ code: 'connector.unavailable' })
    } finally {
      vi.unstubAllGlobals()
    }
  },
)

describe('Connector conditional HTTP responses', () => {
  it.each(routes)('revalidates %s after checking current authorization and data', async (route) => {
    let revision = 1
    let calls = 0
    let authorized = true
    const read = () => {
      calls++
      return [{ revision }]
    }
    const service = {
      listConnectorProviders: read,
      listConnectorActions: read,
      listConnectorActionMetadata: read,
      searchConnectorActionMetadata: read,
      getConnectorActionMetadata: read,
      searchConnectorActions: read,
      getConnectorAction: read,
      listAllConnectorConnections: read,
      listConnectorConnections: read,
    } as unknown as ControlService
    const app = createControlApp(service, () => (authorized ? 'actor' : undefined)).onError((error) =>
      Response.json({ error: { message: error.message } }, { status: error instanceof ControlError ? error.status : 500 }),
    )
    const first = await app.request(route)
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('private, no-cache')
    const etag = first.headers.get('etag')!
    expect(etag).toBeTruthy()
    const next = await app.request(route, { headers: { 'if-none-match': etag } })
    expect(next.status).toBe(304)
    expect(await next.text()).toBe('')
    expect(next.headers.get('cache-control')).toBe('private, no-cache')
    expect(calls).toBe(2)
    revision++
    const changed = await app.request(route, { headers: { 'if-none-match': etag } })
    expect(changed.status).toBe(200)
    expect(changed.headers.get('etag')).not.toBe(etag)
    authorized = false
    expect((await app.request(route, { headers: { 'if-none-match': etag } })).status).toBe(401)
    expect(calls).toBe(3)
  })
})
