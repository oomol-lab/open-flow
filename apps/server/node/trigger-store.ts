import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { RunAcceptance } from '@oomol-lab/open-flow/run-lifecycle'
import type { DatabaseSync } from 'node:sqlite'

import { insertTriggerActivity, pruneTriggerActivities } from './trigger-activity.ts'

export type TriggerActivityKind =
  | 'delivery.failed'
  | 'health.failed'
  | 'health.needs_reauth'
  | 'health.recovered'
  | 'health.suspended'
  | 'operator.paused'
  | 'operator.resumed'

export interface StoredTriggerActivity {
  readonly activityId: string
  readonly createdAt: number
  readonly errorCode: string | null
  readonly errorMessage: string | null
  readonly kind: TriggerActivityKind
}

export interface StoredTriggerBinding {
  readonly bindingId: string
  readonly currentPublicationId: string | null
  readonly currentRevisionId: string | null
  readonly endpointId: string | null
  readonly flowId: string
  readonly health: 'failed' | 'healthy' | 'initializing' | 'needs_reauth'
  readonly kind: 'cron' | 'integration' | 'poll' | 'webhook'
  readonly lastErrorCode: string | null
  readonly operatorState: 'active' | 'paused'
  readonly runtimeVersion: number
  readonly triggerNodeId: string
  readonly updatedAt: number
}

interface StoredWebhookTarget {
  readonly closureDigest: string
  readonly content: string
  readonly endpointId: string
  readonly engineContract: string
  readonly flowId: string
  readonly publicationId: string
  readonly revisionDigest: string
  readonly revisionId: string
  readonly runtimeVersion: number
  readonly triggerJson: string
  readonly triggerNodeId: string
}

export interface StoredCronTarget {
  readonly bindingId: string
  readonly closureDigest: string
  readonly content: string
  readonly engineContract: string
  readonly flowId: string
  readonly modelVersion: number
  readonly nextAt: number
  readonly publicationId: string
  readonly revisionDigest: string
  readonly revisionId: string
  readonly runtimeVersion: number
  readonly scheduleJson: string
  readonly triggerJson: string
  readonly triggerNodeId: string
}

export type PollHealth = 'failed' | 'healthy' | 'initializing' | 'needs_reauth'

export type RunAdmission = RunAcceptance | { readonly kind: 'overloaded' }

export interface StoredPollTarget {
  readonly bindingId: string
  readonly checkpoint: JsonValue
  readonly closureDigest: string
  readonly connectionId: string
  readonly content: string
  readonly continuationPage: number
  readonly continuationRootId: string | null
  readonly engineContract: string
  readonly flowId: string
  readonly health: Extract<PollHealth, 'healthy' | 'initializing'>
  readonly modelVersion: number
  readonly nextAt: number
  readonly publicationId: string
  readonly revisionDigest: string
  readonly revisionId: string
  readonly runtimeVersion: number
  readonly scheduleJson: string
  readonly triggerJson: string
  readonly triggerNodeId: string
}

export interface StoredPollTestTarget {
  readonly bindingId: string
  readonly checkpoint: JsonValue
  readonly closureDigest: string
  readonly connectionId: string
  readonly content: string
  readonly flowId: string
  readonly publicationId: string
  readonly revisionDigest: string
  readonly revisionId: string
  readonly runtimeVersion: number
  readonly triggerJson: string
  readonly triggerNodeId: string
}

export type PollClaim = { readonly kind: 'acquired'; readonly leaseToken: string } | { readonly kind: 'busy' | 'completed' | 'unavailable' }

export type PollCompletion = { readonly accepted?: RunAcceptance; readonly kind: 'completed' } | { readonly kind: 'ignored' | 'overloaded' }

export interface PollState {
  readonly bindingId: string
  readonly checkpoint: JsonValue
  readonly health: PollHealth
  readonly runtimeVersion: number
}

export type IntegrationHealth = 'failed' | 'healthy' | 'initializing' | 'needs_reauth'

