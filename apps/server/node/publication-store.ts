import type { PublishOperation } from '@oomol-lab/open-flow/control-api'
import type { PublicationAcceptance, StoredFlow, StoredFlowRevision, StoredLive, StoredPublication } from './store.ts'

import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { AcceptanceError } from './error.ts'
import { IntegrationStore } from './integration-store.ts'
import { PollStore } from './poll-store.ts'

const publicationColumns = `
  publications.actor_id AS actorId,
  publications.closure_digest AS closureDigest,
  publications.created_at AS createdAt,
  publications.engine_contract AS engineContract,
  publications.flow_id AS flowId,
  publications.model_version AS modelVersion,
  publications.operation,
  publications.publication_id AS publicationId,
  publications.revision_digest AS revisionDigest,
  publications.revision_id AS revisionId,
  publications.source_publication_id AS sourcePublicationId`

const publishDeadlineMs = 30 * 60 * 1_000
const publishRetentionMs = 24 * 60 * 60 * 1_000
export const publishPending = new Error('Publish candidate activation is pending.')

export class PublicationStore {
  readonly #clock: () => number
  readonly #database: DatabaseSync
  readonly #integrations: IntegrationStore
  readonly #polls: PollStore
  readonly #transaction: <Value>(operation: () => Value) => Value

  constructor(
    database: DatabaseSync,
    clock: () => number,
    transaction: <Value>(operation: () => Value) => Value,
    integrations: IntegrationStore,
    polls: PollStore,
  ) {
    this.#clock = clock
    this.#database = database
    this.#integrations = integrations
    this.#polls = polls
    this.#transaction = transaction
  }

  publication(flowId: string, publicationId: string): StoredPublication | undefined {
    return this.#database
      .prepare(
        `SELECT ${publicationColumns}
         FROM publications
         WHERE publications.flow_id = ? AND publications.publication_id = ?`,
      )
      .get(flowId, publicationId) as StoredPublication | undefined
  }

  publicationById(publicationId: string): StoredPublication | undefined {
    return this.#database
      .prepare(
        `SELECT ${publicationColumns}
         FROM publications
         WHERE publications.publication_id = ?`,
      )
      .get(publicationId) as StoredPublication | undefined
  }

  live(flowId: string): StoredLive | undefined {
    const row = this.#database
      .prepare(
        `SELECT ${publicationColumns}, flow_live.revision, flow_live.updated_at AS updatedAt
         FROM flow_live
         JOIN publications ON publications.publication_id = flow_live.publication_id
         WHERE flow_live.flow_id = ?`,
      )
      .get(flowId) as (StoredPublication & { readonly revision: number; readonly updatedAt: number }) | undefined
    if (row == null) return
    const { revision, updatedAt, ...publication } = row
    return { publication, revision, updatedAt }
  }

