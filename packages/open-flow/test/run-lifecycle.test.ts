import assert from 'node:assert/strict'
import { test } from 'vitest'
import { transitionRun } from '../src/execution/common/runLifecycle.ts'

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
