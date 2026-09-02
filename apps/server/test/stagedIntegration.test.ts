import type { TriggerNode } from '@oomol-lab/open-flow/flow-change'
import type { ConnectorHost } from '../node/connector.ts'

import { integrationDefinitions } from '@oomol-lab/open-flow/provider-triggers'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { createServerApp } from '../node/http.ts'
import { ServerService } from '../node/service.ts'
import { createConnectorHost } from './connectorHost.ts'
import { closeService, openService } from './serviceFixture.ts'

const directories: string[] = []
const services = new Set<ServerService>()
const foundStripe = integrationDefinitions.find((definition) => definition.snapshot.key == 'stripe.on_event')
if (foundStripe == null) throw new Error('Stripe Integration definition is missing.')
const stripe = foundStripe

afterEach(async () => {
  await Promise.allSettled([...services].map(closeService))
  services.clear()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function databaseFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-staged-integration-'))
  directories.push(directory)
  return path.join(directory, 'open-flow.sqlite')
}

function stripeNode(events: readonly string[]): Extract<TriggerNode, { readonly kind: 'integration' }> {
  return {
    bindingId: 'stripe-connection',
    config: { apiVersion: '', events, includeConnectedAccounts: false },
    definition: stripe.snapshot,
    kind: 'integration',
    name: 'Stripe events',
  }
}

async function addStripe(service: ServerService, flowId: string, revisionId: string, events: readonly string[]): Promise<string> {
  const changed = await service.control.changeDraft('operator', flowId, revisionId, [
    { binding: { kind: 'connection', target: 'connection-stripe' }, bindingId: 'stripe-connection', kind: 'binding.create' },
    { kind: 'graph.node.create', node: stripeNode(events), nodeId: 'stripe', target: { kind: 'flow' } },
  ])
  return changed.revision.revisionId
}

async function replaceStripe(service: ServerService, flowId: string, revisionId: string, events: readonly string[]): Promise<string> {
  const changed = await service.control.changeDraft('operator', flowId, revisionId, [
    { before: ['charge.succeeded'], kind: 'graph.trigger.config.set', name: 'events', nodeId: 'stripe', value: events },
  ])
  return changed.revision.revisionId
}

async function addMarker(service: ServerService, flowId: string, revisionId: string): Promise<string> {
  const changed = await service.control.changeDraft('operator', flowId, revisionId, [
    {
      kind: 'graph.node.create',
      node: {
        concurrency: 1,
        inputs: {},
        kind: 'value',
        values: [{ handle: 'ready', jsonSchema: { type: 'boolean' }, nullable: false, value: true }],
      },
      nodeId: 'marker',
      target: { kind: 'flow' },
    },
  ])
  return changed.revision.revisionId
}

function connector(proxy: ConnectorHost['proxy']) {
  return createConnectorHost({
    listConnections: async () => [
      {
        connectionId: 'connection-stripe',
        displayName: 'Stripe',
        isDefault: true,
        serviceId: 'stripe',
        status: 'active',
      },
    ],
    proxy,
  })
}

const runtime = { integration: { callbackKey: 'callback-key', publicOrigin: 'https://flow.example' } } as const

it('recovers Stripe candidate creation with one fixed idempotency key, fences callbacks, and reuses the active subscription', async () => {
  const file = await databaseFile()
  const createKeys: string[] = []
  let createCalls = 0
  const service = await openService(
    file,
    connector(async (_provider, _connectionId, _rateLimitId, request) => {
      if (request.endpoint == '/v1/webhook_endpoints' && request.method == 'GET') {
        return { data: { data: [], has_more: false }, status: 200 }
      }
      if (request.endpoint == '/v1/webhook_endpoints' && request.method == 'POST') {
        createCalls += 1
        createKeys.push(request.headers?.['Idempotency-Key'] ?? '')
        return { data: { id: 'we_candidate', secret: 'whsec_candidate' }, status: 200 }
      }
      if (request.endpoint == '/v1/webhook_endpoints/we_candidate' && request.method == 'POST') {
        return { data: { id: 'we_candidate' }, status: 200 }
      }
      throw new Error('Unexpected Stripe request: ' + request.method + ' ' + request.endpoint)
    }),
    () => Date.parse('2026-08-31T08:00:00.000Z'),
    runtime,
    undefined,
    undefined,
    [stripe],
  )
  services.add(service)
  const created = await service.control.createFlow('operator', 'Stripe', 'stripe-flow')
  const revisionId = await addStripe(service, created.flow.flowId, created.flow.draftRevisionId, ['charge.succeeded'])
  const operation = await service.control.publishFlow('operator', created.flow.flowId, revisionId, 'open-flow-engine/v1', null, 'stripe-publish')
  const database = new DatabaseSync(file)
  const candidate = database.prepare('SELECT endpoint_id AS endpointId FROM integration_candidates WHERE operation_id = ?').get(operation.operationId) as {
    readonly endpointId: string
  }

  const callback = await createServerApp(service).request('/v1/integrations/' + candidate.endpointId, {
    body: '{}',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  expect(callback.status).toBe(404)
  expect(database.prepare('SELECT COUNT(*) AS count FROM integration_bindings').get()).toEqual({ count: 0 })

  database.exec(`
    CREATE TRIGGER fail_candidate_confirmation
    BEFORE UPDATE OF subscription_json ON integration_candidates
    WHEN OLD.subscription_json = '{}' AND NEW.subscription_json != '{}'
    BEGIN
      SELECT RAISE(ABORT, 'synthetic candidate confirmation failure');
    END;
  `)
  await service.tickIntegration('2026-08-31T08:00:00.000Z')
  database.exec('DROP TRIGGER fail_candidate_confirmation')
  await service.tickIntegration('2026-08-31T08:00:01.000Z')

  expect(createKeys).toHaveLength(2)
  expect(createKeys[0]).toBe(createKeys[1])
  expect(createKeys[0]).toContain(operation.operationId)
  expect(service.control.getPublishOperation(created.flow.flowId, operation.operationId).status).toBe('pending')
  expect(database.prepare('SELECT COUNT(*) AS count FROM integration_bindings').get()).toEqual({ count: 0 })

  await service.tickMaintenance('2026-08-31T08:00:01.000Z')
  const completed = service.control.getPublishOperation(created.flow.flowId, operation.operationId)
  if (completed.status != 'succeeded') throw new Error('Stripe Publish operation did not succeed.')
  expect(service.integrationEndpoint(created.flow.flowId, 'stripe')).toBe(candidate.endpointId)
  expect(service.integrationState(created.flow.flowId, 'stripe')?.subscription).toEqual({
    endpointId: 'we_candidate',
    signingSecret: 'whsec_candidate',
  })
  expect(database.prepare('SELECT COUNT(*) AS count FROM integration_candidates').get()).toEqual({ count: 0 })

  const unchangedRevisionId = await addMarker(service, created.flow.flowId, revisionId)
  const unchanged = await service.control.publishFlow(
    'operator',
    created.flow.flowId,
    unchangedRevisionId,
    'open-flow-engine/v1',
    completed.publicationId,
    'stripe-unchanged',
  )
  await service.tickMaintenance('2026-08-31T08:00:02.000Z')
  expect(service.control.getPublishOperation(created.flow.flowId, unchanged.operationId).status).toBe('succeeded')
  expect(service.integrationEndpoint(created.flow.flowId, 'stripe')).toBe(candidate.endpointId)
  expect(service.integrationState(created.flow.flowId, 'stripe')?.runtimeVersion).toBe(1)
  expect(createCalls).toBe(2)

  const changedRevisionId = await replaceStripe(service, created.flow.flowId, unchangedRevisionId, ['charge.failed'])
  const live = await service.control.getLive(created.flow.flowId)
  await expect(
    service.control.publishFlow(
      'operator',
      created.flow.flowId,
      changedRevisionId,
      'open-flow-engine/v1',
      live.publication?.publicationId ?? null,
      'stripe-changed',
    ),
  ).rejects.toMatchObject({ code: 'publication.unsupported' })
  expect(database.prepare('SELECT COUNT(*) AS count FROM publish_operations').get()).toEqual({ count: 2 })
  database.close()
})

it('fails a Stripe candidate before activation, preserves old Live, and recovers remote cleanup', async () => {
  const file = await databaseFile()
  let createdUrl = ''
  let deletes = 0
  const service = await openService(
    file,
    connector(async (_provider, _connectionId, _rateLimitId, request) => {
      if (request.endpoint == '/v1/webhook_endpoints' && request.method == 'GET') {
        return {
          data: { data: createdUrl == '' ? [] : [{ id: 'we_failed', url: createdUrl }], has_more: false },
          status: 200,
        }
      }
      if (request.endpoint == '/v1/webhook_endpoints' && request.method == 'POST') {
        if (typeof request.body != 'string') throw new Error('Stripe create body is missing.')
        createdUrl = new URLSearchParams(request.body).get('url') ?? ''
        return { data: { id: 'we_failed', secret: 'whsec_failed' }, status: 200 }
      }
      if (request.endpoint == '/v1/webhook_endpoints/we_failed' && request.method == 'POST') {
        return { data: { error: { message: 'Rejected.' } }, status: 400 }
      }
      if (request.endpoint == '/v1/webhook_endpoints/we_failed' && request.method == 'DELETE') {
        deletes += 1
        return { data: { deleted: true, id: 'we_failed' }, status: 200 }
      }
      throw new Error('Unexpected Stripe request: ' + request.method + ' ' + request.endpoint)
    }),
    () => Date.parse('2026-08-31T09:00:00.000Z'),
    runtime,
    undefined,
    undefined,
    [stripe],
  )
  services.add(service)
  const created = await service.control.createFlow('operator', 'Stripe failure', 'stripe-failure-flow')
  const initial = await service.control.publishFlow(
    'operator',
    created.flow.flowId,
    created.flow.draftRevisionId,
    'open-flow-engine/v1',
    null,
    'initial-publish',
  )
  await service.tickMaintenance('2026-08-31T09:00:00.000Z')
  const initialDone = service.control.getPublishOperation(created.flow.flowId, initial.operationId)
  if (initialDone.status != 'succeeded') throw new Error('Initial Publish operation did not succeed.')

  const revisionId = await addStripe(service, created.flow.flowId, created.flow.draftRevisionId, ['charge.succeeded'])
  const operation = await service.control.publishFlow(
    'operator',
    created.flow.flowId,
    revisionId,
    'open-flow-engine/v1',
    initialDone.publicationId,
    'failed-stripe',
  )
  await service.tickIntegration('2026-08-31T09:00:00.000Z')
  await service.tickIntegration('2026-08-31T09:00:01.000Z')
  await service.tickMaintenance('2026-08-31T09:00:01.000Z')

  expect(service.control.getPublishOperation(created.flow.flowId, operation.operationId)).toMatchObject({
    issue: { code: 'trigger-key.invalid', nodeId: 'stripe' },
    status: 'failed',
  })
  await expect(service.control.getLive(created.flow.flowId)).resolves.toMatchObject({
    publication: { publicationId: initialDone.publicationId },
  })
  expect(service.control.listPublications(created.flow.flowId, 10).page.publications).toHaveLength(1)
  expect(deletes).toBe(1)
  const database = new DatabaseSync(file, { readOnly: true })
  expect(database.prepare('SELECT COUNT(*) AS count FROM integration_candidates').get()).toEqual({ count: 0 })
  database.close()
})

it('removes a cleanup candidate whose fixed Integration definition is unavailable', async () => {
  const file = await databaseFile()
  const service = await openService(
    file,
    connector(async () => {
      throw new Error('Cleanup should fail before a Connector request.')
    }),
    () => Date.parse('2026-08-31T13:00:00.000Z'),
    runtime,
    undefined,
    undefined,
    [stripe],
  )
  services.add(service)
  const created = await service.control.createFlow('operator', 'Stripe cleanup', 'stripe-cleanup-flow')
  const revisionId = await addStripe(service, created.flow.flowId, created.flow.draftRevisionId, ['charge.succeeded'])
  const operation = await service.control.publishFlow('operator', created.flow.flowId, revisionId, 'open-flow-engine/v1', null, 'stripe-cleanup')
  const unavailable = { ...stripeNode(['charge.succeeded']), definition: { ...stripe.snapshot, key: 'stripe.unavailable' } }
  const database = new DatabaseSync(file)
  database
    .prepare(
      `UPDATE integration_candidates
       SET checkpoint_json = 'null', subscription_json = '{}', status = 'cleanup', next_at = ?, trigger_json = ?
       WHERE operation_id = ?`,
    )
    .run(Date.parse('2026-08-31T13:00:00.000Z'), JSON.stringify(unavailable), operation.operationId)

  await service.tickIntegration('2026-08-31T13:00:00.000Z')

  expect(database.prepare('SELECT COUNT(*) AS count FROM integration_candidates WHERE operation_id = ?').get(operation.operationId)).toEqual({ count: 0 })
  database.close()
})
