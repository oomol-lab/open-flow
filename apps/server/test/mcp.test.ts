import { serve } from '@hono/node-server'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import * as z from 'zod'
import { createServerApp } from '../node/http.ts'
import { OperatorStore } from '../node/operator-store.ts'
import { OperatorSession } from '../node/operator.ts'
import { createConnectorHost } from './connectorHost.ts'
import { closeService, openService, startService } from './serviceFixture.ts'

const token = 'mcp-test-operator-token-000000000001'
const version = '2026-07-28'
const start = { kind: 'graph.node.create', target: { kind: 'flow' }, nodeId: 'start', node: { kind: 'manual', name: 'Start' } }

async function fixture(options: Parameters<typeof openService>[1] = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-mcp-'))
  const file = path.join(directory, 'flow.sqlite')
  const service = await openService(file, options)
  const store = new OperatorStore(file)
  const operator = new OperatorSession(store, token, false)
  const shutdown = new AbortController()
  const app = createServerApp(service, { operator, shutdownSignal: shutdown.signal })
  const http = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0, overrideGlobalObjects: false })
  await once(http, 'listening')
  const address = http.address()
  if (address == null || typeof address == 'string') throw new Error('HTTP address is unavailable.')
  const origin = `http://127.0.0.1:${address.port}`
  const endpoint = new URL('/v1/mcp', origin)
  const clients: Client[] = []
  onTestFinished(async () => {
    shutdown.abort()
    await Promise.all(clients.map((client) => client.close()))
    await new Promise<void>((resolve, reject) => http.close((error) => (error == null ? resolve() : reject(error))))
    await closeService(service)
    store.close()
    await rm(directory, { force: true, recursive: true })
  })
  const connect = async (credential = token) => {
    const client = new Client({ name: 'open-flow-test', version: '1.0.0' }, { versionNegotiation: { mode: { pin: version } } })
    clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { authorization: `Bearer ${credential}` } } }))
    return client
  }
  const client = await connect()
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args })
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true)
    return z.record(z.string(), z.unknown()).parse(response.structuredContent)
  }
  const control = new ControlClient((url, init) => {
    const headers = new Headers(init?.headers)
    headers.set('authorization', `Bearer ${token}`)
    return fetch(new URL(url, origin), { ...init, headers })
  })
  return { app, call, client, connect, control, endpoint, origin, service, shutdown }
}

it('serves discovery and an atomic authoring, validation and execution workflow over HTTP', async () => {
  const { call, client, control, service } = await fixture()
  const discovered = await client.discover()
  expect(JSON.stringify(discovered)).toContain(version)
  const tools = await client.listTools()
  expect(tools.tools.map((tool) => tool.name)).toContain('flow_apply')
  expect(tools.tools.map((tool) => tool.name)).not.toContain('flow_delete')
  expect(await call('flow_schema', { kind: 'graph.node.create' })).toHaveProperty('operations')

  const flow = await call('flow_create', { name: 'MCP workflow', idempotencyKey: 'create' })
  const flowId = z.string().parse(flow.flowId)
  expect(await call('flow_create', { name: 'MCP workflow', idempotencyKey: 'create' })).toEqual(flow)
  const edit = {
    flowId,
    expectedRevisionId: flow.draftRevisionId,
    idempotencyKey: 'edit',
    operations: [
      start,
      {
        kind: 'graph.node.create',
        target: { kind: 'flow' },
        nodeId: 'answer',
        node: {
          kind: 'value',
          name: 'Answer',
          inputs: {},
          values: [{ handle: 'answer', jsonSchema: { type: 'number' }, nullable: false, value: 42 }],
        },
      },
      { kind: 'graph.edge.connect', target: { kind: 'flow' }, edge: { source: 'start', target: 'answer' } },
    ],
  }
  const changed = await call('flow_apply', edit)
  expect(await call('flow_apply', edit)).toEqual(changed)
  const revisionId = z.object({ revisionId: z.string() }).parse(changed.revision).revisionId
  expect((await control.getDraft(flowId)).revisionId).toBe(revisionId)
  expect(await call('flow_check', { flowId, revisionId })).toMatchObject({ valid: true, revisionId })
  const runArgs = { source: 'draft', flowId, revisionId, trigger: { nodeId: 'start', payload: {} }, idempotencyKey: 'run' }
  const run = await call('flow_run', runArgs)
  const runId = z.string().parse(run.runId)
  expect(await call('flow_run', runArgs)).toEqual(run)
  await startService(service)
  await expect.poll(async () => (await call('run_get', { runId })).status).toBe('completed')
  expect(await call('run_result', { runId })).toMatchObject({ status: 'completed' })
  const page = await call('run_events', { runId, limit: 1 })
  expect(page.events).toHaveLength(1)
  const rest = await call('run_events', { runId, after: page.nextAfter })
  expect(JSON.stringify(rest.events)).toContain('42')
  expect(await call('flow_get', { flowId })).toMatchObject({ draft: { revisionId } })
})

