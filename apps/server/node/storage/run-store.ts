import type { RunEventKind } from '@oomol-lab/open-flow/control-api'
import type { JsonValue, WaitAction } from '@oomol-lab/open-flow/flow-change'
import type { ProjectedRunEvent } from '@oomol-lab/open-flow/run-events'
import type { RunStatus, RunTerminalStatus } from '@oomol-lab/open-flow/run-lifecycle'
import type { FlowRunCheckpoint, FlowRunOptions, FlowRunOutcome, TriggerSeed } from '@oomol-lab/open-flow/scheduler'
import type { DatabaseSync } from 'node:sqlite'
import type { LlmConfig } from '../deployment/llm.ts'
import type { ConnectorTeamStore } from './connector-team-store.ts'
import type { FlowStore } from './flow-store.ts'
import type { PublicationStore } from './publication-store.ts'
import type { RevisionStore } from './revision-store.ts'
import type { RunViewStore, StoredControlRun } from './run-view-store.ts'
import type { RunAdmission, TriggerOccurrenceInput } from './trigger-store.ts'
import type { VariableStore } from './variable-store.ts'

import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { decodeFlowRunCheckpoint } from '@oomol-lab/open-flow/scheduler'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { isolatedVmEngineDigest } from '../runtime/isolated-vm.ts'

type RunInputs = NonNullable<FlowRunOptions['inputs']>

export interface StoredRun {
  readonly bindingValues?: Readonly<Record<string, string>>
  readonly connectorTeamId?: string
  readonly content: string
  readonly engineContract: string
  readonly engineDigest: string
  readonly flowId: string
  readonly inputs: RunInputs
  readonly llmConfig?: LlmConfig
  readonly remainingMs?: number
  readonly resume?: { readonly action: WaitAction; readonly checkpoint: FlowRunCheckpoint }
  readonly resumeUnavailable?: true
  readonly revisionDigest: string
  readonly runId: string
  readonly source: StoredControlRun['source'] | null
  readonly trigger?: TriggerSeed
}

export interface RunStoreOptions {
  readonly maxPendingRuns: number
  readonly runEventRetentionMs: number
}

export interface RunStoreDependencies {
  readonly connectorTeams: ConnectorTeamStore
  readonly flows: FlowStore
  readonly publications: PublicationStore
  readonly revisions: RevisionStore
  readonly variables: VariableStore
  readonly views: RunViewStore
}

const encoder = new TextEncoder()
const maxEventBytes = 1024 * 1024
const maxEventCount = 1_000
const maxEventTotalBytes = 16 * 1024 * 1024
const waitDurationMs = 7 * 24 * 60 * 60 * 1_000

/**
 * The authoritative Run state machine: admission, execution transitions,
 * RunEvents, Wait resolution, and terminal recovery.
 */
export class RunStore {
  readonly #clock: () => number
  readonly #database: DatabaseSync
  readonly #deps: RunStoreDependencies
  readonly #maxPendingRuns: number
  readonly #runEventRetentionMs: number
  readonly #transaction: <Value>(operation: () => Value) => Value

