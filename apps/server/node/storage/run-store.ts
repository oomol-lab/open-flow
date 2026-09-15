import type { RunEventKind } from '@oomol-lab/open-flow/control-api'
import type { JsonValue, WaitAction } from '@oomol-lab/open-flow/flow-change'
import type { ProjectedRunEvent } from '@oomol-lab/open-flow/run-events'
import type { RunStatus, RunTerminalStatus } from '@oomol-lab/open-flow/run-lifecycle'
import type { FlowRunCheckpoint, WaitRequest, FlowRunOptions, FlowRunOutcome, TriggerSeed } from '@oomol-lab/open-flow/scheduler'
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
  readonly resume?: { readonly checkpoint: FlowRunCheckpoint }
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
  readonly #waitListeners = new Map<string, Set<() => void>>()
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
                  run_checkpoints.checkpoint_json AS checkpointJson,
                  run_checkpoints.remaining_ms AS remainingMs, run_checkpoints.run_id AS checkpointRunId,
                  run_checkpoints.checkpoint_digest AS checkpointDigest, run_checkpoints.checkpoint_bytes AS checkpointBytes,
                  runs.trigger_payload AS triggerPayload, runs.trigger_node_id AS triggerNodeId
           FROM runs JOIN revisions USING (revision_id)
           LEFT JOIN trigger_occurrences USING (run_id)
           LEFT JOIN run_checkpoints USING (run_id)
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
        readonly checkpointRunId: string | null
      }
      let resumeUnavailable = row.checkpointRunId != null && !this.#checkpointValid(row.checkpointJson, row.checkpointDigest, row.checkpointBytes)
      let resume: StoredRun['resume']
      if (!resumeUnavailable && row.checkpointJson != null) {
        try {
          resume = { checkpoint: decodeFlowRunCheckpoint(JSON.parse(row.checkpointJson)) }
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
             AND NOT EXISTS (SELECT 1 FROM run_checkpoints WHERE run_checkpoints.run_id = runs.run_id)`,
        )
        .run(this.#clock(), runId)
      if (changed.changes != 1) return false
      const bytes = encoder.encode(JSON.stringify(event)).byteLength
      this.#insertEvent(runId, event.kind, event.payload, 'value' in event ? event.value : undefined)
      this.#database.prepare('UPDATE runs SET event_count = event_count + 1, event_bytes = event_bytes + ? WHERE run_id = ?').run(bytes, runId)
      return true
    })
  }

  resume(runId: string): boolean {
    return this.#transaction(() => {
      const changed = this.#database
        .prepare(`UPDATE runs SET status = 'running' WHERE run_id = ? AND status = 'starting'
        AND EXISTS (SELECT 1 FROM run_checkpoints WHERE run_checkpoints.run_id = runs.run_id AND checkpoint_json IS NOT NULL)`)
        .run(runId)
      if (changed.changes != 1) return false
      this.#database.prepare('UPDATE run_checkpoints SET checkpoint_json = NULL WHERE run_id = ?').run(runId)
      return true
    })
  }

  commit(runId: string, status: RunTerminalStatus, result: unknown): boolean {
    return this.#transaction(() => {
      const condition =
        status == 'canceled'
          ? "status IN ('queued', 'starting', 'running', 'waiting')"
          : status == 'failed'
            ? "status IN ('queued', 'starting', 'running', 'waiting')"
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

  createWait(
    runId: string,
    wait: WaitRequest,
    publicOrigin: string | undefined,
    notification?: {
      readonly action: string
      readonly connectionId?: string
      readonly input: Readonly<Record<string, JsonValue>>
      readonly messageHandle: string
      readonly taskId: string
    },
  ): JsonValue | undefined {
    return this.#transaction(() => {
      this.resolutions(runId, [])
      const previous = this.#database
        .prepare(
          'SELECT job_id AS jobId, node_id AS nodeId, value, prompt, actions, notification_output AS output FROM wait_receipts WHERE run_id = ? AND wait_id = ?',
        )
        .get(runId, wait.waitId) as { jobId: string; nodeId: string; value: string; prompt: string; actions: string; output: string | null } | undefined
      if (previous != null) {
        if (
          previous.jobId != wait.jobId ||
          previous.nodeId != wait.nodeId ||
          previous.value != JSON.stringify(wait.value) ||
          previous.prompt != wait.prompt ||
          previous.actions != JSON.stringify(wait.actions)
        )
          throw new Error('Wait identity changed.')
        return previous.output == null ? undefined : (JSON.parse(previous.output) as JsonValue)
      }
      const waitingSince = this.#clock()
      const expiresAt = waitingSince + waitDurationMs
      const needsLinks = wait.notify || notification != null
      if (needsLinks && publicOrigin == null) throw new Error('Wait action links require OPEN_FLOW_PUBLIC_ORIGIN.')
      const capability = needsLinks ? randomBytes(32).toString('base64url') : undefined
      const links =
        capability == null ? [] : wait.actions.map((action) => ({ action, url: new URL(`/v1/wait-actions/${capability}/${action}`, publicOrigin!).href }))
      const output: JsonValue | undefined = wait.notify
        ? { value: wait.value, prompt: wait.prompt, actions: links, expiresAt: new Date(expiresAt).toISOString() }
        : undefined
      this.#database
        .prepare(
          `INSERT INTO wait_receipts (run_id, wait_id, node_id, job_id, actions, prompt, value, waiting_since, expires_at, capability_digest, notification_output) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          runId,
          wait.waitId,
          wait.nodeId,
          wait.jobId,
          JSON.stringify(wait.actions),
          wait.prompt,
          JSON.stringify(wait.value),
          waitingSince,
          expiresAt,
          capability == null ? null : createHash('sha256').update(capability).digest('hex'),
          output == null ? null : JSON.stringify(output),
        )
      if (notification != null) {
        const message = [wait.prompt, `Expires at: ${new Date(expiresAt).toISOString()}`, ...links.map(({ action, url }) => `${action}: ${url}`)].join('\n')
        this.#database
          .prepare(
            `INSERT INTO wait_notifications (run_id, wait_id, invocation_id, action, connection_id, task_id, input_json, status, attempts, retry_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
          )
          .run(
            runId,
            wait.waitId,
            `wait:${runId}:${wait.waitId}`,
            notification.action,
            notification.connectionId ?? null,
            notification.taskId,
            JSON.stringify({ ...notification.input, [notification.messageHandle]: message }),
            waitingSince,
            waitingSince,
            waitingSince,
          )
      }
      const payload = {
        nodeId: wait.nodeId,
        waitId: wait.waitId,
        waitingSince: new Date(waitingSince).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
      }
      this.#insertEvent(runId, 'wait.created', payload)
      const bytes = encoder.encode(JSON.stringify({ kind: 'wait.created', payload })).byteLength
      this.#database.prepare('UPDATE runs SET event_count = event_count + 1, event_bytes = event_bytes + ? WHERE run_id = ?').run(bytes, runId)
      return output
    })
  }

  resolutions(runId: string, waitIds: readonly string[]): Readonly<Record<string, WaitAction>> {
    const run = this.#database.prepare('SELECT status FROM runs WHERE run_id = ?').get(runId) as { status: RunStatus } | undefined
    if (run?.status != 'running') throw new Error('Run execution is no longer active.')
    const results: Record<string, WaitAction> = {}
    for (const waitId of waitIds) {
      const row = this.#database.prepare('SELECT action FROM wait_receipts WHERE run_id = ? AND wait_id = ?').get(runId, waitId) as
        | { action: WaitAction | null }
        | undefined
      if (row == null) throw new Error('Waiting node is not registered.')
      if (row.action != null) results[waitId] = row.action
    }
    return results
  }

  waitForResolutions(runId: string, waitIds: readonly string[], signal: AbortSignal): Promise<Readonly<Record<string, WaitAction>>> {
    return new Promise((resolve, reject) => {
      const listeners = this.#waitListeners.get(runId) ?? new Set<() => void>()
      this.#waitListeners.set(runId, listeners)
      let poll: ReturnType<typeof setInterval> | undefined
      const cleanup = () => {
        clearInterval(poll)
        listeners.delete(check)
        if (listeners.size == 0) this.#waitListeners.delete(runId)
        signal.removeEventListener('abort', abort)
      }
      const check = () => {
        try {
          const values = this.resolutions(runId, waitIds)
          if (Object.keys(values).length > 0) {
            cleanup()
            resolve(values)
          }
        } catch (error) {
          cleanup()
          reject(error)
        }
      }
      const abort = () => {
        cleanup()
        reject(signal.reason)
      }
      listeners.add(check)
      signal.addEventListener('abort', abort, { once: true })
      poll = setInterval(check, 1000)
      if (signal.aborted) abort()
      else check()
    })
  }

  wait(runId: string, outcome: Extract<FlowRunOutcome, { readonly kind: 'waiting' }>, remainingMs: number): boolean {
    return this.#transaction(() => {
      this.resolutions(
        runId,
        outcome.checkpoint.waits.map((wait) => wait.waitId),
      )
      for (const wait of outcome.checkpoint.waits) {
        const row = this.#database
          .prepare('SELECT node_id AS nodeId, job_id AS jobId, value, notification_output AS output FROM wait_receipts WHERE run_id = ? AND wait_id = ?')
          .get(runId, wait.waitId) as { nodeId: string; jobId: string; value: string; output: string | null }
        if (
          row.nodeId != wait.nodeId ||
          row.jobId != wait.jobId ||
          row.value != JSON.stringify(wait.value) ||
          row.output != (wait.notification == null ? null : JSON.stringify(wait.notification))
        )
          throw new Error('Wait checkpoint changed registered values.')
      }
      const unresolved = this.#database.prepare('SELECT wait_id AS waitId FROM wait_receipts WHERE run_id = ? AND action IS NULL').all(runId) as {
        waitId: string
      }[]
      const savedWaits = new Set(outcome.checkpoint.waits.map((wait) => wait.waitId))
      if (unresolved.some((wait) => !savedWaits.has(wait.waitId))) throw new Error('Checkpoint omits an unresolved Wait.')
      const source = JSON.stringify(decodeFlowRunCheckpoint(outcome.checkpoint))
      const bytes = encoder.encode(source).byteLength
      if (bytes > 16 * 1024 * 1024) throw new Error('Flow Run checkpoint exceeds 16 MiB.')
      const resolved = this.resolutions(
        runId,
        outcome.checkpoint.waits.map((wait) => wait.waitId),
      )
      const status = Object.keys(resolved).length > 0 ? 'queued' : 'waiting'
      this.#database
        .prepare(
          `INSERT INTO run_checkpoints (run_id, checkpoint_json, checkpoint_digest, checkpoint_bytes, remaining_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET checkpoint_json = excluded.checkpoint_json, checkpoint_digest = excluded.checkpoint_digest, checkpoint_bytes = excluded.checkpoint_bytes, remaining_ms = excluded.remaining_ms`,
        )
        .run(runId, source, `sha256:${createHash('sha256').update(source).digest('hex')}`, bytes, remainingMs)
      this.#database.prepare("UPDATE runs SET status = ? WHERE run_id = ? AND status = 'running'").run(status, runId)
      const payload = { waitIds: outcome.checkpoint.waits.map((wait) => wait.waitId) }
      this.#insertEvent(runId, 'run.waiting', payload)
      const eventBytes = encoder.encode(JSON.stringify({ kind: 'run.waiting', payload })).byteLength
      this.#database.prepare('UPDATE runs SET event_count = event_count + 1, event_bytes = event_bytes + ? WHERE run_id = ?').run(eventBytes, runId)
      return true
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
      if (!['running', 'waiting', 'queued', 'starting'].includes(row.status)) {
        return { action: null, changed: false, kind: 'resolved' as const, resolutionAccepted: false, resolvedAt: null, status: row.status }
      }
      const resolvedAt = this.#clock()
      if (resolvedAt >= row.expiresAt) {
        this.#finishRun(
          runId,
          'failed',
          { error: { code: 'run.wait-expired', message: 'The Wait expired before it was resolved.' } },
          "status IN ('running', 'waiting', 'queued', 'starting')",
          resolvedAt,
        )
        return { action: null, changed: true, kind: 'resolved' as const, resolutionAccepted: false, resolvedAt: null, status: 'failed' as const }
      }
      this.#database.prepare("UPDATE runs SET status = 'queued' WHERE run_id = ? AND status = 'waiting'").run(runId)
      this.#database.prepare('UPDATE wait_receipts SET action = ?, resolved_at = ? WHERE run_id = ? AND wait_id = ?').run(requested, resolvedAt, runId, waitId)
      this.#database.prepare('DELETE FROM wait_notifications WHERE run_id = ? AND wait_id = ?').run(runId, waitId)
      for (const listener of this.#waitListeners.get(runId) ?? []) listener()
      const payload = { action: requested, resolvedAt: new Date(resolvedAt).toISOString(), waitId }
      this.#insertEvent(runId, 'run.resolved', payload)
      const bytes = encoder.encode(JSON.stringify({ kind: 'run.resolved', payload })).byteLength
      this.#database.prepare('UPDATE runs SET event_count = event_count + 1, event_bytes = event_bytes + ? WHERE run_id = ?').run(bytes, runId)
      return {
        action: requested,
        changed: true,
        kind: 'resolved' as const,
        resolutionAccepted: true,
        resolvedAt,
        status: row.status == 'waiting' ? ('queued' as const) : row.status,
      }
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
        this.#database.prepare('DELETE FROM run_checkpoints WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM wait_receipts WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM work WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM run_results WHERE run_id = ?').run(runId)
        this.#database.prepare('DELETE FROM runs WHERE run_id = ?').run(runId)
      }
      return runs.length
    })
  }

  nextMaintenanceAt(): number | undefined {
    const row = this.#database
      .prepare(
        `SELECT MIN(dueAt) AS dueAt FROM (
           SELECT MIN(wait_receipts.expires_at) AS dueAt
           FROM wait_receipts JOIN runs USING (run_id)
           WHERE runs.status IN ('running', 'waiting', 'queued', 'starting') AND wait_receipts.action IS NULL
           UNION ALL
           SELECT MIN(MAX(wait_notifications.retry_at, COALESCE(wait_notifications.claim_expires_at, wait_notifications.retry_at))) AS dueAt
           FROM wait_notifications JOIN runs USING (run_id) JOIN wait_receipts USING (run_id)
           WHERE wait_notifications.status = 'pending'
             AND runs.status IN ('running', 'waiting', 'queued', 'starting') AND wait_receipts.action IS NULL
             AND wait_receipts.wait_id = wait_notifications.wait_id
         )`,
      )
      .get() as { readonly dueAt: number | null }
    return row.dueAt ?? undefined
  }

  maintain(now: number, limit: number, notificationLeaseMs: number) {
    return this.#transaction(() => {
      const expiredWaits = this.#expireWaits(now, limit)
      const prunedEvents = this.#pruneExpiredEvents(now, limit)
      const notification = this.#claimWaitNotification(now, notificationLeaseMs)
      return { expiredWaits, more: expiredWaits.length == limit || prunedEvents > 0, notification }
    })
  }

  #expireWaits(now: number, limit: number): readonly { readonly flowId: string; readonly runId: string }[] {
    const due = this.#database
      .prepare(
        `SELECT DISTINCT runs.flow_id AS flowId, runs.run_id AS runId
         FROM runs JOIN wait_receipts USING (run_id)
         WHERE runs.status IN ('running', 'waiting', 'queued', 'starting') AND wait_receipts.action IS NULL AND wait_receipts.expires_at <= ?
         ORDER BY wait_receipts.expires_at, runs.run_id LIMIT ?`,
      )
      .all(now, limit) as unknown as readonly { readonly flowId: string; readonly runId: string }[]
    for (const { runId } of due) {
      this.#finishRun(
        runId,
        'failed',
        { error: { code: 'run.wait-expired', message: 'The Wait expired before it was resolved.' } },
        "status IN ('running', 'waiting', 'queued', 'starting')",
        now,
      )
    }
    return due
  }

  #pruneExpiredEvents(now: number, limit: number): number {
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

  #claimWaitNotification(
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
    this.#database
      .prepare(
        `DELETE FROM wait_notifications
         WHERE status = 'pending' AND NOT EXISTS (
           SELECT 1 FROM runs JOIN wait_receipts USING (run_id)
           WHERE runs.run_id = wait_notifications.run_id
             AND runs.status IN ('running', 'waiting', 'queued', 'starting') AND wait_receipts.action IS NULL
             AND wait_receipts.wait_id = wait_notifications.wait_id
             AND wait_receipts.expires_at > ?
         )`,
      )
      .run(now)
    const row = this.#database
      .prepare(
        `SELECT wait_notifications.action, wait_notifications.connection_id AS connectionId,
                wait_notifications.input_json AS inputJson, wait_notifications.invocation_id AS invocationId,
                wait_notifications.run_id AS runId, runs.connector_team_id AS teamId,
                wait_notifications.wait_id AS waitId
         FROM wait_notifications JOIN runs USING (run_id) JOIN wait_receipts USING (run_id)
         WHERE wait_notifications.status = 'pending'
           AND wait_notifications.retry_at <= ?
           AND (wait_notifications.claim_id IS NULL OR wait_notifications.claim_expires_at <= ?)
           AND runs.status IN ('running', 'waiting', 'queued', 'starting') AND wait_receipts.action IS NULL
           AND wait_receipts.wait_id = wait_notifications.wait_id
           AND wait_receipts.expires_at > ?
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
    this.#database.prepare('UPDATE run_checkpoints SET checkpoint_json = NULL WHERE run_id = ?').run(runId)
    this.#database.prepare('DELETE FROM wait_notifications WHERE run_id = ?').run(runId)
    this.#insertEvent(runId, `run.${status}`, { result })
    const bytes = encoder.encode(JSON.stringify({ kind: `run.${status}`, payload: { result } })).byteLength
    this.#database.prepare('UPDATE runs SET event_count = event_count + 1, event_bytes = event_bytes + ? WHERE run_id = ?').run(bytes, runId)
    this.#database.prepare('DELETE FROM work WHERE run_id = ?').run(runId)
    for (const listener of this.#waitListeners.get(runId) ?? []) listener()
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
    const paused = this.#database
      .prepare(
        `SELECT runs.run_id AS runId, runs.status, c.checkpoint_json AS source, c.checkpoint_digest AS digest, c.checkpoint_bytes AS bytes FROM runs LEFT JOIN run_checkpoints c USING (run_id) WHERE runs.status = 'waiting' OR (runs.status IN ('queued', 'starting') AND c.run_id IS NOT NULL)`,
      )
      .all() as { runId: string; status: RunStatus; source: string | null; digest: string | null; bytes: number | null }[]
    for (const row of paused) {
      if (this.#checkpointValid(row.source, row.digest, row.bytes)) continue
      this.#transaction(() =>
        this.#finishRun(
          row.runId,
          'indeterminate',
          { error: { code: 'execution.resume-unavailable', message: 'The stored checkpoint is unavailable or uses an old Engine.' } },
          'status = ?',
          this.#clock(),
          row.status,
        ),
      )
    }
    this.#expireWaits(this.#clock(), Number.MAX_SAFE_INTEGER)
  }

  #checkpointValid(source: string | null, digest: string | null, bytes: number | null): boolean {
    if (source == null || digest == null || bytes == null || encoder.encode(source).byteLength != bytes) return false
    if (`sha256:${createHash('sha256').update(source).digest('hex')}` != digest) return false
    try {
      decodeFlowRunCheckpoint(JSON.parse(source))
      return true
    } catch {
      return false
    }
  }
}
