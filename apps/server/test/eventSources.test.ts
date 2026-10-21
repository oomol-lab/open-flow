import type { CreateEventSource } from '@oomol-lab/open-flow/control-api'
import type { JsonValue, TriggerNode } from '@oomol-lab/open-flow/flow-change'

import { decodeEventSources } from '@oomol-lab/open-flow/control-api'
import { inputValues } from '@oomol-lab/open-flow/flow-change'
import { integrationDefinitions } from '@oomol-lab/open-flow/provider-triggers'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, vi } from 'vitest'
import { ConnectorClient } from '../node/deployment/connector.ts'
import { createServerApp } from '../node/transport/http.ts'
import { createConnectorHost } from './connectorHost.ts'
import { closeService, openService } from './serviceFixture.ts'
import { sourceProtocolFixture } from './sourceProtocolFixture.ts'

const now = Date.parse('2026-09-14T08:00:00.000Z')
const definition = integrationDefinitions.find((item) => item.snapshot.key == 'feishu_app_bot.on_event')!
const input: Extract<CreateEventSource, { kind?: 'feishu' }> = {
  version: 1,
  name: 'Feishu',
  connectionId: 'connection',
  teamId: null,
  verificationToken: 'verification-secret',
  encryptKey: 'encrypt-secret',
  eventTypes: ['im.message.receive_v1', 'approval_instance'],
  manageSubscriptions: true,
}

function delivery(result: unknown) {
  return { method: 'POST', body: JSON.stringify(result), headers: { 'content-type': 'application/json' } }
}

async function setup() {
  const requests: string[] = []
  const connector = createConnectorHost({
    listConnections: async () => [
      {
        connectionId: input.connectionId,
        providerAccountId: 'cli_test',
        displayName: 'Feishu app',
        serviceId: 'feishu_app_bot',
        status: 'active',
        isDefault: true,
      },
    ],
    trigger: async (_provider, _connection, _trigger, request) => {
      if (request.operation === 'source') return sourceProtocolFixture(request.request)
      if (request.operation !== 'resource') throw new Error('Unexpected operation')
      requests.push(`${request.active ? 'subscribe' : 'unsubscribe'} ${JSON.stringify(request.config.resource)}`)
      return { outcome: 'ready' }
    },
  })
  const service = await openService(':memory:', {
    clock: () => now,
    capabilities: { connector: () => connector, integration: () => ({ callbackKey: 'key', publicOrigin: 'https://flow.example' }) },
  })
  const app = createServerApp(service, { resolveControlActor: () => 'operator' })
  const created = await app.request('/v1/event-sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
  expect(created.status, await created.clone().text()).toBe(201)
  const source = await created.json()
  const endpoint = new URL(source.endpointUrl).pathname
  const challenge = await app.request(
    endpoint,
    delivery({ verify: true, response: { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge: 'verify' }) } }),
  )
  expect(challenge.status).toBe(200)
  expect(await challenge.json()).toEqual({ challenge: 'verify' })
  return { app, service, source, endpoint, requests }
}

async function publish(context: Awaited<ReturnType<typeof setup>>, name: string, resource?: JsonValue) {
  const { service, source } = context
  const created = await service.control.createFlow('operator', name, `create-${name}`)
  const flowId = created.flow.flowId
  const node: Extract<TriggerNode, { kind: 'integration' }> = {
    kind: 'integration',
    name: 'Feishu events',
    connectionId: input.connectionId,
    definition: definition.snapshot,
    config: inputValues({
      sourceId: source.sourceId,
      eventTypes: [resource == null ? 'im.message.receive_v1' : 'approval_instance'],
      ...(resource == null ? {} : { resource }),
    }),
  }
  const draft = await service.control.changeDraft('operator', flowId, created.flow.draftRevisionId, [{ kind: 'graph.node.create', nodeId: 'feishu', node }])
  const operation = await service.control.publishFlow('operator', flowId, draft.revision.revisionId, currentEngineContract, null, `publish-${name}`)
  await service.tickIntegration()
  await service.tickMaintenance()
  const completed = service.control.getPublishOperation(flowId, operation.operationId)
  expect(completed.status).toBe('succeeded')
  return flowId
}

it('authenticates management, redacts secrets and protects concurrent updates', async () => {
  const context = await setup()
  const { app, service, source } = context
  const anonymous = createServerApp(service)
  expect((await anonymous.request('/v1/event-sources')).status).toBe(401)
  const response = await app.request('/v1/event-sources')
  const text = await response.text()
  expect(text).not.toContain(input.encryptKey)
  expect(text).not.toContain(input.verificationToken)
  const changes = { version: 1, expectedRevision: source.revision, name: 'Renamed', enabled: true, eventTypes: input.eventTypes }
  expect(
    (
      await app.request(`/v1/event-sources/${source.sourceId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(changes),
      })
    ).status,
  ).toBe(200)
  expect(
    (
      await app.request(`/v1/event-sources/${source.sourceId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(changes),
      })
    ).status,
  ).toBe(409)
})

