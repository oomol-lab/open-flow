import * as Effect from 'effect/Effect'
import * as Semaphore from 'effect/Semaphore'
import { expect, it, onTestFinished, vi } from 'vitest'
import { Maintenance } from '../node/application/maintenance.ts'
import { silentLogger } from '../node/logger.ts'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'
import { createConnectorHost } from './connectorHost.ts'

function fixture() {
  let now = 1_000
  const database = Database.open(':memory:')
  onTestFinished(() => database.close())
  const clock = () => now
  const store = new Store(database, clock)
  return { database, clock, store, setTime: (at: number) => (now = at) }
}

function pause(store: Store, clock: () => number, flowId: string, notify = false) {
  const revisionId = `revision:${flowId}`
  store.flows.createFlow({
    actorId: 'operator',
    content: '{}',
    createdAt: clock(),
    digest: 'revision',
    flowId,
    idempotencyKey: flowId,
    name: flowId,
    requestDigest: flowId,
    revisionId,
  })
  const accepted = store.runs.acceptControlRun({
    closureDigest: 'closure',
    flowId,
    idempotencyKey: `run:${flowId}`,
    inputs: {},
    modelVersion: 1,
    requestDigest: flowId,
    revisionDigest: 'revision',
    revisionId,
    trigger: { nodeId: 'start', payload: {} },
    variableNames: [],
  })
  if (accepted.kind != 'accepted') throw new Error('Run was not accepted.')
  const { runId } = accepted
  expect(store.runs.claim()?.runId).toBe(runId)
  expect(store.runs.start(runId, { kind: 'run.started', payload: { flowId, scopeId: runId } })).toBe(true)
  const wait = { jobId: 'job', nodeId: 'wait', waitId: 'wait' }
  const waiting = store.runs.wait(
    runId,
    {
      kind: 'waiting',
      wait: { ...wait, actions: ['continue'], prompt: 'Continue?' },
      checkpoint: { bindingValues: {}, inputs: {}, results: {}, skipped: [], version: 2, agents: {}, queue: [], wait: { ...wait, value: null } },
    },
    1_000,
    notify ? { action: 'send', input: {}, messageHandle: 'message', prompt: 'Continue?', publicOrigin: 'https://flows.example', taskId: 'send' } : undefined,
  )
  if (waiting == null) throw new Error('Run did not pause.')
  return { ...waiting, flowId, runId }
}

it('schedules and expires a Wait without notifications before the periodic maintenance deadline', async () => {
  const { clock, store, setTime } = fixture()
  const changed = vi.fn()
  const publisher = { advance: vi.fn(() => 'idle' as const) }
  const maintenance = new Maintenance(
    store,
    publisher,
    clock,
    silentLogger,
    () => undefined,
    () => {},
    () => false,
    () => {},
    changed,
    () => {},
    await Effect.runPromise(Semaphore.make(1)),
  )
  const waiting = pause(store, clock, 'flow')
  setTime(waiting.expiresAt - 500)
  await Effect.runPromise(maintenance.run(new Date(clock()).toISOString()))
  expect(maintenance.nextAt()).toBe(waiting.expiresAt)
  setTime(waiting.expiresAt)
  await Effect.runPromise(maintenance.run(new Date(clock()).toISOString()))
  expect(store.runViews.run(waiting.runId)).toMatchObject({ status: 'failed', result: { error: { code: 'run.wait-expired' } } })
  expect(changed).toHaveBeenCalledExactlyOnceWith('flow', waiting.runId)
  expect(maintenance.nextAt()).toBeGreaterThan(clock())
})

it('drains expired Waits in bounded batches before claiming a still-valid notification', () => {
  const { clock, store, setTime } = fixture()
  const first = pause(store, clock, 'first', true)
  pause(store, clock, 'second', true)
  setTime(clock() + 1_000)
  const active = pause(store, clock, 'active', true)
  setTime(first.expiresAt)
  const batch = store.runs.maintain(clock(), 1, 60_000)
  expect(batch.expiredWaits).toHaveLength(1)
  expect(batch.more).toBe(true)
  expect(batch.notification?.runId).toBe(active.runId)
  expect(store.runs.nextMaintenanceAt()).toBe(clock())

  const next = store.runs.maintain(clock(), 1, 60_000)
  expect(next.expiredWaits).toHaveLength(1)
  expect(next.notification).toBeUndefined()
  expect(store.runs.nextMaintenanceAt()).toBe(active.expiresAt)
  expect(store.runs.maintain(clock(), 1, 60_000).more).toBe(false)
})

