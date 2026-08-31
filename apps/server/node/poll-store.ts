import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { RunAcceptance } from '@oomol-lab/open-flow/run-lifecycle'
import type { DatabaseSync } from 'node:sqlite'
import type {
  PollClaim,
  PollCompletion,
  PollHealth,
  PollState,
  RunAdmission,
  StoredPollTarget,
  StoredPollTestTarget,
  TriggerOccurrenceInput,
} from './trigger-store.ts'

import { randomUUID } from 'node:crypto'
import { insertTriggerActivity, pruneTriggerActivities } from './trigger-activity.ts'

export interface PollCandidate {
  readonly bindingId: string
  readonly checkpointJson: string
  readonly connectionId: string
  readonly flowId: string
  readonly nodeId: string
  readonly operationId: string
  readonly scheduleJson: string
  readonly status: 'preparing' | 'ready'
  readonly triggerJson: string
}

export class PollStore {
  readonly #acceptTriggerOccurrence: (input: TriggerOccurrenceInput) => RunAdmission
  readonly #database: DatabaseSync
  readonly #transaction: <Value>(operation: () => Value) => Value

  constructor(
    database: DatabaseSync,
    transaction: <Value>(operation: () => Value) => Value,
    acceptTriggerOccurrence: (input: TriggerOccurrenceInput) => RunAdmission,
  ) {
    this.#acceptTriggerOccurrence = acceptTriggerOccurrence
    this.#database = database
    this.#transaction = transaction
  }

  createCandidates(
    operationId: string,
    flowId: string,
    expectedLivePublicationId: string | null,
    polls: readonly {
      readonly connectionId: string
      readonly scheduleJson: string
      readonly triggerJson: string
      readonly triggerNodeId: string
    }[],
    now: number,
  ): void {
    for (const poll of polls) {
      const current = this.#database
        .prepare(
          `SELECT binding_id AS bindingId, current_publication_id AS currentPublicationId,
                  trigger_json AS triggerJson, connection_id AS connectionId, health
           FROM poll_bindings WHERE flow_id = ? AND trigger_node_id = ?`,
        )
        .get(flowId, poll.triggerNodeId) as
        | {
            readonly bindingId: string
            readonly connectionId: string | null
            readonly currentPublicationId: string | null
            readonly health: PollHealth
            readonly triggerJson: string | null
          }
        | undefined
      if (
        current != null &&
        current.currentPublicationId == expectedLivePublicationId &&
        current.triggerJson == poll.triggerJson &&
        current.connectionId == poll.connectionId &&
        current.health == 'healthy'
      ) {
        continue
      }
      const bindingId = current?.bindingId ?? `binding_${randomUUID().replaceAll('-', '')}`
      this.#database
        .prepare(
          `INSERT INTO poll_candidates (
             operation_id, node_id, binding_id, flow_id, trigger_json, connection_id,
             schedule_json, checkpoint_json, status, next_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'null', 'preparing', ?, ?, ?)`,
        )
        .run(operationId, poll.triggerNodeId, bindingId, flowId, poll.triggerJson, poll.connectionId, poll.scheduleJson, now, now, now)
      this.#database
        .prepare(
          `INSERT INTO publish_work (
             work_id, operation_id, node_id, action, status, next_at, created_at, updated_at
           ) VALUES (?, ?, ?, 'poll.baseline', 'pending', ?, ?, ?)`,
        )
        .run(`work_${randomUUID().replaceAll('-', '')}`, operationId, poll.triggerNodeId, now, now, now)
    }
  }

