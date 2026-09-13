import type { ControlService } from '../node/application/control-service.ts'

import { describe, expect, it } from 'vitest'
import { ControlError } from '../node/error.ts'
import { createControlApp } from '../node/transport/control.ts'

const routes = [
  '/connector/providers',
  '/connector/actions?service=mail&locale=en',
  '/connector/actions?q=send&locale=en',
  '/connector/actions/mail.send?locale=en',
  '/connector/connections/mail',
]

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
      searchConnectorActions: read,
      getConnectorAction: read,
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
