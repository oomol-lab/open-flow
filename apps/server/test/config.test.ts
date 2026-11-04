import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createConfigApp } from '../node/deployment/config.ts'
import { OomolLogin } from '../node/deployment/oomol-login.ts'
import { Settings } from '../node/deployment/settings.ts'
import { Database } from '../node/storage/database.ts'
import { SettingsStore } from '../node/storage/settings-store.ts'
import { createServerApp } from '../node/transport/http.ts'
import { closeService, openService } from './serviceFixture.ts'

const directories: string[] = []
const stores: Database[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const store of stores.splice(0)) store.close()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function databaseFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-settings-'))
  directories.push(directory)
  const file = path.join(directory, 'open-flow.sqlite')
  Database.open(file).close()
  return file
}

function settings(file: string, environment: ConstructorParameters<typeof Settings>[1] = {}): Settings {
  const database = Database.open(file)
  stores.push(database)
  return new Settings(new SettingsStore(database), environment)
}

function configurationRequest(method: string, body: unknown): RequestInit {
  return { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method }
}

it('advertises the configured MCP address to members and falls back to the browser origin when unset', async () => {
  const file = await databaseFile()
  const service = await openService(file)
  const configured = settings(file)
  const { user } = await service.control.users.create('member@example.com', 'user')
  const app = createServerApp(service, { resolveControlActor: () => user.userId, settings: configured })
  const anonymous = createServerApp(service, { settings: configured })
  expect((await anonymous.request('/config/agent-access')).status).toBe(401)
  expect((await app.request('/config')).status).toBe(403)

  const fallback = await app.request('/config/agent-access')
  expect(fallback.status).toBe(200)
  expect(fallback.headers.get('cache-control')).toBe('no-store')
  expect(await fallback.json()).toEqual({ version: 1, mcpUrl: '/v1/mcp' })

  expect(configured.putIntegration(1, 'https://flows.example.com', 'integration-callback-key-32-bytes')).toBe('saved')
  expect(await (await app.request('/config/agent-access')).json()).toEqual({ version: 1, mcpUrl: 'https://flows.example.com/v1/mcp' })

  const environment = createServerApp(service, {
    resolveControlActor: () => user.userId,
    settings: settings(file, {
      integrationPublicOrigin: 'https://environment.example.com',
      integrationCallbackKey: 'environment-integration-key-32-bytes',
    }),
  })
  expect(await (await environment.request('/config/agent-access')).json()).toEqual({ version: 1, mcpUrl: 'https://environment.example.com/v1/mcp' })

  expect(configured.deleteIntegration(2)).toBe('saved')
  expect(await (await app.request('/config/agent-access')).json()).toEqual({ version: 1, mcpUrl: '/v1/mcp' })
  await closeService(service)
})

it('keeps LLM invocations on the configuration snapshot taken when they start', async () => {
  const file = await databaseFile()
  const configured = settings(file)
  expect(configured.status()).toEqual({
    services: { mode: null, managed: false, profiles: expect.any(Object) },
    connector: {
      console: { configured: false, source: 'none' },
      runtime: { configured: false, source: 'none', tokenConfigured: false },
    },
    integration: { configured: false, source: 'none' },
    llm: {
      mode: null,
      managed: false,
      custom: { origin: '', tokenConfigured: false },
      oomolAvailable: false,
      oomolManaged: false,
      configured: false,
      source: 'none',
      tokenConfigured: false,
    },
    revision: 1,
    version: 1,
  })
  expect(configured.putLlm(1, 'https://models.example.com', 'first-token')).toBe('saved')
  const first = configured.llm()
  expect(first).toBeDefined()
  expect(configured.putLlm(2, 'https://models.example.com', 'second-token')).toBe('saved')
  const second = configured.llm()
  expect(second).toBeDefined()
  if (first == null || second == null) throw new Error('Expected both LLM snapshots to be configured.')
  const authorizations: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      authorizations.push(new Headers(init?.headers).get('authorization') ?? '')
      return Response.json({ choices: [{ message: { content: 'done' } }] })
    }),
  )
  const input = {
    input: { model: {}, template: [{ content: 'Hello', role: 'user' }] },
    invocationId: 'invoke',
    mode: 'chat',
    signal: new AbortController().signal,
    version: 1,
  } as const

  await expect(first(input)).resolves.toMatchObject({ kind: 'completed' })
  await expect(second(input)).resolves.toMatchObject({ kind: 'completed' })
  expect(authorizations).toEqual(['Bearer first-token', 'Bearer second-token'])

  expect(settings(file).status()).toEqual({
    services: { mode: null, managed: false, profiles: expect.any(Object) },
    connector: {
      console: { configured: false, source: 'none' },
      runtime: { configured: false, source: 'none', tokenConfigured: false },
    },
    integration: { configured: false, source: 'none' },
    llm: {
      mode: 'custom',
      managed: false,
      custom: { origin: 'https://models.example.com', tokenConfigured: true },
      oomolAvailable: false,
      oomolManaged: false,
      configured: true,
      origin: 'https://models.example.com',
      source: 'settings',
      tokenConfigured: true,
    },
    revision: 3,
    version: 1,
  })
})