it('rejects stale concurrent edits and mismatched idempotent requests without losing accepted changes', async () => {
  const { call, client, connect, control } = await fixture()
  const flow = await call('flow_create', { name: 'Conflict', idempotencyKey: 'conflict-create' })
  const args = { flowId: flow.flowId, expectedRevisionId: flow.draftRevisionId, operations: [start] }
  const other = await connect()
  const replies = await Promise.all([
    client.callTool({ name: 'flow_apply', arguments: { ...args, idempotencyKey: 'first' } }),
    other.callTool({ name: 'flow_apply', arguments: { ...args, idempotencyKey: 'second' } }),
  ])
  expect(replies.filter((reply) => reply.isError)).toHaveLength(1)
  expect(replies.find((reply) => reply.isError)?.structuredContent).toMatchObject({ error: { code: 'flow.revision-conflict' } })
  const conflict = await client.callTool({ name: 'flow_create', arguments: { name: 'Different', idempotencyKey: 'conflict-create' } })
  expect(conflict.structuredContent).toMatchObject({ error: { code: 'flow.conflict' } })
  const draft = await control.getDraft(z.string().parse(flow.flowId))
  expect(draft.content.document.graph.nodes.start).toMatchObject({ kind: 'manual' })
})

it('shares pagination cursors with the Control API and preserves invalid input and business errors', async () => {
  const { call, client, control } = await fixture()
  await call('flow_create', { name: 'First', idempotencyKey: 'page-1' })
  await call('flow_create', { name: 'Second', idempotencyKey: 'page-2' })
  const first = await call('flow_list', { limit: 1 })
  const next = await control.listFlows({ cursor: z.string().parse(first.nextCursor), limit: 1 })
  expect(next.flows).toHaveLength(1)
  expect(next.flows[0]?.flowId).not.toBe(z.array(z.object({ flowId: z.string() })).parse(first.flows)[0]?.flowId)
  const invalid = await client.callTool({ name: 'flow_list', arguments: { cursor: 'invalid' } })
  expect(invalid.structuredContent).toMatchObject({ error: { code: 'page.invalid-cursor' } })
  for (const args of [
    { name: ' ', idempotencyKey: 'invalid' },
    { name: 'Valid', idempotencyKey: 'invalid', unexpected: true },
  ]) {
    expect((await client.callTool({ name: 'flow_create', arguments: args })).isError).toBe(true)
  }
  expect((await client.callTool({ name: 'run_get', arguments: { runId: 'missing' } })).structuredContent).toMatchObject({ error: { code: 'run.not-found' } })
  expect((await client.callTool({ name: 'connector_list', arguments: {} })).structuredContent).toMatchObject({ error: { code: 'connector.unconfigured' } })
})

it('keeps admitted Runs across client disconnects and exposes Wait and cancellation state', async () => {
  const { call, client, connect, service } = await fixture()
  const flow = await call('flow_create', { name: 'Approval', idempotencyKey: 'wait-create' })
  const changed = await call('flow_apply', {
    flowId: flow.flowId,
    expectedRevisionId: flow.draftRevisionId,
    idempotencyKey: 'wait-edit',
    operations: [
      start,
      {
        kind: 'graph.node.create',
        target: { kind: 'flow' },
        nodeId: 'approval',
        node: {
          kind: 'wait',
          name: 'Approval',
          actions: ['approve', 'reject'],
          prompt: 'Approve?',
          input: { handle: 'value', jsonSchema: {}, nullable: true, value: null },
          inputs: { value: { kind: 'value', value: 42 } },
        },
      },
      { kind: 'graph.edge.connect', target: { kind: 'flow' }, edge: { source: 'start', target: 'approval' } },
    ],
  })
  const args = {
    source: 'draft',
    flowId: flow.flowId,
    revisionId: z.object({ revisionId: z.string() }).parse(changed.revision).revisionId,
    trigger: { nodeId: 'start', payload: {} },
    idempotencyKey: 'wait-run',
  }
  const run = await call('flow_run', args)
  await client.close()
  const other = await connect()
  const replay = await other.callTool({ name: 'flow_run', arguments: args })
  expect(replay.structuredContent).toMatchObject({ runId: run.runId })
  await startService(service)
  await expect
    .poll(async () => (await other.callTool({ name: 'run_get', arguments: { runId: run.runId } })).structuredContent)
    .toMatchObject({
      status: 'waiting',
      waiting: { actions: ['approve', 'reject'] },
    })
  expect((await other.callTool({ name: 'run_result', arguments: { runId: run.runId } })).structuredContent).toMatchObject({
    error: { code: 'run.not-terminal' },
  })
  await other.callTool({ name: 'run_cancel', arguments: { runId: run.runId } })
  expect((await other.callTool({ name: 'run_result', arguments: { runId: run.runId } })).structuredContent).toMatchObject({ status: 'canceled' })
})

