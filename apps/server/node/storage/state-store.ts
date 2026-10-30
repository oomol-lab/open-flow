import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { DedupeIdentity, FlowStateView, StateScope } from '@oomol-lab/open-flow/flow-state'
import type { DatabaseSync } from 'node:sqlite'

import { increasingIdentities, StateError } from '@oomol-lab/open-flow/flow-state'

export const stateLimits = { maxValueBytes: 64 * 1024, maxBytes: 2 * 1024 * 1024, maxIdentities: 10_000, maxRunWrites: 1_000 }
type SpaceRow = { mode: 'new' | 'increasing'; count: number; watermark_json: string | null; updated_at: number }
const identityBytes = 96

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

  set(flowId: string, scope: StateScope, runId: string, key: string, value: JsonValue, insert = false): boolean {
    return this.transaction(() => {
      const previous = this.database.prepare('SELECT size FROM flow_state_values WHERE flow_id = ? AND scope = ? AND key = ?').get(flowId, scope, key) as
        | { size: number }
        | undefined
      if (insert && previous != null) return false
      const json = JSON.stringify(value)
      const bytes = Buffer.byteLength(json)
      if (value !== null && bytes > this.limits.maxValueBytes) throw new StateError('limit-exceeded', 'State value exceeds its size limit.')
      const size = value === null ? 0 : Buffer.byteLength(key) + bytes + 64
      this.#usage(flowId, scope, size - (previous?.size ?? 0))
      if (value === null) this.database.prepare('DELETE FROM flow_state_values WHERE flow_id = ? AND scope = ? AND key = ?').run(flowId, scope, key)
      else
        this.database
          .prepare(
            'INSERT INTO flow_state_values VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (flow_id, scope, key) DO UPDATE SET value_json = excluded.value_json, size = excluded.size, updated_at = excluded.updated_at, updated_run_id = excluded.updated_run_id',
          )
          .run(flowId, scope, key, json, size, this.clock(), runId)
      return true
    })
  }

  has(flowId: string, scope: StateScope, space: string, hashes: readonly Uint8Array[]): boolean[] {
    const row = this.#space(flowId, scope, space)
    if (row?.mode === 'increasing') throw new StateError('capability.invalid', 'Set membership is unavailable for a watermark space.')
    const query = this.database.prepare('SELECT 1 FROM flow_dedupe_identities WHERE flow_id = ? AND scope = ? AND space = ? AND identity = ?')
    return hashes.map((hash) => query.get(flowId, scope, space, hash) != null)
  }

  insert(
    flowId: string,
    scope: StateScope,
    space: string,
    mode: 'new' | 'increasing',
    ids: readonly DedupeIdentity[],
    hashes: readonly Uint8Array[],
  ): boolean[] {
    return this.transaction(() => {
      const old = this.#space(flowId, scope, space)
      if (ids.length === 0 && (old == null || old.mode === mode)) return []
      const previous = old?.mode === mode ? old : undefined
      const oldBytes = old == null ? 0 : old.mode === 'new' ? old.count * identityBytes : old.watermark_json == null ? 0 : identityBytes
      const now = this.clock()
      let inserted: boolean[]
      let watermark: DedupeIdentity | null = null
      let count: number
      if (mode === 'increasing') {
        const result = increasingIdentities(ids, previous?.watermark_json == null ? null : (JSON.parse(previous.watermark_json) as DedupeIdentity))
        inserted = result.inserted
        watermark = result.watermark
        count = 0
      } else {
        const query = this.database.prepare('SELECT 1 FROM flow_dedupe_identities WHERE flow_id = ? AND scope = ? AND space = ? AND identity = ?')
        const seen = new Set<string>()
        inserted = hashes.map((hash) => {
          const key = Buffer.from(hash).toString('hex')
          const fresh = !seen.has(key) && (previous == null || query.get(flowId, scope, space, hash) == null)
          seen.add(key)
          return fresh
        })
        count = (previous?.count ?? 0) + inserted.filter(Boolean).length
        if (count > this.limits.maxIdentities) throw new StateError('dedupe.full', 'Deduplication space is full. Clear history or use increasing mode.')
      }
      this.#usage(flowId, scope, (mode === 'new' ? count * identityBytes : watermark == null ? 0 : identityBytes) - oldBytes)
      if (old != null && previous == null)
        this.database.prepare('DELETE FROM flow_dedupe_identities WHERE flow_id = ? AND scope = ? AND space = ?').run(flowId, scope, space)
      if (mode === 'new') {
        const write = this.database.prepare('INSERT INTO flow_dedupe_identities VALUES (?, ?, ?, ?, ?)')
        hashes.forEach((hash, index) => {
          if (inserted[index]) write.run(flowId, scope, space, hash, now)
        })
      }
      this.database
        .prepare(
          'INSERT INTO flow_dedupe_spaces VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (flow_id, scope, space) DO UPDATE SET mode = excluded.mode, count = excluded.count, watermark_json = excluded.watermark_json, updated_at = excluded.updated_at',
        )
        .run(flowId, scope, space, mode, count, watermark == null ? null : JSON.stringify(watermark), now)
      return inserted
    })
  }

  dedupeCount(flowId: string, scope: StateScope, space: string): number {
    return this.#space(flowId, scope, space)?.count ?? 0
  }

  clearValues(flowId: string, scope: StateScope, key?: string): void {
    this.transaction(() => {
      const where = key == null ? 'flow_id = ? AND scope = ?' : 'flow_id = ? AND scope = ? AND key = ?'
      const args = key == null ? [flowId, scope] : [flowId, scope, key]
      const row = this.database.prepare(`SELECT COALESCE(SUM(size), 0) AS bytes FROM flow_state_values WHERE ${where}`).get(...args) as { bytes: number }
      this.#usage(flowId, scope, -row.bytes)
      this.database.prepare(`DELETE FROM flow_state_values WHERE ${where}`).run(...args)
    })
  }

  clearSpace(flowId: string, scope: StateScope, space: string): void {
    this.transaction(() => {
      const old = this.#space(flowId, scope, space)
      if (old == null) return
      this.#usage(flowId, scope, -(old.mode === 'new' ? old.count * identityBytes : old.watermark_json == null ? 0 : identityBytes))
      this.database.prepare('DELETE FROM flow_dedupe_identities WHERE flow_id = ? AND scope = ? AND space = ?').run(flowId, scope, space)
      this.database.prepare('DELETE FROM flow_dedupe_spaces WHERE flow_id = ? AND scope = ? AND space = ?').run(flowId, scope, space)
    })
  }

  view(flowId: string, scope: StateScope, includeValues = false): FlowStateView {
    const values = this.database
      .prepare(`SELECT key, size, updated_at${includeValues ? ', value_json' : ''} FROM flow_state_values WHERE flow_id = ? AND scope = ? ORDER BY key`)
      .all(flowId, scope) as { key: string; size: number; updated_at: number; value_json?: string }[]
    const spaces = this.database.prepare('SELECT * FROM flow_dedupe_spaces WHERE flow_id = ? AND scope = ? ORDER BY space').all(flowId, scope) as (SpaceRow & {
      space: string
    })[]
    return {
      version: 1,
      scope,
      limits: this.limits,
      bytes: this.#bytes(flowId, scope),
      values: values.map((row) =>
        Object.assign(
          { key: row.key, size: row.size, updatedAt: row.updated_at },
          row.value_json == null ? {} : { value: JSON.parse(row.value_json) as JsonValue },
        ),
      ),
      spaces: spaces.map((row) => ({
        space: row.space,
        mode: row.mode,
        count: row.count,
        updatedAt: row.updated_at,
        watermark: row.watermark_json == null ? null : (JSON.parse(row.watermark_json) as DedupeIdentity),
      })),
    }
  }

  #space(flowId: string, scope: StateScope, space: string): SpaceRow | undefined {
    return this.database.prepare('SELECT * FROM flow_dedupe_spaces WHERE flow_id = ? AND scope = ? AND space = ?').get(flowId, scope, space) as
      | SpaceRow
      | undefined
  }

  #bytes(flowId: string, scope: StateScope): number {
    return (
      (this.database.prepare('SELECT bytes FROM flow_state_usage WHERE flow_id = ? AND scope = ?').get(flowId, scope) as { bytes: number } | undefined)
        ?.bytes ?? 0
    )
  }

  #usage(flowId: string, scope: StateScope, delta: number): void {
    if (delta === 0) return
    const bytes = this.#bytes(flowId, scope) + delta
    if (bytes > this.limits.maxBytes) throw new StateError('limit-exceeded', 'Flow state exceeds its size limit.')
    this.database
      .prepare('INSERT INTO flow_state_usage VALUES (?, ?, ?) ON CONFLICT (flow_id, scope) DO UPDATE SET bytes = excluded.bytes')
      .run(flowId, scope, bytes)
  }
}
