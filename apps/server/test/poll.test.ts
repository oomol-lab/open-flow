import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { PollDefinition, PollResult } from '@oomol-lab/open-flow/poll-trigger'
import type { DestinationStream, Logger } from 'pino'

import { maximumPollCheckpointBytes, PollConnectionError, TransientPollError } from '@oomol-lab/open-flow/poll-trigger'
import * as Effect from 'effect/Effect'
import { TestClock } from 'effect/testing'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createLogger } from '../node/logger.ts'
import { ServerService } from '../node/service.ts'
import { Store } from '../node/store.ts'
import { createConnectorHost } from './connectorHost.ts'
import { closeService, openService, startService } from './serviceFixture.ts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function databaseFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-poll-'))
  directories.push(directory)
  return path.join(directory, 'open-flow.sqlite')
}

function captureLogger(): { readonly logger: Logger; readonly output: () => string } {
  let output = ''
  const destination: DestinationStream = {
    write(chunk) {
      output += chunk
    },
  }
  return { logger: createLogger('trace', destination), output: () => output }
}

const snapshot = {
  configSchema: {
    additionalProperties: false,
    properties: { source: { type: 'string' } },
    required: ['source'],
    type: 'object',
  },
  definitionVersion: 1,
  description: 'Poll test definition.',
  displayName: 'Poll test',
  key: 'test.on_event',
  name: 'on_event',
  payloadSchema: {
    additionalProperties: false,
    properties: { events: { items: { type: 'object' }, type: 'array' } },
    required: ['events'],
    type: 'object',
  },
  provider: 'test',
  type: 'poll',
} as const