it('enforces authentication, Origin, request limits and the modern HTTP protocol', async () => {
  const { endpoint, origin, shutdown } = await fixture()
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': version,
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  })
  const headers = {
    'authorization': `Bearer ${token}`,
    'accept': 'application/json, text/event-stream',
    'content-type': 'application/json',
    'mcp-protocol-version': version,
    'mcp-method': 'tools/list',
  }
  const request = (extra: Record<string, string> = {}, source = body) => fetch(endpoint, { method: 'POST', headers: { ...headers, ...extra }, body: source })
  expect((await request({ authorization: 'Bearer invalid' })).status).toBe(401)
  expect((await request({ authorization: '' })).status).toBe(401)
  expect((await request({ origin: 'https://evil.example' })).status).toBe(403)
  expect((await request({ origin })).status).toBe(200)
  expect((await request({ 'content-type': 'text/plain' })).status).toBe(415)
  expect((await request({}, '{')).status).toBe(400)
  expect((await request({ 'mcp-method': 'tools/call' })).status).toBe(400)
  expect((await request({ 'mcp-protocol-version': '2025-11-25' })).status).toBe(400)
  expect((await request({}, ' '.repeat(5 * 1024 * 1024 + 1))).status).toBe(413)
  for (const method of ['GET', 'DELETE']) expect((await fetch(endpoint, { method, headers })).status).toBe(405)
  const response = await request()
  expect(response.headers.get('mcp-session-id')).toBeNull()
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toMatchObject({ result: { resultType: 'complete', cacheScope: 'private' } })
  shutdown.abort()
  expect((await request()).status).toBe(503)
})

it('cancels Connector requests on HTTP disconnect and Server shutdown', async () => {
  const signals: AbortSignal[] = []
  const connector = createConnectorHost({
    listProviders: async (signal) => {
      if (signal == null) throw new Error('Connector request is missing cancellation.')
      signals.push(signal)
      await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      return []
    },
  })
  const { client, shutdown } = await fixture({ capabilities: { connector: () => connector } })
  const cancel = new AbortController()
  const pending = client.callTool({ name: 'connector_list', arguments: {} }, { signal: cancel.signal }).catch((error: unknown) => error)
  await expect.poll(() => signals.length).toBe(1)
  cancel.abort()
  await expect.poll(() => signals[0]?.aborted).toBe(true)
  expect(await pending).toBeInstanceOf(Error)
  const stopping = client.callTool({ name: 'connector_list', arguments: {} }).catch((error: unknown) => error)
  await expect.poll(() => signals.length).toBe(2)
  shutdown.abort()
  await expect.poll(() => signals[1]?.aborted).toBe(true)
  expect(await stopping).toBeInstanceOf(Error)
})