it('locks an environment LLM and derives LLM in hosted mode', async () => {
  const file = await databaseFile()
  const stored = settings(file)
  expect(stored.putLlm(1, 'https://stored.example.com', 'stored-token')).toBe('saved')

  const environment = settings(file, { llmOrigin: 'https://environment.example.com', llmToken: 'environment-token' })
  expect(environment.status().llm).toMatchObject({
    configured: true,
    origin: 'https://environment.example.com',
    source: 'environment',
    tokenConfigured: true,
  })
  expect(environment.putLlm(2, 'https://ignored.example.com', 'ignored-token')).toBe('environment')
  expect(environment.deleteLlm(2)).toBe('environment')

  expect(stored.deleteLlm(2)).toBe('saved')
  const derived = settings(file, { connectorOrigin: 'https://connector.oomol.com', connectorToken: 'connector-token' })
  expect(derived.status().llm.configured).toBe(false)
  expect(derived.selectLlm(3, 'oomol')).toBe('saved')
  expect(derived.status().llm).toMatchObject({ configured: true, origin: 'https://new-llm.oomol.com', source: 'derived', tokenConfigured: true })
})

it('persists Connector and Integration settings without exposing their secrets', async () => {
  const file = await databaseFile()
  const service = await openService(file)
  const configured = settings(file)
  const app = createServerApp(service, { resolveControlActor: () => 'operator', settings: configured })
  try {
    const connector = await app.request('/config/connector', {
      body: JSON.stringify({ expectedRevision: 1, origin: 'https://connector.example.com/api', token: 'connector-secret', version: 1 }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    expect(connector.status).toBe(200)
    expect(await connector.text()).not.toContain('connector-secret')

    const console = await app.request('/config/connector-console', {
      body: JSON.stringify({ expectedRevision: 2, origin: 'https://console.example.com', version: 1 }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    expect(console.status).toBe(200)

    const integration = await app.request('/config/integration', {
      body: JSON.stringify({
        callbackKey: 'integration-callback-key-32-bytes',
        expectedRevision: 3,
        publicOrigin: 'https://flows.example.com',
        version: 1,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    expect(integration.status).toBe(200)
    expect(await integration.text()).not.toContain('integration-callback-key-32-bytes')

    expect(settings(file).status()).toMatchObject({
      connector: {
        console: { configured: true, origin: 'https://console.example.com', source: 'settings' },
        runtime: { configured: true, source: 'settings', tokenConfigured: true },
      },
      integration: { configured: true, publicOrigin: 'https://flows.example.com', source: 'settings' },
      revision: 4,
    })

    const environment = settings(file, {
      connectorConsoleOrigin: 'https://environment-console.example.com',
      connectorOrigin: 'https://environment-connector.example.com',
      connectorToken: 'environment-token',
      integrationCallbackKey: 'environment-integration-key-32-bytes',
      integrationPublicOrigin: 'https://environment-flows.example.com',
    })
    expect(environment.deleteConnector(4)).toBe('environment')
    expect(environment.deleteConnectorConsole(4)).toBe('environment')
    expect(environment.deleteIntegration(4)).toBe('environment')
    expect(environment.status()).toMatchObject({
      connector: { console: { source: 'environment' }, runtime: { source: 'environment' } },
      integration: { source: 'environment' },
    })
  } finally {
    await closeService(service)
  }
})

it('authenticates configuration requests, hides tokens, and rejects stale or environment-managed writes', async () => {
  const file = await databaseFile()
  const service = await openService(file)
  const configured = settings(file)
  const anonymous = createServerApp(service, { settings: configured })
  const app = createServerApp(service, { resolveControlActor: () => 'operator', settings: configured })
  try {
    expect((await anonymous.request('/config')).status).toBe(401)
    expect(await (await app.request('/config')).json()).toEqual({
      services: { mode: null, managed: false, profiles: expect.any(Object) },
      connector: {
        console: { configured: false, source: 'none' },
        runtime: { configured: false, source: 'none', tokenConfigured: false },
      },
      integration: { configured: false, source: 'none' },
      llm: {
        mode: null,
        managed: false,
        custom: { origin: '', tokenConfigured: false },
        oomolAvailable: false,
        oomolManaged: false,
        configured: false,
        source: 'none',
        tokenConfigured: false,
      },
      revision: 1,
      version: 1,
    })
    const saved = await app.request('/config/llm', {
      body: JSON.stringify({ expectedRevision: 1, origin: 'https://models.example.com', token: 'private-token', version: 1 }),
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })
    expect(saved.status).toBe(200)
    expect(await saved.text()).not.toContain('private-token')
    expect(
      (
        await app.request('/config/llm', {
          body: JSON.stringify({ expectedRevision: 1, origin: 'https://stale.example.com', token: 'stale-token', version: 1 }),
          headers: { 'content-type': 'application/json' },
          method: 'PUT',
        })
      ).status,
    ).toBe(409)

    const environment = settings(file, { llmOrigin: 'https://environment.example.com', llmToken: 'environment-token' })
    const locked = createServerApp(service, { resolveControlActor: () => 'operator', settings: environment })
    const rejected = await locked.request('/config/llm', {
      body: JSON.stringify({ expectedRevision: 2, version: 1 }),
      headers: { 'content-type': 'application/json' },
      method: 'DELETE',
    })
    expect(rejected.status).toBe(409)
    expect(await rejected.json()).toMatchObject({ error: { code: 'configuration.environment-managed' } })
  } finally {
    await closeService(service)
  }
})

it('rejects malformed UTF-8 in configuration JSON bodies', async () => {
  const file = await databaseFile()
  const service = await openService(file)
  const configured = settings(file)
  const app = createServerApp(service, { resolveControlActor: () => 'operator', settings: configured })
  try {
    const prefix = new TextEncoder().encode('{"expectedRevision":1,"origin":"https://models.example.com","token":"')
    const suffix = new TextEncoder().encode('","version":1}')
    const malformed = new Uint8Array(prefix.length + 2 + suffix.length)
    malformed.set(prefix)
    malformed.set([0xc3, 0x28], prefix.length)
    malformed.set(suffix, prefix.length + 2)

    const response = await app.request('/config/llm', {
      body: malformed,
      headers: { 'content-type': 'application/json' },
      method: 'PUT',
    })

    expect(response.status).toBe(400)
    expect(configured.status().llm.configured).toBe(false)
  } finally {
    await closeService(service)
  }
})

it('mounts independent Connector proxies with live settings and upstream cache headers', async () => {
  const file = await databaseFile()
  const service = await openService(file)
  const configured = settings(file)
  const app = createServerApp(service, { resolveControlActor: () => 'operator', settings: configured })
  const fetcher = vi.fn(
    async () => new Response('{ "success": true, "data": [] }', { headers: { 'etag': '"upstream"', 'cache-control': 'public, max-age=120' } }),
  )
  vi.stubGlobal('fetch', fetcher)
  try {
    expect((await (await app.request('/v1/connector/proxy/apps')).json()).error.code).toBe('connector.unconfigured')
    expect(configured.putConnector(1, 'https://connector.example', 'first')).toBe('saved')
    for (const resource of ['providers', 'actions', 'apps']) {
      const response = await app.request(`/v1/connector/proxy/${resource}`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('{ "success": true, "data": [] }')
      expect(response.headers.get('etag')).toBe('"upstream"')
      expect(response.headers.get('cache-control')).toBe('public, max-age=120')
    }
    expect(configured.putConnector(2, 'https://next.example', 'second')).toBe('saved')
    await app.request('/v1/connector/proxy/apps')
    const [target, init] = fetcher.mock.calls[3] as unknown as [URL, RequestInit]
    expect(target.origin).toBe('https://next.example')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer second')
    expect((await app.request('/v1/connector/proxy/apps?flowId=missing')).status).toBe(404)
    const anonymous = createServerApp(service, { settings: configured })
    expect((await anonymous.request('/v1/connector/proxy/apps')).status).toBe(401)
    expect(fetcher).toHaveBeenCalledTimes(4)
    const environment = settings(file, { connectorOrigin: 'https://environment.example', connectorToken: 'env' })
    expect(environment.connectorConfiguration()).toEqual({ origin: 'https://environment.example', token: 'env' })
  } finally {
    await closeService(service)
  }
})

it.each(['http://localhost:3000', 'https://flow.example.com'])(
  'authorizes OOMOL on %s into a draft without persisting the API key or exposing private authorization state',
  async (origin) => {
    const file = await databaseFile()
    const service = await openService(file)
    const configured = settings(file)
    const app = createServerApp(service, { resolveControlActor: () => 'operator', settings: configured })
    const anonymous = createServerApp(service, { settings: configured })
    const endpoint = new URL('/config/connector/oomol-login', origin).href
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: 'waiting', code: 'ABC123', expires_in: 600, verify_code_url: 'https://console.oomol.com/login/device' }))
      .mockResolvedValueOnce(Response.json({ status: 'waiting' }))
      .mockResolvedValueOnce(Response.json({ status: 'verified', endpoint: 'oomol.com', api_key: 'private-oomol-key' }))
    vi.stubGlobal('fetch', fetcher)
    try {
      expect((await anonymous.request(endpoint, configurationRequest('POST', { expectedRevision: 1, version: 1 }))).status).toBe(401)
      expect(fetcher).not.toHaveBeenCalled()
      const response = await app.request(endpoint, configurationRequest('POST', { expectedRevision: 1, version: 1 }))
      expect(response.status).toBe(200)
      const session = await response.json()
      expect(session.url).toBe('https://console.oomol.com/login/device?user_code=ABC123')
      const stat = JSON.parse(fetcher.mock.calls[0]![1].body).stat
      expect(stat).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(JSON.stringify(session)).not.toContain(stat)
      const poll = configurationRequest('PUT', { id: session.id, version: 1 })
      expect(await (await app.request(endpoint, poll)).json()).toEqual({ status: 'waiting', version: 1 })
      const completed = await app.request(endpoint, poll)
      expect(completed.status).toBe(200)
      expect(completed.headers.get('cache-control')).toBe('no-store')
      expect(await completed.json()).toEqual({ status: 'authorized', connectorOrigin: 'https://connector.oomol.com', apiKey: 'private-oomol-key', version: 1 })
      expect(settings(file).connectorConfiguration()).toBeUndefined()
      expect(configured.status().revision).toBe(1)
      expect(configured.status().services.profiles.oomol.connectorTokenConfigured).toBe(false)
      expect(JSON.stringify(configured.status())).not.toContain('private-oomol-key')
      expect((await app.request(endpoint, poll)).status).toBe(410)
      expect(fetcher.mock.calls[1]![0].searchParams.get('stat')).toBe(stat)
    } finally {
      await closeService(service)
    }
  },
)

it('rejects environment-managed and stale OOMOL authorization before contacting the upstream', async () => {
  const file = await databaseFile()
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const signal = new AbortController().signal
  await expect(
    new OomolLogin(settings(file, { connectorOrigin: 'https://connector.oomol.com', connectorToken: 'environment' })).start('operator', 1, signal),
  ).rejects.toMatchObject({ code: 'configuration.environment-managed' })
  await expect(new OomolLogin(settings(file)).start('operator', 2, signal)).rejects.toMatchObject({ code: 'configuration.conflict' })
  expect(fetcher).not.toHaveBeenCalled()
})

it.each(['cancel', 'replace', 'conflict', 'expire', 'actor'])('does not save an obsolete OOMOL authorization: %s', async (outcome) => {
  const file = await databaseFile()
  const configured = settings(file)
  const login = new OomolLogin(configured)
  const signal = new AbortController().signal
  const verified = Promise.withResolvers<Response>()
  const fetcher = vi
    .fn()
    .mockImplementation(async () =>
      Response.json({ status: 'waiting', code: 'ABC123', expires_in: 600, verify_code_url: 'https://console.oomol.com/login/device' }),
    )
  vi.stubGlobal('fetch', fetcher)
  const session = await login.start('operator', 1, signal)
  if (outcome == 'actor') {
    await expect(login.poll('other-operator', session.id, signal)).rejects.toMatchObject({ code: 'configuration.login-expired' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    return
  }
  fetcher.mockReturnValueOnce(verified.promise)
  const polling = login.poll('operator', session.id, signal)
  const rejected = expect(polling).rejects.toMatchObject({ code: outcome == 'conflict' ? 'configuration.conflict' : 'configuration.login-expired' })
  if (outcome == 'cancel') login.cancel('operator', session.id)
  if (outcome == 'replace') await login.start('operator', 1, signal)
  if (outcome == 'conflict') configured.putConnector(1, 'https://custom.example.com', 'manual-key')
  const now = vi.spyOn(Date, 'now')
  if (outcome == 'expire') now.mockReturnValue(Date.now() + 600_001)
  verified.resolve(Response.json({ status: 'verified', endpoint: 'oomol.com', api_key: 'obsolete-key' }))
  try {
    await rejected
    expect(configured.connectorConfiguration()).toEqual(outcome == 'conflict' ? { origin: 'https://custom.example.com/', token: 'manual-key' } : undefined)
  } finally {
    now.mockRestore()
  }
})

it.each([
  'https://attacker.example/login/device',
  'http://console.oomol.com/login/device',
  'https://console.oomol.com:444/login/device',
  'https://console.oomol.com/settings',
])('rejects an untrusted authorization URL: %s', async (url) => {
  const file = await databaseFile()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'waiting', code: 'ABC123', expires_in: 600, verify_code_url: url })))
  await expect(new OomolLogin(settings(file)).start('operator', 1, new AbortController().signal)).rejects.toMatchObject({
    code: 'configuration.login-unavailable',
  })
})

it('uses the configured OOMOL development environment and rejects mismatched result credentials', async () => {
  const file = await databaseFile()
  const configured = settings(file)
  configured.putConnector(1, 'https://connector.oomol.dev', 'previous-key')
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ status: 'waiting', code: 'ABC123', expires_in: 600, verify_code_url: 'https://console.oomol.dev/login/device' }))
    .mockResolvedValueOnce(Response.json({ status: 'verified', endpoint: 'oomol.com', api_key: 'wrong-environment-key' }))
  vi.stubGlobal('fetch', fetcher)
  const login = new OomolLogin(configured)
  const signal = new AbortController().signal
  const session = await login.start('operator', 2, signal)
  expect(fetcher.mock.calls[0]![0].origin).toBe('https://api.oomol.dev')
  await expect(login.poll('operator', session.id, signal)).rejects.toMatchObject({ code: 'configuration.login-unavailable' })
  expect(configured.connectorConfiguration()?.token).toBe('previous-key')
})

const customServices = {
  connectorOrigin: 'https://connector.example.com',
  connectorToken: 'connector-secret',
  consoleOrigin: 'https://console.example.com',
  llmOrigin: 'https://models.example.com',
  llmToken: 'model-secret',
}

it('keeps legacy grouped writes atomic and subsequent Connector changes independent', async () => {
  const configured = settings(await databaseFile())
  const changed = vi.fn()
  const app = createConfigApp(configured, async () => 'operator', changed)
  expect((await app.request('/services', configurationRequest('PUT', { ...customServices, expectedRevision: 1, version: 1 }))).status).toBe(200)
  expect(configured.llm()?.config).toEqual({ origin: customServices.llmOrigin, token: customServices.llmToken })
  const before = configured.status()
  for (const [expectedRevision, llmToken, status] of [
    [2, '', 400],
    [1, 'stale', 409],
  ] as const) {
    expect((await app.request('/services', configurationRequest('PUT', { ...customServices, expectedRevision, llmToken, version: 1 }))).status).toBe(status)
    expect(configured.status()).toEqual(before)
  }
  expect(changed).toHaveBeenCalledOnce()
  expect(configured.putConnector(2, 'https://connector.oomol.com', 'hosted-secret')).toBe('saved')
  expect(configured.llm()?.config).toEqual({ origin: customServices.llmOrigin, token: customServices.llmToken })
  expect(configured.deleteServices(3)).toBe('saved')
  expect(configured.connector()).toBeUndefined()
  expect(configured.llm()?.config?.token).toBe(customServices.llmToken)
})

it('selects LLM independently, reuses OOMOL authorization, and never falls back after an OOMOL failure', async () => {
  const file = await databaseFile()
  const configured = settings(file)
  const app = createConfigApp(configured, async () => 'operator')
  expect(configured.putLlm(1, customServices.llmOrigin, 'custom-model-key')).toBe('saved')
  expect(configured.status().services.mode).toBeNull()
  expect(configured.putConnector(2, 'https://connector.oomol.dev', 'hosted-key')).toBe('saved')
  expect(configured.llm()?.config?.token).toBe('custom-model-key')
  expect((await app.request('/llm/mode', configurationRequest('PUT', { mode: 'oomol', expectedRevision: 3, version: 1 }))).status).toBe(200)
  expect(configured.putConnector(4, 'https://connector.example.com', 'connector-key')).toBe('saved')
  expect(settings(file).llm()?.config).toEqual({ origin: 'https://new-llm.oomol.dev', token: 'hosted-key' })
  expect(configured.connectorConfiguration()?.token).toBe('connector-key')

  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(
    configured.llm()!({
      input: { model: {}, template: [{ content: 'Hello', role: 'user' }] },
      invocationId: 'invoke',
      mode: 'chat',
      signal: new AbortController().signal,
      version: 1,
    }),
  ).resolves.toMatchObject({ kind: 'failed', code: 'llm.unavailable' })
  expect(fetcher).toHaveBeenCalledOnce()
  expect(String(fetcher.mock.calls[0]![0])).toBe('https://new-llm.oomol.dev/v1/chat/completions')
  expect(new Headers(fetcher.mock.calls[0]![1].headers).get('authorization')).toBe('Bearer hosted-key')
  expect(configured.status().llm.mode).toBe('oomol')

  const saved = await app.request('/llm', configurationRequest('PUT', { origin: customServices.llmOrigin, token: null, expectedRevision: 5, version: 1 }))
  expect(saved.status).toBe(200)
  expect(configured.llm()?.config?.token).toBe('custom-model-key')
  expect(configured.connectorConfiguration()?.token).toBe('connector-key')
  expect(configured.selectLlm(6, 'oomol')).toBe('saved')
  expect(configured.saveProfile(7, 'oomol', { connectorOrigin: 'https://connector.oomol.dev', connectorToken: '', consoleOrigin: '' })).toBe('saved')
  expect(configured.llm()).toBeUndefined()
  expect(settings(file).status().llm).toMatchObject({ mode: 'oomol', configured: false, oomolAvailable: false, custom: { tokenConfigured: true } })
  expect(JSON.stringify(configured.status())).not.toMatch(/hosted-key|connector-key|custom-model-key/)
})

it('saves custom LLM configuration without selecting it or changing Connector', async () => {
  const file = await databaseFile()
  const configured = settings(file)
  expect(configured.putLlm(1, 'https://models.example.com', 'model-key')).toBe('saved')
  expect(configured.putConnector(2, 'https://connector.oomol.com', 'hosted-key')).toBe('saved')
  expect(configured.selectLlm(3, 'oomol')).toBe('saved')
  expect(configured.putConnector(4, 'https://connector.example.com', 'connector-key')).toBe('saved')
  const app = createConfigApp(configured, async () => 'operator')
  const response = await app.request(
    '/llm/custom',
    configurationRequest('PUT', {
      origin: 'https://next-models.example.com',
      token: null,
      version: 1,
      expectedRevision: 5,
    }),
  )
  expect(response.status).toBe(200)
  expect(await response.text()).not.toMatch(/model-key|hosted-key|connector-key/)
  const reopened = settings(file)
  expect(reopened.llm()?.config).toEqual({ origin: 'https://new-llm.oomol.com', token: 'hosted-key' })
  expect(reopened.connectorConfiguration()?.token).toBe('connector-key')
  expect(reopened.status().llm.custom).toEqual({ origin: 'https://next-models.example.com', tokenConfigured: true })
  expect(reopened.selectLlm(6, 'custom')).toBe('saved')
  expect(reopened.llm()?.config).toEqual({ origin: 'https://next-models.example.com', token: 'model-key' })
})

it('saves and switches Connector profiles without changing LLM settings or losing credentials', async () => {
  const configured = settings(await databaseFile())
  const app = createConfigApp(configured, async () => 'operator')
  const hosted = { connectorOrigin: 'https://connector.oomol.com', connectorToken: 'hosted-key', consoleOrigin: '' }
  const custom = { connectorOrigin: 'https://connector.example.com', connectorToken: 'custom-key', consoleOrigin: 'https://console.example.com' }
  expect(configured.putLlm(1, 'https://models.example.com', 'model-key')).toBe('saved')
  const llm = configured.status().llm
  for (const [mode, value] of [
    ['oomol', hosted],
    ['custom', custom],
  ] as const) {
    expect(
      (await app.request('/services/' + mode, configurationRequest('PUT', { ...value, version: 1, expectedRevision: configured.status().revision }))).status,
    ).toBe(200)
    expect(configured.status().llm).toEqual({ ...llm, oomolAvailable: true })
  }
  expect(configured.connectorConfiguration()).toBeUndefined()
  for (const mode of ['custom', 'oomol', 'custom'] as const) {
    expect(configured.selectProfile(configured.status().revision, mode)).toBe('saved')
    expect(configured.connectorConfiguration()?.token).toBe(mode == 'oomol' ? 'hosted-key' : 'custom-key')
    expect(configured.llm()?.config?.token).toBe('model-key')
  }
  const response = await app.request(
    '/services/custom',
    configurationRequest('PUT', {
      ...custom,
      connectorToken: null,
      consoleOrigin: '',
      expectedRevision: configured.status().revision,
      version: 1,
    }),
  )
  expect(response.status).toBe(200)
  expect(configured.connectorConfiguration()?.token).toBe('custom-key')
  expect(configured.llm()?.config?.token).toBe('model-key')
})

it('locks only the environment-managed block and gives an explicit environment LLM precedence', async () => {
  const file = await databaseFile()
  const configured = settings(file, { llmOrigin: 'https://environment.example.com', llmToken: 'environment-key' })
  expect(configured.status().services.managed).toBe(false)
  expect(configured.putConnector(1, 'https://connector.oomol.com', 'hosted-key')).toBe('saved')
  expect(configured.selectProfile(2, 'custom')).toBe('saved')
  expect(configured.llm()?.config).toEqual({ origin: 'https://environment.example.com', token: 'environment-key' })
  expect(configured.putLlm(3, 'https://ignored.example.com', 'ignored')).toBe('environment')
  expect(configured.selectLlm(3, 'oomol')).toBe('environment')
  expect(configured.deleteLlm(3)).toBe('environment')
  const connector = settings(file, { connectorOrigin: 'https://connector.example.com', connectorToken: 'environment-connector' })
  expect(connector.selectProfile(3, 'oomol')).toBe('environment')
  expect(connector.putLlm(3, 'https://models.example.com', 'model-key')).toBe('saved')
  expect(connector.status().llm.managed).toBe(false)
  expect(connector.connectorConfiguration()?.token).toBe('environment-connector')
  const hosted = settings(await databaseFile(), { connectorOrigin: 'https://connector.oomol.com', connectorToken: 'environment-hosted' })
  expect(hosted.status().llm).toMatchObject({ mode: 'oomol', source: 'derived', oomolAvailable: true, oomolManaged: true, managed: false })
  expect(hosted.putLlm(1, 'https://models.example.com', 'model-key')).toBe('saved')
  expect(hosted.llm()?.config?.token).toBe('model-key')
})

it('authorizes OOMOL for LLM while an environment-managed custom Connector remains selected', async () => {
  const configured = settings(await databaseFile(), { connectorOrigin: 'https://connector.example.com', connectorToken: 'connector-key' })
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: 'waiting', code: 'ABC123', expires_in: 600, verify_code_url: 'https://console.oomol.com/login/device' }))
      .mockResolvedValueOnce(Response.json({ status: 'verified', endpoint: 'oomol.com', api_key: 'authorized-key' })),
  )
  const login = new OomolLogin(configured)
  const signal = new AbortController().signal
  const session = await login.start('operator', 1, signal)
  const authorized = await login.poll('operator', session.id, signal)
  expect(authorized.status).toBe('authorized')
  if (authorized.status != 'authorized') throw new Error('Expected OOMOL authorization.')
  expect(configured.saveProfile(1, 'oomol', { connectorOrigin: authorized.connectorOrigin, connectorToken: authorized.apiKey, consoleOrigin: '' })).toBe(
    'saved',
  )
  expect(configured.selectLlm(2, 'oomol')).toBe('saved')
  expect(configured.connectorConfiguration()).toEqual({ origin: 'https://connector.example.com', token: 'connector-key' })
  expect(configured.llm()?.config).toEqual({ origin: 'https://new-llm.oomol.com', token: 'authorized-key' })
})

