import type { JsonValue, RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { IntegrationDefinition } from '@oomol-lab/open-flow/integration-trigger'
import type { DestinationStream, Logger } from 'pino'
import type { ServerServiceOptions } from '../node/service.ts'

import { IntegrationConnectionError, PermanentIntegrationError, TransientIntegrationError } from '@oomol-lab/open-flow/integration-trigger'
import * as Effect from 'effect/Effect'
import { TestClock } from 'effect/testing'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createServerApp } from '../node/http.ts'
import { createLogger } from '../node/logger.ts'
import { ServerService } from '../node/service.ts'
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
        nodes: {
          integration: {
            bindingId: 'connection',
            config: { mode },
            definition: snapshot,
            kind: 'integration',
            name: 'Integration runtime test',
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
  const result = await service.publishFlow({
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
