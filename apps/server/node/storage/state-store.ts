import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { FlowStateSummary, FlowStateView, StateScope } from '@oomol-lab/open-flow/flow-state'
import type { DatabaseSync } from 'node:sqlite'

import { StateError, stateReadLimits } from '@oomol-lab/open-flow/flow-state'

export const stateLimits = { maxValueBytes: 64 * 1024, maxValues: 1_000, maxSpaces: 100, maxIdentities: 10_000, maxRunWrites: 1_000 }
type SpaceRow = { space: string; count: number; updated_at: number }

export class StateStore {
  readonly database: DatabaseSync
  readonly transaction: <Value>(operation: () => Value) => Value
  readonly clock: () => number
  readonly limits: typeof stateLimits
  constructor(database: DatabaseSync, transaction: <Value>(operation: () => Value) => Value, clock: () => number = Date.now, limits = stateLimits) {
    this.database = database
    this.transaction = transaction
    this.clock = clock
    this.limits = limits
  }

  reserveWrite(flowId: string, scope: StateScope, runId: string): void {
    const result = this.database
      .prepare("UPDATE runs SET state_writes = state_writes + 1 WHERE run_id = ? AND flow_id = ? AND source = ? AND status = 'running' AND state_writes < ?")
      .run(runId, flowId, scope, this.limits.maxRunWrites)
    if (result.changes === 0) {
      const run = this.database.prepare('SELECT state_writes, status FROM runs WHERE run_id = ? AND flow_id = ? AND source = ?').get(runId, flowId, scope) as
        | { state_writes: number; status: string }
        | undefined
      if (run?.status === 'running' && run.state_writes >= this.limits.maxRunWrites) throw new StateError('limit-exceeded', 'Run state write limit exceeded.')
      throw new StateError('capability.denied', 'State requires an active Run.')
    }
  }

  get(flowId: string, scope: StateScope, key: string): JsonValue {
    const row = this.database.prepare('SELECT value_json FROM flow_state_values WHERE flow_id = ? AND scope = ? AND key = ?').get(flowId, scope, key) as
      | { value_json: string }
      | undefined
    return row == null ? null : (JSON.parse(row.value_json) as JsonValue)
  }

  list(flowId: string, scope: StateScope): string[] {
    return (
      this.database.prepare('SELECT key FROM flow_state_values WHERE flow_id = ? AND scope = ? ORDER BY key').all(flowId, scope) as { key: string }[]
    ).map((row) => row.key)
  }

  readValues(flowId: string, scope: StateScope, keys: readonly string[]) {
    const rows = this.database
      .prepare('SELECT key, size, value_json FROM flow_state_values WHERE flow_id = ? AND scope = ? AND key IN (SELECT value FROM json_each(?))')
      .all(flowId, scope, JSON.stringify(keys)) as { key: string; size: number; value_json: string }[]
    if (rows.reduce((total, row) => total + row.size, 0) > stateReadLimits.maxBytes)
      throw new StateError('limit-exceeded', 'Requested State values exceed the 1 MiB read limit. Read fewer keys.')
    const values = new Map(rows.map((row) => [row.key, JSON.parse(row.value_json) as JsonValue]))
    return keys.map((key) => ({ key, value: values.get(key) ?? null }))
  }

  set(flowId: string, scope: StateScope, runId: string, key: string, value: JsonValue, insert = false): boolean {
    return this.transaction(() => {
      const previous = this.database.prepare('SELECT size FROM flow_state_values WHERE flow_id = ? AND scope = ? AND key = ?').get(flowId, scope, key) as
        | { size: number }
        | undefined
      if (insert && previous != null) return false
      const json = JSON.stringify(value)
      const bytes = Buffer.byteLength(json)
      if (value !== null && bytes > this.limits.maxValueBytes) throw new StateError('limit-exceeded', 'State value exceeds its size limit.')
      if (value !== null && previous == null) {
        const { count } = this.database.prepare('SELECT COUNT(*) AS count FROM flow_state_values WHERE flow_id = ? AND scope = ?').get(flowId, scope) as {
          count: number
        }
        if (count >= this.limits.maxValues) throw new StateError('limit-exceeded', 'Flow state entry limit exceeded.')
      }
      if (value === null) this.database.prepare('DELETE FROM flow_state_values WHERE flow_id = ? AND scope = ? AND key = ?').run(flowId, scope, key)
      else
        this.database
          .prepare(
            'INSERT INTO flow_state_values VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (flow_id, scope, key) DO UPDATE SET value_json = excluded.value_json, size = excluded.size, updated_at = excluded.updated_at, updated_run_id = excluded.updated_run_id',
          )
          .run(flowId, scope, key, json, bytes, this.clock(), runId)
      return true
    })
  }

