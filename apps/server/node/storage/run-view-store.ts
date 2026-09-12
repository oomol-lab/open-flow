import type { RunEventKind } from '@oomol-lab/open-flow/control-api'
import type { JsonValue, WaitAction } from '@oomol-lab/open-flow/flow-change'
import type { RunStatus } from '@oomol-lab/open-flow/run-lifecycle'
import type { DatabaseSync } from 'node:sqlite'

export interface RunEvent {
  readonly cursor: number
  readonly kind: RunEventKind
  readonly payload: Readonly<Record<string, unknown>>
  readonly value?: unknown
}

export interface RunRecord {
  readonly eventsTruncated: boolean
  readonly result?: unknown
  readonly runId: string
  readonly status: RunStatus
}

export interface StoredRunRequest {
  readonly requestDigest: string
  readonly runId: string
  readonly source: 'draft' | 'live' | 'trigger' | null
  readonly status: RunStatus
}

export interface StoredControlRun {
  readonly closureDigest: string
  readonly createdAt: number
  readonly engineContract: string
  readonly engineDigest: string
  readonly eventsExpiresAt: number | null
  readonly eventsTruncated: boolean
  readonly finishedAt: number | null
  readonly flowId: string
  readonly modelVersion: number
  readonly occurrenceId: string | null
  readonly publicationId: string | null
  readonly result?: unknown
  readonly revisionDigest: string
  readonly revisionId: string
  readonly runId: string
  readonly source: 'draft' | 'live' | 'trigger'
  readonly startedAt: number | null
  readonly status: RunStatus
  readonly triggerNodeId: string | null
}

export interface StoredControlEvent {
  readonly createdAt: number
  readonly kind: RunEventKind
  readonly payload: Readonly<Record<string, JsonValue>>
  readonly sequence: number
  readonly value?: JsonValue
}