function revision(source = 'primary'): RevisionContent {
  return {
    document: {
      bindings: { connection: { kind: 'connection', target: 'connection-main' } },
      graph: {
        nodes: {
          poll: {
            bindingId: 'connection',
            config: { source },
            definition: snapshot,
            kind: 'poll',
            name: 'Poll test trigger',
            pollTimes: [{ type: 'every', unit: 'minute', value: 1 }],
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
        },
      },
      subflows: {},
      tasks: {},
    },
    modelVersion: 1,
    modules: { 'module-main': { imports: [], name: 'Main', source: 'export default function run() { return {} }' } },
  }
}

const activeConnection = {
  connectionId: 'connection-main',
  displayName: 'Main',
  isDefault: true,
  serviceId: snapshot.provider,
  status: 'active',
} as const
const connector = createConnectorHost({ listConnections: async () => [activeConnection] })
const publishedAt = Date.parse('2026-08-21T00:00:30.000Z')

async function publish(service: ServerService, content = revision(), expectedLivePublicationId: string | null = null) {
  const result = await service.publishFlow({
    expectedLivePublicationId,
    flowId: 'main',
    idempotencyKey: crypto.randomUUID(),
    revision: content,
    revisionId: crypto.randomUUID(),
  })
  if (result.kind != 'published') throw new Error('Poll test Publication conflicted.')
  return result.publicationId
}

describe('Server Poll Trigger', () => {
  it('aborts an in-flight Provider and Connector request when the service closes', async () => {
    const entered = Promise.withResolvers<void>()
    const canceled = Promise.withResolvers<void>()
    let providerSignal: AbortSignal | undefined
    const requestSignal = new AbortController().signal
    const waitingConnector = createConnectorHost({
      listConnections: async () => [activeConnection],
      async proxy(_provider, _connectionId, _rateLimitId, _request, signal) {
        entered.resolve()
        return await new Promise((_resolve, reject) => {
          const abort = (): void => {
            canceled.resolve()
            reject(signal.reason)
          }
          if (signal.aborted) abort()
          else signal.addEventListener('abort', abort, { once: true })
        })
      },
    })
    const definition: PollDefinition = {
      snapshot,
      async poll(context): Promise<PollResult> {
        providerSignal = context.signal
        await context.connector.execute({ endpoint: '/events', method: 'GET' }, requestSignal)
        return { checkpoint: null, events: [] }
      },
    }
    let now = publishedAt
    const service = await openService(await databaseFile(), {
      capabilities: { connector: () => waitingConnector },
      clock: () => now,
      triggerDefinitions: [definition],
    })
    await publish(service)
    now = Date.parse('2026-08-21T00:01:00.000Z')
    await startService(service)
    await entered.promise

    await closeService(service)
    await canceled.promise

    expect(providerSignal?.aborted).toBe(true)
    expect(requestSignal.aborted).toBe(false)
  })

  it('times out an in-flight Provider through the Effect clock', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* TestClock.make()
          yield* clock.setTime(publishedAt)
          const file = yield* Effect.promise(databaseFile)
          const entered = Promise.withResolvers<void>()
          const canceled = Promise.withResolvers<void>()
          const definition: PollDefinition = {
            snapshot,
            async poll(context) {
              const signal = context.signal
              if (signal == null) throw new Error('Poll Provider signal is missing.')
              return await new Promise((_resolve, reject) => {
                signal.addEventListener(
                  'abort',
                  () => {
                    canceled.resolve()
                    reject(signal.reason)
                  },
                  { once: true },
                )
                entered.resolve()
              })
            },
          }
          const service = yield* ServerService.open(file, {
            capabilities: { connector: () => connector },
            clock,
            triggerDefinitions: [definition],
          })
          yield* Effect.tryPromise({ try: () => publish(service), catch: (error) => error })
          const ticking = service.tickPoll('2026-08-21T00:01:00.000Z')
          yield* Effect.promise(() => entered.promise)

          yield* clock.adjust(30_000)
          yield* Effect.promise(() => ticking)
          yield* Effect.promise(() => canceled.promise)

          expect(service.pollState('main', 'poll')).toMatchObject({ checkpoint: null, health: 'initializing' })
        }),
      ),
    )
  })

  it('publishes its injected Trigger Key and tests a fixed Poll binding without changing runtime state', async () => {
    const file = await databaseFile()
    let calls = 0
    let checkpoint: unknown
    const definition: PollDefinition = {
      snapshot,
      async poll(context): Promise<PollResult> {
        calls += 1
        checkpoint = context.checkpoint
        if (calls == 1) {
          return {
            checkpoint: { baseline: true },
            events: [{ dedupeKey: 'old-event', payload: { value: 'old' } }],
          }
        }
        return {
          checkpoint: { ignored: true },
          events: [{ dedupeKey: 'event-1', payload: { value: 'first' } }],
          filtered: 2,
          hasMore: true,
        }
      },
    }
    const service = await openService(file, { capabilities: { connector: () => connector }, clock: () => publishedAt, triggerDefinitions: [definition] })
    try {
      const created = await service.control.createFlow('operator', 'Poll control', 'poll-control-flow')
      const content = revision()
      const changed = await service.control.changeDraft('operator', created.flow.flowId, created.flow.draftRevisionId, [
        { binding: { kind: 'connection', target: 'connection-main' }, bindingId: 'connection', kind: 'binding.create' },
        { kind: 'graph.node.create', node: content.document.graph.nodes.poll!, nodeId: 'poll', target: { kind: 'flow' } },
      ])
      await service.control.publishFlow('operator', created.flow.flowId, changed.revision.revisionId, 'open-flow-engine/v1', null, 'poll-control-publication')
      await service.tickPoll()
      await service.tickMaintenance()
      const before = service.pollState(created.flow.flowId, 'poll')

      expect(service.control.listTriggerKeys()).toEqual([
        {
          description: snapshot.description,
          displayName: snapshot.displayName,
          key: snapshot.key,
          name: snapshot.name,
          provider: snapshot.provider,
          type: snapshot.type,
        },
      ])
      await expect(service.control.testFlowPollTrigger(created.flow.flowId, 'poll')).resolves.toEqual({
        events: [{ value: 'first' }],
        filtered: 2,
        hasMore: true,
        version: 1,
      })
      expect(calls).toBe(2)
      expect(checkpoint).toEqual({ baseline: true })
      expect(service.pollState(created.flow.flowId, 'poll')).toEqual(before)
      const database = new DatabaseSync(file, { readOnly: true })
      expect(database.prepare('SELECT COUNT(*) AS count FROM poll_claims').get()).toEqual({ count: 0 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM poll_event_dedupe').get()).toEqual({ count: 0 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM runs').get()).toEqual({ count: 0 })
      database.close()
    } finally {
      await closeService(service)
    }
  })

  it('persists a continuation across restart and bounds transient retries', async () => {
    const file = await databaseFile()
    let calls = 0
    const definition: PollDefinition = {
      snapshot,
      async poll(): Promise<PollResult> {
        calls += 1
        if (calls == 1) return { checkpoint: { page: 1 }, events: [], hasMore: true }
        if (calls == 2) throw new TransientPollError('Provider is temporarily unavailable.')
        return { checkpoint: { page: 2 }, events: [] }
      },
    }
    let service = await openService(file, { capabilities: { connector: () => connector }, clock: () => publishedAt, triggerDefinitions: [definition] })
    await publish(service)

    await service.tickPoll('2026-08-21T00:01:00.000Z')
    expect(calls).toBe(2)
    expect(service.pollState('main', 'poll')).toMatchObject({ checkpoint: { page: 1 }, health: 'initializing' })
    await closeService(service)

    service = await openService(file, { capabilities: { connector: () => connector }, clock: () => publishedAt, triggerDefinitions: [definition] })
    await service.tickPoll('2026-08-21T00:01:00.000Z')
    expect(calls).toBe(2)
    await service.tickPoll('2026-08-21T00:01:01.000Z')
    expect(calls).toBe(3)
    expect(service.pollState('main', 'poll')).toMatchObject({ checkpoint: { page: 2 }, health: 'healthy' })
    await closeService(service)
  })

  it('bounds continuation pages processed by one Poll tick', async () => {
    let calls = 0
    const definition: PollDefinition = {
      snapshot,
      async poll() {
        calls += 1
        return { checkpoint: { page: calls }, events: [], hasMore: true }
      },
    }
    const service = await openService(await databaseFile(), {
      capabilities: { connector: () => connector },
      clock: () => publishedAt,
      triggerDefinitions: [definition],
    })
    await publish(service)

    await service.tickPoll('2026-08-21T00:01:00.000Z')

    expect(calls).toBe(100)
    expect(service.pollState('main', 'poll')).toMatchObject({ checkpoint: { page: 100 }, health: 'initializing' })
    await closeService(service)
  })

  it('stops scheduling a Poll binding that needs Connection reauthorization', async () => {
    const file = await databaseFile()
    const captured = captureLogger()
    const definition: PollDefinition = {
      snapshot,
      async poll() {
        throw new PollConnectionError('Connection requires reauthorization.')
      },
    }
    const service = await openService(file, {
      capabilities: { connector: () => connector },
      clock: () => publishedAt,
      logger: captured.logger,
      triggerDefinitions: [definition],
    })
    await publish(service)

    await service.tickPoll('2026-08-21T00:01:00.000Z')

    expect(service.pollState('main', 'poll')).toMatchObject({ checkpoint: null, health: 'needs_reauth' })
    const database = new DatabaseSync(file, { readOnly: true })
    expect(database.prepare('SELECT next_at AS nextAt FROM poll_bindings').get()).toEqual({ nextAt: null })
    expect(database.prepare('SELECT error_code AS errorCode, kind FROM trigger_activities ORDER BY created_at DESC, activity_id DESC').all()).toEqual([
      { errorCode: 'connector.connection-required', kind: 'health.needs_reauth' },
    ])
    expect(captured.output()).toContain('"category":"trigger.poll.health_changed"')
    expect(captured.output()).toContain('"health":"needs_reauth"')
    expect(captured.output()).not.toContain('Connection requires reauthorization.')
    database.close()
    await closeService(service)
  })

  it('fails a Poll binding whose Provider returns an oversized checkpoint', async () => {
    const file = await databaseFile()
    let calls = 0
    const definition: PollDefinition = {
      snapshot,
      async poll() {
        calls += 1
        return { checkpoint: calls == 1 ? null : 'x'.repeat(maximumPollCheckpointBytes), events: [] }
      },
    }
    const service = await openService(file, { capabilities: { connector: () => connector }, clock: () => publishedAt, triggerDefinitions: [definition] })
    await publish(service)

    await service.tickPoll('2026-08-21T00:01:00.000Z')
    expect(service.pollState('main', 'poll')).toMatchObject({ checkpoint: null, health: 'healthy' })
    await service.tickPoll('2026-08-21T00:02:00.000Z')
    expect(service.pollState('main', 'poll')).toMatchObject({ checkpoint: null, health: 'failed' })
    await service.tickPoll('2026-08-21T00:03:00.000Z')
    expect(calls).toBe(2)

    const database = new DatabaseSync(file, { readOnly: true })
    expect(database.prepare('SELECT next_at AS nextAt FROM poll_bindings').get()).toEqual({ nextAt: null })
    expect(database.prepare('SELECT error_code AS errorCode, kind FROM trigger_activities').all()).toEqual([
      { errorCode: 'trigger-key.invalid', kind: 'health.failed' },
    ])
    database.close()
    await closeService(service)
  })

  it('fences an in-flight page when Poll semantics are republished', async () => {
    const file = await databaseFile()
    const entered = Promise.withResolvers<void>()
    const page = Promise.withResolvers<PollResult>()
    const definition: PollDefinition = {
      snapshot,
      async poll() {
        entered.resolve()
        return await page.promise
      },
    }
    let now = Date.parse('2026-08-21T00:00:30.000Z')
    const service = await openService(file, { capabilities: { connector: () => connector }, clock: () => now, triggerDefinitions: [definition] })
    const publicationId = await publish(service)
    const ticking = service.tickPoll('2026-08-21T00:01:00.000Z')
    await entered.promise

    now = Date.parse('2026-08-21T00:01:01.000Z')
    await publish(service, revision('secondary'), publicationId)
    page.resolve({ checkpoint: { stale: true }, events: [{ dedupeKey: 'stale', payload: { value: 'stale' } }] })
    await ticking

    expect(service.pollState('main', 'poll')).toMatchObject({ checkpoint: null, health: 'initializing', runtimeVersion: 2 })
    const database = new DatabaseSync(file, { readOnly: true })
    expect(database.prepare('SELECT COUNT(*) AS count FROM poll_claims').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM poll_admissions').get()).toEqual({ count: 0 })
    database.close()
    await closeService(service)
  })

  it('allows an expired durable claim lease to be reacquired', async () => {
    const file = await databaseFile()
    const definition: PollDefinition = { snapshot, poll: () => Promise.resolve({ checkpoint: null, events: [] }) }
    const service = await openService(file, { capabilities: { connector: () => connector }, clock: () => publishedAt, triggerDefinitions: [definition] })
    await publish(service)
    await closeService(service)

    const store = new Store(file)
    const target = store.polls.duePoll(Date.parse('2026-08-21T00:01:00.000Z'), 1)[0]
    if (target == null) throw new Error('Poll claim target was not due.')
    const first = store.polls.claimPoll(target, 'claim-main', 1_000, 2_000)
    const busy = store.polls.claimPoll(target, 'claim-main', 1_500, 2_500)
    const reacquired = store.polls.claimPoll(target, 'claim-main', 2_000, 3_000)

    expect(first).toMatchObject({ kind: 'acquired' })
    expect(busy).toEqual({ kind: 'busy' })
    expect(reacquired).toMatchObject({ kind: 'acquired' })
    if (first.kind != 'acquired' || reacquired.kind != 'acquired') throw new Error('Poll claim was not acquired.')
    expect(reacquired.leaseToken).not.toBe(first.leaseToken)
    store.close()
  })
})
