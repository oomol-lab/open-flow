import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ConnectorClient } from '../node/connector.ts'
import { createServerApp } from '../node/http.ts'
import { OperatorStore } from '../node/operator-store.ts'
import { OperatorSession } from '../node/operator.ts'
import { closeService, openService } from './serviceFixture.ts'

const token = 'open-flow-server-operator-token-00000001'
const operatorStores: OperatorStore[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  for (const store of operatorStores.splice(0)) store.close()
})

function operator(file: string, envToken: string | undefined, secure = false, setupCode?: string, now?: () => number): OperatorSession {
  const store = new OperatorStore(file, now)
  operatorStores.push(store)
  return new OperatorSession(store, envToken, secure, setupCode, now)
}

it('uses a signed operator session, expires it on time or token rotation, and clears its cookie on logout', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-operator-'))
  const file = path.join(directory, 'open-flow.sqlite')
  const service = await openService(file)
  let now = Date.UTC(2026, 7, 22)
  const session = operator(file, token, false, undefined, () => now)
  const app = createServerApp(service, { operator: session })
  try {
    const anonymous = await app.request('/auth/session')
    expect(anonymous.headers.get('cache-control')).toBe('no-store')
    expect(anonymous.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(anonymous.headers.get('permissions-policy')).toBe('camera=(), geolocation=(), microphone=()')
    expect(anonymous.headers.get('referrer-policy')).toBe('no-referrer')
    expect(anonymous.headers.get('x-content-type-options')).toBe('nosniff')
    expect(anonymous.headers.get('x-frame-options')).toBe('DENY')
    expect(await anonymous.json()).toEqual({
      authenticated: false,
      configured: true,
      setupAuthorized: false,
      setupRequired: false,
      source: 'environment',
      version: 1,
    })

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
    expect(setCookie).toContain('Max-Age=2592000')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).not.toContain('Secure')
    expect(setCookie).not.toContain(token)
    const cookie = setCookie.split(';', 1)[0]!

    const authenticated = await app.request('/auth/session', { headers: { cookie } })
    expect(await authenticated.json()).toEqual({
      authenticated: true,
      configured: true,
      setupAuthorized: false,
      setupRequired: false,
      source: 'environment',
      version: 1,
    })
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
      operator: operator(file, 'open-flow-server-rotated-token-00000001', false, undefined, () => now),
    })
    expect(await (await rotated.request('/auth/session', { headers: { cookie } })).json()).toEqual({
      authenticated: false,
      configured: true,
      setupAuthorized: false,
      setupRequired: false,
      source: 'environment',
      version: 1,
    })

    now += 30 * 24 * 60 * 60 * 1_000 + 1
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
    await closeService(service)
    await rm(directory, { force: true, recursive: true })
  }
})

it('rate limits operator login attempts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-operator-limit-'))
  const file = path.join(directory, 'open-flow.sqlite')
  const service = await openService(file)
  const app = createServerApp(service, {
    operator: operator(file, token),
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
    await closeService(service)
    await rm(directory, { force: true, recursive: true })
  }
})

it('throttles failed stored token verification and caches a verified token', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-operator-verify-'))
  const file = path.join(directory, 'open-flow.sqlite')
  const service = await openService(file)
  let now = Date.UTC(2026, 7, 22)
  const claimed = new OperatorStore(file, () => now)
  const restored = new OperatorStore(file, () => now)
  operatorStores.push(claimed, restored)
  try {
    expect(claimed.claim(token)).toBe(true)
    expect(await restored.matches('wrong')).toBe(false)
    expect(await restored.matches(token)).toBe(false)

    now += 1_000
    await expect(Promise.all([restored.matches(token), restored.matches(token)])).resolves.toEqual([true, true])

    expect(await restored.matches('another-wrong-token')).toBe(false)
    expect(await restored.matches(token)).toBe(true)
  } finally {
    await closeService(service)
    await rm(directory, { force: true, recursive: true })
  }
})

it('reports missing operator configuration without disabling callbacks or health', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-operator-missing-'))
  const file = path.join(directory, 'open-flow.sqlite')
  const service = await openService(file)
  const app = createServerApp(service, { operator: operator(file, undefined, false, 'setup-code-000000000000000000000000') })
  try {
    expect(await (await app.request('/auth/session')).json()).toEqual({
      authenticated: false,
      configured: false,
      setupAuthorized: false,
      setupRequired: true,
      source: 'none',
      version: 1,
    })
    expect((await app.request('/auth/session', { body: JSON.stringify({ token, version: 1 }), method: 'POST' })).status).toBe(503)
    expect((await app.request('/v1/flows')).status).toBe(401)
    expect((await app.request('/v1/flows', { headers: { authorization: `Bearer ${token}` } })).status).toBe(401)
    expect((await app.request('/v1/runs/missing')).status).toBe(401)
    expect((await app.request('/healthz')).status).toBe(200)
    expect((await app.request('/v1/webhooks/not-an-endpoint')).status).toBe(404)
  } finally {
    await closeService(service)
    await rm(directory, { force: true, recursive: true })
  }
})

