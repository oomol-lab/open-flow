import type {
  RunAcceptance,
  RunClaim,
  RunLifecycleHarness,
  RunObservation,
  RunStart,
  RunStatus,
  RunTerminalStatus,
} from '../src/execution/common/runLifecycle.ts'

import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'vitest'
import { runLifecycleConformanceCases, transitionRun } from '../src/execution/common/runLifecycle.ts'

class SqliteRunLifecycle implements RunLifecycleHarness {
  readonly #database = new DatabaseSync(':memory:')
  #sequence = 0

  constructor() {
    this.#database.exec(`
      CREATE TABLE runs (
        run_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_digest TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'starting', 'running', 'waiting', 'completed', 'failed', 'canceled', 'indeterminate')),
        terminal_status TEXT CHECK (terminal_status IN ('completed', 'failed', 'canceled', 'indeterminate'))
      ) STRICT;
      CREATE TABLE run_terminal_events (
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'canceled', 'indeterminate')),
        PRIMARY KEY (run_id, sequence)
      ) STRICT;
    `)
  }

  async accept(input: { readonly idempotencyKey: string; readonly requestDigest: string }): Promise<RunAcceptance> {
    this.#sequence += 1
    const runId = `run-${this.#sequence}`
    const inserted = this.#database
      .prepare('INSERT OR IGNORE INTO runs (run_id, idempotency_key, request_digest, status) VALUES (?, ?, ?, ?)')
      .run(runId, input.idempotencyKey, input.requestDigest, 'queued')
    const row = this.#database
      .prepare('SELECT run_id AS runId, request_digest AS requestDigest, status FROM runs WHERE idempotency_key = ?')
      .get(input.idempotencyKey) as { readonly requestDigest: string; readonly runId: string; readonly status: RunStatus }
    if (row.requestDigest != input.requestDigest) return { kind: 'conflict' }
    return { created: inserted.changes == 1, kind: 'accepted', runId: row.runId, status: row.status }
  }

  async claim(runId: string): Promise<RunClaim> {
    this.#database.prepare("UPDATE runs SET status = 'starting' WHERE run_id = ? AND status = 'queued'").run(runId)
    const status = this.#status(runId)
    switch (status) {
      case 'starting':
        return { kind: 'ready', status }
      case 'running':
        return { kind: 'running', status }
      case 'waiting':
        return { kind: 'waiting', status }
      case 'canceled':
      case 'completed':
      case 'failed':
      case 'indeterminate':
        return { kind: 'terminal', status }
      case 'queued':
        throw new Error('SQLite Run claim did not advance the queued state.')
    }
  }

  async commit(runId: string, status: RunTerminalStatus): Promise<boolean> {
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      const statement =
        status == 'canceled'
          ? "UPDATE runs SET status = ?, terminal_status = ? WHERE run_id = ? AND status IN ('queued', 'starting', 'running', 'waiting') AND terminal_status IS NULL"
          : status == 'failed'
            ? "UPDATE runs SET status = ?, terminal_status = ? WHERE run_id = ? AND status IN ('running', 'waiting') AND terminal_status IS NULL"
            : "UPDATE runs SET status = ?, terminal_status = ? WHERE run_id = ? AND status = 'running' AND terminal_status IS NULL"
      const result = this.#database.prepare(statement).run(status, status, runId)
      if (result.changes == 1) {
        this.#database.prepare('INSERT INTO run_terminal_events (run_id, sequence, status) VALUES (?, 1, ?)').run(runId, status)
      }
      this.#database.exec('COMMIT')
      return result.changes == 1
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    this.#database.close()
  }

  async observe(runId: string): Promise<RunObservation> {
    return {
      status: this.#status(runId),
      terminalEvents: this.#database
        .prepare('SELECT status FROM run_terminal_events WHERE run_id = ? ORDER BY sequence')
        .all(runId)
        .map((row) => row.status as RunTerminalStatus),
    }
  }

  async start(runId: string): Promise<RunStart> {
    const result = this.#database.prepare("UPDATE runs SET status = 'running' WHERE run_id = ? AND status = 'starting'").run(runId)
    if (result.changes == 1) return { kind: 'started', status: 'running' }
    const status = this.#status(runId)
    return status == 'running' ? { kind: 'already-started', status } : { kind: 'stale', status }
  }

  async wait(runId: string): Promise<boolean> {
    return this.#database.prepare("UPDATE runs SET status = 'waiting' WHERE run_id = ? AND status = 'running'").run(runId).changes == 1
  }

  async resolve(runId: string): Promise<boolean> {
    return this.#database.prepare("UPDATE runs SET status = 'queued' WHERE run_id = ? AND status = 'waiting'").run(runId).changes == 1
  }

  #status(runId: string): RunStatus {
    return (this.#database.prepare('SELECT status FROM runs WHERE run_id = ?').get(runId) as { readonly status: RunStatus }).status
  }
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

for (const conformance of runLifecycleConformanceCases) {
  test(`conforms with SQLite: ${conformance.name}`, async () => {
    const harness = new SqliteRunLifecycle()
    try {
      await conformance.verify(harness)
    } finally {
      harness.close()
    }
  })
}