  has(flowId: string, scope: StateScope, space: string, hashes: readonly Uint8Array[]): boolean[] {
    const query = this.database.prepare('SELECT 1 FROM flow_dedupe_identities WHERE flow_id = ? AND scope = ? AND space = ? AND identity = ?')
    return hashes.map((hash) => query.get(flowId, scope, space, hash) != null)
  }

  /** Code's explicit set operations persist immediately. */
  insert(flowId: string, scope: StateScope, space: string, hashes: readonly Uint8Array[]): boolean[] {
    return this.transaction(() => {
      const present = this.has(flowId, scope, space, hashes)
      const seen = new Set<string>()
      const inserted = hashes.map((hash, index) => {
        const key = Buffer.from(hash).toString('hex')
        const fresh = !present[index] && !seen.has(key)
        seen.add(key)
        return fresh
      })
      this.#reserve(flowId, scope, space, hashes)
      if (hashes.length === 0) return inserted
      const now = this.clock()
      const write = this.database.prepare('INSERT OR IGNORE INTO flow_dedupe_identities VALUES (?, ?, ?, ?, ?)')
      hashes.forEach((hash, index) => {
        if (inserted[index]) write.run(flowId, scope, space, hash, now)
      })
      this.#updateSpace(flowId, scope, space, now)
      return inserted
    })
  }

