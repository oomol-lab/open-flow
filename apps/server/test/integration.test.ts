import type { JsonValue, RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { IntegrationDefinition } from '@oomol-lab/open-flow/integration-trigger'
import type { DestinationStream, Logger } from 'pino'
import type { ServerServiceOptions } from '../node/application/service.ts'

import { IntegrationConnectionError, PermanentIntegrationError, TransientIntegrationError } from '@oomol-lab/open-flow/integration-trigger'
import { integrationDefinitions } from '@oomol-lab/open-flow/provider-triggers'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Scope from 'effect/Scope'
import { TestClock } from 'effect/testing'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { ServerService } from '../node/application/service.ts'
import { createLogger } from '../node/logger.ts'
import { createServerApp } from '../node/transport/http.ts'
import { createConnectorHost } from './connectorHost.ts'
import { closeService, openService, startService } from './serviceFixture.ts'

const directories: string[] = []
let sequence = 0

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

function next(label: string): string {
  sequence += 1
  return `${label}-${sequence}`
}

async function databaseFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-integration-'))
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
    properties: { mode: { enum: ['connection', 'permanent', 'ready', 'transient'], type: 'string' } },
    required: ['mode'],
    type: 'object',
  },
  definitionVersion: 1,
  description: 'Integration runtime test definition.',
  displayName: 'Integration runtime test',
  endpoint: { body: { allowArray: false, allowEmpty: false, formats: ['json'] }, methods: ['POST'], successStatus: 202 },
  key: 'test.on_event',
  name: 'on_event',
  payloadSchema: {
    additionalProperties: false,
    properties: { body: { type: 'object' }, deliveryId: { type: 'string' }, event: { type: 'string' } },
    required: ['body', 'deliveryId', 'event'],
    type: 'object',
  },
  provider: 'test',
  type: 'integration',
} as const

const connector = createConnectorHost({
  listConnections: async () => [
    {
      connectionId: 'connection-main',
      displayName: 'Main',
      isDefault: true,
      serviceId: snapshot.provider,
      status: 'active',
    },
  ],
})