it('uses the notification lease and retry deadlines and rejects stale delivery receipts', () => {
  const { clock, store, setTime } = fixture()
  const waiting = pause(store, clock, 'flow', true)
  expect(store.runs.nextMaintenanceAt()).toBe(clock())
  const first = store.runs.maintain(clock(), 100, 60_000).notification
  if (first == null) throw new Error('Notification was not claimed.')
  expect(store.runs.nextMaintenanceAt()).toBe(clock() + 60_000)
  setTime(clock() + 60_000)
  const reclaimed = store.runs.maintain(clock(), 100, 60_000).notification
  if (reclaimed == null) throw new Error('Notification was not reclaimed.')
  expect(reclaimed.invocationId).toBe(first.invocationId)
  expect(store.runs.finishWaitNotification(first.runId, first.waitId, first.claimId, true)).toBe(false)
  const retryAt = clock() + 1_000
  store.runs.releaseWaitNotification(reclaimed.runId, reclaimed.waitId, reclaimed.claimId, retryAt, 3)
  expect(store.runs.nextMaintenanceAt()).toBe(retryAt)
  expect(store.runs.maintain(clock(), 100, 60_000).notification).toBeUndefined()
  setTime(retryAt)
  const retried = store.runs.maintain(clock(), 100, 60_000).notification
  if (retried == null) throw new Error('Notification was not retried.')
  store.runs.finishWaitNotification(retried.runId, retried.waitId, retried.claimId, true)
  expect(store.runs.nextMaintenanceAt()).toBe(waiting.expiresAt)
})

it('rolls back Run expiry if claiming notification work fails in the same maintenance batch', () => {
  const { database, clock, store, setTime } = fixture()
  const expired = pause(store, clock, 'expired')
  setTime(clock() + 1_000)
  pause(store, clock, 'active', true)
  setTime(expired.expiresAt)
  database.connection.exec(`
    CREATE TRIGGER reject_notification_claim BEFORE UPDATE ON wait_notifications
    BEGIN SELECT RAISE(ABORT, 'claim failed'); END;
  `)
  expect(() => store.runs.maintain(clock(), 100, 60_000)).toThrow('claim failed')
  expect(store.runViews.run(expired.runId)?.status).toBe('waiting')
  expect(store.runViews.events(expired.runId).filter(({ kind }) => kind == 'run.failed')).toEqual([])
  database.connection.exec('DROP TRIGGER reject_notification_claim')
  expect(store.runs.maintain(clock(), 100, 60_000).expiredWaits).toEqual([{ flowId: 'expired', runId: expired.runId }])
})

it('preserves a maintenance wake received while a notification is being delivered', async () => {
  const { clock, store } = fixture()
  const started = Promise.withResolvers<void>()
  const delivered = Promise.withResolvers<null>()
  const connector = createConnectorHost({
    execute: async () => {
      started.resolve()
      return await delivered.promise
    },
  })
  const maintenance = new Maintenance(
    store,
    { advance: () => 'idle' },
    clock,
    silentLogger,
    () => connector,
    () => {},
    () => false,
    () => {},
    () => {},
    () => {},
    await Effect.runPromise(Semaphore.make(1)),
  )
  pause(store, clock, 'flow', true)
  const running = Effect.runPromise(maintenance.run(new Date(clock()).toISOString()))
  try {
    await started.promise
    maintenance.wake()
  } finally {
    delivered.resolve(null)
    await running
  }
  expect(maintenance.nextAt()).toBe(clock())
  await Effect.runPromise(maintenance.run(new Date(clock()).toISOString()))
  expect(maintenance.nextAt()).toBeGreaterThan(clock())
})
