import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const workspaceRoot = path.resolve(import.meta.dirname, '../../..')
const suffix = randomUUID().replaceAll('-', '')
const imageName = `open-flow-server:smoke-${suffix}`
const volumeName = `open-flow-server-smoke-${suffix}`
const firstContainer = `open-flow-server-smoke-first-${suffix}`
const secondContainer = `open-flow-server-smoke-second-${suffix}`
const setupContainer = `open-flow-server-smoke-setup-${suffix}`
const restoredContainer = `open-flow-server-smoke-restored-${suffix}`
const operatorToken = 'open-flow-server-docker-smoke-token'
const containers = [firstContainer, secondContainer, setupContainer, restoredContainer]
let imageBuilt = false
let volumeCreated = false

try {
  process.stdout.write('Building the Server Docker image.\n')
  await docker(['build', '--file', 'apps/server/Dockerfile', '--tag', imageName, '.'])
  imageBuilt = true

  await docker(['volume', 'create', volumeName])
  volumeCreated = true

  process.stdout.write('Starting the first container and exercising the runtime.\n')
  await startContainer(firstContainer)
  await waitForHealthy(firstContainer)
  const firstOrigin = await containerOrigin(firstContainer)
  const firstCookie = await login(firstOrigin)

  const index = await fetch(firstOrigin, { headers: { accept: 'text/html' } })
  assert.equal(index.status, 200)
  assert.match(await index.text(), /<title>Open Flow Server<\/title>/)

  const flow = await requestJson<{ readonly draftRevisionId: string; readonly flowId: string }>(
    firstOrigin,
    '/v1/flows',
    {
      body: JSON.stringify({ name: 'Docker smoke flow', version: 1 }),
      headers: { 'content-type': 'application/json', 'cookie': firstCookie, 'idempotency-key': `flow-${suffix}` },
      method: 'POST',
    },
    201,
  )
  const revision = codeFlow()
  const changed = await requestJson<{ readonly revision: { readonly revisionId: string } }>(
    firstOrigin,
    `/v1/flows/${flow.flowId}/draft/changes`,
    {
      body: JSON.stringify({
        expectedRevisionId: flow.draftRevisionId,
        operations: [
          { kind: 'module.create', module: revision.modules.code, moduleId: 'code' },
          { kind: 'graph.node.create', node: revision.document.graph.nodes.code, nodeId: 'code', target: { kind: 'flow' } },
        ],
        version: 1,
      }),
      headers: { 'content-type': 'application/json', 'cookie': firstCookie },
      method: 'POST',
    },
    200,
  )
  const publication = await requestJson<{ readonly publicationId: string }>(
    firstOrigin,
    `/v1/flows/${flow.flowId}/revisions/${changed.revision.revisionId}/publications`,
    {
      body: JSON.stringify({ engineContract: 'open-flow-engine/v1', expectedLivePublicationId: null, version: 1 }),
      headers: { 'content-type': 'application/json', 'cookie': firstCookie, 'idempotency-key': `publication-${suffix}` },
      method: 'POST',
    },
    201,
  )
  const accepted = await requestJson<{ readonly runId: string }>(
    firstOrigin,
    '/v1/runs',
    {
      body: JSON.stringify({ inputs: {}, publicationId: publication.publicationId, version: 1 }),
      headers: { 'content-type': 'application/json', 'cookie': firstCookie, 'idempotency-key': `run-${suffix}` },
      method: 'POST',
    },
    202,
  )
  const run = await waitForRun(firstOrigin, accepted.runId, firstCookie)
  assert.equal(run.status, 'completed')
  const events = await requestJson<{
    readonly events: readonly { readonly kind: string; readonly payload: Record<string, unknown>; readonly value?: unknown }[]
  }>(firstOrigin, `/v1/runs/${accepted.runId}/events`, { headers: { cookie: firstCookie } }, 200)
  const output = events.events.find((event) => event.kind == 'node.output')
  assert.equal(output?.payload.handle, 'result')
  assert.deepEqual(output?.payload.output, { kind: 'inline', value: 42 })

  await stopContainer(firstContainer)
  await docker(['rm', firstContainer])

  process.stdout.write('Restarting from the same volume and checking persisted state.\n')
  await startContainer(secondContainer)
  await waitForHealthy(secondContainer)
  const secondOrigin = await containerOrigin(secondContainer)
  const secondCookie = await login(secondOrigin)
  const flows = await requestJson<{ readonly flows: readonly { readonly flowId: string }[] }>(
    secondOrigin,
    '/v1/flows',
    { headers: { cookie: secondCookie } },
    200,
  )
  assert.ok(flows.flows.some((candidate) => candidate.flowId == flow.flowId))
  const restoredRun = await requestJson<{ readonly runId: string; readonly status: string }>(
    secondOrigin,
    `/v1/runs/${accepted.runId}`,
    { headers: { cookie: secondCookie } },
    200,
  )
  assert.equal(restoredRun.runId, accepted.runId)
  assert.equal(restoredRun.status, 'completed')
  await stopContainer(secondContainer)

  process.stdout.write('Claiming the same deployment without an operator environment variable.\n')
  await startContainer(setupContainer, false)
  await waitForHealthy(setupContainer)
  const setupOrigin = await containerOrigin(setupContainer)
  const setupCookie = await authorizeSetup(setupOrigin, await setupCode(setupContainer))
  const claimedCookie = await claim(setupOrigin, setupCookie)
  const claimedFlows = await requestJson<{ readonly flows: readonly { readonly flowId: string }[] }>(
    setupOrigin,
    '/v1/flows',
    { headers: { cookie: claimedCookie } },
    200,
  )
  assert.ok(claimedFlows.flows.some((candidate) => candidate.flowId == flow.flowId))
  await requestJson(
    setupOrigin,
    '/config/connector-console',
    {
      body: JSON.stringify({ expectedRevision: 1, origin: 'https://console.example.com', version: 1 }),
      headers: { 'content-type': 'application/json', 'cookie': claimedCookie },
      method: 'PUT',
    },
    200,
  )
  await requestJson(
    setupOrigin,
    '/config/integration',
    {
      body: JSON.stringify({
        callbackKey: 'docker-smoke-integration-key-32-bytes',
        expectedRevision: 2,
        publicOrigin: 'https://flows.example.com',
        version: 1,
      }),
      headers: { 'content-type': 'application/json', 'cookie': claimedCookie },
      method: 'PUT',
    },
    200,
  )
  await requestJson(
    setupOrigin,
    '/config/llm',
    {
      body: JSON.stringify({ expectedRevision: 3, origin: 'https://models.example.com', token: 'docker-smoke-model-token', version: 1 }),
      headers: { 'content-type': 'application/json', 'cookie': claimedCookie },
      method: 'PUT',
    },
    200,
  )
  await stopContainer(setupContainer)

  process.stdout.write('Restarting the claimed deployment without an operator environment variable.\n')
  await startContainer(restoredContainer, false)
  await waitForHealthy(restoredContainer)
  const claimedOrigin = await containerOrigin(restoredContainer)
  const restoredCookie = await login(claimedOrigin)
  const persistedFlows = await requestJson<{ readonly flows: readonly { readonly flowId: string }[] }>(
    claimedOrigin,
    '/v1/flows',
    { headers: { cookie: restoredCookie } },
    200,
  )
  assert.ok(persistedFlows.flows.some((candidate) => candidate.flowId == flow.flowId))
  const configuration = await requestJson<{
    readonly connector: unknown
    readonly integration: unknown
    readonly llm: { readonly origin: string; readonly source: string; readonly tokenConfigured: boolean }
    readonly revision: number
  }>(claimedOrigin, '/config', { headers: { cookie: restoredCookie } }, 200)
  assert.deepEqual(configuration, {
    connector: {
      console: { configured: true, origin: 'https://console.example.com', source: 'settings' },
      runtime: { configured: false, source: 'none', tokenConfigured: false },
    },
    integration: { configured: true, publicOrigin: 'https://flows.example.com', source: 'settings' },
    llm: { configured: true, origin: 'https://models.example.com', source: 'settings', tokenConfigured: true },
    revision: 4,
    version: 1,
  })
  await stopContainer(restoredContainer)

  process.stdout.write('Verified the Server image, operator setup, Workbench, Isolated VM, graceful shutdown, and SQLite volume persistence.\n')
} catch (error) {
  for (const container of containers) {
    const logs = await docker(['logs', container]).catch(() => '')
    if (logs.trim().length > 0) process.stderr.write(`\n${container} logs:\n${logs}`)
  }
  throw error
} finally {
  for (const container of containers) await docker(['rm', '--force', container]).catch(() => undefined)
  if (volumeCreated) await docker(['volume', 'rm', volumeName]).catch(() => undefined)
  if (imageBuilt) await docker(['image', 'rm', imageName]).catch(() => undefined)
}

