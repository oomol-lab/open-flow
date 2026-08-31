import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createServerApp } from '../node/http.ts'
import { migrateDatabase } from '../node/migrate.ts'
import { SettingsStore } from '../node/settings-store.ts'
import { Settings } from '../node/settings.ts'
import { closeService, openService } from './serviceFixture.ts'

const directories: string[] = []
const stores: SettingsStore[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  for (const store of stores.splice(0)) store.close()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function databaseFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-settings-'))
  directories.push(directory)
  const file = path.join(directory, 'open-flow.sqlite')
  migrateDatabase(file)
  return file
}

function settings(file: string, environment: ConstructorParameters<typeof Settings>[1] = {}): Settings {
  const store = new SettingsStore(file)
  stores.push(store)
  return new Settings(store, environment)
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
