import type { JsonValue, RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { IntegrationDefinition } from '@oomol-lab/open-flow/integration-trigger'
import type { DestinationStream, Logger } from 'pino'

import { IntegrationConnectionError, PermanentIntegrationError, TransientIntegrationError } from '@oomol-lab/open-flow/integration-trigger'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createServerApp } from '../node/http.ts'
import { createLogger } from '../node/logger.ts'
import { ServerService } from '../node/service.ts'

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

function runtime() {
  return { integration: { callbackKey: 'callback-key', publicOrigin: 'https://flow.example' } } as const
}

it('requires HTTPS for non-loopback Integration callback origins', async () => {
  const file = await databaseFile()
  expect(() =>
    ServerService.open(
      file,
      undefined,
      Date.now,
      { integration: { callbackKey: 'callback-key', publicOrigin: 'http://flow.example' } },
      undefined,
      undefined,
      [],
    ),
  ).toThrow('Integration public origin must be an HTTPS origin without credentials, a path, query, or fragment, except on loopback.')
})

it('rejects Integration publication when the callback runtime is not configured', async () => {
  const definition: IntegrationDefinition = {
    receive: () => ({ outcome: 'ignored', reason: 'unused' }),
    reconcile: () => Promise.resolve({ outcome: 'ready' }),
    snapshot,
  }
  const service = ServerService.open(await databaseFile(), undefined, Date.now, {}, undefined, undefined, [definition])
  try {
    await expect(publish(service, 'ready', null)).rejects.toMatchObject({ code: 'trigger-invalid', message: 'Integration runtime is not configured.' })
  } finally {
    await service.close()
  }
})

describe('Server Integration reconciliation', () => {
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
    const service = ServerService.open(await databaseFile(), undefined, () => at, runtime(), undefined, undefined, [definition])
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
      await service.close()
    }
  })

  it('cancels an armed reconciliation timer when the service closes', async () => {
    let calls = 0
    const at = Date.parse('2026-08-21T00:00:00.000Z')
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
    const service = ServerService.open(await databaseFile(), undefined, () => at, runtime(), undefined, undefined, [definition])
    let closed = false
    try {
      await publish(service, 'ready', null)
      await service.tickIntegration(new Date(at).toISOString())
      service.start()
      await service.close()
      closed = true
      await new Promise<void>((resolve) => setTimeout(resolve, 25))
      expect(calls).toBe(1)
    } finally {
      if (!closed) await service.close()
    }
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
    const service = ServerService.open(await databaseFile(), undefined, () => at, runtime(), undefined, captured.logger, [definition])
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
      await service.close()
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
    const service = ServerService.open(file, undefined, () => now, runtime(), undefined, undefined, [definition])
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
      await service.close()
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
    const service = ServerService.open(file, undefined, () => now, runtime(), undefined, undefined, [definition])
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
      await service.close()
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
