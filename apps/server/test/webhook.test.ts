import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'

import { webhookEndpointId } from '@oomol-lab/open-flow/webhook-trigger'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createServerApp } from '../node/http.ts'
import { ServerService } from '../node/service.ts'
import { storeRevision } from './runFixture.ts'
import { closeService, openService, startService } from './serviceFixture.ts'

const directories: string[] = []
const services: ServerService[] = []
const stringPort = { jsonSchema: { type: 'string' }, nullable: false } as const
const payloadPort = {
  jsonSchema: {
    additionalProperties: false,
    properties: { message: { type: 'string' } },
    required: ['message'],
    type: 'object',
  },
  nullable: false,
} as const

afterEach(async () => {
  await Promise.allSettled(services.splice(0).map(closeService))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function databaseFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-webhook-'))
  directories.push(directory)
  return path.join(directory, 'open-flow.sqlite')
}

function webhookFlow(): RevisionContent {
  return {
    document: {
      bindings: {},
      graph: {
        nodes: {
          capture: {
            concurrency: 1,
            inputs: { event: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'incoming', output: 'payload' }] } },
            kind: 'task',
            task: {
              inputs: [{ ...payloadPort, handle: 'event' }],
              moduleId: 'capture',
              name: 'Capture',
              outputs: [{ ...stringPort, handle: 'message' }],
            },
          },
          incoming: {
            inputsDef: [{ handle: 'message', ...stringPort }],
            kind: 'webhook',
            name: 'Incoming',
          },
        },
      },
      subflows: {},
      tasks: {},
    },
    modelVersion: 1,
    modules: {
      capture: { imports: [], name: 'Capture', source: 'export default ({ event }) => ({ message: event.message })' },
    },
  }
}

async function publishedWebhook(service: ServerService) {
  const stored = await storeRevision(service, webhookFlow(), 'revision-webhook')
  await service.control.publishFlow('test', stored.flowId, stored.revisionId, 'open-flow-engine/v1', null, 'publication-webhook')
  await service.tickMaintenance()
  const binding = service.control.getFlowTriggerBinding(stored.flowId, 'incoming', 'http://server.local')
  const endpointId = binding.endpointUrl == null ? undefined : webhookEndpointId(new URL(binding.endpointUrl))
  const target = endpointId == null ? undefined : service.webhookTarget(endpointId)
  if (target == null) throw new Error('Published Webhook target is missing.')
  return target
}

