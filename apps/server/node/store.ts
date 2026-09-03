import type { RunEventKind } from '@oomol-lab/open-flow/control-api'
import type { JsonValue, WaitAction } from '@oomol-lab/open-flow/flow-change'
import type { ProjectedRunEvent } from '@oomol-lab/open-flow/run-events'
import type { RunStatus, RunTerminalStatus } from '@oomol-lab/open-flow/run-lifecycle'
import type { FlowRunCheckpoint, FlowRunOptions, FlowRunOutcome, TriggerSeed } from '@oomol-lab/open-flow/scheduler'
import type { RunAdmission, TriggerOccurrenceInput } from './trigger-store.ts'

import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { decodeFlowRunCheckpoint } from '@oomol-lab/open-flow/scheduler'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { AcceptanceError } from './error.ts'
import { IntegrationStore } from './integration-store.ts'
import { isolatedVmEngineDigest } from './isolated-vm.ts'
import { PollStore } from './poll-store.ts'
import { PublicationStore } from './publication-store.ts'
import { TriggerStore } from './trigger-store.ts'

type RunInputs = NonNullable<FlowRunOptions['inputs']>

export type PublicationAcceptance =
  | { readonly created: boolean; readonly kind: 'published'; readonly publicationId: string }
  | {
      readonly kind: 'binding-unresolved' | 'busy' | 'conflict' | 'live-conflict' | 'not-found' | 'operation-pending' | 'revision-conflict' | 'source-not-found'
    }

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

export interface StoredFlow {
  readonly createRequestDigest: string
  readonly createdAt: number
  readonly draftRevisionId: string
  readonly name: string
  readonly flowId: string
  readonly status: 'active' | 'retiring'
  readonly updatedAt: number
}

export interface StoredFlowRevision {
  readonly actorId: string
  readonly content: string
  readonly createdAt: number
  readonly digest: string
  readonly parentRevisionId: string | null
  readonly flowId: string
  readonly revisionId: string
}

export interface StoredPresentation {
  readonly flowId: string
  readonly revision: number
  readonly updatedAt: number
  readonly value: Readonly<Record<string, JsonValue>>
}

export interface StoredPublication {
  readonly actorId: string
  readonly closureDigest: string
  readonly createdAt: number
  readonly engineContract: string
  readonly flowId: string
  readonly modelVersion: number
  readonly operation: 'publish' | 'rollback'
  readonly publicationId: string
  readonly revisionDigest: string
  readonly revisionId: string
  readonly sourcePublicationId: string | null
}

export interface StoredLive {
  readonly publication: StoredPublication
  readonly revision: number
  readonly updatedAt: number
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

interface StoredRunRequest {
  readonly requestDigest: string
  readonly runId: string
  readonly source: 'draft' | 'live' | 'trigger' | null
  readonly status: RunStatus
}

export interface StoredRun {
  readonly connectorTeamId?: string
  readonly content: string
  readonly engineContract: string
  readonly engineDigest: string
  readonly flowId: string
  readonly inputs: RunInputs
  readonly revisionDigest: string
  readonly remainingMs?: number
  readonly resume?: { readonly action: WaitAction; readonly checkpoint: FlowRunCheckpoint }
  readonly resumeUnavailable?: true
  readonly runId: string
  readonly trigger?: TriggerSeed
}

const encoder = new TextEncoder()
const maxEventBytes = 1024 * 1024
const maxEventCount = 1_000
const maxEventTotalBytes = 16 * 1024 * 1024
const defaultRunEventRetentionMs = 30 * 24 * 60 * 60 * 1000
const defaultMaxPendingRuns = 1_000
const waitDurationMs = 7 * 24 * 60 * 60 * 1_000

export class Store {
  readonly integrations: IntegrationStore
  readonly polls: PollStore
  readonly publications: PublicationStore
  readonly triggers: TriggerStore
  readonly #clock: () => number
  readonly #database: DatabaseSync
  readonly #maxPendingRuns: number
  readonly #runEventRetentionMs: number

