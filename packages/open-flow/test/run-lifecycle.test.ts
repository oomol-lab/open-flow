import type { RunOperation, RunStatus, RunTerminalStatus } from '../src/execution/common/runLifecycle.ts'

import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  isRunActive,
  isRunTerminal,
  runStatuses,
  runStatusSets,
  runTransitionScope,
  runTransitionScopes,
  transitionRun,
} from '../src/execution/common/runLifecycle.ts'

const terminalStatuses = runStatusSets.terminal

function commits(status: RunStatus, operation: RunOperation): boolean {
  const transition = transitionRun(status, operation)
  return transition.kind == 'ready' || transition.kind == 'started' || transition.kind == 'waited' || transition.kind == 'committed'
}

function inScope(scope: readonly RunStatus[], status: RunStatus): boolean {
  return scope.some((candidate) => candidate == status)
}

test('models the Run start barrier and terminal commit rules', () => {
  assert.deepEqual(transitionRun('queued', { kind: 'claim' }), { kind: 'ready', status: 'starting' })
  assert.deepEqual(transitionRun('starting', { kind: 'claim' }), { kind: 'ready', status: 'starting' })
  assert.deepEqual(transitionRun('running', { kind: 'claim' }), { kind: 'running', status: 'running' })
  assert.deepEqual(transitionRun('running', { kind: 'wait' }), { kind: 'waited', status: 'waiting' })
  assert.deepEqual(transitionRun('waiting', { kind: 'claim' }), { kind: 'waiting', status: 'waiting' })
  assert.deepEqual(transitionRun('waiting', { kind: 'resolve' }), { kind: 'resolved', status: 'queued' })
  assert.deepEqual(transitionRun('starting', { kind: 'commit', status: 'completed' }), { kind: 'stale', status: 'starting' })
  assert.deepEqual(transitionRun('starting', { kind: 'commit', status: 'canceled' }), { kind: 'committed', status: 'canceled' })
  assert.deepEqual(transitionRun('running', { kind: 'commit', status: 'indeterminate' }), { kind: 'committed', status: 'indeterminate' })
  assert.deepEqual(transitionRun('waiting', { kind: 'commit', status: 'failed' }), { kind: 'committed', status: 'failed' })
  assert.deepEqual(transitionRun('waiting', { kind: 'commit', status: 'completed' }), { kind: 'stale', status: 'waiting' })
})

test('limits startup and recovery failures to the start barrier', () => {
  for (const kind of ['fail-start', 'fail-resume'] as const) {
    assert.deepEqual(transitionRun('starting', { kind }), { kind: 'committed', status: kind == 'fail-start' ? 'failed' : 'indeterminate' })
    for (const status of ['queued', 'running', 'waiting', 'canceled', 'completed', 'failed', 'indeterminate'] as const) {
      assert.deepEqual(transitionRun(status, { kind }), { kind: 'stale', status })
    }
  }
})

test('partitions every status into exactly one of active or terminal', () => {
  for (const status of runStatuses) {
    assert.equal(isRunActive(status), !isRunTerminal(status), status)
  }
  assert.deepEqual(runStatuses.filter((status) => isRunActive(status)).toSorted(), [...runStatusSets.active].toSorted())
  assert.deepEqual(runStatuses.filter((status) => isRunTerminal(status)).toSorted(), [...terminalStatuses].toSorted())
})

test('writes only from the declared transition scope for every operation', () => {
  const operations: readonly RunOperation[] = [
    { kind: 'claim' },
    { kind: 'start' },
    { kind: 'wait' },
    { kind: 'fail-start' },
    { kind: 'fail-resume' },
    ...terminalStatuses.map((status): RunOperation => ({ kind: 'commit', status })),
  ]
  for (const operation of operations) {
    const scope = runTransitionScope(operation)
    for (const status of runStatuses) {
      const expected = operation.kind == 'commit' && isRunTerminal(status) ? false : inScope(scope, status)
      assert.equal(commits(status, operation), expected, `${operation.kind} from ${status}`)
    }
  }
})

test('declares the active scope once and reuses it for terminal operations', () => {
  assert.deepEqual([...runTransitionScopes.cancel], [...runStatusSets.active])
  assert.deepEqual([...runTransitionScopes.fail], [...runStatusSets.active])
  assert.deepEqual([...runTransitionScopes.complete], ['running'])
  assert.deepEqual([...runTransitionScopes.indeterminate], ['running'])
  assert.deepEqual([...runTransitionScopes.claim], ['queued', 'starting'])
})

test('rejects resolve only for terminal Runs', () => {
  for (const status of runStatuses) {
    const transition = transitionRun(status, { kind: 'resolve' })
    assert.equal(transition.kind == 'stale', isRunTerminal(status), status)
  }
  for (const status of ['queued', 'starting', 'running'] as const) {
    assert.deepEqual(transitionRun(status, { kind: 'resolve' }), { kind: 'resolved', status })
  }
  assert.deepEqual(transitionRun('waiting', { kind: 'resolve' }), { kind: 'resolved', status: 'queued' })
})

test('exposes commit scopes per terminal status', () => {
  const expected: Record<RunTerminalStatus, readonly RunStatus[]> = {
    canceled: runStatusSets.active,
    completed: ['running'],
    failed: runStatusSets.active,
    indeterminate: ['running'],
  }
  for (const status of terminalStatuses) {
    assert.deepEqual([...runTransitionScope({ kind: 'commit', status })], [...expected[status]])
  }
})