export interface StoredIntegrationState {
  readonly bindingId: string
  readonly checkpointJson: string
  readonly connectionId: string
  readonly reconcileAt: number | null
  readonly runtimeVersion: number
  readonly subscriptionJson: string
  readonly triggerJson: string
  readonly updatedAt: number
}

export interface StoredIntegrationBinding {
  readonly bindingId: string
  readonly connectionId: string
  readonly currentPublicationId: string | null
  readonly endpointId: string
  readonly flowId: string
  readonly health: IntegrationHealth
  readonly runtimeVersion: number
  readonly triggerJson: string
  readonly triggerNodeId: string
}

export interface StoredIntegrationTarget extends StoredIntegrationBinding {
  readonly closureDigest: string
  readonly content: string
  readonly currentPublicationId: string
  readonly engineContract: string
  readonly modelVersion: number
  readonly revisionDigest: string
  readonly revisionId: string
  readonly state?: StoredIntegrationState
}

interface TriggerOccurrence {
  readonly content: string
  readonly flowId: string
  readonly occurrenceId: string
  readonly payload: JsonValue
  readonly requestDigest: string
  readonly revisionDigest: string
  readonly revisionId: string
  readonly triggerNodeId: string
}

export type TriggerOccurrenceInput = TriggerOccurrence & {
  readonly closureDigest: string
  readonly modelVersion: number
  readonly publicationId: string
  readonly source: 'trigger'
}

export class TriggerStore {
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

  listTriggerBindings(flowId: string): readonly StoredTriggerBinding[] {
    return this.#database
      .prepare(
        `SELECT * FROM (
           SELECT bindings.endpoint_id AS bindingId,
                  bindings.current_publication_id AS currentPublicationId,
                  publications.revision_id AS currentRevisionId,
                  bindings.endpoint_id AS endpointId,
                  bindings.flow_id AS flowId,
                  'healthy' AS health,
                  'webhook' AS kind,
                  NULL AS lastErrorCode,
                  bindings.operator_state AS operatorState,
                  bindings.runtime_version AS runtimeVersion,
                  bindings.trigger_node_id AS triggerNodeId,
                  bindings.updated_at AS updatedAt
           FROM webhook_bindings AS bindings
           LEFT JOIN publications ON publications.publication_id = bindings.current_publication_id
           WHERE bindings.flow_id = ?
           UNION ALL
           SELECT bindings.binding_id, bindings.current_publication_id, publications.revision_id,
                  NULL, bindings.flow_id, 'healthy', 'cron', NULL, bindings.operator_state,
                  bindings.runtime_version, bindings.trigger_node_id, bindings.updated_at
           FROM cron_bindings AS bindings
           LEFT JOIN publications ON publications.publication_id = bindings.current_publication_id
           WHERE bindings.flow_id = ?
           UNION ALL
           SELECT bindings.binding_id, bindings.current_publication_id, publications.revision_id,
                  NULL, bindings.flow_id, bindings.health, 'poll', bindings.last_error_code, bindings.operator_state,
                  bindings.runtime_version, bindings.trigger_node_id, bindings.updated_at
           FROM poll_bindings AS bindings
           LEFT JOIN publications ON publications.publication_id = bindings.current_publication_id
           WHERE bindings.flow_id = ?
           UNION ALL
           SELECT bindings.binding_id, bindings.current_publication_id, publications.revision_id,
                  NULL, bindings.flow_id, bindings.health, 'integration', bindings.last_error_code, bindings.operator_state,
                  bindings.runtime_version, bindings.trigger_node_id, bindings.updated_at
           FROM integration_bindings AS bindings
           LEFT JOIN publications ON publications.publication_id = bindings.current_publication_id
           WHERE bindings.flow_id = ?
         ) ORDER BY triggerNodeId`,
      )
      .all(flowId, flowId, flowId, flowId) as unknown as readonly StoredTriggerBinding[]
  }

  triggerBinding(flowId: string, triggerNodeId: string): StoredTriggerBinding | undefined {
    return this.listTriggerBindings(flowId).find((binding) => binding.triggerNodeId == triggerNodeId)
  }

