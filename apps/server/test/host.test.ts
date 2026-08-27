import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createServerApp } from '../node/http.ts'
import { OperatorSession } from '../node/operator.ts'
import { ServerService } from '../node/service.ts'

const token = 'open-flow-server-operator-token-00000001'

it('uses a signed operator session, expires it on time or token rotation, and clears its cookie on logout', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-operator-'))
  const service = ServerService.open(path.join(directory, 'open-flow.sqlite'))
  let now = Date.UTC(2026, 7, 22)
  const operator = new OperatorSession(token, false, () => now)
  const app = createServerApp(service, { operator })
  try {
    const anonymous = await app.request('/auth/session')
    expect(anonymous.headers.get('cache-control')).toBe('no-store')
    expect(anonymous.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(anonymous.headers.get('permissions-policy')).toBe('camera=(), geolocation=(), microphone=()')
    expect(anonymous.headers.get('referrer-policy')).toBe('no-referrer')
    expect(anonymous.headers.get('x-content-type-options')).toBe('nosniff')
    expect(anonymous.headers.get('x-frame-options')).toBe('DENY')
    expect(await anonymous.json()).toEqual({ authenticated: false, configured: true, version: 1 })

    const invalid = await app.request('/auth/session', {
      body: JSON.stringify({ token: 'wrong', version: 1 }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(invalid.status).toBe(401)
    expect(invalid.headers.get('set-cookie')).toBeNull()

    const login = await app.request('/auth/session', {
      body: JSON.stringify({ token, version: 1 }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(login.status).toBe(200)
    const setCookie = login.headers.get('set-cookie')!
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Max-Age=43200')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).not.toContain('Secure')
    expect(setCookie).not.toContain(token)
    const cookie = setCookie.split(';', 1)[0]!

    const authenticated = await app.request('/auth/session', { headers: { cookie } })
    expect(await authenticated.json()).toEqual({ authenticated: true, configured: true, version: 1 })
    const flow = await app.request('/v1/flows', {
      body: JSON.stringify({ name: 'Operator flow', version: 1 }),
      headers: { 'content-type': 'application/json', cookie, 'idempotency-key': 'operator-flow' },
      method: 'POST',
    })
    expect(flow.status).toBe(201)
    expect((await app.request('/v1/flows')).status).toBe(401)
    expect((await app.request('/v1/variables')).status).toBe(401)
    expect((await app.request('/v1/variables/TOKEN')).status).toBe(401)
    expect((await app.request('/v1/variables', { headers: { cookie } })).status).toBe(200)
    expect((await app.request('/v1/flows', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200)
    expect((await app.request('/v1/flows', { headers: { authorization: 'Bearer wrong' } })).status).toBe(401)
    expect((await app.request('/v1/flows', { headers: { authorization: `Basic ${token}` } })).status).toBe(401)

    const rotated = createServerApp(service, {
      operator: new OperatorSession('open-flow-server-rotated-token-00000001', false, () => now),
    })
    expect(await (await rotated.request('/auth/session', { headers: { cookie } })).json()).toEqual({
      authenticated: false,
      configured: true,
      version: 1,
    })

    now += 12 * 60 * 60 * 1_000 + 1
    expect((await app.request('/v1/flows', { headers: { cookie } })).status).toBe(401)

    now = Date.UTC(2026, 7, 22)
    const logout = await app.request('/auth/session', { headers: { cookie }, method: 'DELETE' })
    expect(logout.status).toBe(204)
    expect(logout.headers.get('cache-control')).toBe('no-store')
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')

    const callback = await app.request('/v1/webhooks/not-an-endpoint', { method: 'POST' })
    expect(callback.status).toBe(404)
    expect(await callback.text()).toBe('')
  } finally {
    await service.close()
    await rm(directory, { force: true, recursive: true })
  }
})

it('rate limits operator login attempts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-operator-limit-'))
  const service = ServerService.open(path.join(directory, 'open-flow.sqlite'))
  const app = createServerApp(service, {
    operator: new OperatorSession(token, false),
    operatorLoginAttemptsPerMinute: 1,
  })
  try {
    const invalid = await app.request('/auth/session', {
      body: JSON.stringify({ token: 'wrong', version: 1 }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(invalid.status).toBe(401)
    const limited = await app.request('/auth/session', {
      body: JSON.stringify({ token, version: 1 }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(limited.headers.get('set-cookie')).toBeNull()
  } finally {
    await service.close()
    await rm(directory, { force: true, recursive: true })
  }
})

it('reports missing operator configuration without disabling callbacks or health', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-operator-missing-'))
  const service = ServerService.open(path.join(directory, 'open-flow.sqlite'))
  const app = createServerApp(service)
  try {
    expect(await (await app.request('/auth/session')).json()).toEqual({ authenticated: false, configured: false, version: 1 })
    expect((await app.request('/auth/session', { body: JSON.stringify({ token, version: 1 }), method: 'POST' })).status).toBe(503)
    expect((await app.request('/v1/flows')).status).toBe(401)
    expect((await app.request('/v1/flows', { headers: { authorization: `Bearer ${token}` } })).status).toBe(401)
    expect((await app.request('/v1/runs/missing')).status).toBe(401)
    expect((await app.request('/healthz')).status).toBe(200)
    expect((await app.request('/v1/webhooks/not-an-endpoint')).status).toBe(404)
  } finally {
    await service.close()
    await rm(directory, { force: true, recursive: true })
  }
})

it('streams independent Flow catalog and current Flow invalidations', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-notifications-'))
  const service = ServerService.open(path.join(directory, 'open-flow.sqlite'))
  const app = createServerApp(service, { resolveControlActor: () => 'operator' })
  try {
    expect((await createServerApp(service).request('/v1/flows/notifications')).status).toBe(401)
    const catalog = await app.request('/v1/flows/notifications')
    const catalogReader = catalog.body!.getReader()
    expect(new TextDecoder().decode((await catalogReader.read()).value)).toBe(': connected\n\n')
    const createdResponse = await app.request('/v1/flows', {
      body: JSON.stringify({ name: 'Notifications', version: 1 }),
      headers: { 'content-type': 'application/json', 'idempotency-key': 'notifications-flow' },
      method: 'POST',
    })
    const created = (await createdResponse.json()) as { readonly draftRevisionId: string; readonly flowId: string }
    expect(new TextDecoder().decode((await catalogReader.read()).value)).toBe(`data: ${JSON.stringify({ kind: 'flows.changed', version: 1 })}\n\n`)

    const response = await app.request(`/v1/flows/${created.flowId}/notifications`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.headers.get('cache-control')).toBe('no-cache')
    const reader = response.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe(': connected\n\n')

    const changed = await service.control.changeDraft('operator', created.flowId, created.draftRevisionId, [
      {
        kind: 'graph.node.create',
        node: { concurrency: 1, inputs: {}, kind: 'value', values: [] },
        nodeId: 'marker',
        target: { kind: 'flow' },
      },
    ])
    const notification = await reader.read()
    expect(new TextDecoder().decode(notification.value)).toBe(
      `data: ${JSON.stringify({ kind: 'draft.changed', flowId: created.flowId, revisionId: changed.revision.revisionId, version: 1 })}\n\n`,
    )
    const accepted = await service.control.createDraftRun(created.flowId, changed.revision.revisionId, currentEngineContract, {}, 'notification-run')
    const runNotification = await reader.read()
    expect(new TextDecoder().decode(runNotification.value)).toBe(
      `data: ${JSON.stringify({ flowId: created.flowId, kind: 'run.created', runId: accepted.run.runId, version: 1 })}\n\n`,
    )
    await reader.cancel()
    await catalogReader.cancel()
  } finally {
    await service.close()
    await rm(directory, { force: true, recursive: true })
  }
})

it('closes Flow notification streams during shutdown', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-notification-shutdown-'))
  const service = ServerService.open(path.join(directory, 'open-flow.sqlite'))
  const shutdown = new AbortController()
  try {
    const created = await service.control.createFlow('operator', 'Shutdown', 'shutdown-flow')
    const app = createServerApp(service, { resolveControlActor: () => 'operator', shutdownSignal: shutdown.signal })
    const response = await app.request(`/v1/flows/${created.flow.flowId}/notifications`)
    const reader = response.body?.getReader()
    if (reader == null) throw new Error('Flow notification stream is missing.')
    await expect(reader.read()).resolves.toMatchObject({ done: false })

    shutdown.abort()
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
  } finally {
    await service.close()
    await rm(directory, { force: true, recursive: true })
  }
})

it('serves immutable assets and limits the SPA fallback to non-reserved HTML navigation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-static-'))
  const publicDirectory = path.join(directory, 'public')
  await mkdir(path.join(publicDirectory, 'assets'), { recursive: true })
  await writeFile(path.join(publicDirectory, 'index.html'), '<!doctype html><title>Server shell</title>')
  await writeFile(path.join(publicDirectory, 'assets', 'app-1234.js'), 'globalThis.openFlow = true')
  const service = ServerService.open(path.join(directory, 'open-flow.sqlite'))
  const app = createServerApp(service, { publicDirectory })
  try {
    for (const target of ['/', '/flows/main/design', '/flows/main/runs']) {
      const response = await app.request(target, { headers: { accept: 'text/html' } })
      expect.soft(response.status, target).toBe(200)
      expect.soft(response.headers.get('cache-control'), target).toBe('no-cache')
      expect.soft(await response.text(), target).toContain('Server shell')
    }

    const asset = await app.request('/assets/app-1234.js')
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await asset.text()).toBe('globalThis.openFlow = true')

    for (const target of ['/assets/missing.js', '/auth/missing', '/connector/page', '/oauth/callback', '/v1/missing']) {
      const response = await app.request(target, { headers: { accept: 'text/html' } })
      expect.soft(response.status, target).toBe(404)
      expect.soft(response.headers.get('content-type'), target).toContain('application/json')
    }
    expect((await app.request('/flows/main/design', { headers: { accept: 'application/json' } })).status).toBe(404)
    expect((await app.request('/flows/main/design', { headers: { accept: 'text/html' }, method: 'POST' })).status).toBe(404)

    const apiOnly = createServerApp(service)
    const withoutAssets = await apiOnly.request('/', { headers: { accept: 'text/html' } })
    expect(withoutAssets.status).toBe(404)
    expect(withoutAssets.headers.get('content-type')).toContain('application/json')
  } finally {
    await service.close()
    await rm(directory, { force: true, recursive: true })
  }
})