/** Read projections over Runs, theirs events, and their Waits. */
export class RunViewStore {
  readonly #database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.#database = database
  }

  run(runId: string): RunRecord | undefined {
    const row = this.#database.prepare('SELECT events_truncated AS eventsTruncated, result, run_id AS runId, status FROM runs WHERE run_id = ?').get(runId) as
      | { readonly eventsTruncated: number; readonly result: string | null; readonly runId: string; readonly status: RunStatus }
      | undefined
    if (row == null) return
    return {
      eventsTruncated: row.eventsTruncated == 1,
      ...(row.result == null ? {} : { result: JSON.parse(row.result) as unknown }),
      runId: row.runId,
      status: row.status,
    }
  }

  request(idempotencyKey: string): StoredRunRequest | undefined {
    return this.#database
      .prepare(
        `SELECT request_digest AS requestDigest, run_id AS runId, source, status
         FROM runs WHERE idempotency_key = ?`,
      )
      .get(idempotencyKey) as StoredRunRequest | undefined
  }

  controlRun(runId: string): StoredControlRun | undefined {
    return this.#controlRuns('runs.run_id = ?', [runId], 'LIMIT 1')[0]
  }

  listControlRuns(
    flowId: string,
    limit: number,
    options: {
      readonly after?: { readonly createdAt: number; readonly runId: string }
      readonly status?: RunStatus
    } = {},
  ): readonly StoredControlRun[] {
    const conditions = ['runs.flow_id = ?']
    const parameters: (number | string)[] = [flowId]
    if (options.after != null) {
      conditions.push('(runs.created_at < ? OR (runs.created_at = ? AND runs.run_id < ?))')
      parameters.push(options.after.createdAt, options.after.createdAt, options.after.runId)
    }
    if (options.status != null) {
      conditions.push('runs.status = ?')
      parameters.push(options.status)
    }
    parameters.push(limit)
    return this.#controlRuns(conditions.join(' AND '), parameters, 'ORDER BY runs.created_at DESC, runs.run_id DESC LIMIT ?')
  }

  controlEvents(runId: string, after: number, limit: number): readonly StoredControlEvent[] {
    return (
      this.#database
        .prepare(
          `SELECT events.created_at AS createdAt, events.kind, events.payload, events.cursor AS sequence, events.value
           FROM events WHERE events.run_id = ? AND events.cursor > ?
           ORDER BY events.cursor LIMIT ?`,
        )
        .all(runId, after, limit) as {
        readonly createdAt: number
        readonly kind: RunEventKind
        readonly payload: string
        readonly sequence: number
        readonly value: string | null
      }[]
    ).map((row) => {
      const event = {
        createdAt: row.createdAt,
        kind: row.kind,
        payload: JSON.parse(row.payload) as Readonly<Record<string, JsonValue>>,
        sequence: row.sequence,
      }
      if (row.value == null) return event
      return Object.assign(event, { value: JSON.parse(row.value) as JsonValue })
    })
  }

  events(runId: string): readonly RunEvent[] {
    return (
      this.#database.prepare('SELECT cursor, kind, payload, value FROM events WHERE run_id = ? ORDER BY cursor').all(runId) as {
        readonly cursor: number
        readonly kind: RunEventKind
        readonly payload: string
        readonly value: string | null
      }[]
    ).map((row) => {
      const payload = JSON.parse(row.payload) as Readonly<Record<string, unknown>>
      if (row.value == null) return { cursor: row.cursor, kind: row.kind, payload }
      return { cursor: row.cursor, kind: row.kind, payload, value: JSON.parse(row.value) as unknown }
    })
  }

  eventsExpired(runId: string, now: number): boolean {
    const row = this.#database.prepare('SELECT events_expires_at AS eventsExpiresAt FROM runs WHERE run_id = ?').get(runId) as
      | { readonly eventsExpiresAt: number | null }
      | undefined
    return row?.eventsExpiresAt != null && row.eventsExpiresAt <= now
  }

  activeWait(runId: string) {
    const active = this.#database
      .prepare(`SELECT wait_id AS waitId FROM run_waits JOIN runs USING (run_id)
      WHERE run_id = ? AND runs.status = 'waiting'`)
      .get(runId) as { readonly waitId: string } | undefined
    return active == null ? undefined : this.waitReceipt(runId, active.waitId)
  }

  waitReceipt(runId: string, waitId: string) {
    const row = this.#database
      .prepare(`SELECT node_id AS nodeId, wait_id AS waitId,
      waiting_since AS waitingSince, expires_at AS expiresAt, actions, prompt, value
      FROM wait_receipts WHERE run_id = ? AND wait_id = ?`)
      .get(runId, waitId) as
      | {
          readonly nodeId: string
          readonly waitId: string
          readonly waitingSince: number
          readonly expiresAt: number
          readonly actions: string
          readonly prompt: string
          readonly value: string
        }
      | undefined
    return row == null
      ? undefined
      : { ...row, actions: JSON.parse(row.actions) as readonly ['continue'] | readonly ['approve', 'reject'], value: JSON.parse(row.value) as JsonValue }
  }

  waitByCapability(digest: string):
    | {
        readonly action: WaitAction | null
        readonly expiresAt: number
        readonly flowId: string
        readonly nodeId: string
        readonly resolvedAt: number | null
        readonly revisionId: string
        readonly runId: string
        readonly status: RunStatus
        readonly waitId: string
      }
    | undefined {
    return this.#database
      .prepare(
        `SELECT wait_receipts.action, wait_receipts.expires_at AS expiresAt, runs.flow_id AS flowId,
                wait_receipts.node_id AS nodeId, wait_receipts.resolved_at AS resolvedAt,
                runs.revision_id AS revisionId, runs.run_id AS runId, runs.status,
                wait_receipts.wait_id AS waitId
         FROM wait_receipts JOIN runs USING (run_id)
         WHERE wait_receipts.capability_digest = ?`,
      )
      .get(digest) as
      | {
          readonly action: WaitAction | null
          readonly expiresAt: number
          readonly flowId: string
          readonly nodeId: string
          readonly resolvedAt: number | null
          readonly revisionId: string
          readonly runId: string
          readonly status: RunStatus
          readonly waitId: string
        }
      | undefined
  }

  nextWaitExpiry(): number | undefined {
    return (
      (
        this.#database
          .prepare(
            `SELECT MIN(run_waits.expires_at) AS expiresAt
           FROM run_waits JOIN runs USING (run_id)
           WHERE runs.status = 'waiting'`,
          )
          .get() as { readonly expiresAt: number | null }
      ).expiresAt ?? undefined
    )
  }

  nextWaitNotificationAt(): number | undefined {
    return (
      (
        this.#database
          .prepare(
            `SELECT MIN(COALESCE(wait_notifications.claim_expires_at, wait_notifications.retry_at)) AS dueAt
           FROM wait_notifications JOIN runs USING (run_id) JOIN run_waits USING (run_id)
           WHERE wait_notifications.status = 'pending'
             AND runs.status = 'waiting'
             AND run_waits.wait_id = wait_notifications.wait_id`,
          )
          .get() as { readonly dueAt: number | null }
      ).dueAt ?? undefined
    )
  }

  #controlRuns(condition: string, parameters: readonly (number | string)[], suffix: string): readonly StoredControlRun[] {
    const rows = this.#database
      .prepare(
        `SELECT runs.closure_digest AS closureDigest,
                runs.created_at AS createdAt, runs.engine_contract AS engineContract,
                runs.engine_digest AS engineDigest, runs.events_expires_at AS eventsExpiresAt,
                runs.events_truncated AS eventsTruncated,
                runs.finished_at AS finishedAt, runs.flow_id AS flowId,
                runs.model_version AS modelVersion, trigger_occurrences.occurrence_id AS occurrenceId, runs.result,
                runs.publication_id AS publicationId,
                runs.revision_digest AS revisionDigest, runs.revision_id AS revisionId,
                runs.run_id AS runId, runs.source, runs.started_at AS startedAt, runs.status,
                runs.trigger_node_id AS triggerNodeId
         FROM runs LEFT JOIN trigger_occurrences USING (run_id)
         WHERE ${condition}
         ${suffix}`,
      )
      .all(...parameters) as unknown as readonly (Omit<StoredControlRun, 'eventsTruncated' | 'result'> & {
      readonly eventsTruncated: number
      readonly result: string | null
    })[]
    const runs: StoredControlRun[] = []
    for (const { eventsTruncated, result, ...row } of rows) {
      runs.push({ ...row, eventsTruncated: eventsTruncated == 1, ...(result == null ? {} : { result: JSON.parse(result) as unknown }) })
    }
    return runs
  }
}
