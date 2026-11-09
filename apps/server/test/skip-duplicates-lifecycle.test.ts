import type { RunTerminalStatus } from '@oomol-lab/open-flow/run-lifecycle'
import type { FlowRunCheckpoint } from '@oomol-lab/open-flow/scheduler'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { hashIdentities } from '@oomol-lab/open-flow/flow-state'
import { expect, it, onTestFinished } from 'vitest'
import { isolatedVmEngineDigest } from '../node/runtime/isolated-vm.ts'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'

function fixture() {
  const database = Database.open(':memory:')
  onTestFinished(() => database.close())
  const environment = { engineDigest: isolatedVmEngineDigest, snapshot: () => undefined }
  const store = new Store(database, environment)
  store.flows.createFlow({
    actorId: 'operator',
    content: '{}',
    createdAt: 0,
    digest: 'revision',
    flowId: 'flow',
    idempotencyKey: 'flow',
    modelVersion: currentFlowModelVersion,
    name: 'Flow',
    requestDigest: 'flow',
    revisionId: 'revision',
  })
  const accepted = store.runs.acceptControlRun({
    initiator: { channel: 'api' },
    closureDigest: 'closure',
    flowId: 'flow',
    idempotencyKey: 'run',
    inputs: {},
    modelVersion: currentFlowModelVersion,
    requestDigest: 'run',
    revisionDigest: 'revision',
    revisionId: 'revision',
    trigger: { nodeId: 'start', outputs: {} },
    variableNames: [],
  })
  if (accepted.kind !== 'accepted') throw new Error('Run not accepted')
  const runId = accepted.runId
  store.runs.claim()
  store.runs.start(runId, { kind: 'run.started', payload: { flowId: 'flow', scopeId: runId } })
  return { store, database, environment, runId }
}

it.each(['completed', 'failed', 'canceled', 'indeterminate'] satisfies RunTerminalStatus[])(
  'finalizes pending history exactly once with Run %s',
  async (status) => {
    const { store, runId } = fixture()
    const hashes = await hashIdentities(['a'])
    store.state.stage('flow', 'draft', runId, 'job', 'filter', hashes)
    expect(store.runs.commit(runId, status, {})).toBe(true)
    expect(store.runs.commit(runId, status, {})).toBe(false)
    expect(store.state.has('flow', 'draft', 'node:filter', hashes)).toEqual([status === 'completed'])
    expect(store.state.view('flow', 'draft').spaces).toEqual(status === 'completed' ? [expect.objectContaining({ count: 1, pendingCount: 0 })] : [])
    expect(store.runViews.events(runId).filter((event) => event.kind === `run.${status}`)).toHaveLength(1)
  },
)

it('rolls back Run status, history and terminal event together', async () => {
  const { store, database, runId } = fixture()
  const hashes = await hashIdentities(['a'])
  store.state.stage('flow', 'draft', runId, 'job', 'filter', hashes)
  database.connection.exec(
    "CREATE TRIGGER reject_terminal BEFORE INSERT ON events WHEN NEW.kind = 'run.completed' BEGIN SELECT RAISE(ABORT, 'terminal rejected'); END;",
  )
  expect(() => store.runs.commit(runId, 'completed', {})).toThrow('terminal rejected')
  expect(store.runViews.run(runId)?.status).toBe('running')
  expect(store.state.view('flow', 'draft').spaces).toMatchObject([{ count: 0, pendingCount: 1 }])
  expect(store.runViews.events(runId).some((event) => event.kind === 'run.completed')).toBe(false)
  database.connection.exec('DROP TRIGGER reject_terminal')
  expect(store.runs.commit(runId, 'completed', {})).toBe(true)
  expect(store.state.has('flow', 'draft', 'node:filter', hashes)).toEqual([true])
})

it('discards provisional history when restart recovery declares a running Run indeterminate', async () => {
  const { store, database, environment, runId } = fixture()
  store.state.stage('flow', 'draft', runId, 'job', 'filter', await hashIdentities(['a']))
  const recovered = new Store(database, environment)
  expect(recovered.runViews.run(runId)?.status).toBe('indeterminate')
  expect(recovered.state.view('flow', 'draft').spaces).toEqual([])
  expect(recovered.runs.claim()).toBeUndefined()
})

function pauseRun(store: Store, runId: string) {
  const wait = { jobId: 'wait-job', nodeId: 'wait', waitId: 'wait' }
  store.runs.createWait(runId, { ...wait, value: null, actions: ['continue'], prompt: 'Continue', notify: false }, undefined)
  const checkpoint: FlowRunCheckpoint = {
    version: 7,
    bindingValues: {},
    inputs: {},
    results: {},
    counts: {},
    agents: {},
    dependencies: {
      nextId: 1,
      iterations: {},
      frames: [{ input: {} }],
      results: [],
      nodes: { wait: { id: 0, status: 'running', jobId: wait.jobId, input: 0, previous: [], released: [], seeded: false } },
    },
    waits: [{ ...wait, value: null }],
  }
  expect(store.runs.wait(runId, { kind: 'waiting', checkpoint }, 1000)).toBe(true)
  return wait
}

it('keeps pending identities through a durable Wait and commits only after resumed completion', async () => {
  const { store, database, environment, runId } = fixture()
  const hashes = await hashIdentities(['a'])
  store.state.stage('flow', 'draft', runId, 'filter-job', 'filter', hashes)
  const wait = pauseRun(store, runId)
  const recovered = new Store(database, environment)
  expect(recovered.runViews.run(runId)?.status).toBe('waiting')
  expect(recovered.state.view('flow', 'draft').spaces).toMatchObject([{ count: 0, pendingCount: 1 }])
  expect(recovered.runs.resolveWait(runId, wait.waitId, 'continue')).toMatchObject({ changed: true })
  expect(recovered.runs.claim()?.runId).toBe(runId)
  expect(recovered.runs.resume(runId)).toBe(true)
  expect(recovered.state.stage('flow', 'draft', runId, 'next-job', 'filter', hashes)).toEqual([false])
  expect(recovered.runs.commit(runId, 'completed', {})).toBe(true)
  expect(recovered.state.view('flow', 'draft').spaces).toMatchObject([{ count: 1, pendingCount: 0 }])
})

it('atomically discards expired Wait history during restart recovery', async () => {
  const { store, database, environment, runId } = fixture()
  store.state.stage('flow', 'draft', runId, 'filter-job', 'filter', await hashIdentities(['a']))
  pauseRun(store, runId)
  database.connection.prepare('UPDATE wait_receipts SET expires_at = 0 WHERE run_id = ?').run(runId)
  database.connection.exec(
    "CREATE TRIGGER reject_terminal BEFORE INSERT ON events WHEN NEW.kind = 'run.failed' BEGIN SELECT RAISE(ABORT, 'terminal rejected'); END;",
  )
  expect(() => new Store(database, environment)).toThrow('terminal rejected')
  expect(store.runViews.run(runId)?.status).toBe('waiting')
  expect(store.state.view('flow', 'draft').spaces).toMatchObject([{ count: 0, pendingCount: 1 }])
  expect(store.runViews.events(runId).some((event) => event.kind === 'run.failed')).toBe(false)
  database.connection.exec('DROP TRIGGER reject_terminal')
  const recovered = new Store(database, environment)
  expect(recovered.runViews.run(runId)?.status).toBe('failed')
  expect(recovered.state.view('flow', 'draft').spaces).toEqual([])
  expect(recovered.runViews.events(runId).filter((event) => event.kind === 'run.failed')).toHaveLength(1)
})
