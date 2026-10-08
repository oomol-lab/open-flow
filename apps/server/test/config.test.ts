import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
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

it('keeps LLM invocations on the configuration snapshot taken when they start', async () => {
  const file = await databaseFile()
  const configured = settings(file)
  expect(configured.status()).toEqual({
    connector: {
      console: { configured: false, source: 'none' },
      runtime: { configured: false, source: 'none', tokenConfigured: false },
    },
    integration: { configured: false, source: 'none' },
    llm: { configured: false, source: 'none', tokenConfigured: false },
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
    connector: {
      console: { configured: false, source: 'none' },
      runtime: { configured: false, source: 'none', tokenConfigured: false },
    },
    integration: { configured: false, source: 'none' },
    llm: { configured: true, origin: 'https://models.example.com', source: 'settings', tokenConfigured: true },
    revision: 3,
    version: 1,
  })
})

it('locks an environment LLM and only derives LLM when no explicit setting exists', async () => {
  const file = await databaseFile()
  const stored = settings(file)
  expect(stored.putLlm(1, 'https://stored.example.com', 'stored-token')).toBe('saved')

  const environment = settings(file, { llmOrigin: 'https://environment.example.com', llmToken: 'environment-token' })
  expect(environment.status().llm).toEqual({
    configured: true,
    origin: 'https://environment.example.com',
    source: 'environment',
    tokenConfigured: true,
  })
  expect(environment.putLlm(2, 'https://ignored.example.com', 'ignored-token')).toBe('environment')
  expect(environment.deleteLlm(2)).toBe('environment')

  expect(stored.deleteLlm(2)).toBe('saved')
  const derived = settings(file, { connectorOrigin: 'https://connector.oomol.com', connectorToken: 'connector-token' })
  expect(derived.status().llm).toEqual({ configured: true, origin: 'https://llm.oomol.com', source: 'derived', tokenConfigured: true })
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
      connector: {
        console: { configured: false, source: 'none' },
        runtime: { configured: false, source: 'none', tokenConfigured: false },
      },
      integration: { configured: false, source: 'none' },
      llm: { configured: false, source: 'none', tokenConfigured: false },
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
  'authorizes OOMOL on %s without sending the private state or key to the browser',
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
      expect(await completed.json()).toMatchObject({
        status: 'saved',
        configuration: { revision: 2, connector: { runtime: { origin: 'https://connector.oomol.com/', tokenConfigured: true } }, llm: { source: 'derived' } },
      })
      expect(settings(file).connectorConfiguration()).toEqual({ origin: 'https://connector.oomol.com/', token: 'private-oomol-key' })
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
