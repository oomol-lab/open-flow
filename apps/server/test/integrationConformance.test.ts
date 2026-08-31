import type { JsonValue, RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { IntegrationConformanceFixture, IntegrationConformanceHarness, IntegrationDefinition } from '@oomol-lab/open-flow/integration-trigger'

import { integrationCallbackSecret, integrationConformanceCases } from '@oomol-lab/open-flow/integration-trigger'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'vitest'
import { createServerApp } from '../node/http.ts'
import { createConnectorHost } from './connectorHost.ts'
import { closeService, openService } from './serviceFixture.ts'

let sequence = 0

function next(label: string): string {
  sequence += 1
  return `${label}-${sequence}`
}

const snapshot = {
  configSchema: {
    additionalProperties: false,
    properties: { source: { type: 'string' } },
    required: ['source'],
    type: 'object',
  },
  definitionVersion: 1,
  description: 'Integration conformance definition.',
  displayName: 'Integration conformance',
  endpoint: { body: { allowArray: false, allowEmpty: false, formats: ['json'] }, methods: ['POST'], successStatus: 202 },
  key: 'conformance.on_event',
  name: 'on_event',
  payloadSchema: {
    additionalProperties: false,
    properties: { body: { type: 'object' }, deliveryId: { type: 'string' }, event: { type: 'string' } },
    required: ['body', 'deliveryId', 'event'],
    type: 'object',
  },
  provider: 'conformance',
  type: 'integration',
} as const

function revision(fixture: IntegrationConformanceFixture, enabled = true): RevisionContent {
  return {
    document: {
      bindings: enabled ? { connection: { kind: 'connection', target: fixture.connectionId } } : {},
      graph: {
        nodes: enabled
          ? {
              integration: {
                bindingId: 'connection',
                config: fixture.config,
                definition: snapshot,
                kind: 'integration',
                name: 'Integration conformance trigger',
              },
              task: {
                concurrency: 1,
                inputs: { event: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'integration', output: 'payload' }] } },
                kind: 'task',
                task: {
                  inputs: [{ handle: 'event', jsonSchema: snapshot.payloadSchema, nullable: false }],
                  moduleId: 'module-main',
                  name: 'Main',
                  outputs: [],
                },
              },
            }
          : {},
      },
      subflows: {},
      tasks: {},
    },
    modelVersion: 1,
    modules: { 'module-main': { imports: [], name: 'Main', source: 'export default function run() { return {} }' } },
  }
}

async function createHarness(fixture: IntegrationConformanceFixture): Promise<IntegrationConformanceHarness> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-integration-conformance-'))
  const file = path.join(directory, 'open-flow.sqlite')
  const callbackKey = 'integration-conformance-key'
  const publicOrigin = 'https://flow.example'
  let receiveCalls = 0
  let reconcileCalls = 0
  const definition: IntegrationDefinition = {
    ...(fixture.definition.initialState == null ? {} : { initialState: fixture.definition.initialState }),
    async receive(input) {
      receiveCalls += 1
      return await fixture.definition.receive(input)
    },
    async reconcile(input) {
      reconcileCalls += 1
      return await fixture.definition.reconcile(input)
    },
    snapshot,
  }
  const connector = createConnectorHost({
    listConnections: async () => [
      {
        connectionId: fixture.connectionId,
        displayName: 'Conformance',
        isDefault: true,
        serviceId: snapshot.provider,
        status: 'active',
      },
    ],
  })
  let now = Date.parse(fixture.publishedAt)
  const open = () => openService(file, connector, () => now, { integration: { callbackKey, publicOrigin } }, undefined, undefined, [definition])
  let service = await open()
  let revisionId = next('revision')
  const published = await service.publishFlow({
    expectedLivePublicationId: null,
    flowId: 'main',
    idempotencyKey: next('publish'),
    revision: revision(fixture),
    revisionId,
  })
  if (published.kind != 'published') throw new Error('Initial Server Integration conformance Publication conflicted.')
  let publicationId = published.publicationId
  const endpointId = service.integrationEndpoint('main', 'integration')
  if (endpointId == null) throw new Error('Server Integration conformance endpoint was not created.')
  let app = createServerApp(service)
  const endpointUrl = `${publicOrigin}/v1/integrations/${endpointId}`

  return {
    callbackSecret: await integrationCallbackSecret(callbackKey, endpointId),
    endpointUrl,
    async dispose() {
      await closeService(service)
      await rm(directory, { force: true, recursive: true })
    },
    async reconcile(at) {
      now = Date.parse(at)
      await service.tickIntegration(at)
    },
    async republish(at) {
      now = Date.parse(at)
      const republished = await service.publishFlow({
        expectedLivePublicationId: publicationId,
        flowId: 'main',
        idempotencyKey: next('publish'),
        revision: revision(fixture),
        revisionId,
      })
      if (republished.kind != 'published') throw new Error('Server Integration conformance republish conflicted.')
      publicationId = republished.publicationId
    },
    async request(request) {
      return await app.request(request)
    },
    async restart() {
      await closeService(service)
      service = await open()
      app = createServerApp(service)
    },
    async retire(at) {
      now = Date.parse(at)
      revisionId = next('revision')
      const retired = await service.publishFlow({
        expectedLivePublicationId: publicationId,
        flowId: 'main',
        idempotencyKey: next('publish'),
        revision: revision(fixture, false),
        revisionId,
      })
      if (retired.kind != 'published') throw new Error('Server Integration conformance retirement conflicted.')
      publicationId = retired.publicationId
    },
    async state() {
      const state = service.integrationState('main', 'integration')
      if (state == null || (state.health != 'healthy' && state.health != 'initializing')) {
        throw new Error('Server Integration conformance binding has an unexpected state.')
      }
      const database = new DatabaseSync(file, { readOnly: true })
      try {
        const rows = database
          .prepare(
            `SELECT trigger_occurrences.payload
             FROM integration_admissions JOIN trigger_occurrences USING (run_id)
             ORDER BY integration_admissions.rowid`,
          )
          .all() as { readonly payload: string }[]
        return {
          checkpoint: state.checkpoint,
          health: state.health,
          payloads: rows.map((row) => JSON.parse(row.payload) as JsonValue),
          receiveCalls,
          reconcileCalls,
          runtimeVersion: state.runtimeVersion,
          subscription: state.subscription,
        }
      } finally {
        database.close()
      }
    },
  }
}

describe('Server Integration Trigger conformance', () => {
  for (const conformance of integrationConformanceCases) {
    it(conformance.name, async () => {
      const harness = await createHarness(conformance.fixture)
      try {
        await conformance.verify(harness)
      } finally {
        await harness.dispose()
      }
    })
  }
})