  /** Only committed history and this Run's provisional history suppress items. */
  stage(flowId: string, scope: StateScope, runId: string, jobId: string, nodeId: string, hashes: readonly Uint8Array[]): boolean[] {
    return this.transaction(() => {
      const active = this.database
        .prepare("SELECT 1 FROM runs WHERE run_id = ? AND flow_id = ? AND source = ? AND status = 'running'")
        .get(runId, flowId, scope)
      if (active == null) throw new StateError('capability.denied', 'Skip Duplicates requires an active Run.')
      const space = `node:${nodeId}`
      const present = this.has(flowId, scope, space, hashes)
      const provisional = this.database.prepare('SELECT 1 FROM flow_dedupe_pending WHERE run_id = ? AND space = ? AND identity = ?')
      const seen = new Set<string>()
      const inserted = hashes.map((hash, index) => {
        const key = Buffer.from(hash).toString('hex')
        const fresh = !present[index] && !seen.has(key) && provisional.get(runId, space, hash) == null
        seen.add(key)
        return fresh
      })
      this.#reserve(
        flowId,
        scope,
        space,
        hashes.filter((_, index) => inserted[index]),
      )
      const write = this.database.prepare('INSERT INTO flow_dedupe_pending VALUES (?, ?, ?, ?, ?, ?, ?)')
      hashes.forEach((hash, index) => {
        if (inserted[index]) write.run(runId, jobId, flowId, scope, space, hash, this.clock())
      })
      return inserted
    })
  }

  discardInvocation(runId: string, jobId: string): void {
    this.database.prepare('DELETE FROM flow_dedupe_pending WHERE run_id = ? AND job_id = ?').run(runId, jobId)
  }

  /** Called inside the authoritative Run terminal transaction; never opens a nested transaction. */
  finishRun(runId: string, completed: boolean): void {
    if (completed) {
      const spaces = this.database.prepare('SELECT DISTINCT flow_id, scope, space FROM flow_dedupe_pending WHERE run_id = ?').all(runId) as {
        flow_id: string
        scope: StateScope
        space: string
      }[]
      this.database
        .prepare(`INSERT OR IGNORE INTO flow_dedupe_identities (flow_id, scope, space, identity, recorded_at)
        SELECT flow_id, scope, space, identity, MIN(recorded_at) FROM flow_dedupe_pending WHERE run_id = ? GROUP BY flow_id, scope, space, identity`)
        .run(runId)
      for (const row of spaces) this.#updateSpace(row.flow_id, row.scope, row.space, this.clock())
    }
    this.database.prepare('DELETE FROM flow_dedupe_pending WHERE run_id = ?').run(runId)
  }

  /** Reserved identities are counted once across overlapping Runs and committed history. */
  dedupeCount(flowId: string, scope: StateScope): number {
    return (
      this.database
        .prepare(`SELECT COUNT(*) AS count FROM (
      SELECT space, identity FROM flow_dedupe_identities WHERE flow_id = ? AND scope = ?
      UNION SELECT space, identity FROM flow_dedupe_pending WHERE flow_id = ? AND scope = ?
    )`)
        .get(flowId, scope, flowId, scope) as { count: number }
    ).count
  }

  #reserve(flowId: string, scope: StateScope, space: string, hashes: readonly Uint8Array[]): void {
    if (hashes.length === 0) return
    if (Buffer.byteLength(space) > 256) throw new StateError('capability.invalid', 'Deduplication space names must not exceed 256 UTF-8 bytes.')
    const spaces = this.database
      .prepare(`SELECT space FROM flow_dedupe_spaces WHERE flow_id = ? AND scope = ?
      UNION SELECT space FROM flow_dedupe_pending WHERE flow_id = ? AND scope = ?`)
      .all(flowId, scope, flowId, scope) as { space: string }[]
    if (!spaces.some((item) => item.space === space) && spaces.length >= this.limits.maxSpaces)
      throw new StateError('dedupe.full', 'Flow deduplication space limit reached. Clear unused history.')
    const reserved = this.database.prepare(`SELECT 1 FROM flow_dedupe_identities WHERE flow_id = ? AND scope = ? AND space = ? AND identity = ?
      UNION ALL SELECT 1 FROM flow_dedupe_pending WHERE flow_id = ? AND scope = ? AND space = ? AND identity = ? LIMIT 1`)
    const additional = new Set(
      hashes.filter((hash) => reserved.get(flowId, scope, space, hash, flowId, scope, space, hash) == null).map((hash) => Buffer.from(hash).toString('hex')),
    ).size
    if (additional > 0 && this.dedupeCount(flowId, scope) + additional > this.limits.maxIdentities)
      throw new StateError('dedupe.full', 'Flow deduplication history is full. Clear unused history.')
  }

  #updateSpace(flowId: string, scope: StateScope, space: string, now: number): void {
    this.database
      .prepare(`INSERT INTO flow_dedupe_spaces (flow_id, scope, space, count, updated_at)
      VALUES (?, ?, ?, (SELECT COUNT(*) FROM flow_dedupe_identities WHERE flow_id = ? AND scope = ? AND space = ?), ?)
      ON CONFLICT (flow_id, scope, space) DO UPDATE SET count = excluded.count, updated_at = excluded.updated_at`)
      .run(flowId, scope, space, flowId, scope, space, now)
  }

  clearValues(flowId: string, scope: StateScope, key?: string): void {
    this.transaction(() => {
      const where = key == null ? 'flow_id = ? AND scope = ?' : 'flow_id = ? AND scope = ? AND key = ?'
      const args = key == null ? [flowId, scope] : [flowId, scope, key]
      this.database.prepare(`DELETE FROM flow_state_values WHERE ${where}`).run(...args)
    })
  }

  clearSpace(flowId: string, scope: StateScope, space: string): boolean {
    return this.transaction(() => {
      if (this.database.prepare('SELECT 1 FROM flow_dedupe_pending WHERE flow_id = ? AND scope = ? AND space = ? LIMIT 1').get(flowId, scope, space) != null)
        return false
      this.database.prepare('DELETE FROM flow_dedupe_identities WHERE flow_id = ? AND scope = ? AND space = ?').run(flowId, scope, space)
      this.database.prepare('DELETE FROM flow_dedupe_spaces WHERE flow_id = ? AND scope = ? AND space = ?').run(flowId, scope, space)
      return true
    })
  }

  clearAvailableSpaces(flowId: string, scope: StateScope): boolean {
    return this.transaction(() => {
      const available = `flow_id = ? AND scope = ? AND NOT EXISTS (
        SELECT 1 FROM flow_dedupe_pending p WHERE p.flow_id = flow_dedupe_spaces.flow_id
          AND p.scope = flow_dedupe_spaces.scope AND p.space = flow_dedupe_spaces.space
      )`
      const hasAvailable = this.database.prepare(`SELECT 1 FROM flow_dedupe_spaces WHERE ${available} LIMIT 1`).get(flowId, scope) != null
      const hasPending = this.database.prepare('SELECT 1 FROM flow_dedupe_pending WHERE flow_id = ? AND scope = ? LIMIT 1').get(flowId, scope) != null
      if (!hasAvailable && hasPending) return false
      this.database
        .prepare(`DELETE FROM flow_dedupe_identities WHERE flow_id = ? AND scope = ? AND space IN (
        SELECT space FROM flow_dedupe_spaces WHERE ${available}
      )`)
        .run(flowId, scope, flowId, scope)
      this.database.prepare(`DELETE FROM flow_dedupe_spaces WHERE ${available}`).run(flowId, scope)
      return true
    })
  }

  view(flowId: string, scope: StateScope): FlowStateView {
    const values = this.database
      .prepare('SELECT key, size, updated_at FROM flow_state_values WHERE flow_id = ? AND scope = ? ORDER BY key')
      .all(flowId, scope) as { key: string; size: number; updated_at: number }[]
    return {
      version: 1,
      scope,
      limits: this.limits,
      values: values.map((row) => ({ key: row.key, size: row.size, updatedAt: row.updated_at })),
      spaces: this.#spaces(flowId, scope),
    }
  }

  summary(flowId: string, scope: StateScope): FlowStateSummary {
    const values = this.database
      .prepare('SELECT COUNT(*) AS count, MAX(updated_at) AS updatedAt FROM flow_state_values WHERE flow_id = ? AND scope = ?')
      .get(flowId, scope) as FlowStateSummary['values']
    return { version: 1, scope, limits: this.limits, values, spaces: this.#spaces(flowId, scope) }
  }

  #spaces(flowId: string, scope: StateScope): FlowStateView['spaces'] {
    const spaces = this.database
      .prepare(`SELECT space, MAX(count) AS count, MAX(updated_at) AS updated_at FROM (
      SELECT space, count, updated_at FROM flow_dedupe_spaces WHERE flow_id = ? AND scope = ?
      UNION ALL SELECT space, 0 AS count, recorded_at AS updated_at FROM flow_dedupe_pending WHERE flow_id = ? AND scope = ?
    ) GROUP BY space ORDER BY space`)
      .all(flowId, scope, flowId, scope) as SpaceRow[]
    return spaces.map((row) => {
      const pending = this.database
        .prepare(`SELECT COUNT(DISTINCT identity) AS count, COUNT(DISTINCT CASE WHEN NOT EXISTS (
            SELECT 1 FROM flow_dedupe_identities i WHERE i.flow_id = p.flow_id AND i.scope = p.scope AND i.space = p.space AND i.identity = p.identity
          ) THEN identity END) AS additional FROM flow_dedupe_pending p WHERE flow_id = ? AND scope = ? AND space = ?`)
        .get(flowId, scope, row.space) as { count: number; additional: number }
      return {
        space: row.space,
        count: row.count,
        pendingCount: pending.count,
        reservedCount: row.count + pending.additional,
        updatedAt: row.updated_at,
      }
    })
  }
}