  setTriggerOperatorState(
    flowId: string,
    triggerNodeId: string,
    operatorState: StoredTriggerBinding['operatorState'],
    updatedAt: number,
  ): StoredTriggerBinding | undefined {
    return this.#transaction(() => {
      const current = this.triggerBinding(flowId, triggerNodeId)
      if (current?.currentPublicationId == null) return
      if (current.operatorState == operatorState) return current
      switch (current.kind) {
        case 'webhook':
          this.#database
            .prepare(
              `UPDATE webhook_bindings
               SET operator_state = ?, runtime_version = runtime_version + 1, updated_at = ?
               WHERE endpoint_id = ? AND current_publication_id IS NOT NULL`,
            )
            .run(operatorState, updatedAt, current.bindingId)
          break
        case 'cron':
          this.#database
            .prepare(
              `UPDATE cron_bindings
               SET operator_state = ?, runtime_version = runtime_version + 1, updated_at = ?
               WHERE binding_id = ? AND current_publication_id IS NOT NULL`,
            )
            .run(operatorState, updatedAt, current.bindingId)
          break
        case 'poll':
          this.#database
            .prepare(
              `UPDATE poll_bindings
               SET operator_state = ?, runtime_version = runtime_version + 1, updated_at = ?,
                   active_claim_id = NULL, active_lease_token = NULL, active_lease_expires_at = NULL
               WHERE binding_id = ? AND current_publication_id IS NOT NULL`,
            )
            .run(operatorState, updatedAt, current.bindingId)
          break
        case 'integration':
          this.#database
            .prepare(
              `UPDATE integration_bindings
               SET operator_state = ?, runtime_version = runtime_version + 1, updated_at = ?,
                   reconcile_at = CASE WHEN ? = 'active' THEN ? ELSE reconcile_at END
               WHERE binding_id = ? AND current_publication_id IS NOT NULL`,
            )
            .run(operatorState, updatedAt, operatorState, updatedAt, current.bindingId)
          break
      }
      insertTriggerActivity(this.#database, current.bindingId, operatorState == 'paused' ? 'operator.paused' : 'operator.resumed', updatedAt)
      pruneTriggerActivities(this.#database, updatedAt, 100)
      return this.triggerBinding(flowId, triggerNodeId)
    })
  }

  listTriggerActivities(
    bindingId: string,
    limit: number,
    now: number,
    after?: { readonly activityId: string; readonly createdAt: number },
  ): readonly StoredTriggerActivity[] {
    return (after == null
      ? this.#database
          .prepare(
            `SELECT activity_id AS activityId, created_at AS createdAt, error_code AS errorCode,
                    error_message AS errorMessage, kind
             FROM trigger_activities
             WHERE binding_id = ? AND expires_at > ?
             ORDER BY created_at DESC, activity_id DESC
             LIMIT ?`,
          )
          .all(bindingId, now, limit)
      : this.#database
          .prepare(
            `SELECT activity_id AS activityId, created_at AS createdAt, error_code AS errorCode,
                    error_message AS errorMessage, kind
             FROM trigger_activities
             WHERE binding_id = ? AND expires_at > ?
               AND (created_at < ? OR (created_at = ? AND activity_id < ?))
             ORDER BY created_at DESC, activity_id DESC
             LIMIT ?`,
          )
          .all(bindingId, now, after.createdAt, after.createdAt, after.activityId, limit)) as unknown as readonly StoredTriggerActivity[]
  }