it('rejects stale and invalid LLM updates without changing either service', async () => {
  const configured = settings(await databaseFile())
  expect(configured.putLlm(1, 'https://models.example.com', 'model-key')).toBe('saved')
  const app = createConfigApp(configured, async () => 'operator')
  const before = configured.status()
  for (const [endpoint, body, status] of [
    ['/llm', { origin: 'https://next.example.com', token: null, expectedRevision: 1 }, 409],
    ['/llm/mode', { mode: 'oomol', expectedRevision: 1 }, 409],
    ['/llm/mode', { mode: 'other', expectedRevision: 2 }, 400],
    ['/llm', { origin: 'http://unsafe.example.com', token: 'key', expectedRevision: 2 }, 400],
    ['/llm', { origin: 'https://models.example.com', token: '', expectedRevision: 2 }, 400],
    ['/llm', { origin: 'https://models.example.com', token: '   ', expectedRevision: 2 }, 400],
    ['/llm/custom', { origin: 'https://models.example.com', token: '   ', expectedRevision: 2 }, 400],
  ] as const) {
    expect((await app.request(endpoint, configurationRequest('PUT', { ...body, version: 1 }))).status).toBe(status)
    expect(configured.status()).toEqual(before)
  }
})

it.each(['oomol', 'custom'] as const)('persists an incomplete %s Connector without coupling it to LLM', async (mode) => {
  const file = await databaseFile()
  const configured = settings(file)
  expect(configured.putLlm(1, 'https://models.example.com', 'model-key')).toBe('saved')
  const app = createConfigApp(configured, async () => 'operator')
  const value = { connectorOrigin: mode == 'oomol' ? 'https://connector.oomol.com' : '', connectorToken: '', consoleOrigin: '' }
  expect((await app.request('/services/' + mode, configurationRequest('PUT', { ...value, version: 1, expectedRevision: 2 }))).status).toBe(200)
  expect(configured.selectProfile(3, mode)).toBe('saved')
  const reopened = settings(file)
  expect(reopened.status().services.mode).toBe(mode)
  expect(reopened.status().services.profiles[mode].connectorTokenConfigured).toBe(false)
  expect(reopened.llm()?.config?.token).toBe('model-key')
  expect(configured.selectProfile(3, mode)).toBe('conflict')
  expect(
    (await app.request('/services/' + mode, configurationRequest('PUT', { ...value, connectorOrigin: 'invalid', version: 1, expectedRevision: 4 }))).status,
  ).toBe(400)
})