  constructor(
    database: DatabaseSync,
    transaction: <Value>(operation: () => Value) => Value,
    clock: () => number,
    options: RunStoreOptions,
    deps: RunStoreDependencies,
  ) {
    if (!Number.isSafeInteger(options.maxPendingRuns) || options.maxPendingRuns <= 0) {
      throw new TypeError('Maximum pending Runs must be a positive safe integer.')
    }
    this.#clock = clock
    this.#database = database
    this.#deps = deps
    this.#maxPendingRuns = options.maxPendingRuns
    this.#runEventRetentionMs = options.runEventRetentionMs
    this.#transaction = transaction
    this.#backfillEventExpiry()
    this.#recoverRunning()
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
    readonly trigger: TriggerSeed
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
        .get(input.flowId, input.revisionId) as { readonly digest: string; readonly status: 'active' | 'retiring' } | undefined
      if (revision == null || revision.digest != input.revisionDigest) return { kind: 'not-found' }
      if (revision.status != 'active') return { kind: 'busy' }
      if (!this.#deps.variables.hasAll(input.variableNames)) return { kind: 'binding-unresolved' }
      if (!this.#hasRunCapacity()) return { kind: 'overloaded' }

      const runId = this.#queueRun({
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
    readonly trigger: TriggerSeed
    readonly variableNames: readonly string[]
  }): RunAdmission | { readonly kind: 'binding-unresolved' | 'busy' | 'live-conflict' | 'not-found' } {
    return this.#transaction(() => {
      const existing = this.#database
        .prepare('SELECT run_id AS runId, request_digest AS requestDigest, source, status FROM runs WHERE idempotency_key = ?')
        .get(input.idempotencyKey) as
        | { readonly requestDigest: string; readonly runId: string; readonly source: StoredRun['source']; readonly status: RunStatus }
        | undefined
      if (existing != null) {
        if (existing.requestDigest != input.requestDigest || existing.source != 'live') return { kind: 'conflict' }
        return { created: false, kind: 'accepted', runId: existing.runId, status: existing.status }
      }
      const flow = this.#deps.flows.get(input.flowId)
      if (flow == null) return { kind: 'not-found' }
      if (flow.status != 'active') return { kind: 'busy' }
      const target = this.#deps.publications.live(input.flowId)
      if (flow.liveEnabled != 1 || target == null || target.publication.publicationId != input.expectedPublicationId) return { kind: 'live-conflict' }
      const publication = target.publication
      if (
        publication.revisionId != input.revisionId ||
        publication.revisionDigest != input.revisionDigest ||
        publication.closureDigest != input.closureDigest ||
        publication.modelVersion != input.modelVersion
      ) {
        return { kind: 'live-conflict' }
      }
      if (!this.#deps.variables.hasAll(input.variableNames)) return { kind: 'binding-unresolved' }
      if (!this.#hasRunCapacity()) return { kind: 'overloaded' }

      const runId = this.#queueRun({
        ...input,
        publicationId: publication.publicationId,
        source: 'live',
      })
      return { created: true, kind: 'accepted', runId, status: 'queued' }
    })
  }

  /**
   * Admits one Run for a durable Trigger occurrence, at most once per occurrence.
   *
   * Trigger stores call this from inside their own admission transaction, so it
   * deliberately opens none: occurrence identity, checkpoint, and Run creation
   * must commit together.
   */
  acceptTriggerOccurrence(input: TriggerOccurrenceInput): RunAdmission {
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

    this.#deps.revisions.ensure(input)
    const runId = this.#queueRun({
      ...input,
      idempotencyKey: `trigger:${randomUUID()}`,
      inputs: {},
      trigger: { nodeId: input.triggerNodeId, payload: input.payload },
    })
    this.#database
      .prepare('INSERT INTO trigger_occurrences (occurrence_id, run_id, trigger_node_id, payload) VALUES (?, ?, ?, ?)')
      .run(input.occurrenceId, runId, input.triggerNodeId, JSON.stringify(input.payload))
    return { created: true, kind: 'accepted', runId, status: 'queued' }
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
                  runs.binding_values AS bindingValues, runs.llm_config AS llmConfig, runs.connector_team_id AS connectorTeamId, runs.flow_id AS flowId, runs.inputs,
                  runs.revision_digest AS revisionDigest, runs.run_id AS runId, runs.source,
                  run_waits.action AS waitAction, run_waits.checkpoint_json AS checkpointJson,
                  run_waits.remaining_ms AS remainingMs, run_waits.wait_id AS waitId,
                  runs.trigger_payload AS triggerPayload, runs.trigger_node_id AS triggerNodeId
           FROM runs JOIN revisions USING (revision_id)
           LEFT JOIN trigger_occurrences USING (run_id)
           LEFT JOIN run_waits USING (run_id)
           WHERE runs.run_id = ? AND runs.status = 'starting'`,
        )
        .get(claimed.runId) as {
        readonly bindingValues: string | null
        readonly checkpointBytes: number | null
        readonly checkpointDigest: string | null
        readonly checkpointJson: string | null
        readonly connectorTeamId: string | null
        readonly content: string
        readonly engineContract: string
        readonly engineDigest: string
        readonly flowId: string
        readonly inputs: string
        readonly llmConfig: string | null
        readonly remainingMs: number | null
        readonly revisionDigest: string
        readonly runId: string
        readonly source: StoredRun['source']
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
        ...(row.bindingValues == null ? {} : { bindingValues: JSON.parse(row.bindingValues) as Readonly<Record<string, string>> }),
        ...(row.llmConfig == null ? {} : { llmConfig: JSON.parse(row.llmConfig) as LlmConfig }),
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
        source: row.source,
        ...(row.triggerNodeId == null || row.triggerPayload == null
          ? {}
          : { trigger: { nodeId: row.triggerNodeId, payload: JSON.parse(row.triggerPayload) as JsonValue } }),
      }
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

  commit(runId: string, status: RunTerminalStatus, result: unknown): boolean {
    return this.#transaction(() => {
      const condition =
        status == 'canceled'
          ? "status IN ('queued', 'starting', 'running', 'waiting')"
          : status == 'failed'
            ? "status IN ('running', 'waiting')"
            : "status = 'running'"
      return this.#finishRun(runId, status, result, condition, this.#clock())
    })
  }

  cancel(runId: string): boolean {
    return this.commit(runId, 'canceled', { error: { code: 'run.canceled', message: 'Run canceled.' } })
  }

  failStarting(runId: string, result: unknown): boolean {
    return this.#transaction(() => this.#finishRun(runId, 'failed', result, "status = 'starting'", this.#clock()))
  }

  failResume(runId: string, result: unknown): boolean {
    return this.#transaction(() => this.#finishRun(runId, 'indeterminate', result, "status = 'starting'", this.#clock()))
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

  /** Persists a Wait pause: Scheduler checkpoint, fixed identity, and its notification work. */
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
             run_id, wait_id, node_id, job_id, waiting_since, expires_at,
             checkpoint_json, checkpoint_version, checkpoint_digest, checkpoint_bytes,
             remaining_ms, action, resolved_at, capability_digest
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 2, ?, ?, ?, NULL, NULL, ?)
           ON CONFLICT(run_id) DO UPDATE SET
             wait_id = excluded.wait_id, node_id = excluded.node_id, job_id = excluded.job_id,
             waiting_since = excluded.waiting_since,
             expires_at = excluded.expires_at, checkpoint_json = excluded.checkpoint_json,
             checkpoint_version = 2, checkpoint_digest = excluded.checkpoint_digest,
             checkpoint_bytes = excluded.checkpoint_bytes, remaining_ms = excluded.remaining_ms,
             action = NULL, resolved_at = NULL, capability_digest = excluded.capability_digest`,
        )
        .run(
          runId,
          outcome.wait.waitId,
          outcome.wait.nodeId,
          outcome.wait.jobId,
          waitingSince,
          expiresAt,
          checkpointJson,
          checkpointDigest,
          checkpointBytes,
          remainingMs,
          capabilityDigest,
        )
      this.#database
        .prepare(`INSERT INTO wait_receipts (
        run_id, wait_id, node_id, job_id, actions, prompt, value, waiting_since, expires_at, capability_digest
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          runId,
          outcome.wait.waitId,
          outcome.wait.nodeId,
          outcome.wait.jobId,
          JSON.stringify(outcome.wait.actions),
          outcome.wait.prompt,
          JSON.stringify(outcome.checkpoint.wait.value),
          waitingSince,
          expiresAt,
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

  /** Records the first resolution of a Wait and re-queues its Run. */
  resolveWait(
    runId: string,
    waitId: string,
    requested: WaitAction,
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
          `SELECT wait_receipts.action, wait_receipts.actions, wait_receipts.expires_at AS expiresAt,
                  wait_receipts.resolved_at AS resolvedAt, runs.status
           FROM wait_receipts JOIN runs USING (run_id)
           WHERE wait_receipts.run_id = ? AND wait_receipts.wait_id = ?`,
        )
        .get(runId, waitId) as
        | {
            readonly actions: string
            readonly action: WaitAction | null
            readonly expiresAt: number
            readonly resolvedAt: number | null
            readonly status: RunStatus
          }
        | undefined
      if (row == null) return { kind: 'not-found' as const }
      if (!(JSON.parse(row.actions) as readonly WaitAction[]).includes(requested)) return { kind: 'invalid-action' as const }
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
      if (row.status != 'waiting' || this.#deps.views.activeWait(runId)?.waitId != waitId) {
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
      this.#database.prepare('UPDATE wait_receipts SET action = ?, resolved_at = ? WHERE run_id = ? AND wait_id = ?').run(requested, resolvedAt, runId, waitId)
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

  cancelControlRun(runId: string): { readonly accepted: boolean; readonly run: StoredControlRun } | undefined {
    return this.#transaction(() => {
      const current = this.#database.prepare('SELECT status FROM runs WHERE run_id = ?').get(runId) as { readonly status: RunStatus } | undefined
      if (current == null) return
      if (current.status == 'canceled' || current.status == 'completed' || current.status == 'failed' || current.status == 'indeterminate') {
        return { accepted: false, run: this.#deps.views.controlRun(runId)! }
      }
      this.#finishRun(
        runId,
        'canceled',
        { error: { code: 'run.canceled', message: 'Run canceled.' } },
        "status IN ('queued', 'starting', 'running', 'waiting')",
        this.#clock(),
      )
      return { accepted: true, run: this.#deps.views.controlRun(runId)! }
    })
  }

  /** Cancels every live Run of a Flow so its retirement can proceed. */
  cancelByFlow(flowId: string, limit: number): readonly string[] {
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

  /** Deletes one batch of a retired Flow's Run data, including its events and Waits. */
  deleteByFlow(flowId: string, limit: number): number {
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
        this.#database.prepare('DELETE FROM wait_receipts WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM work WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM run_results WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM runs WHERE run_id = ?').run(runId)
      }
      return runs.length
    })
  }

  pruneExpiredEvents(now: number, limit: number): number {
    return Number(
      this.#database
        .prepare(
          `DELETE FROM events WHERE rowid IN (
             SELECT events.rowid FROM events JOIN runs USING (run_id)
             WHERE runs.events_expires_at IS NOT NULL AND runs.events_expires_at <= ?
             ORDER BY events.cursor LIMIT ?
           )`,
        )
        .run(now, limit).changes,
    )
  }

  claimWaitNotification(
    now: number,
    leaseDurationMs: number,
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
        .run(claimId, now + leaseDurationMs, now, row.runId, row.waitId, now, now)
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

  #queueRun(input: {
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
    readonly trigger: TriggerSeed
  }): string {
    const runId = randomUUID()
    const connectorTeamId = this.#deps.connectorTeams.get(input.flowId)
    const snapshot = this.#deps.revisions.agentSnapshot(input.revisionId, input.source == 'draft' ? input.trigger.nodeId : undefined)
    this.#database
      .prepare(
        `INSERT INTO runs (
           run_id, idempotency_key, request_digest, revision_id, revision_digest, flow_id,
           engine_contract, engine_digest, inputs, status, source, closure_digest,
           model_version, created_at, publication_id, connector_team_id, trigger_node_id, trigger_payload, llm_config, binding_values
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.trigger.nodeId,
        JSON.stringify(input.trigger.payload),
        JSON.stringify(snapshot?.model) ?? null,
        JSON.stringify(snapshot?.bindings) ?? null,
      )
    this.#database.prepare('INSERT INTO work (run_id) VALUES (?)').run(runId)
    const payload = {}
    this.#insertEvent(runId, 'run.queued', payload)
    const bytes = encoder.encode(JSON.stringify({ kind: 'run.queued', payload })).byteLength
    this.#database.prepare('UPDATE runs SET event_count = 1, event_bytes = ? WHERE run_id = ?').run(bytes, runId)
    return runId
  }

  #hasRunCapacity(): boolean {
    return this.#database.prepare('SELECT 1 FROM work LIMIT 1 OFFSET ?').get(this.#maxPendingRuns - 1) == null
  }

  #insertEvent(runId: string, kind: RunEventKind, payload: Readonly<Record<string, unknown>>, value?: unknown): void {
    const cursor = Number(
      (this.#database.prepare('SELECT COALESCE(MAX(cursor), 0) + 1 AS cursor FROM events WHERE run_id = ?').get(runId) as { cursor: number }).cursor,
    )
    this.#database
      .prepare('INSERT INTO events (run_id, cursor, kind, payload, value, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(runId, cursor, kind, JSON.stringify(payload), value === undefined ? null : JSON.stringify(value), this.#clock())
  }

  #finishRun(runId: string, status: RunTerminalStatus, result: unknown, condition: string, finishedAt: number, ...conditionParams: readonly string[]): boolean {
    const changed = this.#database
      .prepare(`UPDATE runs SET status = ?, result = ?, finished_at = ?, events_expires_at = ? WHERE run_id = ? AND ${condition}`)
      .run(status, JSON.stringify(result), finishedAt, finishedAt + this.#runEventRetentionMs, runId, ...conditionParams)
    if (changed.changes != 1) return false
    this.#database.prepare('UPDATE run_waits SET checkpoint_json = NULL WHERE run_id = ?').run(runId)
    this.#database.prepare('DELETE FROM wait_notifications WHERE run_id = ?').run(runId)
    this.#insertEvent(runId, `run.${status}`, { result })
    const bytes = encoder.encode(JSON.stringify({ kind: `run.${status}`, payload: { result } })).byteLength
    this.#database.prepare('UPDATE runs SET event_count = event_count + 1, event_bytes = event_bytes + ? WHERE run_id = ?').run(bytes, runId)
    this.#database.prepare('DELETE FROM work WHERE run_id = ?').run(runId)
    return true
  }

  #backfillEventExpiry(): void {
    this.#database
      .prepare(
        `UPDATE runs SET events_expires_at = ?
         WHERE events_expires_at IS NULL AND status IN ('canceled', 'completed', 'failed', 'indeterminate')`,
      )
      .run(this.#clock() + this.#runEventRetentionMs)
  }

  /** Ends Runs whose execution outcome the previous process could not confirm. */
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
          'status = ?',
          this.#clock(),
          row.status,
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
}
