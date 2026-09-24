import type { RevisionContent, TriggerSchedule } from '@oomol-lab/open-flow/flow-change'

import { scheduledTriggerOccurrenceId } from '@oomol-lab/open-flow/cron-trigger'
import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import * as Effect from 'effect/Effect'
import { TestClock } from 'effect/testing'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { AcceptanceError } from '../node/error.ts'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'
import { closeService, openService, startService } from './serviceFixture.ts'

const directories: string[] = []

async function withClock<Value>(at: number, run: (clock: TestClock.TestClock) => Promise<Value>): Promise<Value> {
  return await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const clock = yield* TestClock.make()
        yield* clock.setTime(at)
        return yield* Effect.tryPromise({ try: () => run(clock), catch: (error) => error })
      }),
    ),
  )
}

function revision(rules: readonly TriggerSchedule[]): RevisionContent {
  return {
    document: {
      bindings: {},
      graph: {
        edges: [],
        nodes: {
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
    modelVersion: currentFlowModelVersion,
    modules: {},
  }
}

async function databaseFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-cron-'))
  directories.push(directory)
  return path.join(directory, 'open-flow.sqlite')
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe('Server Cron Trigger', () => {
  it.each([1, 2])('isolates an unreadable model %i publication and recovers after republishing', async (modelVersion) => {
    const file = await databaseFile()
    let now = Date.parse('2026-08-21T00:00:30.000Z')
    let service = await openService(file, { clock: () => now })
    const content = revision([{ type: 'every', unit: 'minute', value: 1 }])
    const broken = await service.publisher.publish({
      expectedLivePublicationId: null,
      flowId: 'broken',
      idempotencyKey: 'publish-broken',
      revision: content,
      revisionId: 'revision-broken',
    })
    if (broken.kind != 'published') throw new Error('Initial Publication unexpectedly conflicted.')
    await service.publisher.publish({
      expectedLivePublicationId: null,
      flowId: 'healthy',
      idempotencyKey: 'publish-healthy',
      revision: content,
      revisionId: 'revision-healthy',
    })
    const database = new DatabaseSync(file)
    const unreadable = JSON.stringify({
      ...content,
      modelVersion,
      document: {
        ...content.document,
        graph: { ...content.document.graph, nodes: { ...content.document.graph.nodes, hook: { kind: 'webhook', name: 'Old webhook', inputsDef: [] } } },
      },
    })
    try {
      database.prepare('UPDATE revisions SET content = ? WHERE revision_id = ?').run(unreadable, 'revision-broken')
      now = Date.parse('2026-08-21T00:01:00.000Z')
      await startService(service)
      await service.waitForIdle()
      expect(database.prepare('SELECT flow_id AS flowId, status FROM runs').all()).toEqual([{ flowId: 'healthy', status: 'completed' }])
      expect(
        database
          .prepare("SELECT next_at AS nextAt, last_error_code AS errorCode, operator_state AS operatorState FROM cron_bindings WHERE flow_id = 'broken'")
          .get(),
      ).toEqual({ nextAt: null, errorCode: 'revision-invalid', operatorState: 'active' })
      expect(database.prepare('SELECT kind, error_code AS errorCode FROM trigger_activities').all()).toEqual([
        { kind: 'health.failed', errorCode: 'revision-invalid' },
      ])
      expect(database.prepare("SELECT content FROM revisions WHERE revision_id = 'revision-broken'").get()).toEqual({ content: unreadable })
      const connection = Database.open(file)
      try {
        expect(new Store(connection).triggers.listTriggerBindings('broken')).toMatchObject([{ health: 'failed', lastErrorCode: 'revision-invalid' }])
      } finally {
        connection.close()
      }
      await closeService(service)
      service = await openService(file, { clock: () => now })
      await service.tickCron()
      expect(database.prepare('SELECT COUNT(*) AS count FROM trigger_activities').get()).toEqual({ count: 1 })
      const recovered = await service.publisher.publish({
        expectedLivePublicationId: broken.publicationId,
        flowId: 'broken',
        idempotencyKey: 'publish-recovered',
        revision: content,
        revisionId: 'revision-recovered',
      })
      expect(recovered.kind).toBe('published')
      expect(database.prepare("SELECT last_error_code AS errorCode FROM cron_bindings WHERE flow_id = 'broken'").get()).toEqual({ errorCode: null })
      now = Date.parse('2026-08-21T00:02:00.000Z')
      await service.tickCron()
      expect(database.prepare("SELECT COUNT(*) AS count FROM runs WHERE flow_id = 'broken'").get()).toEqual({ count: 1 })
    } finally {
      database.close()
      await closeService(service)
    }
  })

  it('keeps disabled schedules stopped across restart and resumes them when enabled', async () => {
    const file = await databaseFile()
    let service = await openService(file, { clock: () => Date.parse('2026-08-21T00:00:30.000Z') })
    await service.publisher.publish({
      expectedLivePublicationId: null,
      flowId: 'main',
      idempotencyKey: 'disabled-cron',
      revision: revision([{ type: 'every', unit: 'minute', value: 1 }]),
      revisionId: 'revision-a',
    })
    const database = new DatabaseSync(file)
    try {
      database.exec('UPDATE flow_live SET enabled = 0')
      await closeService(service)
      service = await openService(file, { clock: () => Date.parse('2026-08-21T00:02:30.000Z') })
      await service.tickCron()
      expect(database.prepare('SELECT COUNT(*) AS count FROM runs').get()).toEqual({ count: 0 })
      database.exec('UPDATE flow_live SET enabled = 1')
      await service.tickCron()
      expect(database.prepare('SELECT COUNT(*) AS count FROM runs').get()).toEqual({ count: 1 })
    } finally {
      database.close()
      await closeService(service)
    }
  })

  it('rejects invalid schedules without moving Live or creating bindings', async () => {
    const file = await databaseFile()
    const service = await openService(file, { clock: () => Date.parse('2026-08-21T00:00:30.000Z') })
    await expect(
      service.publisher.publish({
        expectedLivePublicationId: null,
        flowId: 'main',
        idempotencyKey: 'publish-invalid',
        revision: revision([{ expression: '* * * * * *', timezone: 'UTC', type: 'cron' }]),
        revisionId: 'revision-invalid',
      }),
    ).rejects.toMatchObject({ code: 'trigger-invalid' } satisfies Partial<AcceptanceError>)
    await closeService(service)

    const database = new DatabaseSync(file, { readOnly: true })
    try {
      expect(database.prepare('SELECT COUNT(*) AS count FROM publications').get()).toEqual({ count: 0 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM flow_live').get()).toEqual({ count: 0 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM cron_bindings').get()).toEqual({ count: 0 })
    } finally {
      database.close()
    }
  })

  it('recovers the earliest due grid from SQLite and advances past the actual tick', async () => {
    const file = await databaseFile()
    let service = await openService(file, { clock: () => Date.parse('2026-08-21T00:00:30.000Z') })
    const published = await service.publisher.publish({
      expectedLivePublicationId: null,
      flowId: 'main',
      idempotencyKey: 'publish-cron',
      revision: revision([{ type: 'every', unit: 'minute', value: 1 }]),
      revisionId: 'revision-a',
    })
    expect(published.kind).toBe('published')
    await closeService(service)

    service = await openService(file, { clock: () => Date.parse('2026-08-21T00:03:30.000Z') })
    await service.tickCron()
    await closeService(service)

    const database = new DatabaseSync(file, { readOnly: true })
    try {
      const binding = database.prepare('SELECT binding_id AS bindingId, next_at AS nextAt, runtime_version AS runtimeVersion FROM cron_bindings').get() as {
        readonly bindingId: string
        readonly nextAt: number
        readonly runtimeVersion: number
      }
      expect(binding.nextAt).toBe(Date.parse('2026-08-21T00:04:00.000Z'))
      const occurrence = database
        .prepare(
          `SELECT trigger_occurrences.occurrence_id AS occurrenceId, trigger_occurrences.outputs AS outputsJson
           FROM cron_admissions JOIN trigger_occurrences USING (run_id)`,
        )
        .get() as { readonly occurrenceId: string; readonly outputsJson: string }
      expect(JSON.parse(occurrence.outputsJson)).toEqual({ scheduledAt: '2026-08-21T00:01:00.000Z' })
      await expect(scheduledTriggerOccurrenceId(binding.bindingId, binding.runtimeVersion, '2026-08-21T00:01:00.000Z')).resolves.toBe(occurrence.occurrenceId)
      expect(database.prepare('SELECT status, source FROM runs').get()).toEqual({ status: 'queued', source: 'live' })
      const connection = Database.open(file)
      try {
        const views = new Store(connection).runViews
        expect(views.listControlRuns('main', 10, { source: 'live' })).toHaveLength(1)
        expect(views.listControlRuns('main', 10, { source: 'draft' })).toHaveLength(0)
      } finally {
        connection.close()
      }
      expect(database.prepare('SELECT COUNT(*) AS count FROM work').get()).toEqual({ count: 1 })
    } finally {
      database.close()
    }
  })

  it('uses the process timer to wake and execute a due ordinary Run', async () => {
    const file = await databaseFile()
    await withClock(Date.parse('2026-08-21T00:00:30.000Z'), async (clock) => {
      const service = await openService(file, { clock })
      try {
        await service.publisher.publish({
          expectedLivePublicationId: null,
          flowId: 'main',
          idempotencyKey: 'publish-timer',
          revision: revision([{ type: 'every', unit: 'minute', value: 1 }]),
          revisionId: 'revision-timer',
        })
        await Effect.runPromise(clock.setTime(Date.parse('2026-08-21T00:01:00.000Z')))
        await startService(service)
        await service.waitForIdle()
      } finally {
        await closeService(service)
      }
    })

    const database = new DatabaseSync(file, { readOnly: true })
    try {
      expect(database.prepare('SELECT status FROM runs').get()).toEqual({ status: 'completed' })
      expect(database.prepare('SELECT outputs AS outputsJson FROM trigger_occurrences').get()).toEqual({
        outputsJson: JSON.stringify({ scheduledAt: '2026-08-21T00:01:00.000Z' }),
      })
      expect(database.prepare('SELECT COUNT(*) AS count FROM work').get()).toEqual({ count: 0 })
    } finally {
      database.close()
    }
  })

  it('keeps one scheduled Run while the same Flow waits', async () => {
    const file = await databaseFile()
    let now = Date.parse('2026-08-21T00:00:30.000Z')
    const service = await openService(file, { clock: () => now })
    const scheduled = revision([{ type: 'every', unit: 'minute', value: 1 }])
    const flow: RevisionContent = {
      ...scheduled,
      document: {
        ...scheduled.document,
        graph: {
          ...scheduled.document.graph,
          edges: [...scheduled.document.graph.edges, { source: 'scheduled', target: 'approval' }],
          nodes: {
            ...scheduled.document.graph.nodes,
            approval: {
              inputDefinitions: [{ handle: 'value', jsonSchema: {}, nullable: true, value: null }],
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'scheduled', output: 'scheduledAt' }] } },
              kind: 'wait',
              prompt: 'Continue?',
            },
          },
        },
      },
    }
    await service.publisher.publish({
      expectedLivePublicationId: null,
      flowId: 'main',
      idempotencyKey: 'publish-waiting-cron',
      revision: flow,
      revisionId: 'revision-waiting-cron',
    })

    now = Date.parse('2026-08-21T00:01:00.000Z')
    await service.tickCron(new Date(now).toISOString())
    await startService(service)
    const database = new DatabaseSync(file)
    try {
      await expect.poll(() => database.prepare('SELECT COUNT(*) AS count FROM wait_receipts').get()).toEqual({ count: 1 })
      const first = database.prepare('SELECT run_id AS runId, status FROM runs').get() as { readonly runId: string; readonly status: string }
      expect(first.status).toBe('running')

      now = Date.parse('2026-08-21T00:03:00.000Z')
      await service.tickCron(new Date(now).toISOString())
      expect(database.prepare('SELECT COUNT(*) AS count FROM runs').get()).toEqual({ count: 1 })
      expect(database.prepare('SELECT next_at AS nextAt FROM cron_bindings').get()).toEqual({ nextAt: Date.parse('2026-08-21T00:02:00.000Z') })

      expect(service.control.runs.cancelRun(first.runId)).toMatchObject({ cancelAccepted: true, status: 'canceled' })

      now = Date.parse('2026-08-21T00:05:00.000Z')
      await service.tickCron(new Date(now).toISOString())
      await expect.poll(() => database.prepare('SELECT COUNT(*) AS count FROM wait_receipts').get()).toEqual({ count: 2 })
      expect(database.prepare('SELECT next_at AS nextAt FROM cron_bindings').get()).toEqual({ nextAt: Date.parse('2026-08-21T00:06:00.000Z') })
      const outputs = database.prepare('SELECT outputs AS outputsJson FROM trigger_occurrences ORDER BY rowid').all() as unknown as readonly {
        readonly outputsJson: string
      }[]
      expect(outputs.map(({ outputsJson }) => JSON.parse(outputsJson).scheduledAt)).toEqual(['2026-08-21T00:01:00.000Z', '2026-08-21T00:02:00.000Z'])
    } finally {
      database.close()
      await closeService(service)
    }
  })

  it('cancels an armed process timer when the service closes', async () => {
    const file = await databaseFile()
    await withClock(Date.parse('2026-08-21T00:00:59.990Z'), async (clock) => {
      const service = await openService(file, { clock })
      await service.publisher.publish({
        expectedLivePublicationId: null,
        flowId: 'main',
        idempotencyKey: 'publish-close',
        revision: revision([{ type: 'every', unit: 'minute', value: 1 }]),
        revisionId: 'revision-close',
      })
      await startService(service)
      await closeService(service)
      await Effect.runPromise(clock.adjust(25))
    })

    const database = new DatabaseSync(file, { readOnly: true })
    try {
      expect(database.prepare('SELECT COUNT(*) AS count FROM runs').get()).toEqual({ count: 0 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM trigger_occurrences').get()).toEqual({ count: 0 })
    } finally {
      database.close()
    }
  })

  it('fences a due target when Publish advances during admission', async () => {
    const file = await databaseFile()
    let now = Date.parse('2026-08-21T00:00:30.000Z')
    const service = await openService(file, { clock: () => now })
    const published = await service.publisher.publish({
      expectedLivePublicationId: null,
      flowId: 'main',
      idempotencyKey: 'publish-before-race',
      revision: revision([{ type: 'every', unit: 'minute', value: 1 }]),
      revisionId: 'revision-before-race',
    })
    if (published.kind != 'published') throw new Error('Initial race Publication unexpectedly conflicted.')

    const subtle = crypto.subtle
    const descriptor = Object.getOwnPropertyDescriptor(subtle, 'digest')
    const digest = subtle.digest.bind(subtle)
    let reached!: () => void
    const intercepted = new Promise<void>((resolve) => (reached = resolve))
    let resume!: () => void
    const gate = new Promise<void>((resolve) => (resume = resolve))
    let first = true
    Object.defineProperty(subtle, 'digest', {
      configurable: true,
      async value(algorithm: Parameters<typeof subtle.digest>[0], data: Parameters<typeof subtle.digest>[1]) {
        if (first) {
          first = false
          reached()
          await gate
        }
        return await digest(algorithm, data)
      },
    })

    const ticking = service.tickCron('2026-08-21T00:01:00.000Z')
    try {
      await intercepted
      Reflect.deleteProperty(subtle, 'digest')
      now = Date.parse('2026-08-21T00:00:45.000Z')
      const republished = await service.publisher.publish({
        expectedLivePublicationId: published.publicationId,
        flowId: 'main',
        idempotencyKey: 'publish-during-race',
        revision: revision([{ type: 'every', unit: 'hour', value: 1 }]),
        revisionId: 'revision-during-race',
      })
      expect(republished.kind).toBe('published')
    } finally {
      resume()
      if (descriptor == null) Reflect.deleteProperty(subtle, 'digest')
      else Object.defineProperty(subtle, 'digest', descriptor)
    }
    await ticking
    await closeService(service)

    const database = new DatabaseSync(file, { readOnly: true })
    try {
      expect(database.prepare('SELECT COUNT(*) AS count FROM runs').get()).toEqual({ count: 0 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM trigger_occurrences').get()).toEqual({ count: 0 })
      expect(database.prepare('SELECT runtime_version AS runtimeVersion, next_at AS nextAt FROM cron_bindings').get()).toEqual({
        nextAt: Date.parse('2026-08-21T01:00:00.000Z'),
        runtimeVersion: 2,
      })
    } finally {
      database.close()
    }
  })
})