it('claims an unconfigured deployment with a one-time setup session and restores the operator credential', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-operator-setup-'))
  const file = path.join(directory, 'open-flow.sqlite')
  const service = await openService(file)
  const setupCode = 'open-flow-server-setup-code-000000000001'
  const session = operator(file, undefined, false, setupCode)
  const app = createServerApp(service, { operator: session })
  try {
    const invalid = await app.request('/auth/setup/session', {
      body: JSON.stringify({ code: 'wrong', version: 1 }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(invalid.status).toBe(401)

    const authorized = await app.request('/auth/setup/session', {
      body: JSON.stringify({ code: setupCode, version: 1 }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(authorized.status).toBe(200)
    const setupCookie = authorized.headers.get('set-cookie')!.split(';', 1)[0]!
    expect(setupCookie).toContain('open_flow_operator_setup=')
    expect(await (await app.request('/auth/session', { headers: { cookie: setupCookie } })).json()).toEqual({
      authenticated: false,
      configured: false,
      setupAuthorized: true,
      setupRequired: true,
      source: 'none',
      version: 1,
    })

    const short = await app.request('/auth/setup', {
      body: JSON.stringify({ token: 'short', version: 1 }),
      headers: { 'content-type': 'application/json', 'cookie': setupCookie },
      method: 'POST',
    })
    expect(short.status).toBe(401)

    const claimed = await app.request('/auth/setup', {
      body: JSON.stringify({ token, version: 1 }),
      headers: { 'content-type': 'application/json', 'cookie': setupCookie },
      method: 'POST',
    })
    expect(claimed.status).toBe(201)
    const cookie = claimed.headers.get('set-cookie')!.match(/open_flow_operator_session=[^;]+/)?.[0]
    expect(cookie).toBeDefined()
    expect(await (await app.request('/auth/session', { headers: { cookie: cookie! } })).json()).toEqual({
      authenticated: true,
      configured: true,
      setupAuthorized: false,
      setupRequired: false,
      source: 'settings',
      version: 1,
    })
    expect((await app.request('/v1/flows', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200)
    expect(
      (
        await app.request('/auth/setup/session', {
          body: JSON.stringify({ code: setupCode, version: 1 }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        })
      ).status,
    ).toBe(409)

    const restored = createServerApp(service, { operator: operator(file, undefined) })
    const login = await restored.request('/auth/session', {
      body: JSON.stringify({ token, version: 1 }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(login.status).toBe(200)
  } finally {
    await closeService(service)
    await rm(directory, { force: true, recursive: true })
  }
})

it('fixes one OOMOL Team when each Flow is created', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-team-'))
  const file = path.join(directory, 'open-flow.sqlite')
  const requests: { readonly teamId: string | null; readonly url: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      requests.push({ teamId: new Headers(init?.headers).get('x-oo-team-id'), url })
      return url.startsWith('https://relation-control.oomol.com/')
        ? Response.json({
            teams: [
              { id: 'team-1', name: 'Engineering', system_created: true },
              { id: 'team-2', name: 'Operations', system_created: false },
            ],
          })
        : Response.json({ data: [], success: true })
    }),
  )
  const connector = new ConnectorClient('https://connector.oomol.com', 'runtime-token')
  const service = await openService(file, { capabilities: { connector: () => connector } })
  let flowId = ''
  try {
    expect((await createServerApp(service).request('/connector/teams')).status).toBe(401)
    const app = createServerApp(service, { resolveControlActor: () => 'operator' })
    expect(await (await app.request('/connector/teams')).json()).toEqual({
      bindings: [],
      enabled: true,
      teams: [
        { id: 'team-1', name: 'Engineering', systemCreated: true },
        { id: 'team-2', name: 'Operations', systemCreated: false },
      ],
      version: 1,
    })
    expect(
      (
        await app.request('/connector/flows', {
          body: JSON.stringify({ name: 'Missing Team', teamId: 'missing', version: 1 }),
          headers: { 'content-type': 'application/json', 'idempotency-key': 'missing-team-flow' },
          method: 'POST',
        })
      ).status,
    ).toBe(400)
    const createdResponse = await app.request('/connector/flows', {
      body: JSON.stringify({ name: 'Team Flow', teamId: 'team-2', version: 1 }),
      headers: { 'content-type': 'application/json', 'idempotency-key': 'create-team-flow' },
      method: 'POST',
    })
    expect(createdResponse.status).toBe(201)
    flowId = ((await createdResponse.json()) as { readonly flowId: string }).flowId
    await service.control.listConnectorProviders(flowId)
    expect(requests.at(-1)).toEqual({ teamId: 'team-2', url: 'https://connector.oomol.com/v1/providers' })
    const other = await service.control.createFlow('operator', 'Default Team Flow', 'create-default-team-flow')
    const teamStatus = (await (await app.request('/connector/teams')).json()) as {
      readonly bindings: readonly { readonly flowId: string; readonly teamId: string }[]
    }
    expect(teamStatus.bindings).toEqual(
      expect.arrayContaining([
        { flowId, teamId: 'team-2' },
        { flowId: other.flow.flowId, teamId: 'team-1' },
      ]),
    )
    await service.control.listConnectorProviders(other.flow.flowId)
    expect(requests.at(-1)).toEqual({ teamId: 'team-1', url: 'https://connector.oomol.com/v1/providers' })
    await service.control.listConnectorProviders(flowId)
    expect(requests.at(-1)).toEqual({ teamId: 'team-2', url: 'https://connector.oomol.com/v1/providers' })
    expect((await app.request(`/connector/flows/${flowId}/team`, { method: 'PUT' })).status).toBe(404)
  } finally {
    await closeService(service)
  }

  const reopened = await openService(file, { capabilities: { connector: () => new ConnectorClient('https://connector.oomol.com', 'runtime-token') } })
  try {
    await reopened.control.listConnectorProviders(flowId)
    expect(requests.at(-1)).toEqual({ teamId: 'team-2', url: 'https://connector.oomol.com/v1/providers' })
  } finally {
    await closeService(reopened)
    await rm(directory, { force: true, recursive: true })
  }
})

it('hides OOMOL Team selection for a custom Connector', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-custom-team-'))
  const service = await openService(path.join(directory, 'open-flow.sqlite'), {
    capabilities: { connector: () => new ConnectorClient('https://connector.example.com', 'runtime-token') },
  })
  try {
    const app = createServerApp(service, { resolveControlActor: () => 'operator' })
    expect(await (await app.request('/connector/teams')).json()).toEqual({ bindings: [], enabled: false, teams: [], version: 1 })
  } finally {
    await closeService(service)
    await rm(directory, { force: true, recursive: true })
  }
})

it('streams independent Flow catalog and current Flow invalidations', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-notifications-'))
  const service = await openService(path.join(directory, 'open-flow.sqlite'))
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
    await closeService(service)
    await rm(directory, { force: true, recursive: true })
  }
})

it('closes Flow notification streams during shutdown', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-notification-shutdown-'))
  const service = await openService(path.join(directory, 'open-flow.sqlite'))
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
    await closeService(service)
    await rm(directory, { force: true, recursive: true })
  }
})

it('serves immutable assets and limits the SPA fallback to non-reserved HTML navigation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-static-'))
  const publicDirectory = path.join(directory, 'public')
  await mkdir(path.join(publicDirectory, 'assets'), { recursive: true })
  await writeFile(path.join(publicDirectory, 'index.html'), '<!doctype html><title>Server shell</title>')
  await writeFile(path.join(publicDirectory, 'assets', 'app-1234.js'), 'globalThis.openFlow = true')
  const service = await openService(path.join(directory, 'open-flow.sqlite'))
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
    for (const accept of [
      'application/json, text/html;q=0',
      '*/*;q=1, text/html;q=0',
      'text/html;charset=utf-8;q=0, text/html;q=1',
      'text/html;charset=iso-8859-1;q=1, text/html;q=0',
      'text/html;note="a,b";q=0',
    ]) {
      const response = await app.request('/flows/main/design', { headers: { accept } })
      expect.soft(response.status, accept).toBe(404)
      expect.soft(response.headers.get('content-type'), accept).toContain('application/json')
    }
    expect((await app.request('/flows/main/design', { headers: { accept: 'Text/HTML' } })).status).toBe(200)
    expect((await app.request('/flows/main/design', { headers: { accept: 'text/html;charset=utf-8;q=1, text/html;q=0' } })).status).toBe(200)
    expect((await app.request('/flows/main/design', { headers: { accept: 'text/html' }, method: 'POST' })).status).toBe(404)

    const apiOnly = createServerApp(service)
    const withoutAssets = await apiOnly.request('/', { headers: { accept: 'text/html' } })
    expect(withoutAssets.status).toBe(404)
    expect(withoutAssets.headers.get('content-type')).toContain('application/json')
  } finally {
    await closeService(service)
    await rm(directory, { force: true, recursive: true })
  }
})
