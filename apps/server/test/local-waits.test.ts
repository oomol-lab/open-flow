import type { FlowRunCheckpoint, WaitRequest } from '@oomol-lab/open-flow/scheduler'

import { expect, it, onTestFinished, vi } from 'vitest'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'

function fixture() {
  let now = 1000
  const database = Database.open(':memory:')
  onTestFinished(() => database.close())
  const store = new Store(database, () => now)
  store.flows.createFlow({
    actorId: 'operator',
    content: '{}',
    createdAt: now,
    digest: 'revision',
    flowId: 'flow',
    idempotencyKey: 'flow',
    name: 'Flow',
    requestDigest: 'flow',
    revisionId: 'revision',
  })
  const accepted = store.runs.acceptControlRun({
    closureDigest: 'closure',
    flowId: 'flow',
    idempotencyKey: 'run',
    inputs: {},
    modelVersion: 2,
    requestDigest: 'run',
    revisionDigest: 'revision',
    revisionId: 'revision',
    trigger: { nodeId: 'start', outputs: {} },
    variableNames: [],
  })
  if (accepted.kind != 'accepted') throw new Error('Expected acceptance')
  const runId = accepted.runId
  expect(store.runs.claim()?.runId).toBe(runId)
  expect(store.runs.start(runId, { kind: 'run.started', payload: { flowId: 'flow', scopeId: runId } })).toBe(true)
  const waits = ['first', 'second'].map(
    (waitId): WaitRequest => ({ waitId, nodeId: waitId, jobId: waitId, actions: ['approve', 'reject'], prompt: waitId, value: null, notify: true }),
  )
  const checkpoint: FlowRunCheckpoint = {
    version: 5,
    agents: {},
    results: {},
    counts: {},
    frames: Object.fromEntries(waits.map((wait) => [wait.jobId, {}])),
    inputs: {},
    bindingValues: {},
    waits: waits.map((wait) => {
      const notification = store.runs.createWait(runId, wait, 'https://flows.example')!
      return { jobId: wait.jobId, nodeId: wait.nodeId, waitId: wait.waitId, value: wait.value, notification }
    }),
  }
  return {
    store,
    database,
    runId,
    waits,
    checkpoint,
    setTime: (value: number) => {
      now = value
    },
    pause: () => store.runs.wait(runId, { kind: 'waiting', checkpoint }, 900),
  }
}

it('persists multiple waits immediately and resumes locally without a checkpoint', async () => {
  const f = fixture()
  expect(f.store.runViews.activeWaits(f.runId).map((wait) => wait.waitId)).toEqual(['first', 'second'])
  expect(f.database.connection.prepare('SELECT * FROM run_checkpoints').all()).toEqual([])
  const controller = new AbortController()
  const pending = f.store.runs.waitForResolutions(f.runId, ['first', 'second'], controller.signal)
  expect(f.store.runs.resolveWait(f.runId, 'second', 'reject')).toMatchObject({ status: 'running', changed: true })
  expect(await pending).toEqual({ second: 'reject' })
  expect(f.store.runViews.activeWaits(f.runId).map((wait) => wait.waitId)).toEqual(['first'])
  expect(f.store.runViews.listControlRuns('flow', 10, { pendingWait: true })).toHaveLength(1)
  expect(f.store.runs.createWait(f.runId, f.waits[0]!, 'https://different.example')).toEqual(f.checkpoint.waits[0]!.notification)
  expect(f.database.connection.prepare('SELECT * FROM run_checkpoints').all()).toEqual([])
})

it.each(['queued', 'starting'] as const)('accepts a second decision during %s and reads both after resume', (status) => {
  const f = fixture()
  f.pause()
  f.store.runs.resolveWait(f.runId, 'first', 'approve')
  if (status == 'starting') expect(f.store.runs.claim()?.runId).toBe(f.runId)
  expect(f.store.runs.resolveWait(f.runId, 'second', 'reject')).toMatchObject({ status, changed: true })
  if (status == 'queued') expect(f.store.runs.claim()?.runId).toBe(f.runId)
  expect(f.store.runs.resume(f.runId)).toBe(true)
  expect(f.store.runs.resume(f.runId)).toBe(false)
  expect(f.store.runs.resolutions(f.runId, ['first', 'second'])).toEqual({ first: 'approve', second: 'reject' })
})

