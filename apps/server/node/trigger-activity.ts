import type { DatabaseSync } from 'node:sqlite'
import type { TriggerActivityKind } from './trigger-store.ts'

import { randomUUID } from 'node:crypto'

const retentionMs = 30 * 24 * 60 * 60 * 1_000

export function insertTriggerActivity(
  database: DatabaseSync,
  bindingId: string,
  kind: TriggerActivityKind,
  createdAt: number,
  errorCode?: string,
  errorMessage?: string,
): void {
  database
    .prepare(
      `INSERT INTO trigger_activities (
         activity_id, binding_id, kind, error_code, error_message, created_at, expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `activity_${randomUUID().replaceAll('-', '')}`,
      bindingId,
      kind,
      errorCode ?? null,
      errorMessage?.slice(0, 512) ?? null,
      createdAt,
      createdAt + retentionMs,
    )
}

export function pruneTriggerActivities(database: DatabaseSync, now: number, limit: number): void {
  database
    .prepare(
      `DELETE FROM trigger_activities
       WHERE rowid IN (
         SELECT rowid FROM trigger_activities
         WHERE expires_at <= ?
         ORDER BY expires_at, activity_id
         LIMIT ?
       )`,
    )
    .run(now, limit)
}
