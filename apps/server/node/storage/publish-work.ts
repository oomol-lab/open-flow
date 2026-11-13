import type { DatabaseSync } from 'node:sqlite'

import { randomUUID } from 'node:crypto'

/**
 * Publish preparation state authority.
 *
 * A Publish operation stays `pending` until exactly one terminal transition records `succeeded` or
 * `failed`. Each preparation step owns one `publish_work` row that moves once from `pending` to
 * `ready` or `failed`. Deadline expiry is not written into work rows: the operation scheduler derives
 * it from `deadline_at`, and the terminal transition cleans up every candidate of the operation.
 */
export type PublishWorkAction = 'integration.prepare' | 'poll.baseline'

export interface PublishWorkKey {
  readonly action: PublishWorkAction
  readonly nodeId: string
  readonly operationId: string
}

export interface PublishIssue {
  readonly code: string
  readonly message: string
  readonly nodeId?: string
}

export const publishDeadlineIssue = {
  code: 'publication.deadline-exceeded',
  message: 'The Publish operation exceeded its preparation deadline.',
} as const

/** SQL predicate for an operation whose candidates may still advance preparation. */
export function preparingOperation(operationIdColumn: string): string {
  return `EXISTS (
    SELECT 1 FROM publish_operations
    WHERE publish_operations.operation_id = ${operationIdColumn}
      AND publish_operations.status = 'pending' AND publish_operations.deadline_at > ?
  )`
}

export function insertPublishWork(database: DatabaseSync, key: PublishWorkKey, now: number): void {
  database
    .prepare(
      `INSERT INTO publish_work (
         work_id, operation_id, node_id, action, status, next_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .run(`work_${randomUUID().replaceAll('-', '')}`, key.operationId, key.nodeId, key.action, now, now, now)
}

/** Settles one pending work row. Returns false when the row was already settled. */
export function settlePublishWork(database: DatabaseSync, key: PublishWorkKey, outcome: 'ready' | PublishIssue, now: number): boolean {
  if (outcome == 'ready') {
    return (
      database
        .prepare(
          `UPDATE publish_work SET status = 'ready', next_at = NULL, updated_at = ?
           WHERE operation_id = ? AND node_id = ? AND action = ? AND status = 'pending'`,
        )
        .run(now, key.operationId, key.nodeId, key.action).changes == 1
    )
  }
  return (
    database
      .prepare(
        `UPDATE publish_work
         SET status = 'failed', next_at = NULL, issue_code = ?, issue_message = ?, updated_at = ?
         WHERE operation_id = ? AND node_id = ? AND action = ? AND status = 'pending'`,
      )
      .run(outcome.code, outcome.message.slice(0, 512), now, key.operationId, key.nodeId, key.action).changes == 1
  )
}