it('durably fans out to current Flows and does not add later Flows when a message is redelivered', async () => {
  const context = await setup()
  const a = await publish(context, 'A')
  const b = await publish(context, 'B')
  const event = {
    id: 'message',
    type: 'im.message.receive_v1',
    payload: { event: 'im.message.receive_v1', deliveryId: 'message', appId: context.source.appId, tenantKey: 'tenant', occurredAt: null, body: {} },
  }
  expect((await context.app.request(context.endpoint, delivery({ event }))).status).toBe(200)
  const c = await publish(context, 'C')
  expect((await context.app.request(context.endpoint, delivery({ event }))).status).toBe(200)

  await context.service.tickIntegration()
  expect(context.service.control.runs.listRuns(a, 20).page.runs).toHaveLength(1)
  expect(context.service.control.runs.listRuns(b, 20).page.runs).toHaveLength(1)
  expect(context.service.control.runs.listRuns(c, 20).page.runs).toHaveLength(0)
  expect((await context.app.request(context.endpoint, delivery({ response: { status: 401, headers: {}, body: '' } }))).status).toBe(401)
})

it('delivers events from different enterprises through the same application source', async () => {
  const context = await setup()
  const flowId = await publish(context, 'Application events')
  for (const tenantKey of ['tenant-a', 'tenant-b']) {
    const event = {
      id: `message-${tenantKey}`,
      type: 'im.message.receive_v1',
      payload: { event: 'im.message.receive_v1', deliveryId: `message-${tenantKey}`, appId: context.source.appId, tenantKey, occurredAt: null, body: {} },
    }
    expect((await context.app.request(context.endpoint, delivery({ event }))).status).toBe(200)
  }
  await context.service.tickIntegration()
  expect(context.service.control.runs.listRuns(flowId, 20).page.runs).toHaveLength(2)
})