  constructor(file: string, clock: () => number = Date.now, runEventRetentionMs = defaultRunEventRetentionMs, maxPendingRuns = defaultMaxPendingRuns) {
    if (!Number.isSafeInteger(maxPendingRuns) || maxPendingRuns <= 0) throw new TypeError('Maximum pending Runs must be a positive safe integer.')
    this.#clock = clock
    this.#maxPendingRuns = maxPendingRuns
    this.#runEventRetentionMs = runEventRetentionMs
    this.#database = new DatabaseSync(file, { timeout: 5_000 })
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
    `)
    this.integrations = new IntegrationStore(
      this.#database,
      (operation) => this.#transaction(operation),
      (input) => this.#acceptTriggerOccurrence(input),
    )
    this.polls = new PollStore(
      this.#database,
      (operation) => this.#transaction(operation),
      (input) => this.#acceptTriggerOccurrence(input),
    )
    this.publications = new PublicationStore(this.#database, this.#clock, (operation) => this.#transaction(operation), this.integrations, this.polls)
    this.triggers = new TriggerStore(
      this.#database,
      (operation) => this.#transaction(operation),
      (input) => this.#acceptTriggerOccurrence(input),
    )
    this.#backfillEventExpiry()
    this.#recoverRunning()
  }

  createFlow(input: {
    readonly actorId: string
    readonly connectorTeamId?: string
    readonly content: string
    readonly createdAt: number
    readonly digest: string
    readonly idempotencyKey: string
    readonly name: string
    readonly flowId: string
    readonly requestDigest: string
    readonly revisionId: string
  }): { readonly created: boolean; readonly flow: StoredFlow } | { readonly kind: 'conflict' } {
    return this.#transaction(() => {
      const existing = this.#database
        .prepare('SELECT flow_id AS flowId, create_request_digest AS requestDigest FROM flows WHERE create_idempotency_key = ?')
        .get(input.idempotencyKey) as { readonly flowId: string; readonly requestDigest: string } | undefined
      if (existing != null) {
        if (existing.requestDigest != input.requestDigest) return { kind: 'conflict' }
        return { created: false, flow: this.#flow(existing.flowId)! }
      }

      this.#ensureRevision({ content: input.content, revisionDigest: input.digest, revisionId: input.revisionId })
      this.#database
        .prepare('INSERT INTO flow_revisions (revision_id, flow_id, parent_revision_id, actor_id, created_at) VALUES (?, ?, NULL, ?, ?)')
        .run(input.revisionId, input.flowId, input.actorId, input.createdAt)
      this.#database
        .prepare(
          `INSERT INTO flows (
             flow_id, name, status, draft_revision_id, create_idempotency_key,
             create_request_digest, created_at, updated_at
           ) VALUES (?, ?, 'active', ?, ?, ?, ?, ?)`,
        )
        .run(input.flowId, input.name, input.revisionId, input.idempotencyKey, input.requestDigest, input.createdAt, input.createdAt)
      this.#database.prepare("INSERT INTO flow_presentations (flow_id, revision, value, updated_at) VALUES (?, 1, '{}', ?)").run(input.flowId, input.createdAt)
      this.#database.prepare('INSERT INTO flow_connector_teams (flow_id, team_id) VALUES (?, ?)').run(input.flowId, input.connectorTeamId ?? null)
      return { created: true, flow: this.#flow(input.flowId)! }
    })
  }

  listFlows(
    limit: number,
    after?: { readonly createdAt: number; readonly flowId: string },
    includeTotal = false,
  ): { readonly flows: readonly StoredFlow[]; readonly total?: number } {
    const columns = `create_request_digest AS createRequestDigest, created_at AS createdAt,
                     draft_revision_id AS draftRevisionId, name, flow_id AS flowId, status, updated_at AS updatedAt`
    const flows =
      after == null
        ? (this.#database.prepare(`SELECT ${columns} FROM flows ORDER BY created_at, flow_id LIMIT ?`).all(limit) as unknown as StoredFlow[])
        : (this.#database
            .prepare(
              `SELECT ${columns} FROM flows
               WHERE created_at > ? OR (created_at = ? AND flow_id > ?)
               ORDER BY created_at, flow_id LIMIT ?`,
            )
            .all(after.createdAt, after.createdAt, after.flowId, limit) as unknown as StoredFlow[])
    if (!includeTotal) return { flows }
    const total = (this.#database.prepare('SELECT COUNT(*) AS total FROM flows').get() as { readonly total: number }).total
    return { flows, total }
  }

  listVariables(): readonly { readonly name: string; readonly updatedAt: number; readonly value: string }[] {
    return this.#database.prepare('SELECT name, updated_at AS updatedAt, value FROM variables ORDER BY name COLLATE BINARY').all() as unknown as readonly {
      readonly name: string
      readonly updatedAt: number
      readonly value: string
    }[]
  }

  variable(name: string): { readonly name: string; readonly updatedAt: number; readonly value: string } | undefined {
    return this.#database.prepare('SELECT name, updated_at AS updatedAt, value FROM variables WHERE name = ?').get(name) as
      | { readonly name: string; readonly updatedAt: number; readonly value: string }
      | undefined
  }

  putVariable(
    name: string,
    value: string,
  ):
    | { readonly kind: 'limit-reached' }
    | { readonly kind: 'saved'; readonly variable: { readonly name: string; readonly updatedAt: number; readonly value: string } } {
    return this.#transaction(() => {
      const existing = this.variable(name)
      if (existing != null) {
        if (existing.value == value) return { kind: 'saved', variable: existing }
        const updatedAt = this.#clock()
        this.#database.prepare('UPDATE variables SET value = ?, updated_at = ? WHERE name = ?').run(value, updatedAt, name)
        return { kind: 'saved', variable: { name, updatedAt, value } }
      }
      const count = (this.#database.prepare('SELECT COUNT(*) AS count FROM variables').get() as { readonly count: number }).count
      if (count >= 200) return { kind: 'limit-reached' }
      const updatedAt = this.#clock()
      this.#database.prepare('INSERT INTO variables (name, value, updated_at) VALUES (?, ?, ?)').run(name, value, updatedAt)
      return { kind: 'saved', variable: { name, updatedAt, value } }
    })
  }

  deleteVariable(name: string): boolean {
    return this.#transaction(() => this.#database.prepare('DELETE FROM variables WHERE name = ?').run(name).changes == 1)
  }

  resolveVariables(bindings: Readonly<Record<string, string>>): Readonly<Record<string, string>> | undefined {
    const names = [...new Set(Object.values(bindings))]
    if (names.length == 0) return {}
    this.#database.exec('BEGIN')
    try {
      const rows = this.#database
        .prepare(`SELECT name, value FROM variables WHERE name IN (${names.map(() => '?').join(', ')})`)
        .all(...names) as unknown as readonly { readonly name: string; readonly value: string }[]
      const values = new Map(rows.map(({ name, value }) => [name, value]))
      const resolved = Object.fromEntries(
        Object.entries(bindings).flatMap(([bindingId, name]) => {
          const value = values.get(name)
          return value == null ? [] : [[bindingId, value]]
        }),
      )
      this.#database.exec('COMMIT')
      return Object.keys(resolved).length == Object.keys(bindings).length ? resolved : undefined
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw error
    }
  }

  flow(flowId: string): StoredFlow | undefined {
    return this.#flow(flowId)
  }

  renameFlow(flowId: string, name: string, updatedAt: number): StoredFlow | undefined {
    this.#database.prepare("UPDATE flows SET name = ?, updated_at = ? WHERE flow_id = ? AND status = 'active'").run(name, updatedAt, flowId)
    return this.#flow(flowId)
  }

  retireFlow(flowId: string, updatedAt: number): StoredFlow | undefined {
    return this.#transaction(() => {
      const flow = this.#flow(flowId)
      if (flow == null) return
      if (flow.status == 'retiring') {
        this.#database.prepare('UPDATE flows SET deletion_requested_at = COALESCE(deletion_requested_at, ?) WHERE flow_id = ?').run(updatedAt, flowId)
        return this.#flow(flowId)
      }
      this.#database
        .prepare("UPDATE flows SET status = 'retiring', updated_at = ?, deletion_requested_at = ? WHERE flow_id = ?")
        .run(updatedAt, updatedAt, flowId)
      this.#retireFlow(flowId, updatedAt)
      return this.#flow(flowId)
    })
  }

  claimRetiringFlow(attemptedAt: number): string | undefined {
    return this.#transaction(() => {
      const flowId = (
        this.#database
          .prepare(
            `SELECT flow_id AS flowId FROM flows
           WHERE status = 'retiring'
           ORDER BY COALESCE(deletion_attempted_at, deletion_requested_at), deletion_requested_at, flow_id
           LIMIT 1`,
          )
          .get() as { readonly flowId: string } | undefined
      )?.flowId
      if (flowId != null) {
        this.#database.prepare("UPDATE flows SET deletion_attempted_at = ? WHERE flow_id = ? AND status = 'retiring'").run(attemptedAt, flowId)
      }
      return flowId
    })
  }

  cancelFlowRuns(flowId: string, limit: number): readonly string[] {
    return this.#transaction(() => {
      const runs = this.#database
        .prepare(
          `SELECT run_id AS runId FROM runs
           WHERE flow_id = ? AND status IN ('queued', 'starting', 'running', 'waiting')
           ORDER BY created_at, run_id LIMIT ?`,
        )
        .all(flowId, limit) as { readonly runId: string }[]
      const result = { error: { code: 'run.canceled', message: 'Run canceled.' } }
      const finishedAt = this.#clock()
      for (const { runId } of runs) {
        this.#finishRun(runId, 'canceled', result, "status IN ('queued', 'starting', 'running', 'waiting')", finishedAt)
      }
      return runs.map(({ runId }) => runId)
    })
  }

  flowHasIntegrationState(flowId: string): boolean {
    return (
      this.#database
        .prepare(
          `SELECT 1 FROM integration_states
           JOIN integration_bindings USING (binding_id)
           WHERE integration_bindings.flow_id = ? LIMIT 1`,
        )
        .get(flowId) != null
    )
  }

  deleteFlowRuns(flowId: string, limit: number): number {
    return this.#transaction(() => {
      const runs = this.#database.prepare('SELECT run_id AS runId FROM runs WHERE flow_id = ? ORDER BY created_at, run_id LIMIT ?').all(flowId, limit) as {
        readonly runId: string
      }[]
      for (const { runId } of runs) {
        this.#database.prepare('DELETE FROM webhook_admissions WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM cron_admissions WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM poll_admissions WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM integration_admissions WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM poll_claims WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM poll_event_dedupe WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM trigger_occurrences WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM events WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM wait_notifications WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM run_waits WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM work WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM runs WHERE run_id = ?').run(runId)
      }
      return runs.length
    })
  }

  deleteFlow(flowId: string): boolean {
    return this.#transaction(() => {
      const flow = this.#database.prepare("SELECT 1 FROM flows WHERE flow_id = ? AND status = 'retiring'").get(flowId)
      if (flow == null || this.#database.prepare('SELECT 1 FROM runs WHERE flow_id = ? LIMIT 1').get(flowId) != null) return false

      this.#database
        .prepare(
          `DELETE FROM trigger_activities WHERE binding_id IN (
             SELECT endpoint_id FROM webhook_bindings WHERE flow_id = ?
             UNION SELECT binding_id FROM cron_bindings WHERE flow_id = ?
             UNION SELECT binding_id FROM poll_bindings WHERE flow_id = ?
             UNION SELECT binding_id FROM integration_bindings WHERE flow_id = ?
           )`,
        )
        .run(flowId, flowId, flowId, flowId)
      this.#database.prepare('DELETE FROM poll_claims WHERE binding_id IN (SELECT binding_id FROM poll_bindings WHERE flow_id = ?)').run(flowId)
      this.#database.prepare('DELETE FROM poll_event_dedupe WHERE binding_id IN (SELECT binding_id FROM poll_bindings WHERE flow_id = ?)').run(flowId)
      this.#database.prepare('DELETE FROM integration_states WHERE binding_id IN (SELECT binding_id FROM integration_bindings WHERE flow_id = ?)').run(flowId)
      this.#database.prepare('DELETE FROM webhook_bindings WHERE flow_id = ?').run(flowId)
      this.#database.prepare('DELETE FROM cron_bindings WHERE flow_id = ?').run(flowId)
      this.#database.prepare('DELETE FROM poll_bindings WHERE flow_id = ?').run(flowId)
      this.#database.prepare('DELETE FROM integration_bindings WHERE flow_id = ?').run(flowId)
      this.#database.prepare('DELETE FROM flow_live WHERE flow_id = ?').run(flowId)
      this.#database.prepare('DELETE FROM publications WHERE flow_id = ?').run(flowId)
      this.#database.prepare('DELETE FROM flow_presentations WHERE flow_id = ?').run(flowId)
      this.#database.prepare('DELETE FROM flow_connector_teams WHERE flow_id = ?').run(flowId)
      this.#database.prepare('DELETE FROM flow_revisions WHERE flow_id = ?').run(flowId)
      return this.#database.prepare("DELETE FROM flows WHERE flow_id = ? AND status = 'retiring'").run(flowId).changes == 1
    })
  }

  collectOrphanRevisions(limit: number): number {
    return Number(
      this.#database
        .prepare(
          `DELETE FROM revisions WHERE revision_id IN (
             SELECT revisions.revision_id FROM revisions
             WHERE NOT EXISTS (SELECT 1 FROM flow_revisions WHERE flow_revisions.revision_id = revisions.revision_id)
               AND NOT EXISTS (SELECT 1 FROM publications WHERE publications.revision_id = revisions.revision_id)
               AND NOT EXISTS (SELECT 1 FROM runs WHERE runs.revision_id = revisions.revision_id)
             ORDER BY revisions.revision_id LIMIT ?
           )`,
        )
        .run(limit).changes,
    )
  }

  pruneExpiredEvents(now: number, limit: number): number {
    return Number(
      this.#database
        .prepare(
          `DELETE FROM events WHERE run_id IN (
             SELECT runs.run_id FROM runs
             WHERE runs.events_expires_at <= ? AND EXISTS (SELECT 1 FROM events WHERE events.run_id = runs.run_id)
             ORDER BY runs.events_expires_at, runs.run_id LIMIT ?
           )`,
        )
        .run(now, limit).changes,
    )
  }

  draft(flowId: string): StoredFlowRevision | undefined {
    return this.#database
      .prepare(
        `SELECT metadata.actor_id AS actorId, revisions.content, metadata.created_at AS createdAt,
                revisions.digest, metadata.parent_revision_id AS parentRevisionId,
                metadata.flow_id AS flowId, metadata.revision_id AS revisionId
         FROM flows
         JOIN flow_revisions AS metadata ON metadata.revision_id = flows.draft_revision_id
         JOIN revisions ON revisions.revision_id = metadata.revision_id
         WHERE flows.flow_id = ? AND metadata.flow_id = flows.flow_id`,
      )
      .get(flowId) as StoredFlowRevision | undefined
  }

  revision(flowId: string, revisionId: string): StoredFlowRevision | undefined {
    return this.#database
      .prepare(
        `SELECT metadata.actor_id AS actorId, revisions.content, metadata.created_at AS createdAt,
                revisions.digest, metadata.parent_revision_id AS parentRevisionId,
                metadata.flow_id AS flowId, metadata.revision_id AS revisionId
         FROM flow_revisions AS metadata
         JOIN revisions ON revisions.revision_id = metadata.revision_id
         WHERE metadata.flow_id = ? AND metadata.revision_id = ?`,
      )
      .get(flowId, revisionId) as StoredFlowRevision | undefined
  }

  commitRevision(input: {
    readonly actorId: string
    readonly changeId: string
    readonly content: string
    readonly createdAt: number
    readonly digest: string
    readonly expectedRevisionId: string
    readonly flowId: string
    readonly requestDigest: string
    readonly revisionId: string
  }): { readonly kind: 'busy' | 'conflict' | 'not-found' | 'request-conflict' } | { readonly kind: 'committed'; readonly revision: StoredFlowRevision } {
    return this.#transaction(() => {
      const existing = this.#database
        .prepare(
          `SELECT change_request_digest AS requestDigest, revision_id AS revisionId
           FROM flow_revisions WHERE flow_id = ? AND change_id = ?`,
        )
        .get(input.flowId, input.changeId) as { readonly requestDigest: string; readonly revisionId: string } | undefined
      if (existing != null) {
        if (existing.requestDigest != input.requestDigest) return { kind: 'request-conflict' }
        return { kind: 'committed', revision: this.revision(input.flowId, existing.revisionId)! }
      }

      const flow = this.#flow(input.flowId)
      if (flow == null) return { kind: 'not-found' }
      if (flow.status != 'active') return { kind: 'busy' }
      if (flow.draftRevisionId != input.expectedRevisionId) return { kind: 'conflict' }

      this.#ensureRevision({ content: input.content, revisionDigest: input.digest, revisionId: input.revisionId })
      this.#database
        .prepare(
          `INSERT INTO flow_revisions (
             revision_id, flow_id, parent_revision_id, actor_id, created_at, change_id, change_request_digest
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.revisionId, input.flowId, input.expectedRevisionId, input.actorId, input.createdAt, input.changeId, input.requestDigest)
      this.#database.prepare('UPDATE flows SET draft_revision_id = ?, updated_at = ? WHERE flow_id = ?').run(input.revisionId, input.createdAt, input.flowId)
      return { kind: 'committed', revision: this.revision(input.flowId, input.revisionId)! }
    })
  }

  presentation(flowId: string): StoredPresentation | undefined {
    const row = this.#database
      .prepare('SELECT flow_id AS flowId, revision, updated_at AS updatedAt, value FROM flow_presentations WHERE flow_id = ?')
      .get(flowId) as { readonly flowId: string; readonly revision: number; readonly updatedAt: number; readonly value: string } | undefined
    return row == null ? undefined : { ...row, value: JSON.parse(row.value) as Readonly<Record<string, JsonValue>> }
  }

  updatePresentation(
    flowId: string,
    expectedRevision: number,
    value: Readonly<Record<string, JsonValue>>,
    updatedAt: number,
  ): { readonly kind: 'busy' | 'conflict' | 'not-found' } | { readonly kind: 'updated'; readonly presentation: StoredPresentation } {
    return this.#transaction(() => {
      const flow = this.#flow(flowId)
      if (flow == null) return { kind: 'not-found' }
      if (flow.status != 'active') return { kind: 'busy' }
      const changed = this.#database
        .prepare('UPDATE flow_presentations SET revision = revision + 1, value = ?, updated_at = ? WHERE flow_id = ? AND revision = ?')
        .run(JSON.stringify(value), updatedAt, flowId, expectedRevision)
      if (changed.changes != 1) return { kind: 'conflict' }
      return { kind: 'updated', presentation: this.presentation(flowId)! }
    })
  }

  acceptControlRun(input: {
    readonly closureDigest: string
    readonly flowId: string
    readonly idempotencyKey: string
    readonly inputs: RunInputs
    readonly modelVersion: number
    readonly requestDigest: string
    readonly revisionDigest: string
    readonly revisionId: string
    readonly variableNames: readonly string[]
  }): RunAdmission | { readonly kind: 'binding-unresolved' | 'busy' | 'not-found' } {
    return this.#transaction(() => {
      const existing = this.#database
        .prepare('SELECT run_id AS runId, request_digest AS requestDigest, status FROM runs WHERE idempotency_key = ?')
        .get(input.idempotencyKey) as { readonly requestDigest: string; readonly runId: string; readonly status: RunStatus } | undefined
      if (existing != null) {
        if (existing.requestDigest != input.requestDigest) return { kind: 'conflict' }
        return { created: false, kind: 'accepted', runId: existing.runId, status: existing.status }
      }
      const revision = this.#database
        .prepare(
          `SELECT flows.status, revisions.digest
           FROM flows
           JOIN flow_revisions AS metadata ON metadata.flow_id = flows.flow_id
           JOIN revisions ON revisions.revision_id = metadata.revision_id
           WHERE flows.flow_id = ? AND metadata.revision_id = ?`,
        )
        .get(input.flowId, input.revisionId) as { readonly digest: string; readonly status: StoredFlow['status'] } | undefined
      if (revision == null || revision.digest != input.revisionDigest) return { kind: 'not-found' }
      if (revision.status != 'active') return { kind: 'busy' }
      if (!this.#variablesExist(input.variableNames)) return { kind: 'binding-unresolved' }
      if (!this.#hasRunCapacity()) return { kind: 'overloaded' }

      const runId = this.#insertRun({
        ...input,
        source: 'draft',
      })
      return { created: true, kind: 'accepted', runId, status: 'queued' }
    })
  }

  acceptLiveControlRun(input: {
    readonly closureDigest: string
    readonly expectedPublicationId: string
    readonly flowId: string
    readonly idempotencyKey: string
    readonly inputs: RunInputs
    readonly modelVersion: number
    readonly requestDigest: string
    readonly revisionDigest: string
    readonly revisionId: string
    readonly variableNames: readonly string[]
  }): RunAdmission | { readonly kind: 'binding-unresolved' | 'busy' | 'live-conflict' | 'not-found' } {
    return this.#transaction(() => {
      const existing = this.#database
        .prepare('SELECT run_id AS runId, request_digest AS requestDigest, source, status FROM runs WHERE idempotency_key = ?')
        .get(input.idempotencyKey) as
        | { readonly requestDigest: string; readonly runId: string; readonly source: StoredControlRun['source'] | null; readonly status: RunStatus }
        | undefined
      if (existing != null) {
        if (existing.requestDigest != input.requestDigest || existing.source != 'live') return { kind: 'conflict' }
        return { created: false, kind: 'accepted', runId: existing.runId, status: existing.status }
      }
      const flow = this.#flow(input.flowId)
      if (flow == null) return { kind: 'not-found' }
      if (flow.status != 'active') return { kind: 'busy' }
      const target = this.publications.live(input.flowId)
      if (target == null || target.publication.publicationId != input.expectedPublicationId) return { kind: 'live-conflict' }
      const publication = target.publication
      if (
        publication.revisionId != input.revisionId ||
        publication.revisionDigest != input.revisionDigest ||
        publication.closureDigest != input.closureDigest ||
        publication.modelVersion != input.modelVersion
      ) {
        return { kind: 'live-conflict' }
      }
      if (!this.#variablesExist(input.variableNames)) return { kind: 'binding-unresolved' }
      if (!this.#hasRunCapacity()) return { kind: 'overloaded' }

      const runId = this.#insertRun({
        ...input,
        publicationId: publication.publicationId,
        source: 'live',
      })
      return { created: true, kind: 'accepted', runId, status: 'queued' }
    })
  }

  append(runId: string, event: ProjectedRunEvent): void {
    this.#transaction(() => {
      const run = this.#database.prepare('SELECT status, event_count AS eventCount, event_bytes AS eventBytes FROM runs WHERE run_id = ?').get(runId) as {
        readonly eventBytes: number
        readonly eventCount: number
        readonly status: RunStatus
      }
      if (run.status != 'running') return
      const bytes = encoder.encode(JSON.stringify(event)).byteLength
      if (bytes > maxEventBytes || run.eventCount >= maxEventCount || run.eventBytes + bytes > maxEventTotalBytes) {
        this.#database.prepare('UPDATE runs SET events_truncated = 1 WHERE run_id = ?').run(runId)
        return
      }
      this.#insertEvent(runId, event.kind, event.payload, 'value' in event ? event.value : undefined)
      this.#database.prepare('UPDATE runs SET event_count = event_count + 1, event_bytes = event_bytes + ? WHERE run_id = ?').run(bytes, runId)
    })
  }

  cancel(runId: string): boolean {
    return this.commit(runId, 'canceled', { error: { code: 'run.canceled', message: 'Run canceled.' } })
  }

  claim(excludedFlowIds: readonly string[] = []): StoredRun | undefined {
    return this.#transaction(() => {
      const flowFilter = excludedFlowIds.length == 0 ? '' : `AND runs.flow_id NOT IN (${excludedFlowIds.map(() => '?').join(', ')})`
      const claimed = this.#database
        .prepare(
          `SELECT runs.run_id AS runId
           FROM work JOIN runs USING (run_id)
           WHERE runs.status IN ('queued', 'starting')
             AND NOT EXISTS (
               SELECT 1 FROM work AS earlier_work JOIN runs AS earlier ON earlier.run_id = earlier_work.run_id
               WHERE earlier.flow_id = runs.flow_id AND earlier.status = 'waiting' AND earlier_work.sequence < work.sequence
             )
             ${flowFilter}
           ORDER BY work.sequence
           LIMIT 1`,
        )
        .get(...excludedFlowIds) as { readonly runId: string } | undefined
      if (claimed == null) return
      this.#database.prepare("UPDATE runs SET status = 'starting' WHERE run_id = ? AND status = 'queued'").run(claimed.runId)
      const row = this.#database
        .prepare(
          `SELECT revisions.content, runs.engine_contract AS engineContract, runs.engine_digest AS engineDigest,
                  runs.connector_team_id AS connectorTeamId, runs.flow_id AS flowId, runs.inputs,
                  runs.revision_digest AS revisionDigest, runs.run_id AS runId,
                  run_waits.action AS waitAction, run_waits.checkpoint_json AS checkpointJson,
                  run_waits.remaining_ms AS remainingMs, run_waits.wait_id AS waitId,
                  trigger_occurrences.payload AS triggerPayload, trigger_occurrences.trigger_node_id AS triggerNodeId
           FROM runs JOIN revisions USING (revision_id)
           LEFT JOIN trigger_occurrences USING (run_id)
           LEFT JOIN run_waits USING (run_id)
           WHERE runs.run_id = ? AND runs.status = 'starting'`,
        )
        .get(claimed.runId) as {
        readonly connectorTeamId: string | null
        readonly content: string
        readonly engineContract: string
        readonly engineDigest: string
        readonly inputs: string
        readonly flowId: string
        readonly revisionDigest: string
        readonly checkpointJson: string | null
        readonly remainingMs: number | null
        readonly runId: string
        readonly triggerNodeId: string | null
        readonly triggerPayload: string | null
        readonly waitAction: WaitAction | null
        readonly waitId: string | null
      }
      let resumeUnavailable = row.waitId != null && (row.waitAction == null || row.checkpointJson == null || row.remainingMs == null)
      let resume: StoredRun['resume']
      if (!resumeUnavailable && row.waitId != null && row.waitAction != null && row.checkpointJson != null) {
        try {
          const checkpoint = decodeFlowRunCheckpoint(JSON.parse(row.checkpointJson))
          if (checkpoint.wait.waitId != row.waitId) resumeUnavailable = true
          else resume = { action: row.waitAction, checkpoint }
        } catch {
          resumeUnavailable = true
        }
      }
      return {
        content: row.content,
        connectorTeamId: row.connectorTeamId ?? undefined,
        engineContract: row.engineContract,
        engineDigest: row.engineDigest,
        flowId: row.flowId,
        inputs: JSON.parse(row.inputs) as RunInputs,
        ...(resumeUnavailable
          ? { resumeUnavailable: true as const }
          : resume == null || row.remainingMs == null
            ? {}
            : { remainingMs: row.remainingMs, resume }),
        revisionDigest: row.revisionDigest,
        runId: row.runId,
        ...(row.triggerNodeId == null || row.triggerPayload == null
          ? {}
          : { trigger: { nodeId: row.triggerNodeId, payload: JSON.parse(row.triggerPayload) as JsonValue } }),
      }
    })
  }

  close(): void {
    this.#database.close()
  }

  connectorTeam(flowId: string): string | undefined {
    const row = this.#database.prepare('SELECT team_id AS teamId FROM flow_connector_teams WHERE flow_id = ?').get(flowId) as
      | { readonly teamId: string | null }
      | undefined
    return row?.teamId ?? undefined
  }

  connectorTeamBindings(): readonly { readonly flowId: string; readonly teamId: string }[] {
    return this.#database
      .prepare('SELECT flow_id AS flowId, team_id AS teamId FROM flow_connector_teams WHERE team_id IS NOT NULL ORDER BY flow_id')
      .all() as unknown as readonly { readonly flowId: string; readonly teamId: string }[]
  }

  bindConnectorTeam(flowId: string, teamId: string): string | undefined {
    this.#database.prepare('UPDATE flow_connector_teams SET team_id = ? WHERE flow_id = ? AND team_id IS NULL').run(teamId, flowId)
    return this.connectorTeam(flowId)
  }

  bindUnassignedConnectorTeams(teamId: string): void {
    this.#database.prepare('UPDATE flow_connector_teams SET team_id = ? WHERE team_id IS NULL').run(teamId)
  }

  commit(runId: string, status: RunTerminalStatus, result: unknown): boolean {
    return this.#transaction(() => {
      const condition = status == 'canceled' ? "status IN ('queued', 'starting', 'running', 'waiting')" : "status = 'running'"
      return this.#finishRun(runId, status, result, condition, this.#clock())
    })
  }

  failStarting(runId: string, result: unknown): boolean {
    return this.#transaction(() => this.#finishRun(runId, 'failed', result, "status = 'starting'", this.#clock()))
  }

  failResume(runId: string, result: unknown): boolean {
    return this.#transaction(() => this.#finishRun(runId, 'indeterminate', result, "status = 'starting'", this.#clock()))
  }

  wait(
    runId: string,
    outcome: Extract<FlowRunOutcome, { readonly kind: 'waiting' }>,
    remainingMs: number,
    notification?: {
      readonly action: string
      readonly connectionId?: string
      readonly input: Readonly<Record<string, JsonValue>>
      readonly messageHandle: string
      readonly prompt: string
      readonly publicOrigin: string
      readonly taskId: string
    },
  ): { readonly expiresAt: number; readonly waitingSince: number } | undefined {
    const checkpointJson = JSON.stringify(outcome.checkpoint)
    const checkpointBytes = encoder.encode(checkpointJson).byteLength
    const checkpointDigest = `sha256:${createHash('sha256').update(checkpointJson).digest('hex')}`
    return this.#transaction(() => {
      const waitingSince = this.#clock()
      const expiresAt = waitingSince + waitDurationMs
      const capability = notification == null ? undefined : randomBytes(32).toString('base64url')
      const capabilityDigest = capability == null ? null : createHash('sha256').update(capability).digest('hex')
      const changed = this.#database.prepare("UPDATE runs SET status = 'waiting' WHERE run_id = ? AND status = 'running'").run(runId)
      if (changed.changes != 1) return
      this.#database
        .prepare(
          `INSERT INTO run_waits (
             run_id, wait_id, node_id, job_id, job_order, waiting_since, expires_at,
             checkpoint_json, checkpoint_version, checkpoint_digest, checkpoint_bytes,
             remaining_ms, action, resolved_at, capability_digest
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, NULL, ?)
           ON CONFLICT(run_id) DO UPDATE SET
             wait_id = excluded.wait_id, node_id = excluded.node_id, job_id = excluded.job_id,
             job_order = excluded.job_order, waiting_since = excluded.waiting_since,
             expires_at = excluded.expires_at, checkpoint_json = excluded.checkpoint_json,
             checkpoint_version = 1, checkpoint_digest = excluded.checkpoint_digest,
             checkpoint_bytes = excluded.checkpoint_bytes, remaining_ms = excluded.remaining_ms,
             action = NULL, resolved_at = NULL, capability_digest = excluded.capability_digest`,
        )
        .run(
          runId,
          outcome.wait.waitId,
          outcome.wait.nodeId,
          outcome.wait.jobId,
          outcome.wait.order,
          waitingSince,
          expiresAt,
          checkpointJson,
          checkpointDigest,
          checkpointBytes,
          remainingMs,
          capabilityDigest,
        )
      this.#database.prepare('DELETE FROM wait_notifications WHERE run_id = ?').run(runId)
      if (notification != null && capability != null) {
        const expiresAtText = new Date(expiresAt).toISOString()
        const links = outcome.wait.actions.map((action) => ({
          action,
          url: new URL(`/v1/wait-actions/${capability}/${action}`, notification.publicOrigin).href,
        }))
        const labels = { approve: 'Approve', continue: 'Continue', reject: 'Reject' } as const
        const message = [notification.prompt, `Expires at: ${expiresAtText}`, ...links.map(({ action, url }) => `${labels[action]}: ${url}`)].join('\n')
        const input = { ...notification.input, [notification.messageHandle]: message }
        this.#database
          .prepare(
            `INSERT INTO wait_notifications (
               run_id, wait_id, invocation_id, action, connection_id, task_id,
               input_json, status, attempts, retry_at, claim_id, claim_expires_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?)`,
          )
          .run(
            runId,
            outcome.wait.waitId,
            `wait:${runId}:${outcome.wait.waitId}`,
            notification.action,
            notification.connectionId ?? null,
            notification.taskId,
            JSON.stringify(input),
            waitingSince,
            waitingSince,
            waitingSince,
          )
      }
      const payload = {
        expiresAt: new Date(expiresAt).toISOString(),
        nodeId: outcome.wait.nodeId,
        waitId: outcome.wait.waitId,
        waitingSince: new Date(waitingSince).toISOString(),
      }
      this.#insertEvent(runId, 'run.waiting', payload)
      const bytes = encoder.encode(JSON.stringify({ kind: 'run.waiting', payload })).byteLength
      this.#database.prepare('UPDATE runs SET event_count = event_count + 1, event_bytes = event_bytes + ? WHERE run_id = ?').run(bytes, runId)
      return { expiresAt, waitingSince }
    })
  }

  activeWait(runId: string):
    | {
        readonly expiresAt: number
        readonly nodeId: string
        readonly waitId: string
        readonly waitingSince: number
      }
    | undefined {
    return this.#database
      .prepare(
        `SELECT run_waits.expires_at AS expiresAt, run_waits.node_id AS nodeId,
                run_waits.wait_id AS waitId, run_waits.waiting_since AS waitingSince
         FROM run_waits JOIN runs USING (run_id)
         WHERE run_waits.run_id = ? AND runs.status = 'waiting'`,
      )
      .get(runId) as { readonly expiresAt: number; readonly nodeId: string; readonly waitId: string; readonly waitingSince: number } | undefined
  }

  waitReceipt(
    runId: string,
    waitId: string,
  ):
    | {
        readonly expiresAt: number
        readonly nodeId: string
        readonly waitId: string
        readonly waitingSince: number
      }
    | undefined {
    return this.#database
      .prepare(
        `SELECT expires_at AS expiresAt, node_id AS nodeId, wait_id AS waitId, waiting_since AS waitingSince
         FROM run_waits WHERE run_id = ? AND wait_id = ?`,
      )
      .get(runId, waitId) as { readonly expiresAt: number; readonly nodeId: string; readonly waitId: string; readonly waitingSince: number } | undefined
  }

  resolveWait(
    runId: string,
    waitId: string,
    requested: WaitAction,
    allowed: readonly WaitAction[],
  ):
    | { readonly kind: 'invalid-action' | 'not-found' }
    | {
        readonly action: WaitAction | null
        readonly changed: boolean
        readonly kind: 'resolved'
        readonly resolutionAccepted: boolean
        readonly resolvedAt: number | null
        readonly status: RunStatus
      } {
    return this.#transaction(() => {
      const row = this.#database
        .prepare(
          `SELECT run_waits.action, run_waits.expires_at AS expiresAt,
                  run_waits.resolved_at AS resolvedAt, runs.status
           FROM run_waits JOIN runs USING (run_id)
           WHERE run_waits.run_id = ? AND run_waits.wait_id = ?`,
        )
        .get(runId, waitId) as
        | { readonly action: WaitAction | null; readonly expiresAt: number; readonly resolvedAt: number | null; readonly status: RunStatus }
        | undefined
      if (row == null) return { kind: 'not-found' as const }
      if (!allowed.includes(requested)) return { kind: 'invalid-action' as const }
      if (row.action != null && row.resolvedAt != null) {
        return {
          action: row.action,
          changed: false,
          kind: 'resolved' as const,
          resolutionAccepted: row.action == requested,
          resolvedAt: row.resolvedAt,
          status: row.status,
        }
      }
      if (row.status != 'waiting') {
        return { action: null, changed: false, kind: 'resolved' as const, resolutionAccepted: false, resolvedAt: null, status: row.status }
      }
      const resolvedAt = this.#clock()
      if (resolvedAt >= row.expiresAt) {
        this.#finishRun(
          runId,
          'failed',
          { error: { code: 'run.wait-expired', message: 'The Wait expired before it was resolved.' } },
          "status = 'waiting'",
          resolvedAt,
        )
        return { action: null, changed: true, kind: 'resolved' as const, resolutionAccepted: false, resolvedAt: null, status: 'failed' as const }
      }
      this.#database.prepare("UPDATE runs SET status = 'queued' WHERE run_id = ? AND status = 'waiting'").run(runId)
      this.#database.prepare('UPDATE run_waits SET action = ?, resolved_at = ? WHERE run_id = ? AND action IS NULL').run(requested, resolvedAt, runId)
      this.#database.prepare('DELETE FROM wait_notifications WHERE run_id = ?').run(runId)
      const payload = { action: requested, resolvedAt: new Date(resolvedAt).toISOString(), waitId }
      this.#insertEvent(runId, 'run.resolved', payload)
      const bytes = encoder.encode(JSON.stringify({ kind: 'run.resolved', payload })).byteLength
      this.#database.prepare('UPDATE runs SET event_count = event_count + 1, event_bytes = event_bytes + ? WHERE run_id = ?').run(bytes, runId)
      return { action: requested, changed: true, kind: 'resolved' as const, resolutionAccepted: true, resolvedAt, status: 'queued' as const }
    })
  }

  expireWaits(now: number, limit: number): readonly { readonly flowId: string; readonly runId: string }[] {
    return this.#transaction(() => {
      const due = this.#database
        .prepare(
          `SELECT runs.flow_id AS flowId, runs.run_id AS runId
           FROM runs JOIN run_waits USING (run_id)
           WHERE runs.status = 'waiting' AND run_waits.expires_at <= ?
           ORDER BY run_waits.expires_at, runs.run_id LIMIT ?`,
        )
        .all(now, limit) as unknown as readonly { readonly flowId: string; readonly runId: string }[]
      for (const { runId } of due) {
        this.#finishRun(
          runId,
          'failed',
          { error: { code: 'run.wait-expired', message: 'The Wait expired before it was resolved.' } },
          "status = 'waiting'",
          now,
        )
      }
      return due
    })
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

  claimWaitNotification(
    now: number,
    leaseMs: number,
  ):
    | {
        readonly action: string
        readonly claimId: string
        readonly connectionId?: string
        readonly input: Readonly<Record<string, JsonValue>>
        readonly invocationId: string
        readonly runId: string
        readonly teamId?: string
        readonly waitId: string
      }
    | undefined {
    return this.#transaction(() => {
      this.#database
        .prepare(
          `DELETE FROM wait_notifications
           WHERE status = 'pending' AND NOT EXISTS (
             SELECT 1 FROM runs JOIN run_waits USING (run_id)
             WHERE runs.run_id = wait_notifications.run_id
               AND runs.status = 'waiting'
               AND run_waits.wait_id = wait_notifications.wait_id
               AND run_waits.expires_at > ?
           )`,
        )
        .run(now)
      const row = this.#database
        .prepare(
          `SELECT wait_notifications.action, wait_notifications.connection_id AS connectionId,
                  wait_notifications.input_json AS inputJson, wait_notifications.invocation_id AS invocationId,
                  wait_notifications.run_id AS runId, runs.connector_team_id AS teamId,
                  wait_notifications.wait_id AS waitId
           FROM wait_notifications JOIN runs USING (run_id) JOIN run_waits USING (run_id)
           WHERE wait_notifications.status = 'pending'
             AND wait_notifications.retry_at <= ?
             AND (wait_notifications.claim_id IS NULL OR wait_notifications.claim_expires_at <= ?)
             AND runs.status = 'waiting'
             AND run_waits.wait_id = wait_notifications.wait_id
             AND run_waits.expires_at > ?
           ORDER BY wait_notifications.created_at, wait_notifications.run_id LIMIT 1`,
        )
        .get(now, now, now) as
        | {
            readonly action: string
            readonly connectionId: string | null
            readonly inputJson: string
            readonly invocationId: string
            readonly runId: string
            readonly teamId: string | null
            readonly waitId: string
          }
        | undefined
      if (row == null) return
      const claimId = randomUUID()
      const changed = this.#database
        .prepare(
          `UPDATE wait_notifications SET attempts = attempts + 1, claim_id = ?, claim_expires_at = ?, updated_at = ?
           WHERE run_id = ? AND wait_id = ? AND status = 'pending'
             AND retry_at <= ? AND (claim_id IS NULL OR claim_expires_at <= ?)`,
        )
        .run(claimId, now + leaseMs, now, row.runId, row.waitId, now, now)
      if (changed.changes != 1) return
      return {
        action: row.action,
        claimId,
        connectionId: row.connectionId ?? undefined,
        input: JSON.parse(row.inputJson) as Readonly<Record<string, JsonValue>>,
        invocationId: row.invocationId,
        runId: row.runId,
        teamId: row.teamId ?? undefined,
        waitId: row.waitId,
      }
    })
  }

  finishWaitNotification(runId: string, waitId: string, claimId: string, delivered: boolean): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE wait_notifications
           SET status = ?, claim_id = NULL, claim_expires_at = NULL, updated_at = ?
           WHERE run_id = ? AND wait_id = ? AND status = 'pending' AND claim_id = ?`,
        )
        .run(delivered ? 'delivered' : 'failed', this.#clock(), runId, waitId, claimId).changes == 1
    )
  }

  releaseWaitNotification(runId: string, waitId: string, claimId: string, retryAt: number, maxAttempts: number): 'failed' | 'pending' | undefined {
    const row = this.#database
      .prepare(
        `UPDATE wait_notifications
         SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END,
             retry_at = ?, claim_id = NULL, claim_expires_at = NULL, updated_at = ?
         WHERE run_id = ? AND wait_id = ? AND status = 'pending' AND claim_id = ?
         RETURNING status`,
      )
      .get(maxAttempts, retryAt, this.#clock(), runId, waitId, claimId) as { readonly status: 'failed' | 'pending' } | undefined
    return row?.status
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
        `SELECT run_waits.action, run_waits.expires_at AS expiresAt, runs.flow_id AS flowId,
                run_waits.node_id AS nodeId, run_waits.resolved_at AS resolvedAt,
                runs.revision_id AS revisionId, runs.run_id AS runId, runs.status,
                run_waits.wait_id AS waitId
         FROM run_waits JOIN runs USING (run_id)
         WHERE run_waits.capability_digest = ?`,
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

  runRequest(idempotencyKey: string): StoredRunRequest | undefined {
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

  cancelControlRun(runId: string): { readonly accepted: boolean; readonly run: StoredControlRun } | undefined {
    return this.#transaction(() => {
      const current = this.#database.prepare('SELECT status FROM runs WHERE run_id = ?').get(runId) as { readonly status: RunStatus } | undefined
      if (current == null) return
      if (current.status == 'canceled' || current.status == 'completed' || current.status == 'failed' || current.status == 'indeterminate') {
        return { accepted: false, run: this.controlRun(runId)! }
      }
      this.#finishRun(
        runId,
        'canceled',
        { error: { code: 'run.canceled', message: 'Run canceled.' } },
        "status IN ('queued', 'starting', 'running', 'waiting')",
        this.#clock(),
      )
      return { accepted: true, run: this.controlRun(runId)! }
    })
  }

  start(runId: string, event: ProjectedRunEvent): boolean {
    return this.#transaction(() => {
      const changed = this.#database
        .prepare(
          `UPDATE runs SET status = 'running', started_at = ?
           WHERE run_id = ? AND status = 'starting'
             AND NOT EXISTS (SELECT 1 FROM run_waits WHERE run_waits.run_id = runs.run_id AND resolved_at IS NOT NULL)`,
        )
        .run(this.#clock(), runId)
      if (changed.changes != 1) return false
      const bytes = encoder.encode(JSON.stringify(event)).byteLength
      this.#insertEvent(runId, event.kind, event.payload, 'value' in event ? event.value : undefined)
      this.#database.prepare('UPDATE runs SET event_count = event_count + 1, event_bytes = event_bytes + ? WHERE run_id = ?').run(bytes, runId)
      return true
    })
  }

  resume(runId: string, waitId: string): boolean {
    return this.#transaction(() => {
      const changed = this.#database
        .prepare(
          `UPDATE runs SET status = 'running'
           WHERE run_id = ? AND status = 'starting'
             AND EXISTS (
               SELECT 1 FROM run_waits
               WHERE run_waits.run_id = runs.run_id AND wait_id = ?
                 AND action IS NOT NULL AND checkpoint_json IS NOT NULL
             )`,
        )
        .run(runId, waitId)
      if (changed.changes != 1) return false
      this.#database.prepare('UPDATE run_waits SET checkpoint_json = NULL WHERE run_id = ? AND wait_id = ?').run(runId, waitId)
      return true
    })
  }

  #retireFlow(flowId: string, retiredAt: number): void {
    this.#database.prepare('DELETE FROM flow_live WHERE flow_id = ?').run(flowId)
    this.#database
      .prepare(
        `UPDATE webhook_bindings
         SET current_publication_id = NULL, runtime_version = runtime_version + 1, trigger_json = NULL, updated_at = ?
         WHERE flow_id = ? AND current_publication_id IS NOT NULL`,
      )
      .run(retiredAt, flowId)
    this.#database
      .prepare(
        `UPDATE cron_bindings
         SET current_publication_id = NULL, runtime_version = runtime_version + 1,
             trigger_json = NULL, schedule_json = NULL, next_at = NULL, updated_at = ?
         WHERE flow_id = ? AND current_publication_id IS NOT NULL`,
      )
      .run(retiredAt, flowId)
    this.#database
      .prepare(
        `UPDATE poll_bindings
         SET current_publication_id = NULL, runtime_version = runtime_version + 1,
             next_at = NULL, retry_at = NULL, continuation_root_id = NULL, continuation_page = 0,
             active_claim_id = NULL, active_lease_token = NULL, active_lease_expires_at = NULL,
             updated_at = ?
         WHERE flow_id = ? AND current_publication_id IS NOT NULL`,
      )
      .run(retiredAt, flowId)
    this.#database
      .prepare(
        `UPDATE integration_bindings
         SET current_publication_id = NULL, runtime_version = runtime_version + 1,
             reconcile_at = ?, retry_at = NULL, updated_at = ?
         WHERE flow_id = ? AND current_publication_id IS NOT NULL`,
      )
      .run(retiredAt, retiredAt, flowId)
  }

  #flow(flowId: string): StoredFlow | undefined {
    return this.#database
      .prepare(
        `SELECT create_request_digest AS createRequestDigest, created_at AS createdAt,
                draft_revision_id AS draftRevisionId, name, flow_id AS flowId,
                status, updated_at AS updatedAt
         FROM flows WHERE flow_id = ?`,
      )
      .get(flowId) as StoredFlow | undefined
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
                trigger_occurrences.trigger_node_id AS triggerNodeId
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

  #insertEvent(runId: string, kind: RunEventKind, payload: Readonly<Record<string, unknown>>, value?: unknown): void {
    const cursor = Number(
      (this.#database.prepare('SELECT COALESCE(MAX(cursor), 0) + 1 AS cursor FROM events WHERE run_id = ?').get(runId) as { cursor: number }).cursor,
    )
    this.#database
      .prepare('INSERT INTO events (run_id, cursor, kind, payload, value, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(runId, cursor, kind, JSON.stringify(payload), value === undefined ? null : JSON.stringify(value), this.#clock())
  }

  #finishRun(runId: string, status: RunTerminalStatus, result: unknown, condition: string, finishedAt: number): boolean {
    const changed = this.#database
      .prepare(`UPDATE runs SET status = ?, result = ?, finished_at = ?, events_expires_at = ? WHERE run_id = ? AND ${condition}`)
      .run(status, JSON.stringify(result), finishedAt, finishedAt + this.#runEventRetentionMs, runId)
    if (changed.changes != 1) return false
    this.#database.prepare('UPDATE run_waits SET checkpoint_json = NULL WHERE run_id = ?').run(runId)
    this.#database.prepare('DELETE FROM wait_notifications WHERE run_id = ?').run(runId)
    this.#insertEvent(runId, `run.${status}`, { result })
    this.#database.prepare('UPDATE runs SET event_count = event_count + 1 WHERE run_id = ?').run(runId)
    this.#database.prepare('DELETE FROM work WHERE run_id = ?').run(runId)
    return true
  }

  #acceptTriggerOccurrence(input: TriggerOccurrenceInput): RunAdmission {
    const existing = this.#database
      .prepare(
        `SELECT runs.request_digest AS requestDigest, runs.run_id AS runId, runs.status
         FROM trigger_occurrences JOIN runs USING (run_id)
         WHERE trigger_occurrences.occurrence_id = ?`,
      )
      .get(input.occurrenceId) as { readonly requestDigest: string; readonly runId: string; readonly status: RunStatus } | undefined
    if (existing != null) {
      if (existing.requestDigest != input.requestDigest) return { kind: 'conflict' }
      return { created: false, kind: 'accepted', runId: existing.runId, status: existing.status }
    }
    if (!this.#hasRunCapacity()) return { kind: 'overloaded' }

    this.#ensureRevision(input)
    const runId = this.#insertRun({
      ...input,
      idempotencyKey: `trigger:${randomUUID()}`,
      inputs: {},
    })
    this.#database
      .prepare('INSERT INTO trigger_occurrences (occurrence_id, run_id, trigger_node_id, payload) VALUES (?, ?, ?, ?)')
      .run(input.occurrenceId, runId, input.triggerNodeId, JSON.stringify(input.payload))
    return { created: true, kind: 'accepted', runId, status: 'queued' }
  }

  #hasRunCapacity(): boolean {
    return this.#database.prepare('SELECT 1 FROM work LIMIT 1 OFFSET ?').get(this.#maxPendingRuns - 1) == null
  }

  #ensureRevision(input: { readonly content: string; readonly revisionDigest: string; readonly revisionId: string }): void {
    const revision = this.#database.prepare('SELECT digest FROM revisions WHERE revision_id = ?').get(input.revisionId) as
      | { readonly digest: string }
      | undefined
    if (revision != null && revision.digest != input.revisionDigest) {
      throw new AcceptanceError('revision-conflict', 'Revision identity already refers to different content.')
    }
    if (revision == null) {
      this.#database.prepare('INSERT INTO revisions (revision_id, digest, content) VALUES (?, ?, ?)').run(input.revisionId, input.revisionDigest, input.content)
    }
  }

  #insertRun(input: {
    readonly closureDigest: string
    readonly flowId: string
    readonly idempotencyKey: string
    readonly inputs: RunInputs
    readonly modelVersion: number
    readonly publicationId?: string
    readonly requestDigest: string
    readonly revisionDigest: string
    readonly revisionId: string
    readonly source: 'draft' | 'live' | 'trigger'
  }): string {
    const runId = randomUUID()
    const connectorTeamId = this.connectorTeam(input.flowId)
    this.#database
      .prepare(
        `INSERT INTO runs (
           run_id, idempotency_key, request_digest, revision_id, revision_digest, flow_id,
           engine_contract, engine_digest, inputs, status, source, closure_digest,
           model_version, created_at, publication_id, connector_team_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        input.idempotencyKey,
        input.requestDigest,
        input.revisionId,
        input.revisionDigest,
        input.flowId,
        currentEngineContract,
        isolatedVmEngineDigest,
        JSON.stringify(input.inputs),
        input.source,
        input.closureDigest,
        input.modelVersion,
        this.#clock(),
        input.publicationId ?? null,
        connectorTeamId ?? null,
      )
    this.#database.prepare('INSERT INTO work (run_id) VALUES (?)').run(runId)
    const payload = {}
    this.#insertEvent(runId, 'run.queued', payload)
    const bytes = encoder.encode(JSON.stringify({ kind: 'run.queued', payload })).byteLength
    this.#database.prepare('UPDATE runs SET event_count = 1, event_bytes = ? WHERE run_id = ?').run(bytes, runId)
    return runId
  }

  #recoverRunning(): void {
    const running = this.#database.prepare("SELECT run_id AS runId FROM runs WHERE status = 'running'").all() as { readonly runId: string }[]
    for (const { runId } of running) {
      this.commit(runId, 'indeterminate', {
        error: { code: 'execution.terminal-unknown', message: 'The previous process stopped after user execution began.' },
      })
    }
    const waiting = this.#database
      .prepare(
        `SELECT runs.run_id AS runId, run_waits.checkpoint_bytes AS checkpointBytes,
                run_waits.checkpoint_digest AS checkpointDigest, run_waits.checkpoint_json AS checkpointJson,
                run_waits.expires_at AS expiresAt, run_waits.wait_id AS waitId
         FROM runs LEFT JOIN run_waits USING (run_id)
         WHERE runs.status = 'waiting'`,
      )
      .all() as unknown as readonly {
      readonly checkpointBytes: number | null
      readonly checkpointDigest: string | null
      readonly checkpointJson: string | null
      readonly expiresAt: number | null
      readonly runId: string
      readonly waitId: string | null
    }[]
    for (const row of waiting) {
      if (row.expiresAt != null && row.expiresAt <= this.#clock()) {
        this.#transaction(() =>
          this.#finishRun(
            row.runId,
            'failed',
            { error: { code: 'run.wait-expired', message: 'The Wait expired before it was resolved.' } },
            "status = 'waiting'",
            this.#clock(),
          ),
        )
      } else if (!this.#checkpointValid(row.checkpointJson, row.checkpointDigest, row.checkpointBytes, row.waitId)) {
        this.#transaction(() =>
          this.#finishRun(
            row.runId,
            'indeterminate',
            { error: { code: 'execution.resume-unavailable', message: 'The stored Wait checkpoint is unavailable.' } },
            "status = 'waiting'",
            this.#clock(),
          ),
        )
      }
    }
    const resumes = this.#database
      .prepare(
        `SELECT runs.run_id AS runId, runs.status, run_waits.checkpoint_bytes AS checkpointBytes,
                run_waits.checkpoint_digest AS checkpointDigest, run_waits.checkpoint_json AS checkpointJson,
                run_waits.wait_id AS waitId
         FROM runs JOIN run_waits USING (run_id)
         WHERE runs.status IN ('queued', 'starting') AND run_waits.resolved_at IS NOT NULL`,
      )
      .all() as unknown as readonly {
      readonly checkpointBytes: number
      readonly checkpointDigest: string
      readonly checkpointJson: string | null
      readonly runId: string
      readonly status: 'queued' | 'starting'
      readonly waitId: string
    }[]
    for (const row of resumes) {
      if (this.#checkpointValid(row.checkpointJson, row.checkpointDigest, row.checkpointBytes, row.waitId)) continue
      this.#transaction(() =>
        this.#finishRun(
          row.runId,
          'indeterminate',
          { error: { code: 'execution.resume-unavailable', message: 'The stored Wait checkpoint is unavailable.' } },
          `status = '${row.status}'`,
          this.#clock(),
        ),
      )
    }
  }

  #checkpointValid(source: string | null, digest: string | null, bytes: number | null, waitId: string | null): boolean {
    if (source == null || digest == null || bytes == null || encoder.encode(source).byteLength != bytes) return false
    if (`sha256:${createHash('sha256').update(source).digest('hex')}` != digest) return false
    try {
      return decodeFlowRunCheckpoint(JSON.parse(source)).wait.waitId == waitId
    } catch {
      return false
    }
  }

  #backfillEventExpiry(): void {
    this.#database
      .prepare(
        `UPDATE runs SET events_expires_at = ?
         WHERE events_expires_at IS NULL AND status IN ('canceled', 'completed', 'failed', 'indeterminate')`,
      )
      .run(this.#clock() + this.#runEventRetentionMs)
  }

  #variablesExist(names: readonly string[]): boolean {
    const unique = [...new Set(names)]
    if (unique.length == 0) return true
    const count = (
      this.#database.prepare(`SELECT COUNT(*) AS count FROM variables WHERE name IN (${unique.map(() => '?').join(', ')})`).get(...unique) as {
        readonly count: number
      }
    ).count
    return count == unique.length
  }

  #transaction<Value>(operation: () => Value): Value {
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      const value = operation()
      this.#database.exec('COMMIT')
      return value
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw error
    }
  }
}