function codeFlow(): RevisionContent {
  const result = { jsonSchema: { type: 'number' }, nullable: false }
  return {
    document: {
      bindings: {},
      graph: {
        nodes: {
          code: {
            concurrency: 1,
            inputs: {},
            kind: 'task',
            task: { inputs: [], moduleId: 'code', name: 'Code', outputs: [{ ...result, handle: 'result' }] },
          },
        },
      },
      subflows: {},
      tasks: {},
    },
    modelVersion: 1,
    modules: { code: { imports: [], name: 'Code', source: 'export default () => ({ result: 42 })' } },
  }
}

async function docker(args: readonly string[]): Promise<string> {
  const result = await execFileAsync('docker', [...args], { cwd: workspaceRoot, maxBuffer: 32 * 1024 * 1024 })
  return result.stdout
}

async function startContainer(name: string, configured = true): Promise<void> {
  await docker([
    'run',
    '--detach',
    ...(configured ? ['--env', `OPEN_FLOW_TOKEN=${operatorToken}`] : []),
    '--name',
    name,
    '--publish',
    '127.0.0.1::3000',
    '--volume',
    `${volumeName}:/data/open-flow`,
    imageName,
  ])
}

async function setupCode(name: string): Promise<string> {
  const logs = await docker(['logs', name])
  const code = logs.match(/"setupCode":"([^"]+)"/)?.[1]
  assert.ok(code != null)
  return code
}