  acceptWebhookTarget(input: {
    readonly closureDigest: string
    readonly content: string
    readonly endpointId: string
    readonly engineContract: string
    readonly flowId: string
    readonly modelVersion: number
    readonly occurrenceId: string
    readonly payload: JsonValue
    readonly publicationId: string
    readonly requestDigest: string
    readonly revisionDigest: string
    readonly revisionId: string
    readonly runtimeVersion: number
    readonly triggerJson: string
    readonly triggerNodeId: string
  }): RunAdmission | undefined {
    return this.#transaction(() => {
      const current = this.#database
        .prepare(
          `SELECT 1 AS current
           FROM webhook_bindings AS bindings
           JOIN flow_live
             ON flow_live.flow_id = bindings.flow_id
            AND flow_live.publication_id = bindings.current_publication_id
           JOIN publications
             ON publications.publication_id = bindings.current_publication_id
           WHERE bindings.endpoint_id = ?
             AND bindings.flow_id = ?
             AND bindings.trigger_node_id = ?
             AND bindings.current_publication_id = ?
             AND bindings.runtime_version = ?
             AND bindings.operator_state = 'active'
             AND bindings.trigger_json = ?
             AND publications.revision_id = ?
             AND publications.revision_digest = ?
             AND publications.closure_digest = ?
             AND publications.engine_contract = ?
             AND publications.model_version = ?`,
        )
        .get(
          input.endpointId,
          input.flowId,
          input.triggerNodeId,
          input.publicationId,
          input.runtimeVersion,
          input.triggerJson,
          input.revisionId,
          input.revisionDigest,
          input.closureDigest,
          input.engineContract,
          input.modelVersion,
        )
      if (current == null) return

      const accepted = this.#acceptTriggerOccurrence({ ...input, source: 'trigger' })
      if (accepted.kind == 'overloaded') return accepted
      if (accepted.kind == 'accepted' && accepted.created) {
        this.#database
          .prepare('INSERT INTO webhook_admissions (run_id, endpoint_id, runtime_version, publication_id) VALUES (?, ?, ?, ?)')
          .run(accepted.runId, input.endpointId, input.runtimeVersion, input.publicationId)
      }
      return accepted
    })
  }

  acceptCronTarget(
    input: StoredCronTarget & { readonly nextScheduledAt: number; readonly occurrenceId: string; readonly requestDigest: string },
  ): RunAdmission | undefined {
    return this.#transaction(() => {
      const current = this.#database
        .prepare(
          `SELECT 1 AS current
           FROM cron_bindings AS bindings
           JOIN flow_live
             ON flow_live.flow_id = bindings.flow_id
            AND flow_live.publication_id = bindings.current_publication_id
           JOIN publications
             ON publications.publication_id = bindings.current_publication_id
           WHERE bindings.binding_id = ?
             AND bindings.flow_id = ?
             AND bindings.trigger_node_id = ?
             AND bindings.current_publication_id = ?
             AND bindings.runtime_version = ?
             AND bindings.operator_state = 'active'
             AND bindings.trigger_json = ?
             AND bindings.schedule_json = ?
             AND bindings.next_at = ?
             AND publications.revision_id = ?
             AND publications.revision_digest = ?
             AND publications.closure_digest = ?
             AND publications.engine_contract = ?
             AND publications.model_version = ?`,
        )
        .get(
          input.bindingId,
          input.flowId,
          input.triggerNodeId,
          input.publicationId,
          input.runtimeVersion,
          input.triggerJson,
          input.scheduleJson,
          input.nextAt,
          input.revisionId,
          input.revisionDigest,
          input.closureDigest,
          input.engineContract,
          input.modelVersion,
        )
      if (current == null) return

      const scheduledAt = new Date(input.nextAt).toISOString()
      const accepted = this.#acceptTriggerOccurrence({
        content: input.content,
        closureDigest: input.closureDigest,
        flowId: input.flowId,
        modelVersion: input.modelVersion,
        occurrenceId: input.occurrenceId,
        payload: { scheduledAt },
        publicationId: input.publicationId,
        requestDigest: input.requestDigest,
        revisionDigest: input.revisionDigest,
        revisionId: input.revisionId,
        source: 'trigger',
        triggerNodeId: input.triggerNodeId,
      })
      if (accepted.kind == 'overloaded') return accepted
      if (accepted.kind == 'accepted' && accepted.created) {
        this.#database
          .prepare('INSERT INTO cron_admissions (run_id, binding_id, runtime_version, publication_id, scheduled_at) VALUES (?, ?, ?, ?, ?)')
          .run(accepted.runId, input.bindingId, input.runtimeVersion, input.publicationId, scheduledAt)
      }
      this.#database.prepare('UPDATE cron_bindings SET next_at = ? WHERE binding_id = ?').run(input.nextScheduledAt, input.bindingId)
      return accepted
    })
  }

  dueCron(now: number, limit: number): readonly StoredCronTarget[] {
    return this.#database
      .prepare(
        `SELECT
           bindings.binding_id AS bindingId,
           bindings.flow_id AS flowId,
           bindings.trigger_node_id AS triggerNodeId,
           bindings.runtime_version AS runtimeVersion,
           bindings.trigger_json AS triggerJson,
           bindings.schedule_json AS scheduleJson,
           bindings.next_at AS nextAt,
           publications.publication_id AS publicationId,
           publications.revision_id AS revisionId,
           publications.revision_digest AS revisionDigest,
           publications.closure_digest AS closureDigest,
           publications.engine_contract AS engineContract,
           publications.model_version AS modelVersion,
           revisions.content
         FROM cron_bindings AS bindings
         JOIN flow_live
           ON flow_live.flow_id = bindings.flow_id
          AND flow_live.publication_id = bindings.current_publication_id
         JOIN publications
           ON publications.publication_id = bindings.current_publication_id
         JOIN revisions
           ON revisions.revision_id = publications.revision_id
         WHERE bindings.trigger_json IS NOT NULL
           AND bindings.schedule_json IS NOT NULL
           AND bindings.operator_state = 'active'
           AND bindings.next_at <= ?
         ORDER BY bindings.next_at, bindings.binding_id
         LIMIT ?`,
      )
      .all(now, limit) as unknown as readonly StoredCronTarget[]
  }

  nextCronAt(): number | undefined {
    const row = this.#database
      .prepare(
        `SELECT MIN(bindings.next_at) AS nextAt
         FROM cron_bindings AS bindings
         JOIN flow_live
           ON flow_live.flow_id = bindings.flow_id
          AND flow_live.publication_id = bindings.current_publication_id
         WHERE bindings.trigger_json IS NOT NULL
           AND bindings.schedule_json IS NOT NULL
           AND bindings.operator_state = 'active'`,
      )
      .get() as { readonly nextAt: number | null }
    return row.nextAt ?? undefined
  }

  webhookTarget(endpointId: string): StoredWebhookTarget | undefined {
    return this.#database
      .prepare(
        `SELECT
           bindings.endpoint_id AS endpointId,
           bindings.flow_id AS flowId,
           bindings.trigger_node_id AS triggerNodeId,
           bindings.runtime_version AS runtimeVersion,
           bindings.trigger_json AS triggerJson,
           publications.publication_id AS publicationId,
           publications.revision_id AS revisionId,
           publications.revision_digest AS revisionDigest,
           publications.closure_digest AS closureDigest,
           publications.engine_contract AS engineContract,
           revisions.content
         FROM webhook_bindings AS bindings
         JOIN flow_live
           ON flow_live.flow_id = bindings.flow_id
          AND flow_live.publication_id = bindings.current_publication_id
         JOIN publications
           ON publications.publication_id = bindings.current_publication_id
         JOIN revisions
           ON revisions.revision_id = publications.revision_id
         WHERE bindings.endpoint_id = ?
           AND bindings.trigger_json IS NOT NULL
           AND bindings.operator_state = 'active'`,
      )
      .get(endpointId) as StoredWebhookTarget | undefined
  }

  webhookEndpoint(flowId: string, triggerNodeId: string): string | undefined {
    return (
      this.#database
        .prepare(
          `SELECT bindings.endpoint_id AS endpointId
           FROM webhook_bindings AS bindings
           JOIN flow_live
             ON flow_live.flow_id = bindings.flow_id
            AND flow_live.publication_id = bindings.current_publication_id
           WHERE bindings.flow_id = ? AND bindings.trigger_node_id = ?`,
        )
        .get(flowId, triggerNodeId) as { readonly endpointId: string } | undefined
    )?.endpointId
  }
}
