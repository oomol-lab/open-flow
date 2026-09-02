import type { CronConformanceFixture, CronConformanceHarness } from '@oomol-lab/open-flow/cron-trigger'
import type { JsonValue, RevisionContent, TriggerSchedule } from '@oomol-lab/open-flow/flow-change'

import { cronConformanceCases } from '@oomol-lab/open-flow/cron-trigger'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'vitest'
import { closeService, openService, startService } from './serviceFixture.ts'

let sequence = 0

function next(label: string): string {
  sequence += 1
  return `${label}-${sequence}`
}

function revision(rules?: readonly TriggerSchedule[]): RevisionContent {
  return {
    document: {
      bindings: {},
      graph: {
        nodes:
          rules == null
            ? {}
            : {
                scheduled: {
                  cronTimes: rules,
                  kind: 'cron',
                  name: 'Scheduled trigger',
                },
              },
      },
      subflows: {},
      tasks: {},
    },
    modelVersion: 1,
    modules: {},
  }
}

async function createHarness(fixture: CronConformanceFixture): Promise<CronConformanceHarness> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-cron-conformance-'))
  const file = path.join(directory, 'open-flow.sqlite')
  let now = Date.parse(fixture.publishedAt)
  const service = await openService(file, { clock: () => now })
  let revisionId = next('revision')
  const published = await service.publishFlow({
    expectedLivePublicationId: null,
    flowId: 'main',
    idempotencyKey: next('publish'),
    revision: revision(fixture.rules),
    revisionId,
  })
  if (published.kind != 'published') throw new Error('Initial Cron conformance Publication unexpectedly conflicted.')
  let publicationId = published.publicationId
  await startService(service)

  return {
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
             FROM cron_admissions
             JOIN trigger_occurrences USING (run_id)
             JOIN runs USING (run_id)
             ORDER BY runs.rowid`,
          )
          .all() as { readonly payload: string }[]
        return rows.map((row) => JSON.parse(row.payload) as JsonValue)
      } finally {
        database.close()
      }
    },
    async republish(at, rules) {
      now = Date.parse(at)
      revisionId = next('revision')
      const republished = await service.publishFlow({
        expectedLivePublicationId: publicationId,
        flowId: 'main',
        idempotencyKey: next('publish'),
        revision: revision(rules),
        revisionId,
      })
      if (republished.kind != 'published') throw new Error('Cron conformance republish unexpectedly conflicted.')
      publicationId = republished.publicationId
    },
    async retire(at) {
      now = Date.parse(at)
      revisionId = next('revision')
      const retired = await service.publishFlow({
        expectedLivePublicationId: publicationId,
        flowId: 'main',
        idempotencyKey: next('publish'),
        revision: revision(),
        revisionId,
      })
      if (retired.kind != 'published') throw new Error('Cron conformance retirement unexpectedly conflicted.')
      publicationId = retired.publicationId
    },
    async tick(at) {
      now = Date.parse(at)
      await service.tickCron(at)
      await service.waitForIdle()
    },
  }
}

describe('Server Cron Trigger conformance', () => {
  for (const conformance of cronConformanceCases) {
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