it('executes fixed Live code revisions and keeps old Run retries stable after republishing', async () => {
  const { call, client, control, service } = await fixture()
  const flow = await call('flow_create', { name: 'Live code', idempotencyKey: 'live-create' })
  const flowId = z.string().parse(flow.flowId)
  const source = 'export default () => ({ answer: 42 })'
  const edit = await call('flow_apply', {
    flowId,
    expectedRevisionId: flow.draftRevisionId,
    idempotencyKey: 'live-edit',
    operations: [
      start,
      { kind: 'module.create', moduleId: 'main', module: { name: 'Main', imports: [], source } },
      {
        kind: 'graph.node.create',
        nodeId: 'main',
        target: { kind: 'flow' },
        node: {
          kind: 'task',
          name: 'Main',
          inputs: {},
          task: { name: 'Main', moduleId: 'main', inputs: [], outputs: [{ handle: 'answer', jsonSchema: { type: 'number' }, nullable: false }] },
        },
      },
      { kind: 'graph.edge.connect', target: { kind: 'flow' }, edge: { source: 'start', target: 'main' } },
    ],
  })
  const revisionId = z.object({ revisionId: z.string() }).parse(edit.revision).revisionId
  const operation = await control.publishFlow(flowId, revisionId, null)
  await service.tickMaintenance()
  const publication = await control.getPublishOperation(flowId, operation.operationId)
  if (publication.status != 'succeeded') throw new Error('Publication did not succeed.')
  const args = { source: 'live', publicationId: publication.publicationId, trigger: { nodeId: 'start', payload: {} }, idempotencyKey: 'live-run' }
  const run = await call('flow_run', args)
  await startService(service)
  await expect.poll(async () => (await call('run_get', { runId: run.runId })).status).toBe('completed')
  expect(JSON.stringify(await call('run_result', { runId: run.runId }))).toContain('42')
  const changed = await call('flow_apply', {
    flowId,
    expectedRevisionId: revisionId,
    idempotencyKey: 'failing-edit',
    operations: [
      {
        kind: 'module.source.replace',
        moduleId: 'main',
        beforeImports: [],
        beforeSource: source,
        imports: [],
        source: 'export default () => { throw new Error("Expected failure") }',
      },
    ],
  })
  const second = await control.publishFlow(flowId, z.object({ revisionId: z.string() }).parse(changed.revision).revisionId, publication.publicationId)
  await service.tickMaintenance()
  const published = await control.getPublishOperation(flowId, second.operationId)
  if (published.status != 'succeeded') throw new Error('Second publication did not succeed.')
  expect(await call('flow_run', args)).toMatchObject({ runId: run.runId, status: 'completed' })
  const stale = await client.callTool({ name: 'flow_run', arguments: { ...args, idempotencyKey: 'stale-run' } })
  expect(stale.structuredContent).toMatchObject({ error: { code: 'live.conflict' } })
  const failed = await call('flow_run', { ...args, publicationId: published.publicationId, idempotencyKey: 'failed-run' })
  await expect.poll(async () => (await call('run_get', { runId: failed.runId })).status).toBe('failed')
  expect(await call('run_result', { runId: failed.runId })).toMatchObject({ status: 'failed', error: expect.any(Object) })
})

it('reports uncertain mutation outcomes and recovers the accepted resource with the original key', async () => {
  const { call, client, service } = await fixture()
  const create = service.control.createFlow.bind(service.control)
  const fault = vi.spyOn(service.control, 'createFlow').mockImplementationOnce(async (...args) => {
    await create(...args)
    throw new Error('Simulated failure after commit')
  })
  onTestFinished(() => fault.mockRestore())
  const args = { name: 'Recover', idempotencyKey: 'uncertain-create' }
  const response = await client.callTool({ name: 'flow_create', arguments: args })
  expect(response.isError).toBe(true)
  expect(response.structuredContent).toMatchObject({ error: { code: 'flow.mutation-outcome-unknown', idempotencyKey: args.idempotencyKey } })
  expect(JSON.stringify(response)).not.toContain('Simulated failure')
  const accepted = await call('flow_create', args)
  const page = await call('flow_list')
  expect(page.flows).toHaveLength(1)
  expect(page.flows).toEqual([accepted])
})

it('serves a modern client through an HTTP proxy and accepts chunked JSON requests', async () => {
  const { origin, endpoint } = await fixture()
  const proxy = serve({
    hostname: '127.0.0.1',
    port: 0,
    overrideGlobalObjects: false,
    fetch: (request) => {
      const init = { method: request.method, headers: request.headers, body: request.body, duplex: 'half', signal: request.signal }
      return fetch(new URL(new URL(request.url).pathname, origin), init)
    },
  })
  onTestFinished(() => new Promise<void>((resolve, reject) => proxy.close((error) => (error == null ? resolve() : reject(error)))))
  await once(proxy, 'listening')
  const address = proxy.address()
  if (address == null || typeof address == 'string') throw new Error('Proxy address is unavailable.')
  const client = new Client({ name: 'proxy-test', version: '1.0.0' }, { versionNegotiation: { mode: { pin: version } } })
  onTestFinished(() => client.close())
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/v1/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  )
  expect((await client.callTool({ name: 'flow_list', arguments: {} })).structuredContent).toMatchObject({ flows: [] })
  const source = JSON.stringify({
    jsonrpc: '2.0',
    id: 10,
    method: 'tools/list',
    params: {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': version,
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  })
  const init = {
    method: 'POST',
    duplex: 'half',
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      'mcp-protocol-version': version,
      'mcp-method': 'tools/list',
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(source.slice(0, 20)))
        controller.enqueue(new TextEncoder().encode(source.slice(20)))
        controller.close()
      },
    }),
  }
  const response = await fetch(endpoint, init)
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ id: 10, result: { resultType: 'complete', tools: expect.any(Array) } })
})