  listPublications(
    flowId: string,
    limit: number,
    after?: { readonly createdAt: number; readonly publicationId: string },
    includeTotal = false,
  ): { readonly publications: readonly StoredPublication[]; readonly total?: number } {
    const publications =
      after == null
        ? (this.#database
            .prepare(
              `SELECT ${publicationColumns}
               FROM publications
               WHERE publications.flow_id = ?
               ORDER BY publications.created_at DESC, publications.publication_id DESC
               LIMIT ?`,
            )
            .all(flowId, limit) as unknown as readonly StoredPublication[])
        : (this.#database
            .prepare(
              `SELECT ${publicationColumns}
               FROM publications
               WHERE publications.flow_id = ?
                 AND (publications.created_at < ? OR (publications.created_at = ? AND publications.publication_id < ?))
               ORDER BY publications.created_at DESC, publications.publication_id DESC
               LIMIT ?`,
            )
            .all(flowId, after.createdAt, after.createdAt, after.publicationId, limit) as unknown as readonly StoredPublication[])
    if (!includeTotal) return { publications }
    const total = (
      this.#database.prepare('SELECT COUNT(*) AS total FROM publications WHERE flow_id = ?').get(flowId) as {
        readonly total: number
      }
    ).total
    return { publications, total }
  }

  acceptPublishOperation(
    input: Parameters<PublicationStore['publish']>[0],
  ):
    | { readonly kind: 'accepted'; readonly operation: PublishOperation }
    | { readonly kind: 'binding-unresolved' | 'busy' | 'conflict' | 'live-conflict' | 'not-found' | 'revision-conflict' | 'unsupported' } {
    return this.#transaction(() => {
      const now = this.#clock()
      this.#database
        .prepare(
          `DELETE FROM publish_work WHERE operation_id IN (
             SELECT operations.operation_id FROM publish_operations AS operations
             WHERE operations.flow_id = ? AND operations.status != 'pending' AND operations.expires_at <= ?
               AND NOT EXISTS (
                 SELECT 1 FROM integration_candidates WHERE integration_candidates.operation_id = operations.operation_id
               )
               AND NOT EXISTS (
                 SELECT 1 FROM poll_candidates WHERE poll_candidates.operation_id = operations.operation_id
               )
           )`,
        )
        .run(input.flowId, now)
      this.#database
        .prepare(
          `DELETE FROM publish_operations
           WHERE flow_id = ? AND status != 'pending' AND expires_at <= ?
             AND NOT EXISTS (
               SELECT 1 FROM integration_candidates WHERE integration_candidates.operation_id = publish_operations.operation_id
             )
             AND NOT EXISTS (
               SELECT 1 FROM poll_candidates WHERE poll_candidates.operation_id = publish_operations.operation_id
             )`,
        )
        .run(input.flowId, now)
      const existing = this.#database
        .prepare('SELECT operation_id AS operationId, request_digest AS requestDigest FROM publish_operations WHERE flow_id = ? AND idempotency_key = ?')
        .get(input.flowId, input.idempotencyKey) as { readonly operationId: string; readonly requestDigest: string } | undefined
      if (existing != null) {
        if (existing.requestDigest != input.requestDigest) return { kind: 'conflict' }
        const operation = this.publishOperation(input.flowId, existing.operationId)
        if (operation == null) throw new Error('Accepted Publish operation is missing.')
        return { kind: 'accepted', operation }
      }

      const flow = this.#flow(input.flowId)
      if (flow == null) return { kind: 'not-found' }
      if (flow.status != 'active') return { kind: 'busy' }
      if (this.#database.prepare("SELECT 1 FROM publish_operations WHERE flow_id = ? AND status = 'pending'").get(input.flowId) != null) {
        return { kind: 'busy' }
      }
      const revision = this.#revision(input.flowId, input.revisionId)
      if (revision == null || revision.digest != input.revisionDigest) return { kind: 'not-found' }
      if (flow.draftRevisionId != input.revisionId) return { kind: 'revision-conflict' }
      if (!this.#variablesExist(input.variableNames)) return { kind: 'binding-unresolved' }
      const live = this.#database.prepare('SELECT publication_id AS publicationId FROM flow_live WHERE flow_id = ?').get(input.flowId) as
        | { readonly publicationId: string }
        | undefined
      if ((live?.publicationId ?? null) != input.expectedLivePublicationId) return { kind: 'live-conflict' }

      const operationId = `publish_${randomUUID().replaceAll('-', '')}`
      const createdAt = now
      if (!this.#integrations.createCandidates(operationId, input.flowId, input.expectedLivePublicationId, input.integrations, createdAt)) {
        return { kind: 'unsupported' }
      }
      this.#polls.createCandidates(operationId, input.flowId, input.expectedLivePublicationId, input.polls, createdAt)
      this.#database
        .prepare(
          `INSERT INTO publish_operations (
             operation_id, flow_id, revision_id, revision_digest, closure_digest, engine_contract,
             expected_live_publication_id, idempotency_key, request_digest, input_json, status,
             deadline_at, created_at, updated_at, expires_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
        )
        .run(
          operationId,
          input.flowId,
          input.revisionId,
          input.revisionDigest,
          input.closureDigest,
          input.engineContract,
          input.expectedLivePublicationId,
          input.idempotencyKey,
          input.requestDigest,
          JSON.stringify(input),
          createdAt + publishDeadlineMs,
          createdAt,
          createdAt,
          createdAt + publishRetentionMs,
        )
      const operation = this.publishOperation(input.flowId, operationId)
      if (operation == null) throw new Error('Created Publish operation is missing.')
      return { kind: 'accepted', operation }
    })
  }

  replayPublishOperation(
    flowId: string,
    idempotencyKey: string,
    requestDigest: string,
  ): { readonly kind: 'accepted'; readonly operation: PublishOperation } | { readonly kind: 'conflict' } | undefined {
    const existing = this.#database
      .prepare(
        `SELECT operation_id AS operationId, request_digest AS requestDigest FROM publish_operations
         WHERE flow_id = ? AND idempotency_key = ? AND (status = 'pending' OR expires_at > ?)`,
      )
      .get(flowId, idempotencyKey, this.#clock()) as { readonly operationId: string; readonly requestDigest: string } | undefined
    if (existing == null) return
    if (existing.requestDigest != requestDigest) return { kind: 'conflict' }
    const operation = this.publishOperation(flowId, existing.operationId)
    if (operation == null) throw new Error('Replayed Publish operation is missing.')
    return { kind: 'accepted', operation }
  }

  publishOperation(flowId: string, operationId: string): PublishOperation | undefined {
    const row = this.#database
      .prepare(
        `SELECT created_at AS createdAt, flow_id AS flowId, issue_code AS issueCode,
                issue_message AS issueMessage, issue_node_id AS issueNodeId, operation_id AS operationId,
                publication_id AS publicationId, revision_id AS revisionId, status, updated_at AS updatedAt
         FROM publish_operations WHERE flow_id = ? AND operation_id = ?`,
      )
      .get(flowId, operationId) as
      | {
          readonly createdAt: number
          readonly flowId: string
          readonly issueCode: string | null
          readonly issueMessage: string | null
          readonly issueNodeId: string | null
          readonly operationId: string
          readonly publicationId: string | null
          readonly revisionId: string
          readonly status: PublishOperation['status']
          readonly updatedAt: number
        }
      | undefined
    if (row == null) return
    const common = {
      createdAt: new Date(row.createdAt).toISOString(),
      flowId: row.flowId,
      operationId: row.operationId,
      revisionId: row.revisionId,
      updatedAt: new Date(row.updatedAt).toISOString(),
      version: 1 as const,
    }
    switch (row.status) {
      case 'pending':
        return { ...common, status: 'pending' }
      case 'succeeded': {
        if (row.publicationId == null) throw new Error('Succeeded Publish operation is missing its Publication identity.')
        return { ...common, publicationId: row.publicationId, status: 'succeeded' }
      }
      case 'failed': {
        if (row.issueCode == null || row.issueMessage == null) throw new Error('Failed Publish operation is missing its issue.')
        return {
          ...common,
          issue: {
            code: row.issueCode,
            message: row.issueMessage,
            ...(row.issueNodeId == null ? {} : { nodeId: row.issueNodeId }),
          },
          status: 'failed',
        }
      }
    }
  }

  nextPublishOperation(now: number):
    | {
        readonly code: string
        readonly kind: 'failed'
        readonly message: string
        readonly nodeId?: string
        readonly operationId: string
      }
    | { readonly input: string; readonly kind: 'ready'; readonly operationId: string }
    | undefined {
    const row = this.#database
      .prepare(
        `SELECT operations.deadline_at AS deadlineAt, operations.input_json AS input,
                operations.operation_id AS operationId, work.issue_code AS issueCode,
                work.issue_message AS issueMessage, work.node_id AS nodeId
         FROM publish_operations AS operations
         LEFT JOIN publish_work AS work ON work.work_id = (
           SELECT failed.work_id FROM publish_work AS failed
           WHERE failed.operation_id = operations.operation_id AND failed.status = 'failed'
           ORDER BY failed.created_at, failed.work_id LIMIT 1
         )
         WHERE operations.status = 'pending'
           AND (
             operations.deadline_at <= ? OR work.work_id IS NOT NULL OR
             NOT EXISTS (
               SELECT 1 FROM publish_work AS pending
               WHERE pending.operation_id = operations.operation_id AND pending.status = 'pending'
             )
           )
         ORDER BY operations.created_at, operations.operation_id LIMIT 1`,
      )
      .get(now) as
      | {
          readonly deadlineAt: number
          readonly input: string
          readonly issueCode: string | null
          readonly issueMessage: string | null
          readonly nodeId: string | null
          readonly operationId: string
        }
      | undefined
    if (row == null) return
    if (row.issueCode != null && row.issueMessage != null) {
      return {
        code: row.issueCode,
        kind: 'failed',
        message: row.issueMessage,
        ...(row.nodeId == null ? {} : { nodeId: row.nodeId }),
        operationId: row.operationId,
      }
    }
    if (row.deadlineAt <= now) {
      return {
        code: 'publication.deadline-exceeded',
        kind: 'failed',
        message: 'The Publish operation exceeded its preparation deadline.',
        operationId: row.operationId,
      }
    }
    return { input: row.input, kind: 'ready', operationId: row.operationId }
  }

  failPublishOperation(operationId: string, issue: { readonly code: string; readonly message: string; readonly nodeId?: string }): void {
    this.#transaction(() => {
      const now = this.#clock()
      this.#database
        .prepare(
          `UPDATE publish_operations
           SET status = 'failed', issue_node_id = ?, issue_code = ?, issue_message = ?, updated_at = ?
           WHERE operation_id = ? AND status = 'pending'`,
        )
        .run(issue.nodeId ?? null, issue.code, issue.message, now, operationId)
      this.#integrations.cleanupCandidates(operationId, now)
      this.#polls.cleanupCandidates(operationId)
    })
  }

  prunePublishOperations(now: number, limit: number): number {
    return this.#transaction(() => {
      const rows = this.#database
        .prepare(
          `SELECT operation_id AS operationId FROM publish_operations
           WHERE status != 'pending' AND expires_at <= ?
             AND NOT EXISTS (
               SELECT 1 FROM integration_candidates WHERE integration_candidates.operation_id = publish_operations.operation_id
             )
             AND NOT EXISTS (
               SELECT 1 FROM poll_candidates WHERE poll_candidates.operation_id = publish_operations.operation_id
             )
           ORDER BY expires_at, operation_id LIMIT ?`,
        )
        .all(now, limit) as unknown as readonly { readonly operationId: string }[]
      if (rows.length == 0) return 0
      const placeholders = rows.map(() => '?').join(', ')
      const operationIds = rows.map((row) => row.operationId)
      this.#database.prepare(`DELETE FROM publish_work WHERE operation_id IN (${placeholders})`).run(...operationIds)
      this.#database.prepare(`DELETE FROM publish_operations WHERE operation_id IN (${placeholders})`).run(...operationIds)
      return rows.length
    })
  }

  publish(input: {
    readonly closureDigest: string
    readonly content: string
    readonly crons: readonly {
      readonly nextAt: number
      readonly scheduleJson: string
      readonly triggerJson: string
      readonly triggerNodeId: string
    }[]
    readonly expectedLivePublicationId: string | null
    readonly engineContract: string
    readonly flowId: string
    readonly idempotencyKey: string
    readonly integrations: readonly {
      readonly connectionId: string
      readonly reconcileAt: number
      readonly triggerJson: string
      readonly triggerNodeId: string
    }[]
    readonly metadata?:
      | { readonly actorId: string; readonly modelVersion: number; readonly operation: 'publish' }
      | {
          readonly actorId: string
          readonly modelVersion: number
          readonly operation: 'rollback'
          readonly sourcePublicationId: string
        }
    readonly operationId?: string
    readonly polls: readonly {
      readonly connectionId: string
      readonly nextAt: number
      readonly scheduleJson: string
      readonly triggerJson: string
      readonly triggerNodeId: string
    }[]
    readonly publishedAt: number
    readonly requestDigest: string
    readonly revisionDigest: string
    readonly revisionId: string
    readonly variableNames: readonly string[]
    readonly webhooks: readonly { readonly triggerJson: string; readonly triggerNodeId: string }[]
  }): PublicationAcceptance {
    return this.#transaction(() => {
      const existing = this.#database
        .prepare('SELECT publication_id AS publicationId, request_digest AS requestDigest FROM publications WHERE flow_id = ? AND idempotency_key = ?')
        .get(input.flowId, input.idempotencyKey) as { readonly publicationId: string; readonly requestDigest: string } | undefined
      if (existing != null) {
        if (existing.requestDigest != input.requestDigest) return { kind: 'conflict' }
        if (input.operationId != null) {
          this.#database
            .prepare(
              `UPDATE publish_operations SET status = 'succeeded', publication_id = ?, updated_at = ?
               WHERE operation_id = ? AND status = 'pending'`,
            )
            .run(existing.publicationId, input.publishedAt, input.operationId)
        }
        return { created: false, kind: 'published', publicationId: existing.publicationId }
      }

      if (input.operationId != null) {
        const operation = this.#database
          .prepare('SELECT publication_id AS publicationId, status FROM publish_operations WHERE operation_id = ?')
          .get(input.operationId) as { readonly publicationId: string | null; readonly status: PublishOperation['status'] } | undefined
        if (operation?.status == 'succeeded' && operation.publicationId != null) {
          return { created: false, kind: 'published', publicationId: operation.publicationId }
        }
        if (
          operation?.status != 'pending' ||
          this.#database.prepare("SELECT 1 FROM publish_work WHERE operation_id = ? AND status != 'ready' LIMIT 1").get(input.operationId) != null
        ) {
          return { kind: 'operation-pending' }
        }
        if (!this.#integrations.candidatesReady(input.operationId, input.flowId, input.expectedLivePublicationId, input.integrations)) {
          return { kind: 'operation-pending' }
        }
        if (!this.#polls.candidatesReady(input.operationId, input.flowId, input.expectedLivePublicationId, input.polls)) {
          return { kind: 'operation-pending' }
        }
      }

      if (input.metadata != null) {
        const flow = this.#flow(input.flowId)
        if (flow == null) return { kind: 'not-found' }
        if (flow.status != 'active') return { kind: 'busy' }
        const revision = this.#revision(input.flowId, input.revisionId)
        if (revision == null || revision.digest != input.revisionDigest) return { kind: 'not-found' }
        if (input.metadata.operation == 'publish' && flow.draftRevisionId != input.revisionId) return { kind: 'revision-conflict' }
        if (input.metadata.operation == 'rollback') {
          const source = this.publication(input.flowId, input.metadata.sourcePublicationId)
          if (source == null) return { kind: 'source-not-found' }
          if (
            source.revisionId != input.revisionId ||
            source.revisionDigest != input.revisionDigest ||
            source.closureDigest != input.closureDigest ||
            source.modelVersion != input.metadata.modelVersion ||
            source.engineContract != input.engineContract
          ) {
            return { kind: 'revision-conflict' }
          }
        }
      }

      if (!this.#variablesExist(input.variableNames)) return { kind: 'binding-unresolved' }

      const live = this.#database.prepare('SELECT publication_id AS publicationId FROM flow_live WHERE flow_id = ?').get(input.flowId) as
        | { readonly publicationId: string }
        | undefined
      if ((live?.publicationId ?? null) != input.expectedLivePublicationId) {
        if (input.metadata != null) return { kind: 'live-conflict' }
        throw new AcceptanceError('publication-live-conflict', 'The Flow Live pointer no longer matches the expected Publication.')
      }

      this.#ensureRevision(input)
      const publicationId = `publication_${randomUUID().replaceAll('-', '')}`
      this.#database
        .prepare(
          `INSERT INTO publications (
             publication_id, flow_id, revision_id, revision_digest,
             closure_digest, engine_contract, idempotency_key, request_digest,
             actor_id, operation, source_publication_id, model_version, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          publicationId,
          input.flowId,
          input.revisionId,
          input.revisionDigest,
          input.closureDigest,
          input.engineContract,
          input.idempotencyKey,
          input.requestDigest,
          input.metadata?.actorId ?? 'legacy',
          input.metadata?.operation ?? 'publish',
          input.metadata?.operation == 'rollback' ? input.metadata.sourcePublicationId : null,
          input.metadata?.modelVersion ?? 1,
          input.publishedAt,
        )
      this.#database
        .prepare(
          `INSERT INTO flow_live (flow_id, publication_id, revision, updated_at) VALUES (?, ?, 1, ?)
           ON CONFLICT (flow_id) DO UPDATE SET
             publication_id = excluded.publication_id,
             revision = flow_live.revision + 1,
             updated_at = excluded.updated_at`,
        )
        .run(input.flowId, publicationId, input.publishedAt)

      const desired = new Map(input.webhooks.map((webhook) => [webhook.triggerNodeId, webhook.triggerJson]))
      const bindings = this.#database
        .prepare(
          `SELECT endpoint_id AS endpointId, trigger_node_id AS triggerNodeId, current_publication_id AS currentPublicationId
           FROM webhook_bindings WHERE flow_id = ?`,
        )
        .all(input.flowId) as {
        readonly currentPublicationId: string | null
        readonly endpointId: string
        readonly triggerNodeId: string
      }[]
      for (const binding of bindings) {
        const triggerJson = desired.get(binding.triggerNodeId)
        if (triggerJson != null) {
          this.#database
            .prepare(
              `UPDATE webhook_bindings
               SET current_publication_id = ?, runtime_version = runtime_version + 1, trigger_json = ?, updated_at = ?
               WHERE endpoint_id = ?`,
            )
            .run(publicationId, triggerJson, input.publishedAt, binding.endpointId)
          desired.delete(binding.triggerNodeId)
        } else if (binding.currentPublicationId != null) {
          this.#database
            .prepare(
              `UPDATE webhook_bindings
               SET current_publication_id = NULL, runtime_version = runtime_version + 1, trigger_json = NULL, updated_at = ?
               WHERE endpoint_id = ?`,
            )
            .run(input.publishedAt, binding.endpointId)
        }
      }
      for (const [triggerNodeId, triggerJson] of desired) {
        this.#database
          .prepare(
            `INSERT INTO webhook_bindings (
               endpoint_id, flow_id, trigger_node_id, current_publication_id, runtime_version, trigger_json, updated_at
             ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(`endpoint_${randomUUID().replaceAll('-', '')}`, input.flowId, triggerNodeId, publicationId, triggerJson, input.publishedAt)
      }

      const desiredCrons = new Map(input.crons.map((cron) => [cron.triggerNodeId, cron]))
      const cronBindings = this.#database
        .prepare(
          `SELECT binding_id AS bindingId, trigger_node_id AS triggerNodeId, current_publication_id AS currentPublicationId
           FROM cron_bindings WHERE flow_id = ?`,
        )
        .all(input.flowId) as {
        readonly bindingId: string
        readonly currentPublicationId: string | null
        readonly triggerNodeId: string
      }[]
      for (const binding of cronBindings) {
        const cron = desiredCrons.get(binding.triggerNodeId)
        if (cron != null) {
          this.#database
            .prepare(
              `UPDATE cron_bindings
               SET current_publication_id = ?, runtime_version = runtime_version + 1,
                   trigger_json = ?, schedule_json = ?, next_at = ?, updated_at = ?
               WHERE binding_id = ?`,
            )
            .run(publicationId, cron.triggerJson, cron.scheduleJson, cron.nextAt, input.publishedAt, binding.bindingId)
          desiredCrons.delete(binding.triggerNodeId)
        } else if (binding.currentPublicationId != null) {
          this.#database
            .prepare(
              `UPDATE cron_bindings
               SET current_publication_id = NULL, runtime_version = runtime_version + 1,
                   trigger_json = NULL, schedule_json = NULL, next_at = NULL, updated_at = ?
               WHERE binding_id = ?`,
            )
            .run(input.publishedAt, binding.bindingId)
        }
      }
      for (const [triggerNodeId, cron] of desiredCrons) {
        this.#database
          .prepare(
            `INSERT INTO cron_bindings (
               binding_id, flow_id, trigger_node_id, current_publication_id,
               runtime_version, trigger_json, schedule_json, next_at, updated_at
             ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          )
          .run(
            `binding_${randomUUID().replaceAll('-', '')}`,
            input.flowId,
            triggerNodeId,
            publicationId,
            cron.triggerJson,
            cron.scheduleJson,
            cron.nextAt,
            input.publishedAt,
          )
      }

      const desiredPolls = new Map(input.polls.map((poll) => [poll.triggerNodeId, poll]))
      const pollBindings = this.#database
        .prepare(
          `SELECT binding_id AS bindingId, trigger_node_id AS triggerNodeId,
                  current_publication_id AS currentPublicationId, trigger_json AS triggerJson,
                  connection_id AS connectionId, health
           FROM poll_bindings WHERE flow_id = ?`,
        )
        .all(input.flowId) as {
        readonly bindingId: string
        readonly connectionId: string | null
        readonly currentPublicationId: string | null
        readonly health: 'failed' | 'healthy' | 'initializing' | 'needs_reauth'
        readonly triggerJson: string | null
        readonly triggerNodeId: string
      }[]
      for (const binding of pollBindings) {
        const poll = desiredPolls.get(binding.triggerNodeId)
        if (poll != null) {
          const unchanged = binding.triggerJson == poll.triggerJson && binding.connectionId == poll.connectionId
          if (input.operationId != null && unchanged && binding.currentPublicationId == input.expectedLivePublicationId && binding.health == 'healthy') {
            this.#database
              .prepare(
                `UPDATE poll_bindings
                 SET current_publication_id = ?, runtime_version = runtime_version + 1,
                     schedule_json = ?, next_at = ?, retry_at = NULL,
                     continuation_root_id = NULL, continuation_page = 0,
                     active_claim_id = NULL, active_lease_token = NULL, active_lease_expires_at = NULL,
                     updated_at = ?
                 WHERE binding_id = ?`,
              )
              .run(publicationId, poll.scheduleJson, poll.nextAt, input.publishedAt, binding.bindingId)
          } else if (input.operationId != null) {
            if (!this.#polls.activateCandidate(input.operationId, input.flowId, publicationId, poll, input.publishedAt)) {
              throw publishPending
            }
          } else {
            this.#database
              .prepare(
                `UPDATE poll_bindings
                 SET current_publication_id = ?, runtime_version = runtime_version + 1,
                     trigger_json = ?, connection_id = ?, schedule_json = ?, next_at = ?, retry_at = NULL,
                     health = CASE WHEN ? = 1 THEN health ELSE 'initializing' END,
                     checkpoint_json = CASE WHEN ? = 1 THEN checkpoint_json ELSE 'null' END,
                     continuation_root_id = NULL, continuation_page = 0,
                     active_claim_id = NULL, active_lease_token = NULL, active_lease_expires_at = NULL,
                     updated_at = ?
                 WHERE binding_id = ?`,
              )
              .run(
                publicationId,
                poll.triggerJson,
                poll.connectionId,
                poll.scheduleJson,
                poll.nextAt,
                unchanged ? 1 : 0,
                unchanged ? 1 : 0,
                input.publishedAt,
                binding.bindingId,
              )
          }
          desiredPolls.delete(binding.triggerNodeId)
        } else if (binding.currentPublicationId != null) {
          this.#database
            .prepare(
              `UPDATE poll_bindings
               SET current_publication_id = NULL, runtime_version = runtime_version + 1,
                   next_at = NULL, retry_at = NULL, continuation_root_id = NULL, continuation_page = 0,
                   active_claim_id = NULL, active_lease_token = NULL, active_lease_expires_at = NULL,
                   updated_at = ?
               WHERE binding_id = ?`,
            )
            .run(input.publishedAt, binding.bindingId)
        }
      }
      for (const [triggerNodeId, poll] of desiredPolls) {
        if (input.operationId != null) {
          if (!this.#polls.activateCandidate(input.operationId, input.flowId, publicationId, poll, input.publishedAt)) {
            throw publishPending
          }
        } else {
          this.#database
            .prepare(
              `INSERT INTO poll_bindings (
                 binding_id, flow_id, trigger_node_id, current_publication_id,
                 runtime_version, trigger_json, connection_id, schedule_json, next_at, health, updated_at
               ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 'initializing', ?)`,
            )
            .run(
              `binding_${randomUUID().replaceAll('-', '')}`,
              input.flowId,
              triggerNodeId,
              publicationId,
              poll.triggerJson,
              poll.connectionId,
              poll.scheduleJson,
              poll.nextAt,
              input.publishedAt,
            )
        }
      }

      const desiredIntegrations = new Map(input.integrations.map((integration) => [integration.triggerNodeId, integration]))
      const integrationBindings = this.#database
        .prepare(
          `SELECT binding_id AS bindingId, trigger_node_id AS triggerNodeId,
                  current_publication_id AS currentPublicationId, trigger_json AS triggerJson,
                  connection_id AS connectionId
           FROM integration_bindings WHERE flow_id = ?`,
        )
        .all(input.flowId) as {
        readonly bindingId: string
        readonly connectionId: string
        readonly currentPublicationId: string | null
        readonly triggerJson: string
        readonly triggerNodeId: string
      }[]
      for (const binding of integrationBindings) {
        const integration = desiredIntegrations.get(binding.triggerNodeId)
        if (integration != null) {
          const unchanged = binding.triggerJson == integration.triggerJson && binding.connectionId == integration.connectionId
          if (input.operationId != null && unchanged) {
            this.#database
              .prepare('UPDATE integration_bindings SET current_publication_id = ?, updated_at = ? WHERE binding_id = ?')
              .run(publicationId, input.publishedAt, binding.bindingId)
          } else {
            this.#database
              .prepare(
                `UPDATE integration_bindings
                 SET current_publication_id = ?, runtime_version = runtime_version + 1,
                     trigger_json = ?, connection_id = ?, reconcile_at = ?, retry_at = NULL,
                     health = CASE WHEN ? = 1 THEN health ELSE 'initializing' END,
                     updated_at = ?
                 WHERE binding_id = ?`,
              )
              .run(
                publicationId,
                integration.triggerJson,
                integration.connectionId,
                integration.reconcileAt,
                unchanged ? 1 : 0,
                input.publishedAt,
                binding.bindingId,
              )
          }
          desiredIntegrations.delete(binding.triggerNodeId)
        } else if (binding.currentPublicationId != null) {
          this.#database
            .prepare(
              `UPDATE integration_bindings
               SET current_publication_id = NULL, runtime_version = runtime_version + 1,
                   reconcile_at = ?, retry_at = NULL, updated_at = ?
               WHERE binding_id = ?`,
            )
            .run(input.publishedAt, input.publishedAt, binding.bindingId)
        }
      }
      for (const [triggerNodeId, integration] of desiredIntegrations) {
        if (input.operationId != null) {
          if (!this.#integrations.activateCandidate(input.operationId, input.flowId, publicationId, integration, input.publishedAt)) {
            throw publishPending
          }
          continue
        }
        this.#database
          .prepare(
            `INSERT INTO integration_bindings (
               binding_id, endpoint_id, flow_id, trigger_node_id,
               current_publication_id, runtime_version, trigger_json, connection_id, health, reconcile_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'initializing', ?, ?)`,
          )
          .run(
            `binding_${randomUUID().replaceAll('-', '')}`,
            `endpoint_${randomUUID().replaceAll('-', '')}`,
            input.flowId,
            triggerNodeId,
            publicationId,
            integration.triggerJson,
            integration.connectionId,
            integration.reconcileAt,
            input.publishedAt,
          )
      }
      if (input.operationId != null) {
        this.#database
          .prepare(
            `UPDATE publish_operations SET status = 'succeeded', publication_id = ?, updated_at = ?
             WHERE operation_id = ? AND status = 'pending'`,
          )
          .run(publicationId, input.publishedAt, input.operationId)
      }
      return { created: true, kind: 'published', publicationId }
    })
  }

  #flow(flowId: string): StoredFlow | undefined {
    return this.#database
      .prepare(
        `SELECT create_request_digest AS createRequestDigest, created_at AS createdAt, draft_revision_id AS draftRevisionId,
                flow_id AS flowId, name, status, updated_at AS updatedAt
         FROM flows WHERE flow_id = ?`,
      )
      .get(flowId) as StoredFlow | undefined
  }

  #revision(flowId: string, revisionId: string): StoredFlowRevision | undefined {
    return this.#database
      .prepare(
        `SELECT flow_revisions.actor_id AS actorId, flow_revisions.created_at AS createdAt, revisions.content,
                revisions.digest, flow_revisions.flow_id AS flowId, flow_revisions.parent_revision_id AS parentRevisionId,
                flow_revisions.revision_id AS revisionId
         FROM flow_revisions
         JOIN revisions USING (revision_id)
         WHERE flow_revisions.flow_id = ? AND flow_revisions.revision_id = ?`,
      )
      .get(flowId, revisionId) as StoredFlowRevision | undefined
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
}
