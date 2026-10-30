import type { ConnectorHost } from '../node/deployment/connector-contract.ts'

import { decodeEventSource } from '@oomol-lab/open-flow/control-api'
import { inputValues } from '@oomol-lab/open-flow/flow-change'
import { integrationDefinitions } from '@oomol-lab/open-flow/provider-triggers'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Scope from 'effect/Scope'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ServerService } from '../node/application/service.ts'
import { Database } from '../node/storage/database.ts'
import { createServerApp } from '../node/transport/http.ts'

const adapterPath = process.argv[2]
if (!adapterPath) throw new Error('Pass the Connector conformance adapter path.')
const adapter = (await import(pathToFileURL(resolve(adapterPath)).href)) as {
  createHarness(upstream: () => Promise<never>): Promise<{
    request(triggerId: string, body: unknown): Promise<Response>
    disconnect(): Promise<void>
    close(): Promise<void>
  }>
}
const unexpected = async (): Promise<never> => {
  throw new Error('Unexpected upstream operation')
}
const harness = await adapter.createHarness(unexpected)
const database = Database.open(':memory:')
const scope = await Effect.runPromise(Scope.make())
try {
  let callbackCalls = 0
  const connector: ConnectorHost = {
    execute: unexpected,
    getAction: unexpected,
    listActions: unexpected,
    listAllConnections: unexpected,
    listProviders: unexpected,
    proxy: unexpected,
    searchActions: unexpected,
    ready: async () => true,
    listConnections: async () => [
      { connectionId: 'connection', providerAccountId: 'U123', serviceId: 'slackbot', displayName: 'Slack', status: 'active', isDefault: true },
      { connectionId: 'unrelated', providerAccountId: 'U123', serviceId: 'slackbot', displayName: 'Unrelated', status: 'active', isDefault: false },
    ],
    trigger: async (_provider, _connection, triggerId, request) => {
      assert.equal(request.operation, 'sourceReference')
      if (_connection === 'unrelated' && request.request.action === 'receive') throw new Error('Unrelated connection unavailable')
      if (request.request.action === 'route' || request.request.action === 'receive') callbackCalls++
      const response = await harness.request(triggerId, request)
      const body = (await response.json()) as { data?: unknown }
      assert.equal(response.status, 200, JSON.stringify(body))
      return body.data
    },
  }
  const service = await Effect.runPromise(
    ServerService.open(database, {
      capabilities: { connector: () => connector, integration: () => ({ callbackKey: 'key', publicOrigin: 'https://flow.example' }) },
    }).pipe(Scope.provide(scope)),
  )
  const app = createServerApp(service, { resolveControlActor: () => 'operator' })
  const create = await app.request('/v1/event-sources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      kind: 'slack',
      version: 1,
      name: 'Slack',
      connectionId: 'connection',
      teamId: null,
      appId: 'A123',
      workspaceId: 'T123',
      signingSecret: 'source-private-key',
      eventTypes: ['app_mention'],
    }),
  })
  assert.equal(create.status, 201, await create.clone().text())
  let source = decodeEventSource(await create.json())
  const endpoint = new URL(source.endpointUrl!).pathname
  const callback = (payload: unknown, secret = 'source-private-key') => {
    const body = JSON.stringify(payload)
    const timestamp = String(Math.floor(Date.now() / 1000))
    return app.request(endpoint, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/json',
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`,
      },
    })
  }
  assert.equal((await callback({ type: 'url_verification', challenge: 'verified' })).status, 200)
  const created = await service.control.flows.createFlow('operator', 'Source acceptance', 'create')
  const flowId = created.flow.flowId
  const draft = await service.control.drafts.changeDraft('operator', flowId, created.flow.draftRevisionId, [
    {
      kind: 'graph.node.create',
      nodeId: 'slack',
      node: {
        kind: 'integration',
        name: 'Slack',
        connectionId: 'connection',
        definition: integrationDefinitions.find((item) => item.snapshot.key === 'slackbot.on_event')!.snapshot,
        config: inputValues({ sourceId: source.sourceId, eventTypes: ['app_mention'] }),
      },
    },
  ])
  const operation = await service.control.publications.publishFlow('operator', flowId, draft.revision.revisionId, currentEngineContract, null, 'publish')
  await service.tickIntegration()
  await service.tickMaintenance()
  assert.equal(service.control.publications.getPublishOperation('operator', flowId, operation.operationId).status, 'succeeded')
  const event = {
    type: 'event_callback',
    api_app_id: 'A123',
    team_id: 'T123',
    event_id: 'Ev123',
    authorizations: [{ team_id: 'T123', user_id: 'U123', is_bot: true }],
    event: {
      type: 'app_mention',
      user: 'UOTHER',
      channel: 'C123',
      text: 'hello',
      ts: '123.1',
    },
  }
  let sourceCount = 1
  for (const count of [1, 10, 100]) {
    while (sourceCount < count) {
      sourceCount++
      const sibling = await app.request('/v1/event-sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'slack',
          version: 1,
          name: 'Sibling ' + sourceCount,
          connectionId: 'unrelated',
          teamId: null,
          appId: 'A123',
          workspaceId: 'T' + (1000 + sourceCount),
          signingSecret: 'source-private-key',
          eventTypes: ['app_mention'],
        }),
      })
      assert.equal(sibling.status, 201, await sibling.clone().text())
    }
    callbackCalls = 0
    const started = performance.now()
    for (let attempt = 0; attempt < 2; attempt++) assert.equal((await callback({ ...event, event_id: 'Ev' + count })).status, 200)
    assert.equal(callbackCalls, 4, 'Each callback must route once and deliver only to its matching Source')
    await service.tickIntegration()
    console.log(
      'PASS application routing: ' + count + ' Sources, 2 Connector calls/callback, repeated delivery ' + (performance.now() - started).toFixed(2) + ' ms',
    )
  }
  assert.equal(service.control.runs.listRuns('operator', flowId, 20).page.runs.length, 3)
  const update = await app.request(`/v1/event-sources/${source.sourceId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: 1,
      expectedRevision: source.revision,
      name: 'Edited Slack',
      enabled: true,
      eventTypes: source.eventTypes,
      signingSecret: 'replacement-private-key',
    }),
  })
  assert.equal(update.status, 200, await update.clone().text())
  source = decodeEventSource(await update.json())
  assert.equal(source.verifiedAt, null)
  assert.equal((await callback({ type: 'url_verification', challenge: 'old' })).status, 401)
  assert.equal((await callback({ type: 'url_verification', challenge: 'new' }, 'replacement-private-key')).status, 200)
  const local = JSON.stringify(database.connection.prepare('SELECT * FROM event_sources').all())
  assert.ok(!local.includes('source-private-key') && !local.includes('replacement-private-key'))
  assert.deepEqual(database.connection.prepare('SELECT * FROM event_source_apps').all(), [])
  service.control.flows.retireFlow('operator', flowId)
  await service.tickMaintenance()
  await service.tickIntegration()
  await harness.disconnect()
  const removed = await app.request(`/v1/event-sources/${source.sourceId}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, expectedRevision: source.revision }),
  })
  assert.equal(removed.status, 200, await removed.clone().text())
  assert.equal(database.connection.prepare('SELECT COUNT(*) AS count FROM event_sources WHERE source_id = ?').get(source.sourceId)?.count, 0)
  console.log('PASS Open Flow + Connector: create, signed verification, publish, event deduplication, edit, reverify and deletion after disconnect')
} finally {
  await Effect.runPromise(Scope.close(scope, Exit.void))
  database.close()
  await harness.close()
}
