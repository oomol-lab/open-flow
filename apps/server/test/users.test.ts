import type { User } from '../common/users.ts'

import { serve } from '@hono/node-server'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { authoringExample } from '@oomol-lab/open-flow/control-requests'
import { mcpProtocolVersion } from '@oomol-lab/open-flow/mcp'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onTestFinished, expect, it, vi } from 'vitest'
import { createLlm } from '../node/deployment/llm.ts'
import { createOperatorApp, OperatorSession } from '../node/deployment/operator.ts'
import { Settings } from '../node/deployment/settings.ts'
import { Database } from '../node/storage/database.ts'
import { OperatorStore } from '../node/storage/operator-store.ts'
import { PersonalTokenStore } from '../node/storage/personal-token-store.ts'
import { SettingsStore } from '../node/storage/settings-store.ts'
import { createServerApp } from '../node/transport/http.ts'
import { createConnectorHost } from './connectorHost.ts'
import { closeService, openService, startService } from './serviceFixture.ts'

const token = 'user-system-test-operator-token-00000001'
const administrator = { authorization: `Bearer ${token}` }

async function fixture(attempts = 100, options: Parameters<typeof openService>[1] = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-users-'))
  const file = path.join(directory, 'flow.sqlite')
  const service = await openService(file, options)
  const database = Database.open(file)
  let now = Date.now()
  const operator = new OperatorSession(new OperatorStore(database), token, false, undefined, () => now, service.control.users)
  const settings = new Settings(new SettingsStore(database), {})
  const shutdown = new AbortController()
  const app = createServerApp(service, { operator, settings, operatorLoginAttemptsPerMinute: attempts, shutdownSignal: shutdown.signal })
  onTestFinished(async () => {
    shutdown.abort()
    await closeService(service)
    database.close()
    await rm(directory, { recursive: true, force: true })
  })
  async function request(url: string, headers: HeadersInit = administrator, method = 'GET', body?: object) {
    return await app.request(url, { headers, method, ...(body == null ? {} : { body: JSON.stringify({ version: 1, ...body }) }) })
  }
  async function create(email: string, role: 'admin' | 'user' = 'user') {
    const response = await request('/auth/users', administrator, 'POST', { email, role })
    expect(response.status).toBe(201)
    return (await response.json()) as { readonly user: User; readonly password: string }
  }
  async function login(email: string, password: string) {
    const response = await request('/auth/user-session', {}, 'POST', { email, password })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const cookie = response.headers.get('set-cookie')!.match(/open_flow_user_session=[^;]+/)?.[0]
    if (cookie == null) throw new Error('User session cookie is missing.')
    return { cookie }
  }
  async function flow(headers: HeadersInit, key = 'same-key') {
    const response = await request('/v1/flows', { ...headers, 'idempotency-key': key }, 'POST', { name: 'Private workflow' })
    expect(response.status).toBe(201)
    return (await response.json()) as { readonly flowId: string; readonly draftRevisionId: string }
  }
  async function mcp(name: string, args: Record<string, unknown>, headers: Record<string, string>) {
    const http = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0, overrideGlobalObjects: false })
    await once(http, 'listening')
    const address = http.address()
    if (address == null || typeof address == 'string') throw new Error('HTTP address is unavailable.')
    const client = new Client({ name: 'users-test', version: '1.0.0' }, { versionNegotiation: { mode: { pin: mcpProtocolVersion } } })
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/v1/mcp`), { requestInit: { headers } }))
      return await client.callTool({ name, arguments: args })
    } finally {
      await client.close()
      await new Promise<void>((resolve, reject) => http.close((error) => (error == null ? resolve() : reject(error))))
    }
  }
  return {
    app,
    file,
    mcp,
    request,
    create,
    login,
    flow,
    database,
    service,
    operator,
    settings,
    advance: () => {
      now += 30 * 24 * 60 * 60 * 1000 + 1
    },
  }
}

it('creates normalized email accounts, returns a password once, and never stores or lists plaintext credentials', async () => {
  const f = await fixture()
  expect((await f.request('/auth/users', {}, 'POST', { email: 'a@example.com', role: 'user' })).status).toBe(401)
  expect((await f.request('/auth/users', administrator, 'POST', { email: 'invalid', role: 'user' })).status).toBe(400)
  expect((await f.request('/auth/users', administrator, 'POST', { email: 'a@example.com', role: 'owner' })).status).toBe(400)
  const account = await f.create(' Alice@Example.COM ')
  expect(account.user.email).toBe('alice@example.com')
  expect(account.password).toHaveLength(24)
  const stored = f.database.connection.prepare('SELECT * FROM users').get()
  expect(JSON.stringify(stored)).not.toContain(account.password)
  expect(stored?.password_hash).toBeTypeOf('string')
  expect(stored?.password_salt).toBeTypeOf('string')
  const list = await f.request('/auth/users')
  expect(await list.json()).toEqual({ users: [account.user], version: 1 })
  expect((await f.request('/auth/users', administrator, 'POST', { email: 'ALICE@example.com', role: 'admin' })).status).toBe(409)
  const headers = await f.login(' ALICE@EXAMPLE.COM ', account.password)
  expect(await (await f.request('/auth/session', headers)).json()).toMatchObject({
    authenticated: true,
    user: { userId: account.user.userId, role: 'user', email: 'alice@example.com' },
  })
  for (const email of ['alice@example.com', 'unknown@example.com']) {
    const rejected = await f.request('/auth/user-session', {}, 'POST', { email, password: 'incorrect' })
    expect(rejected.status).toBe(401)
    expect(await rejected.json()).toMatchObject({ error: { code: 'authentication.invalid', message: 'Email or password is invalid.' } })
  }
  expect((await f.request('/auth/user-session', {}, 'POST', { email: 'alice@example.com', password: account.password, role: 'admin' })).status).toBe(400)
})

it('allows only administrators to manage users and deployment services', async () => {
  const f = await fixture()
  const regular = await f.create('regular@example.com')
  const headers = await f.login(regular.user.email, regular.password)
  for (const [url, method, body] of [
    ['/auth/users', 'GET', undefined],
    ['/auth/users', 'POST', { email: 'new@example.com', role: 'admin' }],
    [`/auth/users/${regular.user.userId}`, 'PUT', { enabled: false, expectedRevision: 1 }],
    [`/auth/users/${regular.user.userId}/password`, 'POST', { expectedRevision: 1 }],
    ['/config', 'GET', undefined],
    ['/config/connector', 'PUT', { expectedRevision: 1, origin: 'https://example.com', token: 'secret' }],
    ['/config/connector/oomol-login', 'POST', { expectedRevision: 1 }],
    ['/config/llm', 'DELETE', { expectedRevision: 1 }],
    ['/v1/variables', 'GET', undefined],
    ['/v1/variables/TOKEN', 'PUT', { value: 'changed' }],
    ['/v1/event-sources', 'GET', undefined],
    ['/v1/event-sources', 'POST', {}],
    ['/v1/connector/connections/mail/page', 'POST', {}],
  ] as const) {
    expect((await f.request(url, headers, method, body)).status, `${method} ${url}`).toBe(403)
  }
  expect(f.settings.status().revision).toBe(1)
  const admin = await f.create('admin@example.com', 'admin')
  const adminHeaders = await f.login(admin.user.email, admin.password)
  expect((await f.request('/auth/users', adminHeaders)).status).toBe(200)
  expect((await f.request('/config', adminHeaders)).status).toBe(200)
  expect((await f.request(`/auth/users/${admin.user.userId}`, adminHeaders, 'PUT', { enabled: false, expectedRevision: 1 })).status).toBe(403)
})

it('isolates workflow lists, pagination, resource reads, mutations, connector scope and notifications for every role', async () => {
  const f = await fixture()
  const a = await f.create('a@example.com')
  const b = await f.create('b@example.com', 'admin')
  const ah = await f.login(a.user.email, a.password)
  const bh = await f.login(b.user.email, b.password)
  const af = await f.flow(ah)
  const bf = await f.flow(bh)
  const operatorFlow = await f.flow(administrator)
  const second = await f.flow(ah, 'second')
  const page = await (await f.request('/v1/flows?limit=1&includeTotal=true', ah)).json()
  expect(page.total).toBe(2)
  expect(page.flows.map((item: { flowId: string }) => item.flowId)).toEqual([af.flowId])
  const next = await (await f.request(`/v1/flows?cursor=${encodeURIComponent(page.nextCursor)}&limit=1`, ah)).json()
  expect(next.flows.map((item: { flowId: string }) => item.flowId)).toEqual([second.flowId])
  expect(next.nextCursor).toBeUndefined()
  for (const [headers, target] of [
    [ah, bf],
    [bh, af],
    [administrator, af],
    [ah, operatorFlow],
  ] as const) {
    for (const suffix of ['', '/draft', '/editor', '/presentation', '/runs', '/notifications', '/connector-access']) {
      expect((await f.request(`/v1/flows/${target.flowId}${suffix}`, headers)).status, suffix).toBe(404)
    }
    expect((await f.request(`/v1/flows/${target.flowId}`, headers, 'PATCH', { name: 'stolen' })).status).toBe(404)
    expect((await f.request(`/v1/flows/${target.flowId}`, headers, 'DELETE')).status).toBe(404)
    expect((await f.request(`/v1/connector/providers?flowId=${target.flowId}`, headers)).status).toBe(404)
    expect((await f.request(`/v1/connector/proxy/actions?flowId=${target.flowId}`, headers)).status).toBe(404)
  }
  expect((await f.request(`/v1/flows/${af.flowId}/draft`, ah)).status).toBe(200)
  const replay = await f.request('/v1/flows', { ...ah, 'idempotency-key': 'same-key' }, 'POST', { name: 'Private workflow' })
  expect(replay.status).toBe(200)
  expect((await replay.json()).flowId).toBe(af.flowId)
  const stream = await f.request('/v1/flows/notifications', ah)
  const reader = stream.body!.getReader()
  await reader.read()
  const foreign = await f.flow(bh, 'foreign-event')
  await f.request(`/v1/flows/${foreign.flowId}`, bh, 'PATCH', { name: 'Changed' })
  const own = await f.flow(ah, 'own-event')
  const chunk = await reader.read()
  expect(new TextDecoder().decode(chunk.value)).toContain(own.flowId)
  expect(new TextDecoder().decode(chunk.value)).not.toContain(foreign.flowId)
  await reader.cancel()
})

it('rejects another owner’s run, publication and error subscription through REST and MCP', async () => {
  const f = await fixture()
  const account = await f.create('owner@example.com')
  const headers = await f.login(account.user.email, account.password)
  const flow = await f.flow(headers)
  const changed = await f.service.control.changeDraft(account.user.userId, flow.flowId, flow.draftRevisionId, [
    { kind: 'graph.node.create', nodeId: 'start', node: { kind: 'manual', name: 'Start' } },
  ])
  const revisionId = changed.revision.revisionId
  const operation = await f.service.control.publishFlow(account.user.userId, flow.flowId, revisionId, currentEngineContract, null, 'publish')
  await f.service.tickMaintenance()
  const publication = f.service.control.getPublishOperation(flow.flowId, operation.operationId)
  if (publication.status != 'succeeded') throw new Error('Publication did not complete.')
  const accepted = await f.service.control.runs.createDraftRun(
    flow.flowId,
    revisionId,
    currentEngineContract,
    {},
    'run',
    { nodeId: 'start', outputs: {} },
    account.user.userId,
  )
  const runId = accepted.run.runId
  for (const suffix of ['', '/events', '/results', '/result']) {
    expect((await f.request(`/v1/runs/${runId}${suffix}`, administrator)).status).toBe(404)
  }
  expect((await f.request(`/v1/runs/${runId}/cancel`, administrator, 'POST', {})).status).toBe(404)
  expect(
    (
      await f.request('/v1/runs', { ...administrator, 'idempotency-key': 'stolen' }, 'POST', {
        version: 2,
        publicationId: publication.publicationId,
        inputs: {},
        trigger: { nodeId: 'start', outputs: {} },
      })
    ).status,
  ).toBe(404)
  const target = await f.flow(administrator)
  await expect(
    f.service.control.changeDraft('operator', target.flowId, target.draftRevisionId, [
      { kind: 'graph.node.create', nodeId: 'error', node: { kind: 'error', name: 'Errors', sourceFlowIds: [flow.flowId] } },
    ]),
  ).rejects.toMatchObject({ code: 'flow.invalid' })
  const mcp = await f.mcp('run_get', { runId }, administrator)
  expect(mcp.isError).toBe(true)
  expect(JSON.stringify(mcp)).toContain('run.not-found')
  const list = await f.mcp('flow_list', {}, headers)
  const body = JSON.stringify(list.structuredContent)
  expect(body).toContain(flow.flowId)
  expect(body).not.toContain(target.flowId)
})

it('invalidates sessions on password reset, disabling, expiry and cookie tampering', async () => {
  const f = await fixture()
  const account = await f.create('session@example.com')
  const headers = await f.login(account.user.email, account.password)
  const reset = await f.request(`/auth/users/${account.user.userId}/password`, administrator, 'POST', { expectedRevision: 1 })
  expect(reset.status).toBe(200)
  const changed = await reset.json()
  expect((await f.request('/v1/flows', headers)).status).toBe(401)
  expect((await f.request('/auth/user-session', {}, 'POST', { email: account.user.email, password: account.password })).status).toBe(401)
  const fresh = await f.login(account.user.email, changed.password)
  expect((await f.request('/v1/flows', { cookie: `${fresh.cookie}tampered` })).status).toBe(401)
  expect((await f.request(`/auth/users/${account.user.userId}`, administrator, 'PUT', { enabled: false, expectedRevision: 1 })).status).toBe(409)
  expect(
    (await f.request(`/auth/users/${account.user.userId}`, administrator, 'PUT', { enabled: false, expectedRevision: changed.user.revision })).status,
  ).toBe(200)
  expect((await f.request('/v1/flows', fresh)).status).toBe(401)
  expect((await f.request('/auth/user-session', {}, 'POST', { email: account.user.email, password: changed.password })).status).toBe(401)
  await f.request(`/auth/users/${account.user.userId}`, administrator, 'PUT', { enabled: true, expectedRevision: changed.user.revision + 1 })
  expect((await f.request('/v1/flows', fresh)).status).toBe(401)
  const enabled = await f.login(account.user.email, changed.password)
  f.advance()
  expect((await f.request('/v1/flows', enabled)).status).toBe(401)
})

it('lets ordinary users execute workflows with the administrator’s configured LLM and browse Connector services', async () => {
  const gateway = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
    Response.json({ choices: [{ message: { content: 'Shared model response' } }] }),
  )
  vi.stubGlobal('fetch', gateway)
  try {
    const connector = createConnectorHost({
      listProviders: async () => [{ serviceId: 'mail', serviceName: 'Mail', description: '', connectionRequired: true }],
    })
    const llm = createLlm('https://models.example.com', 'administrator-llm-secret')
    const f = await fixture(100, { capabilities: { connector: () => connector, llm: () => llm } })
    const account = await f.create('runner@example.com')
    const headers = await f.login(account.user.email, account.password)
    const flow = await f.flow(headers)
    expect((await f.request(`/v1/connector/providers?flowId=${flow.flowId}`, headers)).status).toBe(200)
    const changed = await f.service.control.changeDraft(account.user.userId, flow.flowId, flow.draftRevisionId, [
      ...authoringExample('manual').operations,
      ...authoringExample('llm-chat').operations,
      { kind: 'graph.edge.connect', edge: { source: 'start', target: 'llm' } },
    ])
    await startService(f.service)
    const accepted = await f.request(
      `/v1/flows/${flow.flowId}/revisions/${changed.revision.revisionId}/runs`,
      { ...headers, 'idempotency-key': 'shared-llm' },
      'POST',
      {
        version: 2,
        inputs: {},
        trigger: { nodeId: 'start', outputs: {} },
        engineContract: currentEngineContract,
      },
    )
    expect(accepted.status).toBe(202)
    const run = await accepted.json()
    await f.service.waitForIdle()
    expect(await (await f.request(`/v1/runs/${run.runId}`, headers)).json()).toMatchObject({ status: 'completed' })
    expect(gateway).toHaveBeenCalledOnce()
    expect(new Headers(gateway.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer administrator-llm-secret')
    expect(JSON.stringify(await (await f.request(`/v1/flows/${flow.flowId}/draft`, headers)).json())).not.toContain('administrator-llm-secret')
  } finally {
    vi.unstubAllGlobals()
  }
})

it('closes existing notification streams after the account password is reset', async () => {
  const f = await fixture()
  const account = await f.create('notifications@example.com')
  const headers = await f.login(account.user.email, account.password)
  const flow = await f.flow(headers)
  const catalog = (await f.request('/v1/flows/notifications', headers)).body!.getReader()
  const changes = (await f.request(`/v1/flows/${flow.flowId}/notifications`, headers)).body!.getReader()
  await catalog.read()
  await changes.read()
  await f.request(`/auth/users/${account.user.userId}/password`, administrator, 'POST', { expectedRevision: 1 })
  await f.service.control.changeDraft(account.user.userId, flow.flowId, flow.draftRevisionId, authoringExample('manual').operations)
  expect((await catalog.read()).done).toBe(true)
  expect((await changes.read()).done).toBe(true)
})

it('rate limits password login and clears user sessions on logout', async () => {
  const f = await fixture(1)
  const account = await f.create('limited@example.com')
  const headers = await f.login(account.user.email, account.password)
  const limited = await f.request('/auth/user-session', {}, 'POST', { email: account.user.email, password: account.password })
  expect(limited.status).toBe(429)
  expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
  const logout = await f.request('/auth/session', headers, 'DELETE')
  expect(logout.status).toBe(204)
  expect(logout.headers.get('set-cookie')).toContain('open_flow_user_session=;')
  expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')
})

it('limits concurrent password logins while verification is running', async () => {
  const f = await fixture()
  const account = await f.create('concurrent@example.com')
  const responses = await Promise.all([
    f.request('/auth/user-session', {}, 'POST', { email: account.user.email, password: account.password }),
    f.request('/auth/user-session', {}, 'POST', { email: account.user.email, password: account.password }),
  ])
  expect(responses.map((response) => response.status).toSorted()).toEqual([200, 429])
  expect((await f.request('/auth/user-session', {}, 'POST', { email: account.user.email, password: account.password })).status).toBe(200)
})

it('issues private, persistent personal tokens and enforces owner isolation through REST and MCP', async () => {
  const f = await fixture()
  const alice = await f.create('token-alice@example.com')
  const bob = await f.create('token-bob@example.com', 'admin')
  const ah = await f.login(alice.user.email, alice.password)
  const bh = await f.login(bob.user.email, bob.password)
  const own = await f.flow(ah)
  const other = await f.flow(bh)
  const response = await f.request('/auth/tokens', ah, 'POST', { name: '  My MCP client  ' })
  expect(response.status).toBe(201)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const created = (await response.json()) as { token: string; credential: { tokenId: string; name: string; createdAt: number } }
  expect(created.credential.name).toBe('My MCP client')
  const headers = { authorization: `Bearer ${created.token}` }
  const operatorStore = new OperatorStore(f.database)
  operatorStore.claim(token)
  const storedSession = new OperatorSession(operatorStore, undefined, false, undefined, Date.now, f.service.control.users)
  expect(await storedSession.actor(new Request('http://localhost/v1/mcp', { headers }))).toBe(alice.user.userId)
  expect(await storedSession.actor(new Request('http://localhost/v1/mcp', { headers: administrator }))).toBe('operator')
  const listed = await (await f.request('/auth/tokens', ah)).json()
  expect(listed).toEqual({ version: 1, tokens: [created.credential] })
  expect(JSON.stringify(f.database.connection.prepare('SELECT * FROM user_tokens').all())).not.toContain(created.token)
  expect(await (await f.request('/auth/tokens', bh)).json()).toEqual({ version: 1, tokens: [] })
  expect((await f.request('/config', headers)).status).toBe(403)
  expect((await f.request(`/v1/flows/${other.flowId}`, headers)).status).toBe(404)
  const mcp = await f.mcp('flow_list', {}, headers)
  expect(mcp.isError).not.toBe(true)
  expect(JSON.stringify(mcp.structuredContent)).toContain(own.flowId)
  expect(JSON.stringify(mcp.structuredContent)).not.toContain(other.flowId)
  const ownRead = await f.mcp('flow_read', { flowId: own.flowId }, headers)
  expect(ownRead.isError).not.toBe(true)
  expect(ownRead.structuredContent).toMatchObject({ flowId: own.flowId, revision: own.draftRevisionId })
  const denied = await f.mcp('flow_read', { flowId: other.flowId }, headers)
  expect(denied.isError).toBe(true)
  expect(JSON.stringify(denied)).toContain('flow.not-found')
  const before = f.service.control.getDraft(other.flowId)
  const edit = {
    baseRevision: before.revisionId,
    requestId: 'foreign-edit',
    edits: [{ op: 'node.add', as: 'stolen', type: 'manual', name: 'Unauthorized trigger' }],
  }
  const deniedEdit = await f.mcp('flow_edit', { flowId: other.flowId, ...edit }, headers)
  expect(deniedEdit.isError).toBe(true)
  expect(JSON.stringify(deniedEdit)).toContain('flow.not-found')
  for (const [operation, body] of [
    ['read', {}],
    ['edit', edit],
  ] as const) {
    const deniedResponse = await f.request(`/v1/flows/${other.flowId}/authoring/${operation}`, headers, 'POST', body)
    expect(deniedResponse.status).toBe(404)
    expect(await deniedResponse.text()).toContain('flow.not-found')
  }
  expect(f.service.control.getDraft(other.flowId)).toEqual(before)
  const reopened = Database.open(f.file)
  expect(new PersonalTokenStore(reopened.connection).tokenActor(created.token)).toBe(alice.user.userId)
  reopened.close()
  expect((await f.request(`/auth/tokens/${created.credential.tokenId}`, bh, 'DELETE')).status).toBe(204)
  expect((await f.request('/v1/flows', headers)).status).toBe(200)
  expect((await f.request(`/auth/tokens/${created.credential.tokenId}`, ah, 'DELETE')).status).toBe(204)
  expect((await f.request('/v1/flows', headers)).status).toBe(401)
  expect((await f.request('/v1/flows', { ...ah, ...headers })).status).toBe(401)
})

it('requires browser login to manage tokens and validates names and request origins', async () => {
  const f = await fixture()
  const account = await f.create('token-login@example.com')
  const cookie = await f.login(account.user.email, account.password)
  const created = (await (await f.request('/auth/tokens', cookie, 'POST', { name: 'Client' })).json()) as { token: string }
  for (const headers of [{}, administrator, { authorization: `Bearer ${created.token}` }]) {
    expect((await f.request('/auth/tokens', headers)).status).toBe(401)
    expect((await f.request('/auth/tokens', headers, 'POST', { name: 'No' })).status).toBe(401)
  }
  for (const body of [{ name: '' }, { name: '  ' }, { name: 'x'.repeat(101) }, { name: 'Name', userId: 'operator' }]) {
    expect((await f.request('/auth/tokens', cookie, 'POST', body)).status).toBe(400)
  }
  expect((await f.request('/auth/tokens', { ...cookie, origin: 'https://evil.example' }, 'POST', { name: 'No' })).status).toBe(403)
  expect((await f.request('/v1/flows', { authorization: `Bearer ${created.token}x` })).status).toBe(401)
})

it('invalidates every personal token on password reset or account disable, without reviving tokens on re-enable', async () => {
  const f = await fixture()
  const account = await f.create('token-reset@example.com')
  let cookie = await f.login(account.user.email, account.password)
  const first = (await (await f.request('/auth/tokens', cookie, 'POST', { name: 'First' })).json()) as { token: string }
  const reset = (await (await f.request(`/auth/users/${account.user.userId}/password`, administrator, 'POST', { expectedRevision: 1 })).json()) as {
    password: string
  }
  expect((await f.request('/v1/flows', { authorization: `Bearer ${first.token}` })).status).toBe(401)
  cookie = await f.login(account.user.email, reset.password)
  expect(await (await f.request('/auth/tokens', cookie)).json()).toEqual({ version: 1, tokens: [] })
  const second = (await (await f.request('/auth/tokens', cookie, 'POST', { name: 'Second' })).json()) as { token: string }
  expect((await f.request(`/auth/users/${account.user.userId}`, administrator, 'PUT', { enabled: false, expectedRevision: 2 })).status).toBe(200)
  expect((await f.request('/v1/flows', { authorization: `Bearer ${second.token}` })).status).toBe(401)
  expect((await f.request(`/auth/users/${account.user.userId}`, administrator, 'PUT', { enabled: true, expectedRevision: 3 })).status).toBe(200)
  expect((await f.request('/v1/flows', { authorization: `Bearer ${second.token}` })).status).toBe(401)
})

it('lets the Operator issue, list and revoke private tokens with REST and MCP ownership intact', async () => {
  const f = await fixture()
  const login = await f.request('/auth/session', {}, 'POST', { token })
  const cookie = { cookie: login.headers.get('set-cookie')!.match(/open_flow_operator_session=[^;]+/)![0] }
  const own = await f.flow(administrator)
  const other = await f.create('operator-token-other@example.com')
  const otherCookie = await f.login(other.user.email, other.password)
  const foreign = await f.flow(otherCookie)
  const response = await f.request('/auth/tokens', cookie, 'POST', { name: 'Operator Agent' })
  expect(response.status).toBe(201)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const created = (await response.json()) as { token: string; credential: { tokenId: string } }
  const headers = { authorization: `Bearer ${created.token}` }
  expect(await (await f.request('/auth/tokens', cookie)).json()).toEqual({ version: 1, tokens: [created.credential] })
  expect(JSON.stringify(f.database.connection.prepare('SELECT * FROM user_tokens').all())).not.toContain(created.token)
  expect((await f.request('/v1/flows', headers)).status).toBe(200)
  expect((await f.request(`/v1/flows/${foreign.flowId}`, headers)).status).toBe(404)
  expect(await (await f.request('/auth/session', headers)).json()).toMatchObject({ user: { userId: 'operator', role: 'admin' } })
  const mcp = await f.mcp('flow_list', {}, headers)
  expect(mcp.isError).not.toBe(true)
  expect(JSON.stringify(mcp.structuredContent)).toContain(own.flowId)
  expect(JSON.stringify(mcp.structuredContent)).not.toContain(foreign.flowId)
  expect((await f.request('/auth/tokens', headers)).status).toBe(401)
  expect((await f.request('/auth/tokens', { ...cookie, origin: 'https://evil.example' }, 'POST', { name: 'No' })).status).toBe(403)
  expect((await f.request('/auth/tokens', cookie, 'POST', { name: 'No', userId: other.user.userId })).status).toBe(400)
  expect(await (await f.request('/auth/tokens', otherCookie)).json()).toEqual({ version: 1, tokens: [] })
  await f.request(`/auth/tokens/${created.credential.tokenId}`, otherCookie, 'DELETE')
  expect((await f.request('/v1/flows', headers)).status).toBe(200)
  const reopened = Database.open(f.file)
  try {
    const restored = new OperatorSession(new OperatorStore(reopened), token, false)
    expect(await restored.actor(new Request('http://localhost/v1/flows', { headers }))).toBe('operator')
    const rotated = new OperatorSession(new OperatorStore(reopened), token + '-rotated', false)
    expect(await rotated.actor(new Request('http://localhost/v1/flows', { headers }))).toBeUndefined()
    const unconfigured = new OperatorSession(new OperatorStore(reopened), undefined, false)
    expect(await unconfigured.actor(new Request('http://localhost/v1/flows', { headers }))).toBeUndefined()
  } finally {
    reopened.close()
  }
  expect((await f.request(`/auth/tokens/${created.credential.tokenId}`, cookie, 'DELETE')).status).toBe(204)
  expect((await f.request('/v1/flows', headers)).status).toBe(401)
  expect((await f.request('/v1/flows', administrator)).status).toBe(200)
})

it('supports personal tokens for a claimed Operator without an email user store', async () => {
  const f = await fixture()
  const store = new OperatorStore(f.database)
  expect(store.claim(token)).toBe(true)
  const session = new OperatorSession(store, undefined, false)
  const app = createOperatorApp(session)
  const login = await app.request('/session', { method: 'POST', body: JSON.stringify({ version: 1, token }) })
  const cookie = login.headers.get('set-cookie')!.match(/open_flow_operator_session=[^;]+/)![0]
  const response = await app.request('/tokens', { method: 'POST', headers: { cookie }, body: JSON.stringify({ version: 1, name: 'Agent' }) })
  expect(response.status).toBe(201)
  const created = (await response.json()) as { token: string; credential: { tokenId: string } }
  const request = new Request('http://localhost/v1/mcp', { headers: { authorization: `Bearer ${created.token}` } })
  expect(await session.actor(request)).toBe('operator')
  expect(await new OperatorSession(new OperatorStore(f.database), undefined, false).actor(request)).toBe('operator')
  expect(await new OperatorSession(new OperatorStore(f.database), token, false).actor(request)).toBeUndefined()
  expect((await app.request('/session', { method: 'POST', body: JSON.stringify({ version: 1, token: created.token }) })).status).toBe(401)
  await app.request(`/tokens/${created.credential.tokenId}`, { method: 'DELETE', headers: { cookie } })
  expect(await session.actor(request)).toBeUndefined()
})