  dueCandidates(now: number, limit: number): readonly PollCandidate[] {
    return this.#transaction(() => {
      this.#database
        .prepare(
          `UPDATE publish_work
           SET status = 'failed', next_at = NULL,
               issue_code = 'publication.deadline-exceeded',
               issue_message = 'The Publish operation exceeded its preparation deadline.',
               updated_at = ?
           WHERE action = 'poll.baseline' AND status = 'pending' AND operation_id IN (
             SELECT operation_id FROM publish_operations WHERE status = 'pending' AND deadline_at <= ?
           )`,
        )
        .run(now, now)
      this.#database
        .prepare(
          `DELETE FROM poll_candidates
           WHERE operation_id IN (
             SELECT operation_id FROM publish_operations WHERE status != 'pending' OR deadline_at <= ?
           )`,
        )
        .run(now)
      return this.#database
        .prepare(
          `SELECT binding_id AS bindingId, checkpoint_json AS checkpointJson,
                  connection_id AS connectionId, flow_id AS flowId, node_id AS nodeId,
                  operation_id AS operationId, schedule_json AS scheduleJson, status,
                  trigger_json AS triggerJson
           FROM poll_candidates
           WHERE status = 'preparing' AND next_at <= ?
           ORDER BY next_at, operation_id, node_id
           LIMIT ?`,
        )
        .all(now, limit) as unknown as readonly PollCandidate[]
    })
  }

  candidate(operationId: string, nodeId: string): PollCandidate | undefined {
    return this.#database
      .prepare(
        `SELECT binding_id AS bindingId, checkpoint_json AS checkpointJson,
                connection_id AS connectionId, flow_id AS flowId, node_id AS nodeId,
                operation_id AS operationId, schedule_json AS scheduleJson, status,
                trigger_json AS triggerJson
         FROM poll_candidates WHERE operation_id = ? AND node_id = ?`,
      )
      .get(operationId, nodeId) as PollCandidate | undefined
  }

  retryCandidate(candidate: PollCandidate, nextAt: number, now: number): void {
    this.#database
      .prepare(
        `UPDATE poll_candidates SET next_at = ?, updated_at = ?
         WHERE operation_id = ? AND node_id = ? AND status = 'preparing'`,
      )
      .run(nextAt, now, candidate.operationId, candidate.nodeId)
  }

  completeCandidate(candidate: PollCandidate, checkpointJson: string, hasMore: boolean, now: number): boolean {
    return this.#transaction(() => {
      if (hasMore) {
        return (
          this.#database
            .prepare(
              `UPDATE poll_candidates SET checkpoint_json = ?, next_at = ?, updated_at = ?
               WHERE operation_id = ? AND node_id = ? AND status = 'preparing' AND checkpoint_json = ?
                 AND EXISTS (
                   SELECT 1 FROM publish_operations
                   WHERE operation_id = ? AND status = 'pending' AND deadline_at > ?
                 )`,
            )
            .run(checkpointJson, now, now, candidate.operationId, candidate.nodeId, candidate.checkpointJson, candidate.operationId, now).changes == 1
        )
      }
      const changed = this.#database
        .prepare(
          `UPDATE poll_candidates SET checkpoint_json = ?, status = 'ready', next_at = NULL, updated_at = ?
           WHERE operation_id = ? AND node_id = ? AND status = 'preparing' AND checkpoint_json = ?
             AND EXISTS (
               SELECT 1 FROM publish_operations
               WHERE operation_id = ? AND status = 'pending' AND deadline_at > ?
             )`,
        )
        .run(checkpointJson, now, candidate.operationId, candidate.nodeId, candidate.checkpointJson, candidate.operationId, now).changes
      if (changed != 1) return false
      this.#database
        .prepare(
          `UPDATE publish_work SET status = 'ready', next_at = NULL, updated_at = ?
           WHERE operation_id = ? AND node_id = ? AND action = 'poll.baseline' AND status = 'pending'`,
        )
        .run(now, candidate.operationId, candidate.nodeId)
      return true
    })
  }

  failCandidate(candidate: PollCandidate, code: string, message: string, now: number): void {
    this.#transaction(() => {
      this.#database
        .prepare(
          `UPDATE publish_work
           SET status = 'failed', next_at = NULL, issue_code = ?, issue_message = ?, updated_at = ?
           WHERE operation_id = ? AND node_id = ? AND action = 'poll.baseline' AND status = 'pending'`,
        )
        .run(code, message.slice(0, 512), now, candidate.operationId, candidate.nodeId)
      this.#database.prepare('DELETE FROM poll_candidates WHERE operation_id = ? AND node_id = ?').run(candidate.operationId, candidate.nodeId)
    })
  }

  cleanupCandidates(operationId: string): void {
    this.#database.prepare('DELETE FROM poll_candidates WHERE operation_id = ?').run(operationId)
  }

  candidatesReady(
    operationId: string,
    flowId: string,
    expectedLivePublicationId: string | null,
    polls: readonly { readonly connectionId: string; readonly triggerJson: string; readonly triggerNodeId: string }[],
  ): boolean {
    for (const poll of polls) {
      const current = this.#database
        .prepare(
          `SELECT current_publication_id AS currentPublicationId, trigger_json AS triggerJson,
                  connection_id AS connectionId, health
           FROM poll_bindings WHERE flow_id = ? AND trigger_node_id = ?`,
        )
        .get(flowId, poll.triggerNodeId) as
        | {
            readonly connectionId: string | null
            readonly currentPublicationId: string | null
            readonly health: PollHealth
            readonly triggerJson: string | null
          }
        | undefined
      if (
        current != null &&
        current.currentPublicationId == expectedLivePublicationId &&
        current.triggerJson == poll.triggerJson &&
        current.connectionId == poll.connectionId &&
        current.health == 'healthy'
      ) {
        continue
      }
      const candidate = this.candidate(operationId, poll.triggerNodeId)
      if (
        candidate?.status != 'ready' ||
        candidate.flowId != flowId ||
        candidate.triggerJson != poll.triggerJson ||
        candidate.connectionId != poll.connectionId
      ) {
        return false
      }
    }
    return true
  }

  activateCandidate(
    operationId: string,
    flowId: string,
    publicationId: string,
    poll: {
      readonly connectionId: string
      readonly nextAt: number
      readonly scheduleJson: string
      readonly triggerJson: string
      readonly triggerNodeId: string
    },
    now: number,
  ): boolean {
    const candidate = this.candidate(operationId, poll.triggerNodeId)
    if (
      candidate?.status != 'ready' ||
      candidate.flowId != flowId ||
      candidate.triggerJson != poll.triggerJson ||
      candidate.connectionId != poll.connectionId ||
      candidate.scheduleJson != poll.scheduleJson
    ) {
      return false
    }
    const current = this.#database
      .prepare('SELECT binding_id AS bindingId FROM poll_bindings WHERE flow_id = ? AND trigger_node_id = ?')
      .get(flowId, poll.triggerNodeId) as { readonly bindingId: string } | undefined
    if (current == null) {
      this.#database
        .prepare(
          `INSERT INTO poll_bindings (
             binding_id, flow_id, trigger_node_id, current_publication_id,
             runtime_version, trigger_json, connection_id, schedule_json,
             next_at, health, checkpoint_json, updated_at
           ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 'healthy', ?, ?)`,
        )
        .run(
          candidate.bindingId,
          flowId,
          poll.triggerNodeId,
          publicationId,
          poll.triggerJson,
          poll.connectionId,
          poll.scheduleJson,
          poll.nextAt,
          candidate.checkpointJson,
          now,
        )
    } else {
      if (current.bindingId != candidate.bindingId) return false
      this.#database
        .prepare(
          `UPDATE poll_bindings
           SET current_publication_id = ?, runtime_version = runtime_version + 1,
               trigger_json = ?, connection_id = ?, schedule_json = ?, next_at = ?, retry_at = NULL,
               health = 'healthy', checkpoint_json = ?, continuation_root_id = NULL, continuation_page = 0,
               active_claim_id = NULL, active_lease_token = NULL, active_lease_expires_at = NULL,
               last_error_code = NULL, updated_at = ?
           WHERE binding_id = ?`,
        )
        .run(publicationId, poll.triggerJson, poll.connectionId, poll.scheduleJson, poll.nextAt, candidate.checkpointJson, now, candidate.bindingId)
    }
    this.#database.prepare('DELETE FROM poll_candidates WHERE operation_id = ? AND node_id = ?').run(operationId, poll.triggerNodeId)
    return true
  }

  claimPoll(target: StoredPollTarget, claimId: string, now: number, leaseExpiresAt: number): PollClaim {
    return this.#transaction(() => {
      const completed = this.#database.prepare('SELECT 1 FROM poll_claims WHERE binding_id = ? AND claim_id = ?').get(target.bindingId, claimId)
      if (completed != null) return { kind: 'completed' }
      const leaseToken = randomUUID()
      const changed = this.#database
        .prepare(
          `UPDATE poll_bindings
           SET active_claim_id = ?, active_lease_token = ?, active_lease_expires_at = ?
           WHERE binding_id = ?
             AND runtime_version = ?
             AND current_publication_id = ?
             AND trigger_json = ?
             AND connection_id = ?
             AND schedule_json = ?
             AND next_at = ?
             AND health IN ('healthy', 'initializing')
             AND operator_state = 'active'
             AND ((? IS NULL AND continuation_root_id IS NULL AND continuation_page = 0)
               OR (continuation_root_id = ? AND continuation_page = ?))
             AND (active_claim_id IS NULL OR active_lease_expires_at <= ?)
             AND EXISTS (
               SELECT 1 FROM flow_live
               WHERE flow_id = poll_bindings.flow_id
                 AND publication_id = poll_bindings.current_publication_id
             )`,
        )
        .run(
          claimId,
          leaseToken,
          leaseExpiresAt,
          target.bindingId,
          target.runtimeVersion,
          target.publicationId,
          target.triggerJson,
          target.connectionId,
          target.scheduleJson,
          target.nextAt,
          target.continuationRootId,
          target.continuationRootId,
          target.continuationPage,
          now,
        )
      if (changed.changes == 1) return { kind: 'acquired', leaseToken }
      if (this.#database.prepare('SELECT 1 FROM poll_claims WHERE binding_id = ? AND claim_id = ?').get(target.bindingId, claimId) != null) {
        return { kind: 'completed' }
      }
      const active = this.#database
        .prepare('SELECT active_lease_expires_at AS leaseExpiresAt FROM poll_bindings WHERE binding_id = ? AND runtime_version = ?')
        .get(target.bindingId, target.runtimeVersion) as { readonly leaseExpiresAt: number | null } | undefined
      return active?.leaseExpiresAt != null && active.leaseExpiresAt > now ? { kind: 'busy' } : { kind: 'unavailable' }
    })
  }

  completePollPage(input: {
    readonly activate: boolean
    readonly checkpointJson: string
    readonly claimExpiresAt: number
    readonly claimId: string
    readonly completedAt: number
    readonly leaseToken: string
    readonly nextAt: number
    readonly nextContinuationPage: number
    readonly nextContinuationRootId: string | null
    readonly page: number
    readonly payload: JsonValue | null
    readonly providerEventIds: readonly string[]
    readonly requestDigest: string | null
    readonly rootOccurrenceId: string
    readonly target: StoredPollTarget
  }): PollCompletion {
    return this.#transaction(() => {
      const current = this.#database
        .prepare(
          `SELECT bindings.last_error_code AS lastErrorCode
           FROM poll_bindings AS bindings
           JOIN flow_live
             ON flow_live.flow_id = bindings.flow_id
            AND flow_live.publication_id = bindings.current_publication_id
           JOIN publications
             ON publications.publication_id = bindings.current_publication_id
           WHERE bindings.binding_id = ?
             AND bindings.runtime_version = ?
             AND bindings.current_publication_id = ?
             AND bindings.trigger_json = ?
             AND bindings.connection_id = ?
             AND bindings.schedule_json = ?
             AND bindings.next_at = ?
             AND bindings.health IN ('healthy', 'initializing')
             AND bindings.operator_state = 'active'
             AND bindings.active_claim_id = ?
             AND bindings.active_lease_token = ?
             AND publications.revision_id = ?
             AND publications.revision_digest = ?
             AND publications.closure_digest = ?
             AND publications.engine_contract = ?
             AND publications.model_version = ?`,
        )
        .get(
          input.target.bindingId,
          input.target.runtimeVersion,
          input.target.publicationId,
          input.target.triggerJson,
          input.target.connectionId,
          input.target.scheduleJson,
          input.target.nextAt,
          input.claimId,
          input.leaseToken,
          input.target.revisionId,
          input.target.revisionDigest,
          input.target.closureDigest,
          input.target.engineContract,
          input.target.modelVersion,
        ) as { readonly lastErrorCode: string | null } | undefined
      if (current == null) return { kind: 'ignored' }

      let accepted: RunAcceptance | undefined
      if (input.payload != null && input.requestDigest != null) {
        const admission = this.#acceptTriggerOccurrence({
          content: input.target.content,
          closureDigest: input.target.closureDigest,
          flowId: input.target.flowId,
          modelVersion: input.target.modelVersion,
          occurrenceId: input.claimId,
          payload: input.payload,
          publicationId: input.target.publicationId,
          requestDigest: input.requestDigest,
          revisionDigest: input.target.revisionDigest,
          revisionId: input.target.revisionId,
          source: 'trigger',
          triggerNodeId: input.target.triggerNodeId,
        })
        if (admission.kind == 'overloaded') return admission
        accepted = admission
        if (accepted.kind == 'conflict') throw new Error('Poll page identity already refers to a different invocation.')
        if (accepted.created) {
          this.#database
            .prepare(
              `INSERT INTO poll_admissions (
                 run_id, binding_id, runtime_version, publication_id, root_occurrence_id, page
               ) VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .run(accepted.runId, input.target.bindingId, input.target.runtimeVersion, input.target.publicationId, input.rootOccurrenceId, input.page)
          for (const providerEventId of input.providerEventIds) {
            this.#database
              .prepare(
                `INSERT INTO poll_event_dedupe (
                   binding_id, provider_event_id, run_id, created_at, expires_at
                 ) VALUES (?, ?, ?, ?, ?)`,
              )
              .run(input.target.bindingId, providerEventId, accepted.runId, input.completedAt, input.claimExpiresAt)
          }
        }
      } else if (input.payload != null || input.requestDigest != null || input.providerEventIds.length != 0) {
        throw new TypeError('Poll page Run input is incomplete.')
      }

      this.#database
        .prepare(
          `INSERT INTO poll_claims (
             binding_id, claim_id, root_occurrence_id, page, runtime_version, run_id, completed_at, expires_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.target.bindingId,
          input.claimId,
          input.rootOccurrenceId,
          input.page,
          input.target.runtimeVersion,
          accepted?.kind == 'accepted' ? accepted.runId : null,
          input.completedAt,
          input.claimExpiresAt,
        )
      this.#database
        .prepare(
          `UPDATE poll_bindings
           SET checkpoint_json = ?, continuation_root_id = ?, continuation_page = ?,
               active_claim_id = NULL, active_lease_token = NULL, active_lease_expires_at = NULL,
               retry_at = NULL, next_at = ?,
               health = CASE WHEN ? = 1 THEN 'healthy' ELSE health END,
               last_error_code = CASE WHEN ? = 1 THEN NULL ELSE last_error_code END,
               updated_at = CASE WHEN ? = 1 THEN ? ELSE updated_at END
           WHERE binding_id = ? AND runtime_version = ? AND active_claim_id = ? AND active_lease_token = ?`,
        )
        .run(
          input.checkpointJson,
          input.nextContinuationRootId,
          input.nextContinuationPage,
          input.nextAt,
          input.activate ? 1 : 0,
          input.activate ? 1 : 0,
          input.activate ? 1 : 0,
          input.completedAt,
          input.target.bindingId,
          input.target.runtimeVersion,
          input.claimId,
          input.leaseToken,
        )
      if (input.activate && current.lastErrorCode != null) {
        insertTriggerActivity(this.#database, input.target.bindingId, 'health.recovered', input.completedAt)
        pruneTriggerActivities(this.#database, input.completedAt, 100)
      }
      return { ...(accepted == null ? {} : { accepted }), kind: 'completed' }
    })
  }

  duePoll(now: number, limit: number): readonly StoredPollTarget[] {
    return this.#pollTargets(
      `AND COALESCE(bindings.retry_at, bindings.next_at) <= ?
       AND (bindings.active_claim_id IS NULL OR bindings.active_lease_expires_at <= ?)
       ORDER BY COALESCE(bindings.retry_at, bindings.next_at), bindings.binding_id
       LIMIT ?`,
      now,
      now,
      limit,
    )
  }

  failPollClaim(
    bindingId: string,
    runtimeVersion: number,
    leaseToken: string,
    outcome:
      | { readonly errorCode: string; readonly health: Extract<PollHealth, 'failed' | 'needs_reauth'>; readonly now: number }
      | { readonly retryAt: number },
  ): void {
    if ('retryAt' in outcome) {
      this.#database
        .prepare(
          `UPDATE poll_bindings
           SET active_claim_id = NULL, active_lease_token = NULL, active_lease_expires_at = NULL, retry_at = ?
           WHERE binding_id = ? AND runtime_version = ? AND active_lease_token = ?`,
        )
        .run(outcome.retryAt, bindingId, runtimeVersion, leaseToken)
      return
    }
    this.#transaction(() => {
      const current = this.#database
        .prepare('SELECT health FROM poll_bindings WHERE binding_id = ? AND runtime_version = ? AND active_lease_token = ?')
        .get(bindingId, runtimeVersion, leaseToken) as { readonly health: PollHealth } | undefined
      const changed = this.#database
        .prepare(
          `UPDATE poll_bindings
           SET active_claim_id = NULL, active_lease_token = NULL, active_lease_expires_at = NULL,
               retry_at = NULL, next_at = NULL, health = ?, last_error_code = ?, updated_at = ?
           WHERE binding_id = ? AND runtime_version = ? AND active_lease_token = ?`,
        )
        .run(outcome.health, outcome.errorCode, outcome.now, bindingId, runtimeVersion, leaseToken)
      if (changed.changes == 1 && current?.health != outcome.health) {
        insertTriggerActivity(
          this.#database,
          bindingId,
          outcome.health == 'needs_reauth' ? 'health.needs_reauth' : 'health.failed',
          outcome.now,
          outcome.errorCode,
        )
      }
      pruneTriggerActivities(this.#database, outcome.now, 100)
    })
  }

  knownPollEvents(bindingId: string, providerEventIds: readonly string[]): ReadonlySet<string> {
    if (providerEventIds.length == 0) return new Set()
    const parameters = providerEventIds.map(() => '?').join(', ')
    const rows = this.#database
      .prepare(`SELECT provider_event_id AS providerEventId FROM poll_event_dedupe WHERE binding_id = ? AND provider_event_id IN (${parameters})`)
      .all(bindingId, ...providerEventIds) as { readonly providerEventId: string }[]
    return new Set(rows.map((row) => row.providerEventId))
  }

  nextPollAt(): number | undefined {
    const row = this.#database
      .prepare(
        `SELECT MIN(next_at) AS nextAt FROM (
           SELECT CASE WHEN bindings.active_claim_id IS NULL
             THEN COALESCE(bindings.retry_at, bindings.next_at)
             ELSE bindings.active_lease_expires_at
           END AS next_at
           FROM poll_bindings AS bindings
           JOIN flow_live
             ON flow_live.flow_id = bindings.flow_id
            AND flow_live.publication_id = bindings.current_publication_id
           WHERE bindings.health IN ('healthy', 'initializing')
             AND bindings.operator_state = 'active'
           UNION ALL
           SELECT candidates.next_at
           FROM poll_candidates AS candidates
           JOIN publish_operations AS operations ON operations.operation_id = candidates.operation_id
           WHERE candidates.status = 'preparing' AND operations.status = 'pending'
         )`,
      )
      .get() as { readonly nextAt: number | null }
    return row.nextAt ?? undefined
  }

  pollState(flowId: string, triggerNodeId: string): PollState | undefined {
    const row = this.#database
      .prepare(
        `SELECT binding_id AS bindingId, checkpoint_json AS checkpointJson, health, runtime_version AS runtimeVersion
         FROM poll_bindings WHERE flow_id = ? AND trigger_node_id = ?`,
      )
      .get(flowId, triggerNodeId) as
      | { readonly bindingId: string; readonly checkpointJson: string; readonly health: PollHealth; readonly runtimeVersion: number }
      | undefined
    return row == null
      ? undefined
      : { bindingId: row.bindingId, checkpoint: JSON.parse(row.checkpointJson) as JsonValue, health: row.health, runtimeVersion: row.runtimeVersion }
  }

  pollTarget(bindingId: string, runtimeVersion: number): StoredPollTarget | undefined {
    return this.#pollTargets('AND bindings.binding_id = ? AND bindings.runtime_version = ?', bindingId, runtimeVersion)[0]
  }

  pollTestTarget(flowId: string, triggerNodeId: string): StoredPollTestTarget | undefined {
    const row = this.#database
      .prepare(
        `SELECT bindings.binding_id AS bindingId,
                bindings.flow_id AS flowId,
                bindings.trigger_node_id AS triggerNodeId,
                bindings.runtime_version AS runtimeVersion,
                bindings.trigger_json AS triggerJson,
                bindings.connection_id AS connectionId,
                bindings.checkpoint_json AS checkpointJson,
                publications.publication_id AS publicationId,
                publications.revision_id AS revisionId,
                publications.revision_digest AS revisionDigest,
                publications.closure_digest AS closureDigest,
                revisions.content
         FROM poll_bindings AS bindings
         JOIN flow_live
           ON flow_live.flow_id = bindings.flow_id
          AND flow_live.publication_id = bindings.current_publication_id
         JOIN publications ON publications.publication_id = bindings.current_publication_id
         JOIN revisions ON revisions.revision_id = publications.revision_id
         WHERE bindings.flow_id = ? AND bindings.trigger_node_id = ?
           AND bindings.trigger_json IS NOT NULL AND bindings.connection_id IS NOT NULL`,
      )
      .get(flowId, triggerNodeId) as (Omit<StoredPollTestTarget, 'checkpoint'> & { readonly checkpointJson: string }) | undefined
    if (row == null) return
    const { checkpointJson, ...target } = row
    return { ...target, checkpoint: JSON.parse(checkpointJson) as JsonValue }
  }

  prunePoll(now: number, limit: number): number {
    return this.#transaction(() => {
      const claims = this.#database
        .prepare(
          `DELETE FROM poll_claims WHERE rowid IN (
             SELECT rowid FROM poll_claims ORDER BY expires_at, binding_id, claim_id LIMIT ?
           ) AND expires_at <= ?`,
        )
        .run(limit, now).changes
      const events = this.#database
        .prepare(
          `DELETE FROM poll_event_dedupe WHERE rowid IN (
             SELECT rowid FROM poll_event_dedupe ORDER BY expires_at, binding_id, provider_event_id LIMIT ?
           ) AND expires_at <= ?`,
        )
        .run(limit, now).changes
      return Number(claims) + Number(events)
    })
  }

  #pollTargets(condition: string, ...parameters: readonly (number | string)[]): readonly StoredPollTarget[] {
    const rows = this.#database
      .prepare(
        `SELECT
           bindings.binding_id AS bindingId,
           bindings.flow_id AS flowId,
           bindings.trigger_node_id AS triggerNodeId,
           bindings.runtime_version AS runtimeVersion,
           bindings.trigger_json AS triggerJson,
           bindings.connection_id AS connectionId,
           bindings.schedule_json AS scheduleJson,
           bindings.next_at AS nextAt,
           bindings.health,
           bindings.checkpoint_json AS checkpointJson,
           bindings.continuation_root_id AS continuationRootId,
           bindings.continuation_page AS continuationPage,
           publications.publication_id AS publicationId,
           publications.revision_id AS revisionId,
           publications.revision_digest AS revisionDigest,
           publications.closure_digest AS closureDigest,
           publications.engine_contract AS engineContract,
           publications.model_version AS modelVersion,
           revisions.content
         FROM poll_bindings AS bindings
         JOIN flow_live
           ON flow_live.flow_id = bindings.flow_id
          AND flow_live.publication_id = bindings.current_publication_id
         JOIN publications
           ON publications.publication_id = bindings.current_publication_id
         JOIN revisions
           ON revisions.revision_id = publications.revision_id
         WHERE bindings.trigger_json IS NOT NULL
           AND bindings.connection_id IS NOT NULL
           AND bindings.schedule_json IS NOT NULL
           AND bindings.next_at IS NOT NULL
           AND bindings.health IN ('healthy', 'initializing')
           AND bindings.operator_state = 'active'
           ${condition}`,
      )
      .all(...parameters) as unknown as readonly (Omit<StoredPollTarget, 'checkpoint'> & { readonly checkpointJson: string })[]
    const targets: StoredPollTarget[] = []
    for (const { checkpointJson, ...row } of rows) {
      targets.push({ ...row, checkpoint: JSON.parse(checkpointJson) as JsonValue })
    }
    return targets
  }
}