async function authorizeSetup(baseUrl: string, code: string): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/setup/session`, {
    body: JSON.stringify({ code, version: 1 }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  assert.equal(response.status, 200)
  const cookie = response.headers.get('set-cookie')
  assert.ok(cookie != null)
  return cookie.split(';', 1)[0]!
}

async function claim(baseUrl: string, setupCookie: string): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/setup`, {
    body: JSON.stringify({ token: operatorToken, version: 1 }),
    headers: { 'content-type': 'application/json', 'cookie': setupCookie },
    method: 'POST',
  })
  assert.equal(response.status, 201)
  const cookie = response.headers.get('set-cookie')?.match(/open_flow_operator_session=[^;]+/)?.[0]
  assert.ok(cookie != null)
  return cookie
}

async function waitForHealthy(name: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = (await docker(['inspect', '--format', '{{.State.Status}} {{.State.Health.Status}}', name])).trim()
    if (state == 'running healthy') return
    if (state.startsWith('exited') || state.startsWith('dead')) throw new Error(`${name} stopped before becoming healthy.`)
    await delay(500)
  }
  throw new Error(`${name} did not become healthy.`)
}

async function containerOrigin(name: string): Promise<string> {
  const address = (await docker(['port', name, '3000/tcp'])).trim().split('\n', 1)[0]
  assert.match(address, /^127\.0\.0\.1:\d+$/)
  return `http://${address}`
}

async function login(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/session`, {
    body: JSON.stringify({ token: operatorToken, version: 1 }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  assert.equal(response.status, 200)
  const cookie = response.headers.get('set-cookie')
  assert.ok(cookie != null)
  return cookie.split(';', 1)[0]!
}

async function requestJson<Body>(baseUrl: string, pathname: string, init: RequestInit, status: number): Promise<Body> {
  const response = await fetch(`${baseUrl}${pathname}`, init)
  const source = await response.text()
  assert.equal(response.status, status, `${pathname} returned HTTP ${response.status}: ${source}`)
  return JSON.parse(source) as Body
}

async function waitForRun(baseUrl: string, runId: string, cookie: string): Promise<{ readonly status: string }> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await requestJson<{ readonly status: string }>(baseUrl, `/v1/runs/${runId}`, { headers: { cookie } }, 200)
    if (['completed', 'failed', 'canceled', 'indeterminate'].includes(run.status)) return run
    await delay(25)
  }
  throw new Error(`Run ${runId} did not reach a terminal status.`)
}

async function stopContainer(name: string): Promise<void> {
  await docker(['stop', '--time', '15', name])
  const exitCode = (await docker(['inspect', '--format', '{{.State.ExitCode}}', name])).trim()
  assert.equal(exitCode, '0')
}
