import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { DedupeIdentity, FlowStateView, StateScope } from '@oomol-lab/open-flow/flow-state'
import type { DatabaseSync } from 'node:sqlite'

import { increasingIdentities, StateError } from '@oomol-lab/open-flow/flow-state'

export const stateLimits = { maxValueBytes: 64 * 1024, maxValues: 1_000, maxSpaces: 100, maxIdentities: 10_000, maxRunWrites: 1_000 }
type SpaceRow = { mode: 'new' | 'increasing'; count: number; watermark_json: string | null; updated_at: number }

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
      if (Buffer.byteLength(space) > 256) throw new StateError('capability.invalid', 'Deduplication space names must not exceed 256 UTF-8 bytes.')
      if (old == null) {
        const { count } = this.database.prepare('SELECT COUNT(*) AS count FROM flow_dedupe_spaces WHERE flow_id = ? AND scope = ?').get(flowId, scope) as {
          count: number
        }
        if (count >= this.limits.maxSpaces) throw new StateError('dedupe.full', 'Flow deduplication space limit reached. Clear unused history.')
      }
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
        if (this.dedupeCount(flowId, scope) - (old?.count ?? 0) + count > this.limits.maxIdentities)
          throw new StateError('dedupe.full', 'Flow deduplication history is full. Clear history or use increasing mode.')
      }
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

  dedupeCount(flowId: string, scope: StateScope): number {
    return (
      this.database.prepare('SELECT COALESCE(SUM(count), 0) AS count FROM flow_dedupe_spaces WHERE flow_id = ? AND scope = ?').get(flowId, scope) as {
        count: number
      }
    ).count
  }

  clearValues(flowId: string, scope: StateScope, key?: string): void {
    this.transaction(() => {
      const where = key == null ? 'flow_id = ? AND scope = ?' : 'flow_id = ? AND scope = ? AND key = ?'
      const args = key == null ? [flowId, scope] : [flowId, scope, key]
      this.database.prepare(`DELETE FROM flow_state_values WHERE ${where}`).run(...args)
    })
  }

  clearSpace(flowId: string, scope: StateScope, space: string): void {
    this.transaction(() => {
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
}