it.each(['before', 'after'] as const)('cannot lose a decision committed %s the freeze transaction', (order) => {
  const f = fixture()
  if (order == 'before') f.store.runs.resolveWait(f.runId, 'first', 'approve')
  f.pause()
  if (order == 'after') f.store.runs.resolveWait(f.runId, 'first', 'approve')
  expect(f.store.runViews.run(f.runId)?.status).toBe('queued')
  const claimed = f.store.runs.claim()!
  expect(claimed.resume?.checkpoint).toEqual(f.checkpoint)
  expect(f.store.runs.resume(f.runId)).toBe(true)
  expect(f.store.runs.resolutions(f.runId, ['first', 'second'])).toEqual({ first: 'approve' })
})

it.each(['queued', 'starting'] as const)('expires unresolved waits during %s without reviving claimed work', (status) => {
  const f = fixture()
  f.pause()
  f.store.runs.resolveWait(f.runId, 'first', 'approve')
  if (status == 'starting') f.store.runs.claim()
  f.setTime(f.store.runViews.waitReceipt(f.runId, 'second')!.expiresAt)
  f.store.runs.maintain(Number.MAX_SAFE_INTEGER, 10, 1000)
  expect(f.store.runViews.run(f.runId)).toMatchObject({ status: 'failed', result: { error: { code: 'run.wait-expired' } } })
  expect(f.store.runs.resume(f.runId)).toBe(false)
  expect(f.store.runs.resolveWait(f.runId, 'second', 'approve')).toMatchObject({ resolutionAccepted: false, changed: false })
  expect(f.store.runs.resolveWait(f.runId, 'first', 'approve')).toMatchObject({ resolutionAccepted: true, changed: false })
})

it('rereads durable decisions after a lost in-memory wake', async () => {
  const f = fixture()
  vi.useFakeTimers()
  try {
    const pending = f.store.runs.waitForResolutions(f.runId, ['first'], new AbortController().signal)
    f.database.connection.prepare("UPDATE wait_receipts SET action = 'approve', resolved_at = 1001 WHERE run_id = ? AND wait_id = 'first'").run(f.runId)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toEqual({ first: 'approve' })
  } finally {
    vi.useRealTimers()
  }
})

it('interrupts waiting observers on cancellation and never revives the Run', async () => {
  const f = fixture()
  const pending = f.store.runs.waitForResolutions(f.runId, ['first'], new AbortController().signal)
  const rejected = expect(pending).rejects.toThrow('no longer active')
  f.store.runs.cancel(f.runId)
  await rejected
  expect(f.store.runs.resolveWait(f.runId, 'first', 'approve')).toMatchObject({ status: 'canceled', resolutionAccepted: false })
})

it.each([false, true])('recovers only safe checkpoints, checkpoint saved: %s', (paused) => {
  const f = fixture()
  if (paused) f.pause()
  const reopened = new Store(f.database, () => 1001)
  expect(reopened.runViews.run(f.runId)?.status).toBe(paused ? 'waiting' : 'indeterminate')
  if (paused) {
    reopened.runs.resolveWait(f.runId, 'first', 'approve')
    expect(reopened.runs.claim()?.resume?.checkpoint).toEqual(f.checkpoint)
  }
})

it('fails closed on corrupt stored checkpoint bytes', () => {
  const f = fixture()
  f.pause()
  f.database.connection.prepare("UPDATE run_checkpoints SET checkpoint_json = '{}' WHERE run_id = ?").run(f.runId)
  const recovered = new Store(f.database, () => 1001)
  expect(recovered.runViews.run(f.runId)).toMatchObject({ status: 'indeterminate', result: { error: { code: 'execution.resume-unavailable' } } })
})

it('releases the same-flow queue after freezing while honoring active worker exclusions', () => {
  const f = fixture()
  const accepted = f.store.runs.acceptControlRun({
    closureDigest: 'closure',
    flowId: 'flow',
    idempotencyKey: 'next',
    inputs: {},
    modelVersion: 2,
    requestDigest: 'next',
    revisionDigest: 'revision',
    revisionId: 'revision',
    trigger: { nodeId: 'start', outputs: {} },
    variableNames: [],
  })
  if (accepted.kind != 'accepted') throw new Error('Expected acceptance')
  expect(f.store.runs.claim(['flow'])).toBeUndefined()
  f.pause()
  expect(f.store.runs.claim()?.runId).toBe(accepted.runId)
})