function revision(mode: 'connection' | 'permanent' | 'ready' | 'transient'): RevisionContent {
  return {
    document: {
      bindings: { connection: { kind: 'connection', target: 'connection-main' } },
      graph: {
        edges: [{ source: 'integration', target: 'task' }],
        nodes: {
          integration: {
            bindingId: 'connection',
            config: { mode },
            definition: snapshot,
            kind: 'integration',
            name: 'Integration runtime test',
          },
          task: {
            inputs: { event: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'integration', output: 'payload' }] } },
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

async function publish(
  service: ServerService,
  mode: 'connection' | 'permanent' | 'ready' | 'transient',
  expectedLivePublicationId: string | null,
): Promise<string> {
  const result = await service.publisher.publish({
    expectedLivePublicationId,
    flowId: 'main',
    idempotencyKey: next('publish'),
    revision: revision(mode),
    revisionId: next('revision'),
  })
  if (result.kind != 'published') throw new Error('Integration test Publication conflicted.')
  return result.publicationId
}

function options(clock: ServerServiceOptions['clock'], triggerDefinitions: readonly IntegrationDefinition[], logger?: Logger): ServerServiceOptions {
  return {
    capabilities: {
      connector: () => connector,
      integration: () => ({ callbackKey: 'callback-key', publicOrigin: 'https://flow.example' }),
    },
    clock,
    ...(logger == null ? {} : { logger }),
    triggerDefinitions,
  }
}

it('requires HTTPS for non-loopback Integration callback origins', async () => {
  const file = await databaseFile()
  await expect(
    openService(file, {
      capabilities: { integration: () => ({ callbackKey: 'callback-key', publicOrigin: 'http://flow.example' }) },
      clock: Date.now,
      triggerDefinitions: [],
    }),
  ).rejects.toThrow('Integration public origin must be an HTTPS origin without credentials, a path, query, or fragment, except on loopback.')
})

it('rejects Integration publication when the callback runtime is not configured', async () => {
  const definition: IntegrationDefinition = {
    receive: () => ({ outcome: 'ignored', reason: 'unused' }),
    reconcile: () => Promise.resolve({ outcome: 'ready' }),
    snapshot,
  }
  const service = await openService(await databaseFile(), { clock: Date.now, triggerDefinitions: [definition] })
  try {
    await expect(publish(service, 'ready', null)).rejects.toMatchObject({ code: 'trigger-invalid', message: 'Integration runtime is not configured.' })
  } finally {
    await closeService(service)
  }
})

describe('Server Integration reconciliation', () => {
  it('aborts an in-flight Provider reconciliation when the service closes', async () => {
    const entered = Promise.withResolvers<void>()
    const canceled = Promise.withResolvers<void>()
    let providerSignal: AbortSignal | undefined
    const definition: IntegrationDefinition = {
      initialState: { checkpoint: null, subscription: {} },
      receive: () => ({ outcome: 'ignored', reason: 'unused' }),
      async reconcile(context) {
        const signal = context.signal
        providerSignal = signal
        if (signal == null) throw new Error('Integration reconciliation signal is missing.')
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
      snapshot,
    }
    const at = Date.parse('2026-08-21T00:00:00.000Z')
    const service = await openService(
      await databaseFile(),
      options(() => at, [definition]),
    )
    await publish(service, 'ready', null)
    await startService(service)
    await entered.promise

    await closeService(service)
    await canceled.promise

    expect(providerSignal?.aborted).toBe(true)
  })

  it('times out an in-flight Provider reconciliation through the Effect clock', async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* TestClock.make()
          const at = Date.parse('2026-08-21T00:00:00.000Z')
          yield* clock.setTime(at)
          const file = yield* Effect.promise(databaseFile)
          const entered = Promise.withResolvers<void>()
          const canceled = Promise.withResolvers<void>()
          const definition: IntegrationDefinition = {
            initialState: { checkpoint: null, subscription: {} },
            receive: () => ({ outcome: 'ignored', reason: 'unused' }),
            async reconcile(context) {
              const signal = context.signal
              if (signal == null) throw new Error('Integration reconciliation signal is missing.')
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
            snapshot,
          }
          const service = yield* ServerService.open(file, options(clock, [definition]))
          yield* Effect.tryPromise({ try: () => publish(service, 'ready', null), catch: (error) => error })
          const ticking = service.tickIntegration(new Date(at).toISOString())
          yield* Effect.promise(() => entered.promise)

          yield* clock.adjust(30_000)
          yield* Effect.promise(() => ticking)
          yield* Effect.promise(() => canceled.promise)

          expect(service.integrationState('main', 'integration')).toMatchObject({ health: 'initializing' })
        }),
      ),
    )
  })

  it('serializes concurrent reconciliation ticks', async () => {
    let active = 0
    let calls = 0
    let entered!: () => void
    let release!: () => void
    const enteredPromise = new Promise<void>((resolve) => (entered = resolve))
    const releasePromise = new Promise<void>((resolve) => (release = resolve))
    let maximumActive = 0
    const definition: IntegrationDefinition = {
      initialState: { checkpoint: null, subscription: {} },
      receive: () => ({ outcome: 'ignored', reason: 'unused' }),
      async reconcile() {
        calls += 1
        active += 1
        maximumActive = Math.max(maximumActive, active)
        if (calls == 1) {
          entered()
          await releasePromise
        }
        active -= 1
        throw new TransientIntegrationError('retry')
      },
      snapshot,
    }
    const at = Date.parse('2026-08-21T00:00:00.000Z')
    const service = await openService(
      await databaseFile(),
      options(() => at, [definition]),
    )
    try {
      await publish(service, 'transient', null)
      const first = service.tickIntegration(new Date(at).toISOString())
      await enteredPromise
      const second = service.tickIntegration(new Date(at + 1_000).toISOString())
      await Promise.resolve()
      expect(calls).toBe(1)
      release()
      await Promise.all([first, second])
      expect(calls).toBe(2)
      expect(maximumActive).toBe(1)
    } finally {
      release()
      await closeService(service)
    }
  })

  it('cancels an armed reconciliation timer when the service closes', async () => {
    const at = Date.parse('2026-08-21T00:00:00.000Z')
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const clock = yield* TestClock.make()
          yield* clock.setTime(at)
          const file = yield* Effect.promise(databaseFile)
          let calls = 0
          const definition: IntegrationDefinition = {
            initialState: { checkpoint: null, subscription: {} },
            receive: () => ({ outcome: 'ignored', reason: 'unused' }),
            async reconcile(context) {
              calls += 1
              await context.state?.saveSubscription({}, new Date(at + 10))
              return { outcome: 'ready' }
            },
            snapshot,
          }
          yield* Effect.scoped(
            Effect.gen(function* () {
              const service = yield* ServerService.open(file, options(clock, [definition]))
              yield* Effect.tryPromise({
                try: async () => {
                  await publish(service, 'ready', null)
                  await service.tickIntegration(new Date(at).toISOString())
                },
                catch: (error) => error,
              })
              yield* service.start()
            }),
          )
          yield* clock.adjust(25)
          expect(calls).toBe(1)
        }),
      ),
    )
  })

  it('applies a one-second transient retry floor without a busy loop', async () => {
    let calls = 0
    const captured = captureLogger()
    const definition: IntegrationDefinition = {
      initialState: { checkpoint: null, subscription: {} },
      receive: () => ({ outcome: 'ignored', reason: 'unused' }),
      async reconcile() {
        calls += 1
        throw new TransientIntegrationError('retry')
      },
      snapshot,
    }
    const at = Date.parse('2026-08-21T00:00:00.000Z')
    const service = await openService(
      await databaseFile(),
      options(() => at, [definition], captured.logger),
    )
    try {
      await publish(service, 'transient', null)
      await service.tickIntegration(new Date(at).toISOString())
      await service.tickIntegration(new Date(at + 999).toISOString())
      expect(calls).toBe(1)
      await service.tickIntegration(new Date(at + 1_000).toISOString())
      expect(calls).toBe(2)
      expect(service.integrationState('main', 'integration')?.health).toBe('initializing')
      expect(captured.output().match(/"category":"trigger.integration.retrying"/g)).toHaveLength(1)
      expect(captured.output()).not.toContain('"retry"')
    } finally {
      await closeService(service)
    }
  })

  it('records Connection and permanent reconciliation failures and retries them after Publish', async () => {
    const definition: IntegrationDefinition = {
      initialState: { checkpoint: null, subscription: {} },
      receive: () => ({ outcome: 'ignored', reason: 'unused' }),
      async reconcile(context) {
        if (!context.active) return { outcome: 'ready' }
        if (context.config.mode == 'connection') throw new IntegrationConnectionError('reauthorize')
        if (context.config.mode == 'permanent') throw new PermanentIntegrationError('invalid')
        return { outcome: 'ready' }
      },
      snapshot,
    }
    let now = Date.parse('2026-08-21T00:00:00.000Z')
    const file = await databaseFile()
    const service = await openService(
      file,
      options(() => now, [definition]),
    )
    try {
      let publicationId = await publish(service, 'connection', null)
      await service.tickIntegration(new Date(now).toISOString())
      expect(service.integrationState('main', 'integration')?.health).toBe('needs_reauth')

      now += 1_000
      publicationId = await publish(service, 'permanent', publicationId)
      await service.tickIntegration(new Date(now).toISOString())
      expect(service.integrationState('main', 'integration')?.health).toBe('failed')

      now += 1_000
      publicationId = await publish(service, 'ready', publicationId)
      await service.tickIntegration(new Date(now).toISOString())
      expect(service.integrationState('main', 'integration')?.health).toBe('healthy')
      const database = new DatabaseSync(file, { readOnly: true })
      expect(database.prepare('SELECT error_code AS errorCode, kind FROM trigger_activities ORDER BY created_at DESC, activity_id DESC').all()).toEqual([
        { errorCode: null, kind: 'health.recovered' },
        { errorCode: 'trigger-key.invalid', kind: 'health.failed' },
        { errorCode: 'connector.connection-required', kind: 'health.needs_reauth' },
      ])
      database.close()
      expect(publicationId).toMatch(/^publication_/)
    } finally {
      await closeService(service)
    }
  })
})

