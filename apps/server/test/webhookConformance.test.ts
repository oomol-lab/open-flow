import type { JsonValue, RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { WebhookConformanceFixture, WebhookConformanceHarness } from '@oomol-lab/open-flow/webhook-trigger'

import { webhookConformanceCases } from '@oomol-lab/open-flow/webhook-trigger'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'vitest'
import { createServerApp } from '../node/http.ts'
import { closeService, openService } from './serviceFixture.ts'

let sequence = 0

function next(label: string): string {
  sequence += 1
  return `${label}-${sequence}`
}

function revision(fixture: WebhookConformanceFixture, enabled = true): RevisionContent {
  return {
    document: {
      bindings: {},
      graph: {
        edges: [],
        nodes: enabled
          ? {
              webhook: {
                inputsDef: fixture.inputsDef,
                kind: 'webhook',
                name: 'Incoming webhook',
                ...(fixture.options == null ? {} : { options: fixture.options }),
              },
            }
          : {},
      },
      subflows: {},
      tasks: {},
    },
    modelVersion: 1,
    modules: {},
  }
}

async function createHarness(fixture: WebhookConformanceFixture): Promise<WebhookConformanceHarness> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-webhook-conformance-'))
  const file = path.join(directory, 'open-flow.sqlite')
  const service = await openService(file)
  let revisionId = next('revision')
  const published = await service.publishFlow({
    expectedLivePublicationId: null,
    flowId: 'main',
    idempotencyKey: next('publish'),
    revision: revision(fixture),
    revisionId,
  })
  if (published.kind != 'published') throw new Error('Initial conformance Publication unexpectedly conflicted.')
  let publicationId = published.publicationId
  const endpointId = service.webhookEndpoint('main', 'webhook')
  if (endpointId == null) throw new Error('Server conformance endpoint was not created.')
  const app = createServerApp(service)

  return {
    endpointUrl: `http://server.local/v1/webhooks/${endpointId}`,
    async dispose() {
      await closeService(service)
      await rm(directory, { force: true, recursive: true })
    },
    async payloads() {
      const database = new DatabaseSync(file, { readOnly: true })
      try {
        const rows = database
          .prepare(
            `SELECT trigger_occurrences.payload
             FROM webhook_admissions
             JOIN trigger_occurrences USING (run_id)
             JOIN runs USING (run_id)
             WHERE webhook_admissions.endpoint_id = ?
             ORDER BY runs.rowid`,
          )
          .all(endpointId) as { readonly payload: string }[]
        return rows.map((row) => JSON.parse(row.payload) as JsonValue)
      } finally {
        database.close()
      }
    },
    async republish() {
      const republished = await service.publishFlow({
        expectedLivePublicationId: publicationId,
        flowId: 'main',
        idempotencyKey: next('publish'),
        revision: revision(fixture),
        revisionId,
      })
      if (republished.kind != 'published') throw new Error('Conformance republish unexpectedly conflicted.')
      publicationId = republished.publicationId
    },
    async request(request) {
      return await app.request(request)
    },
    async retire() {
      revisionId = next('revision')
      const retired = await service.publishFlow({
        expectedLivePublicationId: publicationId,
        flowId: 'main',
        idempotencyKey: next('publish'),
        revision: revision(fixture, false),
        revisionId,
      })
      if (retired.kind != 'published') throw new Error('Conformance retirement unexpectedly conflicted.')
      publicationId = retired.publicationId
    },
  }
}

describe('Server Webhook Trigger conformance', () => {
  for (const conformance of webhookConformanceCases) {
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