describe('Server Webhook Trigger admission', () => {
  it('does not expose resolved occurrence admission as an HTTP route', async () => {
    const service = await openService(await databaseFile())
    services.push(service)
    const app = createServerApp(service)

    const response = await app.request('http://server.local/v1/trigger-occurrences/webhook', {
      body: JSON.stringify({ message: 'hello' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: { code: 'route.not-found', message: 'Route was not found.' } })
  })

  it('executes one ordinary Run and deduplicates concurrent occurrence delivery', async () => {
    const service = await openService(await databaseFile())
    services.push(service)
    const target = await publishedWebhook(service)

    const [first, second] = await Promise.all([
      service.acceptWebhookTarget(target, 'delivery-1', { message: 'hello' }),
      service.acceptWebhookTarget(target, 'delivery-1', { message: 'hello' }),
    ])
    if (first == null || second == null) throw new Error('Concurrent matching occurrences lost their current target.')
    if (first.kind != 'accepted' || second.kind != 'accepted') throw new Error('Concurrent matching occurrences unexpectedly conflicted.')
    const acceptedRuns = [first, second]
    expect(new Set(acceptedRuns.map((accepted) => accepted.runId)).size).toBe(1)
    const accepted = acceptedRuns.find((candidate) => candidate.created)
    if (accepted == null) throw new Error('Concurrent Webhook occurrence did not create a Run.')
    expect(acceptedRuns.filter((candidate) => candidate.created)).toHaveLength(1)
    await startService(service)
    await service.waitForIdle()
    expect(service.run(accepted.runId)).toMatchObject({
      result: { kind: 'node-results', nodes: [{ jobs: [{ outputs: { message: 'hello' } }], nodeId: 'capture' }] },
      status: 'completed',
    })
    expect(service.events(accepted.runId).some((event) => event.payload.nodeId == 'incoming')).toBe(false)

    await expect(service.acceptWebhookTarget(target, 'delivery-1', { message: 'hello' })).resolves.toMatchObject({
      created: false,
      runId: accepted.runId,
      status: 'completed',
    })

    await expect(service.acceptWebhookTarget(target, 'delivery-1', { message: 'different' })).resolves.toEqual({ kind: 'conflict' })
  })

  it('bounds pending Runs without blocking idempotent replay', async () => {
    const service = await openService(await databaseFile(), { clock: Date.now, runtime: { maxPendingRuns: 1 } })
    services.push(service)
    const target = await publishedWebhook(service)

    const first = await service.acceptWebhookTarget(target, 'delivery-1', { message: 'hello' })
    if (first == null || first.kind != 'accepted') throw new Error('Initial Webhook occurrence was not accepted.')
    await expect(service.acceptWebhookTarget(target, 'delivery-2', { message: 'hello' })).resolves.toEqual({ kind: 'overloaded' })
    await expect(service.acceptWebhookTarget(target, 'delivery-1', { message: 'hello' })).resolves.toMatchObject({
      created: false,
      runId: first.runId,
      status: 'queued',
    })
    await expect(service.control.createDraftRun(target.flowId, target.revisionId, target.engineContract, {}, 'manual-run')).rejects.toMatchObject({
      code: 'run.overloaded',
      status: 429,
    })
  })

  it('rate limits requests to a valid callback endpoint', async () => {
    const service = await openService(await databaseFile())
    services.push(service)
    const target = await publishedWebhook(service)
    const app = createServerApp(service, { callbackRequestsPerMinute: 1 })
    const url = `http://server.local/v1/webhooks/${target.endpointId}`

    const first = await app.request(url, {
      body: JSON.stringify({ message: 'hello' }),
      headers: { 'content-type': 'application/json', 'idempotency-key': 'delivery-1' },
      method: 'POST',
    })
    expect(first.status).toBe(200)
    const limited = await app.request(url, {
      body: JSON.stringify({ message: 'again' }),
      headers: { 'content-type': 'application/json', 'idempotency-key': 'delivery-2' },
      method: 'POST',
    })
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
  })

  it('recovers a queued occurrence into the same Run after reopening SQLite', async () => {
    const file = await databaseFile()
    let service = await openService(file)
    services.push(service)
    const target = await publishedWebhook(service)
    const accepted = await service.acceptWebhookTarget(target, 'delivery-1', { message: 'hello' })
    if (accepted == null) throw new Error('Initial Webhook target disappeared.')
    if (accepted.kind != 'accepted') throw new Error('Initial Webhook occurrence unexpectedly conflicted.')
    expect(service.run(accepted.runId)?.status).toBe('queued')
    await closeService(service)

    service = await openService(file)
    services.push(service)
    await startService(service)
    await service.waitForIdle()
    expect(service.run(accepted.runId)?.status).toBe('completed')
    expect(service.events(accepted.runId).filter((event) => event.kind == 'run.completed')).toHaveLength(1)
    await expect(service.acceptWebhookTarget(target, 'delivery-1', { message: 'hello' })).resolves.toMatchObject({
      created: false,
      runId: accepted.runId,
      status: 'completed',
    })
  })

  it('rejects a mismatched payload or non-Webhook Trigger before acceptance', async () => {
    const service = await openService(await databaseFile())
    services.push(service)
    const target = await publishedWebhook(service)

    await expect(service.acceptWebhookTarget(target, 'delivery-1', { message: 42 })).rejects.toMatchObject({ code: 'trigger-payload-invalid' })
    await expect(service.acceptWebhookTarget({ ...target, triggerNodeId: 'capture' }, 'delivery-1', { message: 'hello' })).resolves.toBeUndefined()
  })
})