it('shares one approval subscription and prevents deleting an event source still in use', async () => {
  const context = await setup()
  await publish(context, 'A', { kind: 'approval', id: 'approval' })
  await publish(context, 'B', { kind: 'approval', id: 'approval' })
  expect(context.requests.filter((request) => request.startsWith('subscribe '))).toHaveLength(1)
  expect(
    (
      await context.app.request(`/v1/event-sources/${context.source.sourceId}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, expectedRevision: context.source.revision }),
      })
    ).status,
  ).toBe(409)
})

it('creates an application event source without querying tenant information', async () => {
  const provider = 'feishu_app_bot'
  const connector = createConnectorHost({
    listConnections: async () => [
      { connectionId: input.connectionId, providerAccountId: 'cli_test', displayName: 'Feishu', serviceId: provider, status: 'active', isDefault: true },
    ],
    trigger: async (_provider, _connection, _trigger, request) => (request.operation === 'source' ? sourceProtocolFixture(request.request) : undefined),
    proxy: vi.fn(async () => {
      throw new Error('Creating an event source must not require a provider API request.')
    }),
  })
  const service = await openService(':memory:', { capabilities: { connector: () => connector } })
  const app = createServerApp(service, { resolveControlActor: () => 'operator' })
  const response = await app.request('/v1/event-sources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  expect(response.status, await response.clone().text()).toBe(201)
  const source = await response.json()
  expect(source).toMatchObject({ appId: 'cli_test', provider: 'feishu_app_bot' })
  expect(source).not.toHaveProperty('tenantKey')
  expect(connector.proxy).not.toHaveBeenCalled()
  expect(decodeEventSources(await (await app.request('/v1/event-sources')).json()).sources).toEqual([source])
})

it('rejects missing application identity instead of accepting a manually supplied App ID', async () => {
  const connector = createConnectorHost({
    listConnections: async () => [
      { connectionId: input.connectionId, displayName: 'Unknown app', serviceId: 'feishu_app_bot', status: 'active', isDefault: true },
    ],
    trigger: async (_provider, _connection, _trigger, request) => (request.operation === 'source' ? sourceProtocolFixture(request.request, '') : undefined),
    proxy: async () => {
      throw new Error('Identity must be checked before querying the provider.')
    },
  })
  const service = await openService(':memory:', { capabilities: { connector: () => connector } })
  const app = createServerApp(service, { resolveControlActor: () => 'operator' })
  const request = (body: unknown) =>
    app.request('/v1/event-sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  expect((await request(input)).status).toBe(409)
  expect((await request({ ...input, appId: 'cli_forged' })).status).toBe(400)
  expect((await request({ ...input, provider: 'feishu' })).status).toBe(400)
  expect((await (await app.request('/v1/event-sources')).json()).sources).toEqual([])
})

it('returns the Flow team even when it has no event sources and rejects unknown Flows', async () => {
  const connector = new ConnectorClient('https://connector.oomol.dev', 'runtime-token')
  vi.spyOn(connector, 'listTeams').mockResolvedValue([
    { id: 'team-a', name: 'A', systemCreated: false },
    { id: 'team-b', name: 'B', systemCreated: true },
  ])
  const service = await openService(':memory:', {
    capabilities: { connector: () => connector, integration: () => ({ callbackKey: 'key', publicOrigin: 'https://flow.example' }) },
  })
  const { flow } = await service.control.createFlow('operator', 'A', 'create-team-a', 'team-a')
  const app = createServerApp(service, { resolveControlActor: () => 'operator' })
  const response = await app.request(`/v1/event-sources?flowId=${flow.flowId}`)
  expect(response.status).toBe(200)
  expect(decodeEventSources(await response.json())).toEqual({ version: 1, teamId: 'team-a', sources: [] })
  expect((await app.request('/v1/event-sources?flowId=missing')).status).toBe(404)
  expect(await (await app.request('/v1/event-sources')).json()).toEqual({ version: 1, sources: [] })
})

it('discards older ordered events and retains the deduplication decision after a retry', async () => {
  const context = await setup()
  const flowId = await publish(context, 'Ordered events')
  for (const version of [1, 3, 2, 3]) {
    const event = {
      id: `event-${version}`,
      type: 'im.message.receive_v1',
      ordering: { key: 'object', version },
      payload: {
        event: 'im.message.receive_v1',
        deliveryId: `event-${version}`,
        appId: context.source.appId,
        tenantKey: 'tenant',
        occurredAt: null,
        body: { version },
      },
    }
    expect((await context.app.request(context.endpoint, delivery({ event }))).status).toBe(200)
  }
  await context.service.tickIntegration()
  expect(context.service.control.runs.listRuns(flowId, 20).page.runs).toHaveLength(2)
})

it.each(['normal', 'failure', 'update'])('hydrates persisted sources without losing availability or concurrent edits (%s)', async (scenario) => {
  const failFirst = scenario === 'failure'
  const directory = await mkdtemp(join(tmpdir(), 'source-protocol-upgrade-'))
  const file = join(directory, 'server.sqlite')
  const actions: string[] = []
  const connector = createConnectorHost({
    listConnections: async () => [
      { connectionId: input.connectionId, providerAccountId: 'cli_test', displayName: 'App', serviceId: 'feishu_app_bot', status: 'active', isDefault: true },
    ],
    trigger: async (_provider, _connection, _trigger, request) => {
      if (request.operation !== 'source') throw new Error('Unexpected operation')
      actions.push(request.request.action)
      if (request.request.action === 'inspect' && failFirst && actions.filter((action) => action === 'inspect').length === 1)
        throw new Error('Connector unavailable')
      if (request.request.action === 'inspect' && scenario === 'update') {
        const database = new DatabaseSync(file)
        database
          .prepare("UPDATE event_sources SET revision = revision + 1, name = 'Concurrent edit', state_json = ?")
          .run(JSON.stringify((sourceProtocolFixture(request.request) as { source: { state: unknown } }).source.state))
        database.close()
      }
      return sourceProtocolFixture(request.request)
    },
  })
  const options = { capabilities: { connector: () => connector, integration: () => ({ callbackKey: 'key', publicOrigin: 'https://flow.example' }) } }
  let service = await openService(file, options)
  try {
    let app = createServerApp(service, { resolveControlActor: () => 'operator' })
    const created = await app.request('/v1/event-sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
    expect(created.status).toBe(201)
    const original = await created.json()
    await closeService(service)
    const database = new DatabaseSync(file)
    database.prepare("UPDATE event_sources SET state_json = json_remove(state_json, '$.projection')").run()
    database.close()
    service = await openService(file, options)
    app = createServerApp(service, { resolveControlActor: () => 'operator' })
    if (failFirst) {
      const response = await app.request('/v1/event-sources')
      expect(response.status).toBe(200)
      const result = decodeEventSources(await response.json())
      expect(result.sources[0]).toMatchObject({ sourceId: original.sourceId, appId: null, manageSubscriptions: null, lastError: expect.any(String) })
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await app.request('/v1/event-sources')
      expect(response.status).toBe(200)
      const body = await response.text()
      expect(body).not.toContain(input.verificationToken)
      expect(body).not.toContain(input.encryptKey)
      const listed = JSON.parse(body)
      expect(listed.sources[0]).toMatchObject({
        sourceId: original.sourceId,
        revision: scenario === 'update' ? original.revision + 1 : original.revision,
        endpointUrl: original.endpointUrl,
      })
    }
    expect(actions).toEqual(failFirst ? ['initialize', 'inspect', 'inspect'] : ['initialize', 'inspect'])
  } finally {
    await closeService(service)
    await rm(directory, { recursive: true, force: true })
  }
})

it.each(['feishu', 'fireflies', 'jira', 'unknown'])('rejects application ingress for %s', async (kind) => {
  const { app } = await setup()
  const response = await app.request(`/v1/event-source-apps/${kind}/cli_test/events`, delivery({ verify: true }))
  expect(response.status).toBe(404)
})
