import type { RunStatus, RunTerminalStatus } from '@oomol-lab/open-flow/run-lifecycle'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { runStatuses, runTransitionScope, runTransitionScopes, isRunClaimable, isRunTerminal } from '@oomol-lab/open-flow/run-lifecycle'
import { expect, it, onTestFinished } from 'vitest'
import { isolatedVmEngineDigest } from '../node/runtime/isolated-vm.ts'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'

let nextId = 0

function fixture() {
  const database = Database.open(':memory:')
  onTestFinished(() => database.close())
  const store = new Store(database, { engineDigest: isolatedVmEngineDigest, snapshot: () => undefined }, () => 1_000)
  store.flows.createFlow({
    actorId: 'operator',
    content: '{}',
    createdAt: 1_000,
    digest: 'revision',
    flowId: 'flow',
    idempotencyKey: 'flow',
    modelVersion: currentFlowModelVersion,
    name: 'Flow',
    requestDigest: 'flow',
    revisionId: 'revision',
  })
  return { database, store }
}

function accept(store: Store): string {
  nextId += 1
  const accepted = store.runs.acceptControlRun({
    initiator: { channel: 'api' },
    closureDigest: 'closure',
    flowId: 'flow',
    idempotencyKey: `run-${nextId}`,
    inputs: {},
    modelVersion: currentFlowModelVersion,
    requestDigest: `run-${nextId}`,
    revisionDigest: 'revision',
    revisionId: 'revision',
    trigger: { nodeId: 'start', outputs: {} },
    variableNames: [],
  })
  if (accepted.kind != 'accepted') throw new Error('Expected acceptance')
  return accepted.runId
}

function forceStatus(database: ReturnType<typeof fixture>['database'], runId: string, status: RunStatus): void {
  database.connection.prepare('UPDATE runs SET status = ? WHERE run_id = ?').run(status, runId)
}

function statusOf(store: Store, runId: string): RunStatus | undefined {
  return store.runViews.run(runId)?.status
}

function inScope(scope: readonly RunStatus[], status: RunStatus): boolean {
  return scope.some((candidate) => candidate == status)
}

it('commits each terminal only from the declared scope', () => {
  const { database, store } = fixture()
  const terminals: readonly RunTerminalStatus[] = ['canceled', 'completed', 'failed', 'indeterminate']
  for (const terminal of terminals) {
    const scope = runTransitionScope({ kind: 'commit', status: terminal })
    for (const prior of runStatuses) {
      const runId = accept(store)
      forceStatus(database, runId, prior)
      expect(store.runs.commit(runId, terminal, {}), `${terminal} from ${prior}`).toBe(inScope(scope, prior) && !isRunTerminal(prior))
      expect(statusOf(store, runId)).toBe(inScope(scope, prior) ? terminal : prior)
    }
  }
})

it('claims only queued or starting Runs and writes starting from both', () => {
  const { database, store } = fixture()
  for (const prior of runStatuses) {
    const runId = accept(store)
    forceStatus(database, runId, prior)
    const claimed = store.runs.claim()
    expect(claimed?.runId, `claim from ${prior}`).toBe(isRunClaimable(prior) ? runId : undefined)
    if (isRunClaimable(prior)) expect(statusOf(store, runId)).toBe('starting')
    store.runs.commit(runId, 'canceled', {})
  }
})

it('starts only a claimed Run without a stored checkpoint', () => {
  const { database, store } = fixture()
  for (const prior of runStatuses) {
    const runId = accept(store)
    forceStatus(database, runId, prior)
    const started = store.runs.start(runId, { kind: 'run.started', payload: { flowId: 'flow', scopeId: runId } })
    expect(started, `start from ${prior}`).toBe(prior == 'starting')
    expect(statusOf(store, runId)).toBe(prior == 'starting' ? 'running' : prior)
    store.runs.commit(runId, 'canceled', {})
  }
})

it('fails startup and resume only from the start barrier', () => {
  const { database, store } = fixture()
  const operations = [
    { apply: (runId: string) => store.runs.failStarting(runId, {}), kind: 'fail-start' as const, terminal: 'failed' as const },
    { apply: (runId: string) => store.runs.failResume(runId, {}), kind: 'fail-resume' as const, terminal: 'indeterminate' as const },
  ]
  for (const operation of operations) {
    const scope = runTransitionScopes[operation.kind]
    for (const prior of runStatuses) {
      const runId = accept(store)
      forceStatus(database, runId, prior)
      expect(operation.apply(runId), `${operation.kind} from ${prior}`).toBe(inScope(scope, prior))
      expect(statusOf(store, runId)).toBe(inScope(scope, prior) ? operation.terminal : prior)
      store.runs.commit(runId, 'canceled', {})
    }
  }
})
