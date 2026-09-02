import type { JsonValue, RevisionContent, TriggerSchedule } from '@oomol-lab/open-flow/flow-change'
import type { PollConformanceFixture, PollConformanceHarness, PollDefinition, PollResult } from '@oomol-lab/open-flow/poll-trigger'

import { nextTriggerScheduledAt, scheduledTriggerOccurrenceId } from '@oomol-lab/open-flow/cron-trigger'
import { pollConformanceCases } from '@oomol-lab/open-flow/poll-trigger'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, it } from 'vitest'
import { createConnectorHost } from './connectorHost.ts'
import { closeService, openService } from './serviceFixture.ts'

const directories: string[] = []
let sequence = 0

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

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
  description: 'Poll conformance definition.',
  displayName: 'Poll conformance',
  key: 'conformance.on_event',
  name: 'on_event',
  payloadSchema: {
    additionalProperties: false,
    properties: { events: { items: { type: 'object' }, type: 'array' } },
    required: ['events'],
    type: 'object',
  },
  provider: 'conformance',
  type: 'poll',
} as const

function revision(config: Readonly<Record<string, JsonValue>>, connectionId: string, rules: readonly TriggerSchedule[], enabled = true): RevisionContent {
  return {
    document: {
      bindings: enabled ? { connection: { kind: 'connection', target: connectionId } } : {},
      graph: {
        nodes: enabled
          ? {
              poll: {
                bindingId: 'connection',
                config,
                definition: snapshot,
                kind: 'poll',
                name: 'Poll conformance trigger',
                pollTimes: rules,
              },
              task: {
                concurrency: 1,
                inputs: { event: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'poll', output: 'payload' }] } },
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

async function createHarness(fixture: PollConformanceFixture): Promise<PollConformanceHarness> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-poll-conformance-'))
  directories.push(directory)
  const file = path.join(directory, 'open-flow.sqlite')
  let staged: PollResult[] = []
  let calls = 0
  const definition: PollDefinition = {
    snapshot,
    async poll() {
      calls += 1
      const page = staged.shift()
      if (page == null) throw new Error('Server Poll conformance page was not staged.')
      return page
    },
  }
  let connectionId = fixture.connectionId
  const connector = createConnectorHost({
    listConnections: async () => [
      {
        connectionId,
        displayName: 'Conformance',
        isDefault: true,
        serviceId: snapshot.provider,
        status: 'active',
      },
    ],
  })
  let now = Date.parse(fixture.publishedAt)
  let service = await openService(file, { capabilities: { connector: () => connector }, clock: () => now, triggerDefinitions: [definition] })
  let config = fixture.config
  let active = true
  let nextAt = nextTriggerScheduledAt(fixture.rules, now)
  let lastOccurrence: { readonly bindingId: string; readonly occurredAt: string; readonly occurrenceId: string; readonly runtimeVersion: number } | undefined
  const publication = await service.publishFlow({
    expectedLivePublicationId: null,
    flowId: 'main',
    idempotencyKey: next('publish'),
    revision: revision(config, connectionId, fixture.rules),
    revisionId: next('revision'),
  })
  if (publication.kind != 'published') throw new Error('Initial Server Poll conformance Publication conflicted.')
  let publicationId = publication.publicationId

  return {
    async dispose() {
      await closeService(service)
    },
    async replayLast() {
      if (lastOccurrence != null) await service.processPollOccurrence(lastOccurrence)
    },
    async republish(at, change) {
      now = Date.parse(at)
      config = change?.config ?? config
      connectionId = change?.connectionId ?? connectionId
      const republished = await service.publishFlow({
        expectedLivePublicationId: publicationId,
        flowId: 'main',
        idempotencyKey: next('publish'),
        revision: revision(config, connectionId, fixture.rules),
        revisionId: next('revision'),
      })
      if (republished.kind != 'published') throw new Error('Server Poll conformance Publication conflicted.')
      publicationId = republished.publicationId
      nextAt = nextTriggerScheduledAt(fixture.rules, now)
    },
    async restart() {
      await closeService(service)
      service = await openService(file, { capabilities: { connector: () => connector }, clock: () => now, triggerDefinitions: [definition] })
    },
    async retire(at) {
      now = Date.parse(at)
      const retired = await service.publishFlow({
        expectedLivePublicationId: publicationId,
        flowId: 'main',
        idempotencyKey: next('publish'),
        revision: revision(config, connectionId, fixture.rules, false),
        revisionId: next('revision'),
      })
      if (retired.kind != 'published') throw new Error('Server Poll conformance retirement conflicted.')
      publicationId = retired.publicationId
      active = false
    },
    async state() {
      const state = service.pollState('main', 'poll')
      if (state == null || (state.health != 'healthy' && state.health != 'initializing')) {
        throw new Error('Server Poll conformance binding has an unexpected state.')
      }
      const database = new DatabaseSync(file, { readOnly: true })
      try {
        const rows = database
          .prepare(
            `SELECT trigger_occurrences.payload
             FROM poll_admissions JOIN trigger_occurrences USING (run_id)
             ORDER BY poll_admissions.rowid`,
          )
          .all() as { readonly payload: string }[]
        return { calls, checkpoint: state.checkpoint, health: state.health, payloads: rows.map((row) => JSON.parse(row.payload)) }
      } finally {
        database.close()
      }
    },
    async tick(at, pages) {
      now = Date.parse(at)
      if (!active || nextAt > now) return
      staged = [...pages]
      const state = service.pollState('main', 'poll')
      if (state == null) throw new Error('Server Poll conformance binding disappeared.')
      const scheduledAt = new Date(nextAt).toISOString()
      lastOccurrence = {
        bindingId: state.bindingId,
        occurredAt: at,
        occurrenceId: await scheduledTriggerOccurrenceId(state.bindingId, state.runtimeVersion, scheduledAt),
        runtimeVersion: state.runtimeVersion,
      }
      await service.tickPoll(at)
      if (staged.length != 0) throw new Error('Server Poll conformance pages were not fully consumed.')
      nextAt = nextTriggerScheduledAt(fixture.rules, now)
    },
  }
}

describe('Server Poll Trigger conformance', () => {
  for (const conformance of pollConformanceCases) {
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
