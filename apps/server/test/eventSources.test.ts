import type { CreateEventSource } from '@oomol-lab/open-flow/control-api'
import type { JsonValue, TriggerNode } from '@oomol-lab/open-flow/flow-change'

import { decodeEventSources } from '@oomol-lab/open-flow/control-api'
import { integrationDefinitions } from '@oomol-lab/open-flow/provider-triggers'
import { createCipheriv, createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { ConnectorClient } from '../node/deployment/connector.ts'
import { createServerApp } from '../node/transport/http.ts'
import { createConnectorHost } from './connectorHost.ts'
import { openService } from './serviceFixture.ts'

const now = Date.parse('2026-09-14T08:00:00.000Z')
const definition = integrationDefinitions.find((item) => item.snapshot.key == 'feishu_app_bot.on_event')!
const input: CreateEventSource = {
  version: 1,
  name: 'Feishu',
  connectionId: 'connection',
  teamId: null,
  verificationToken: 'verification-secret',
  encryptKey: 'encrypt-secret',
  eventTypes: ['im.message.receive_v1', 'approval_instance'],
  manageSubscriptions: true,
}

function delivery(value: unknown) {
  const iv = Buffer.alloc(16, 4)
  const cipher = createCipheriv('aes-256-cbc', createHash('sha256').update(input.encryptKey).digest(), iv)
  const body = JSON.stringify({ encrypt: Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final()]).toString('base64') })
  const timestamp = String(now / 1000)
  return {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-lark-request-timestamp': timestamp,
      'x-lark-request-nonce': 'nonce',
      'x-lark-signature': createHash('sha256')
        .update(timestamp + 'nonce' + input.encryptKey + body)
        .digest('hex'),
    },
  }
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
    proxy: async (_provider, _connection, _rate, request) => {
      requests.push(request.method + ' ' + request.endpoint)
      return { status: 200, data: { code: 0, data: request.endpoint == '/tenant/v2/tenant/query' ? { tenant: { tenant_key: 'tenant' } } : {} } }
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
  const challenge = await app.request(endpoint, delivery({ type: 'url_verification', token: input.verificationToken, challenge: 'verify' }))
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
    bindingId: 'connection',
    definition: definition.snapshot,
    config: {
      sourceId: source.sourceId,
      eventTypes: [resource == null ? 'im.message.receive_v1' : 'approval_instance'],
      ...(resource == null ? {} : { resource }),
    },
  }
  const draft = await service.control.changeDraft('operator', flowId, created.flow.draftRevisionId, [
    { kind: 'binding.create', bindingId: 'connection', binding: { kind: 'connection', target: input.connectionId } },
    { kind: 'graph.node.create', target: { kind: 'flow' }, nodeId: 'feishu', node },
  ])
  const operation = await service.control.publishFlow('operator', flowId, draft.revision.revisionId, 'open-flow-engine/v4', null, `publish-${name}`)
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
    schema: '2.0',
    header: {
      app_id: context.source.appId,
      tenant_key: context.source.tenantKey,
      token: input.verificationToken,
      event_id: 'event',
      event_type: 'im.message.receive_v1',
      create_time: String(now),
    },
    event: { message: { message_id: 'message', chat_id: 'chat' } },
  }
  expect((await context.app.request(context.endpoint, delivery(event))).status).toBe(200)
  const c = await publish(context, 'C')
  expect((await context.app.request(context.endpoint, delivery({ ...event, header: { ...event.header, event_id: 'retry' } }))).status).toBe(200)
  await context.service.tickIntegration()
  expect(context.service.control.runs.listRuns(a, 20).page.runs).toHaveLength(1)
  expect(context.service.control.runs.listRuns(b, 20).page.runs).toHaveLength(1)
  expect(context.service.control.runs.listRuns(c, 20).page.runs).toHaveLength(0)
  const forged = delivery(event)
  forged.headers['x-lark-signature'] = '0'.repeat(64)
  expect((await context.app.request(context.endpoint, forged)).status).toBe(401)
})

it('shares one approval subscription and prevents deleting an event source still in use', async () => {
  const context = await setup()
  await publish(context, 'A', { kind: 'approval', id: 'approval' })
  await publish(context, 'B', { kind: 'approval', id: 'approval' })
  expect(context.requests.filter((request) => request == 'POST /approval/v4/approvals/approval/subscribe')).toHaveLength(1)
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

it('derives the application and tenant from the selected Connection', async () => {
  const provider = 'feishu_app_bot'
  const connector = createConnectorHost({
    listConnections: async () => [
      { connectionId: input.connectionId, providerAccountId: 'cli_test', displayName: 'Feishu', serviceId: provider, status: 'active', isDefault: true },
    ],
    proxy: async (_provider, _connection, _rate, request) => {
      expect(request.endpoint).toBe('/tenant/v2/tenant/query')
      return { status: 200, data: { code: 0, data: { tenant: { tenant_key: 'derived-tenant' } } } }
    },
  })
  const service = await openService(':memory:', { capabilities: { connector: () => connector } })
  const app = createServerApp(service, { resolveControlActor: () => 'operator' })
  const response = await app.request('/v1/event-sources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  expect(response.status, await response.clone().text()).toBe(201)
  expect(await response.json()).toMatchObject({ appId: 'cli_test', tenantKey: 'derived-tenant', provider: 'feishu_app_bot' })
})

it.each([null, {}, { tenant_key: '' }, { tenant_key: ' ' }, { tenant_key: 42 }, { tenant_key: 'x'.repeat(257) }])(
  'rejects invalid tenant identity %j without creating a source',
  async (tenant) => {
    const connector = createConnectorHost({
      listConnections: async () => [
        {
          connectionId: input.connectionId,
          providerAccountId: 'cli_test',
          displayName: 'Feishu',
          serviceId: 'feishu_app_bot',
          status: 'active',
          isDefault: true,
        },
      ],
      proxy: async () => ({ status: 200, data: { code: 0, data: { tenant } } }),
    })
    const service = await openService(':memory:', { capabilities: { connector: () => connector } })
    const app = createServerApp(service, { resolveControlActor: () => 'operator' })
    const response = await app.request('/v1/event-sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
    expect(response.status).toBe(400)
    expect((await (await app.request('/v1/event-sources')).json()).sources).toEqual([])
  },
)

it('rejects missing application identity instead of accepting a manually supplied App ID', async () => {
  const connector = createConnectorHost({
    listConnections: async () => [
      { connectionId: input.connectionId, displayName: 'Unknown app', serviceId: 'feishu_app_bot', status: 'active', isDefault: true },
    ],
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