describe('Server Integration callback fencing', () => {
  it.each(['checkpoint', 'subscription'] as const)('updates the %s snapshot only after a successful save', async (field) => {
    const definition: IntegrationDefinition = {
      initialState: { checkpoint: { version: 0 }, subscription: { version: 0 } },
      receive: () => ({ body: '', contentType: 'text/plain', outcome: 'respond', status: 202 }),
      reconcile: async () => ({ outcome: 'ready' }),
      snapshot,
    }
    const now = Date.parse('2026-08-21T00:00:00.000Z')
    const service = await openService(
      await databaseFile(),
      options(() => now, [definition]),
    )
    try {
      await publish(service, 'ready', null)
      const endpoint = service.integrationEndpoint('main', 'integration')
      if (endpoint == null) throw new Error('Integration endpoint is missing.')
      const first = service.integrationTarget(endpoint)?.state
      const stale = service.integrationTarget(endpoint)?.state
      if (first == null || stale == null) throw new Error('Integration state is missing.')
      expect(first[field]).toEqual({ version: 0 })
      const save = (value: Readonly<Record<string, JsonValue>>) =>
        field == 'checkpoint' ? first.saveCheckpoint(value) : first.saveSubscription(value, new Date(now + 60_000))
      await save({ version: 1 })
      expect(first[field]).toEqual({ version: 1 })
      await save({ version: 2 })
      expect(first[field]).toEqual({ version: 2 })

      await expect(
        field == 'checkpoint' ? stale.saveCheckpoint({ version: 3 }) : stale.saveSubscription({ version: 3 }, new Date(now + 120_000)),
      ).rejects.toThrow(TransientIntegrationError)
      expect(stale[field]).toEqual({ version: 0 })
      expect(service.integrationState('main', 'integration')?.[field]).toEqual({ version: 2 })
      expect(service.integrationTarget(endpoint)?.state[field]).toEqual({ version: 2 })
    } finally {
      await closeService(service)
    }
  })

  it('fences an in-flight old runtime and rejects concurrent checkpoint CAS', async () => {
    let mode: 'block' | 'cas' = 'block'
    let entered!: () => void
    let release!: () => void
    const enteredPromise = new Promise<void>((resolve) => (entered = resolve))
    const releasePromise = new Promise<void>((resolve) => (release = resolve))
    let casCalls = 0
    let releaseCas!: () => void
    const casBarrier = new Promise<void>((resolve) => (releaseCas = resolve))
    const definition: IntegrationDefinition = {
      initialState: { checkpoint: null, subscription: {} },
      async receive() {
        if (mode == 'block') {
          entered()
          await releasePromise
        } else {
          casCalls += 1
          if (casCalls == 2) releaseCas()
          await casBarrier
        }
        return {
          checkpoint: { deliveryId: 'delivery-main' },
          dedupeKey: 'delivery-main',
          outcome: 'event',
          payload: { body: {}, deliveryId: 'delivery-main', event: 'test' },
        }
      },
      async reconcile(context) {
        await context.state?.saveSubscription(context.active ? { active: true } : {}, new Date(context.now.getTime() + 60_000))
        return { outcome: 'ready' }
      },
      snapshot,
    }
    let now = Date.parse('2026-08-21T00:00:00.000Z')
    const file = await databaseFile()
    const service = await openService(
      file,
      options(() => now, [definition]),
    )
    try {
      let publicationId = await publish(service, 'ready', null)
      await service.tickIntegration(new Date(now).toISOString())
      const endpointId = service.integrationEndpoint('main', 'integration')!
      const app = createServerApp(service)
      const pending = app.request(`http://server.local/v1/integrations/${endpointId}`, {
        body: JSON.stringify({ deliveryId: 'delivery-main' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
      await enteredPromise
      now += 1_000
      publicationId = await publish(service, 'ready', publicationId)
      release()
      expect((await pending).status).toBe(404)
      expect(admissionCount(file)).toBe(0)

      await service.tickIntegration(new Date(now).toISOString())
      mode = 'cas'
      const first = service.integrationTarget(endpointId)!
      const second = service.integrationTarget(endpointId)!
      const input = {
        headers: new Headers(),
        method: 'POST' as const,
        payload: { deliveryId: 'delivery-main' } satisfies JsonValue,
        query: new URLSearchParams(),
        rawBody: new TextEncoder().encode('{"deliveryId":"delivery-main"}'),
      }
      const outcomes = await Promise.allSettled([service.receiveIntegrationTarget(first, input), service.receiveIntegrationTarget(second, input)])
      expect(outcomes.filter((outcome) => outcome.status == 'fulfilled').map((outcome) => outcome.value.status)).toEqual([202])
      expect(outcomes.filter((outcome) => outcome.status == 'rejected').map((outcome) => outcome.reason)).toEqual([expect.any(TransientIntegrationError)])
      expect(service.integrationState('main', 'integration')?.checkpoint).toEqual({ deliveryId: 'delivery-main' })
    } finally {
      await closeService(service)
    }
  })
})

function admissionCount(file: string): number {
  const database = new DatabaseSync(file, { readOnly: true })
  try {
    return Number((database.prepare('SELECT COUNT(*) AS count FROM integration_admissions').get() as { readonly count: number }).count)
  } finally {
    database.close()
  }
}

it.each(['request', 'service', 'deadline'] as const)('interrupts callback delivery on %s cancellation without accepting late events', async (stop) => {
  const file = await databaseFile()
  const entered = Promise.withResolvers<Parameters<IntegrationDefinition['receive']>[0]>()
  const release = Promise.withResolvers<void>()
  const saved = Promise.withResolvers<unknown>()
  const definition: IntegrationDefinition = {
    initialState: { checkpoint: null, subscription: {} },
    snapshot,
    reconcile: async () => ({ outcome: 'ready' }),
    async receive(context) {
      entered.resolve(context)
      await release.promise
      try {
        if (context.state == null) throw new Error('Missing provider state')
        await context.state.saveCheckpoint({ late: true })
        saved.resolve('saved')
      } catch (error) {
        saved.resolve(error)
      }
      return { outcome: 'event', dedupeKey: 'late', payload: { body: {}, deliveryId: 'late', event: 'test' } }
    },
  }
  const scope = await Effect.runPromise(Scope.make())
  const clock = await Effect.runPromise(TestClock.make().pipe(Scope.provide(scope)))
  const service = await openService(file, options(clock, [definition]))
  try {
    await publish(service, 'ready', null)
    await service.tickIntegration(new Date(0).toISOString())
    const endpoint = service.integrationEndpoint('main', 'integration')
    if (endpoint == null) throw new Error('Missing endpoint')
    const target = service.integrationTarget(endpoint)
    if (target == null) throw new Error('Missing target')
    const cancellation = new AbortController()
    const pending = service.receiveIntegrationTarget(
      target,
      {
        headers: new Headers(),
        method: 'POST',
        payload: {},
        query: new URLSearchParams(),
        rawBody: new Uint8Array(),
      },
      cancellation.signal,
    )
    const rejected = expect(pending).rejects.toBeDefined()
    const context = await entered.promise
    expect(context.signal?.aborted).toBe(false)
    if (stop == 'request') cancellation.abort()
    else if (stop == 'service') await closeService(service)
    else await Effect.runPromise(clock.adjust(30_000))
    await rejected
    expect(context.signal?.aborted).toBe(true)
    release.resolve()
    expect(await saved.promise).toBeInstanceOf(Error)
    expect(admissionCount(file)).toBe(0)
    if (stop != 'service') expect(service.integrationState('main', 'integration')?.checkpoint).toBeNull()
  } finally {
    release.resolve()
    await closeService(service)
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
})

it('rejects an Integration target captured before its Flow was disabled', async () => {
  const file = await databaseFile()
  const definition: IntegrationDefinition = {
    initialState: { checkpoint: null, subscription: {} },
    snapshot,
    reconcile: async () => ({ outcome: 'ready' }),
    receive: () => ({ outcome: 'event', dedupeKey: 'disabled', payload: { body: {}, deliveryId: 'disabled', event: 'test' } }),
  }
  const service = await openService(
    file,
    options(() => 0, [definition]),
  )
  const database = new DatabaseSync(file)
  try {
    await publish(service, 'ready', null)
    await service.tickIntegration(new Date(0).toISOString())
    const endpoint = service.integrationEndpoint('main', 'integration')
    if (endpoint == null) throw new Error('Missing endpoint')
    const target = service.integrationTarget(endpoint)
    if (target == null) throw new Error('Missing target')
    database.exec('UPDATE flow_live SET enabled = 0')
    expect(service.integrationTarget(endpoint)).toBeUndefined()
    const result = await service.receiveIntegrationTarget(target, {
      headers: new Headers(),
      method: 'POST',
      payload: {},
      query: new URLSearchParams(),
      rawBody: new Uint8Array(),
    })
    expect(result.status).toBe(404)
    expect(admissionCount(file)).toBe(0)
  } finally {
    database.close()
    await closeService(service)
  }
})

describe('Server change listener', () => {
  async function publishListener(service: ServerService, file: string): Promise<string> {
    const publicationId = await publish(service, 'ready', null)
    const database = new DatabaseSync(file)
    try {
      database
        .prepare(`INSERT INTO flows (flow_id, name, status, draft_revision_id, create_idempotency_key, create_request_digest, created_at, updated_at)
        SELECT 'main', 'Listener test', 'active', revision_id, 'create-main', 'create-main', 0, 0 FROM publications WHERE publication_id = ?`)
        .run(publicationId)
    } finally {
      database.close()
    }
    return publicationId
  }

  function listener(read: NonNullable<IntegrationDefinition['listener']>['read']): IntegrationDefinition {
    return {
      snapshot,
      initialState: { checkpoint: null, subscription: {} },
      listener: { intervalMs: 60_000, read },
      receive: () => ({ outcome: 'wake' }),
      reconcile: async ({ active, state, now }) => {
        if (active && state?.checkpoint == null) await state!.saveCheckpoint(0)
        if (active) await state!.saveSubscription({}, new Date(now.getTime() + 3_600_000))
        return { outcome: 'ready' }
      },
    }
  }

  it('drains continuation pages without callbacks and resumes periodic scans after restart', async () => {
    const file = await databaseFile()
    let now = 0
    const cursors: JsonValue[] = []
    const definition = listener(async ({ checkpoint }) => {
      cursors.push(checkpoint)
      return Number(checkpoint) < 7
        ? page(Number(checkpoint), Number(checkpoint) < 6)
        : { checkpoint, dedupeKey: String(checkpoint), hasMore: false, payload: null }
    })
    let service = await openService(
      file,
      options(() => now, [definition]),
    )
    try {
      await publishListener(service, file)
      await service.tickIntegration()
      expect(cursors).toEqual([0, 1, 2, 3, 4, 5, 6])
      expect(admissionCount(file)).toBe(7)
      await closeService(service)
      service = await openService(
        file,
        options(() => now, [definition]),
      )
      now = 60_000
      await service.tickIntegration()
      expect(cursors.at(-1)).toBe(7)
      expect(service.integrationState('main', 'integration')?.checkpoint).toBe(7)
      expect(admissionCount(file)).toBe(7)
    } finally {
      await closeService(service)
    }
  })

  it('retains a wake arriving during a scan and coalesces duplicate notifications', async () => {
    const file = await databaseFile()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const cursors: JsonValue[] = []
    const definition = listener(async ({ checkpoint }) => {
      cursors.push(checkpoint)
      if (cursors.length == 1) {
        entered.resolve()
        await release.promise
      }
      return cursors.length == 1 ? page(Number(checkpoint)) : { checkpoint, dedupeKey: String(checkpoint), hasMore: false, payload: null }
    })
    const service = await openService(
      file,
      options(() => 0, [definition]),
    )
    try {
      await publishListener(service, file)
      const scanning = service.tickIntegration()
      await entered.promise
      expect((await wake(service)).status).toBe(202)
      expect((await wake(service)).status).toBe(202)
      release.resolve()
      await scanning
      expect(cursors).toEqual([0, 1])
      expect(admissionCount(file)).toBe(1)
    } finally {
      release.resolve()
      await closeService(service)
    }
  })

  it('rejects an old worker after republish and retries from the retained cursor', async () => {
    const file = await databaseFile()
    let now = 0
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const cursors: JsonValue[] = []
    const definition = listener(async ({ checkpoint }) => {
      cursors.push(checkpoint)
      if (cursors.length == 1) {
        entered.resolve()
        await release.promise
      }
      return page(Number(checkpoint))
    })
    const service = await openService(
      file,
      options(() => now, [definition]),
    )
    try {
      const first = await publishListener(service, file)
      const scanning = service.tickIntegration()
      await entered.promise
      await publish(service, 'ready', first)
      release.resolve()
      await scanning
      expect(service.integrationState('main', 'integration')?.checkpoint).toBe(0)
      expect(admissionCount(file)).toBe(0)
      now = 1000
      await service.tickIntegration()
      expect(cursors).toEqual([0, 0])
      expect(admissionCount(file)).toBe(1)
    } finally {
      release.resolve()
      await closeService(service)
    }
  })

  it('does not advance a page rejected by Run capacity', async () => {
    const file = await databaseFile()
    let now = 0
    const definition = listener(async ({ checkpoint }) => page(Number(checkpoint), true))
    const service = await openService(file, { ...options(() => now, [definition]), runtime: { maxPendingRuns: 1 } })
    try {
      await publishListener(service, file)
      await service.tickIntegration()
      expect(admissionCount(file)).toBe(1)
      expect(service.integrationState('main', 'integration')?.checkpoint).toBe(1)
      now = 1000
      await service.tickIntegration()
      expect(admissionCount(file)).toBe(1)
      expect(service.integrationState('main', 'integration')?.checkpoint).toBe(1)
      const database = new DatabaseSync(file, { readOnly: true })
      const run = database.prepare("SELECT run_id AS runId FROM runs WHERE status = 'queued'").get() as { runId: string }
      database.close()
      expect(service.cancel(run.runId)).toBe(true)
      now = 2000
      await service.tickIntegration()
      expect(admissionCount(file)).toBe(2)
      expect(service.integrationState('main', 'integration')?.checkpoint).toBe(2)
    } finally {
      await closeService(service)
    }
  })

  it('rolls back Run admission when checkpoint storage fails and recovers the expired lease', async () => {
    const file = await databaseFile()
    let now = 0
    const definition = listener(async ({ checkpoint }) => page(Number(checkpoint)))
    const service = await openService(
      file,
      options(() => now, [definition]),
    )
    const database = new DatabaseSync(file)
    try {
      await publishListener(service, file)
      database.exec(`CREATE TRIGGER reject_listener_checkpoint BEFORE UPDATE OF checkpoint_json ON integration_states
        WHEN NEW.checkpoint_json = '1' BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END`)
      await expect(service.tickIntegration()).rejects.toThrow('simulated disk failure')
      expect(admissionCount(file)).toBe(0)
      expect(service.integrationState('main', 'integration')?.checkpoint).toBe(0)
      database.exec('DROP TRIGGER reject_listener_checkpoint')
      now = 60_000
      await service.tickIntegration()
      expect(admissionCount(file)).toBe(1)
      expect(service.integrationState('main', 'integration')?.checkpoint).toBe(1)
    } finally {
      database.close()
      await closeService(service)
    }
  })

  it('recovers an interrupted scan after restart without advancing the cursor', async () => {
    const file = await databaseFile()
    let now = 0
    const entered = Promise.withResolvers<void>()
    let signal: AbortSignal | undefined
    let first = true
    const definition = listener(async (context) => {
      if (first) {
        first = false
        signal = context.signal
        entered.resolve()
        await new Promise<void>((_, reject) => context.signal!.addEventListener('abort', () => reject(context.signal!.reason), { once: true }))
      }
      return page(Number(context.checkpoint))
    })
    let service = await openService(
      file,
      options(() => now, [definition]),
    )
    try {
      await publishListener(service, file)
      await startService(service)
      await entered.promise
      await closeService(service)
      expect(signal?.aborted).toBe(true)
      expect(admissionCount(file)).toBe(0)
      service = await openService(
        file,
        options(() => now, [definition]),
      )
      expect(service.integrationState('main', 'integration')?.checkpoint).toBe(0)
      now = 60_000
      await service.tickIntegration()
      expect(admissionCount(file)).toBe(1)
    } finally {
      await closeService(service)
    }
  })

  it('rejects an invalid continuation without advancing its cursor', async () => {
    const file = await databaseFile()
    const definition = listener(async ({ checkpoint }) => ({ checkpoint, hasMore: true, payload: null, dedupeKey: 'invalid' }))
    const service = await openService(
      file,
      options(() => 0, [definition]),
    )
    try {
      await publishListener(service, file)
      await service.tickIntegration()
      expect(service.integrationState('main', 'integration')).toMatchObject({ checkpoint: 0, listener: { health: 'failed', nextAt: 1000 } })
      expect(admissionCount(file)).toBe(0)
    } finally {
      await closeService(service)
    }
  })

  it('continues scanning when subscription maintenance fails', async () => {
    const file = await databaseFile()
    const definition = listener(async ({ checkpoint }) => page(Number(checkpoint)))
    const failing: IntegrationDefinition = {
      ...definition,
      reconcile: async (context) => {
        await definition.reconcile(context)
        throw new PermanentIntegrationError('Subscription unavailable')
      },
    }
    const service = await openService(
      file,
      options(() => 0, [failing]),
    )
    try {
      await publishListener(service, file)
      await service.tickIntegration()
      expect(service.integrationState('main', 'integration')?.health).toBe('failed')
      expect(service.integrationState('main', 'integration')?.checkpoint).toBe(1)
      expect(admissionCount(file)).toBe(1)
    } finally {
      await closeService(service)
    }
  })
})

it('prepares a Drive listener, preserves candidate wakes across restart, and scans after activation', async () => {
  const file = await databaseFile()
  let now = 0
  let changesRead = 0
  let failPreparation = false
  let stopped = 0
  const definition = integrationDefinitions.find((item) => item.snapshot.key == 'googledrive.watch_changes')!
  let notification: { address: string; id: string; token: string } | undefined
  const drive = createConnectorHost({
    listConnections: async () => [{ connectionId: 'connection-main', displayName: 'Drive', isDefault: true, serviceId: 'googledrive', status: 'active' }],
    proxy: async (_provider, _connection, _binding, request) => {
      if (request.endpoint == '/changes/startPageToken') return { status: 200, data: { startPageToken: 'baseline' } }
      if (request.endpoint == '/changes/watch') {
        if (failPreparation) return { status: 503, data: {} }
        notification = request.body as typeof notification
        return { status: 200, data: { resourceId: 'resource', expiration: String(86_400_000) } }
      }
      if (request.endpoint == '/changes') {
        changesRead += 1
        return request.query?.pageToken == 'baseline'
          ? { status: 200, data: { changes: [{ fileId: 'new-file' }], newStartPageToken: 'next' } }
          : { status: 200, data: { changes: [], newStartPageToken: 'next' } }
      }
      if (request.endpoint == '/channels/stop') {
        stopped += 1
        return { status: 204, data: null }
      }
      throw new Error('Unexpected Drive request')
    },
  })
  const settings: ServerServiceOptions = {
    clock: () => now,
    triggerDefinitions: [definition],
    capabilities: {
      connector: () => drive,
      integration: () => ({ callbackKey: 'callback-key', publicOrigin: 'https://flow.example' }),
    },
  }
  let service = await openService(file, settings)
  try {
    const created = await service.control.createFlow('operator', 'Drive listener', 'drive-listener')
    const flowId = created.flow.flowId
    const changed = await service.control.changeDraft('operator', flowId, created.flow.draftRevisionId, [
      { kind: 'binding.create', bindingId: 'drive', binding: { kind: 'connection', target: 'connection-main' } },
      {
        kind: 'graph.node.create',
        nodeId: 'listen',
        target: { kind: 'flow' },
        node: {
          kind: 'integration',
          bindingId: 'drive',
          config: {},
          definition: definition.snapshot,
          name: 'Watch Drive',
        },
      },
    ])
    const operation = await service.control.publishFlow('operator', flowId, changed.revision.revisionId, 'open-flow-engine/v2', null, 'publish-drive')
    await service.tickIntegration()
    expect(changesRead).toBe(0)
    expect(service.control.getPublishOperation(flowId, operation.operationId).status).toBe('pending')
    const endpointId = new URL(notification!.address).pathname.split('/').at(-1)!
    const target = service.integrationTarget(endpointId)!
    const input = {
      method: 'POST' as const,
      payload: {},
      query: new URLSearchParams(),
      rawBody: new Uint8Array(),
      headers: new Headers({
        'x-goog-channel-id': notification!.id,
        'x-goog-channel-token': notification!.token,
        'x-goog-resource-id': 'resource',
        'x-goog-resource-state': 'change',
      }),
    }
    const invalid = { ...input, headers: new Headers(input.headers) }
    invalid.headers.set('x-goog-channel-token', 'invalid')
    expect((await service.receiveIntegrationTarget(target, invalid)).status).toBe(404)
    expect((await service.receiveIntegrationTarget(target, input)).status).toBe(204)
    expect(admissionCount(file)).toBe(0)
    await closeService(service)
    service = await openService(file, settings)
    await service.tickMaintenance()
    expect(service.control.getPublishOperation(flowId, operation.operationId).status).toBe('succeeded')
    await service.tickIntegration()
    expect(service.integrationState(flowId, 'listen')?.checkpoint).toEqual({ pageToken: 'next' })
    expect(admissionCount(file)).toBe(1)
    expect((await service.receiveIntegrationTarget(service.integrationTarget(endpointId)!, input)).status).toBe(204)
    await service.tickIntegration()
    expect(admissionCount(file)).toBe(1)
    now = 300_000
    await service.tickIntegration()
    expect(changesRead).toBe(3)
    const live = await service.control.getLive(flowId)
    const scoped = await service.control.changeDraft('operator', flowId, changed.revision.revisionId, [
      { kind: 'graph.trigger.config.set', name: 'driveId', nodeId: 'listen', value: 'shared-drive' },
    ])
    failPreparation = true
    const replacement = await service.control.publishFlow(
      'operator',
      flowId,
      scoped.revision.revisionId,
      'open-flow-engine/v2',
      live.publication!.publicationId,
      'replace-drive',
    )
    await service.tickIntegration()
    await service.tickMaintenance()
    expect(service.control.getPublishOperation(flowId, replacement.operationId).status).toBe('pending')
    expect(service.integrationEndpoint(flowId, 'listen')).toBe(endpointId)
    expect(service.integrationState(flowId, 'listen')?.checkpoint).toEqual({ pageToken: 'next' })
    failPreparation = false
    now += 61_000
    await service.tickIntegration()
    await service.tickMaintenance()
    expect(service.control.getPublishOperation(flowId, replacement.operationId).status).toBe('succeeded')
    expect(service.integrationEndpoint(flowId, 'listen')).not.toBe(endpointId)
    expect(service.integrationTarget(endpointId)).toBeUndefined()
    expect(service.integrationState(flowId, 'listen')?.checkpoint).toEqual({ pageToken: 'baseline' })
    await service.tickIntegration()
    expect(admissionCount(file)).toBe(2)
    expect(stopped).toBe(1)
    service.control.retireFlow(flowId)
    await service.tickMaintenance()
    await service.tickIntegration()
    await service.tickMaintenance()
    now = 7 * 24 * 60 * 60 * 1000
    await service.tickIntegration()
    await service.tickMaintenance()
    const retired = new DatabaseSync(file, { readOnly: true })
    try {
      expect(retired.prepare('SELECT COUNT(*) AS count FROM listener_work').get()).toEqual({ count: 0 })
    } finally {
      retired.close()
    }
    expect(stopped).toBe(2)
  } finally {
    await closeService(service)
  }
})

function page(checkpoint: number, hasMore = false) {
  return { checkpoint: checkpoint + 1, dedupeKey: String(checkpoint), hasMore, payload: { body: {}, deliveryId: String(checkpoint), event: 'change' } }
}

async function wake(service: ServerService) {
  const target = service.integrationTarget(service.integrationEndpoint('main', 'integration')!)!
  return service.receiveIntegrationTarget(target, {
    headers: new Headers(),
    method: 'POST',
    payload: {},
    query: new URLSearchParams(),
    rawBody: new Uint8Array(),
  })
}
