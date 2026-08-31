import type { JsonValue, TriggerNode } from '@oomol-lab/open-flow/flow-change'
import type { DatabaseSync } from 'node:sqlite'
import type {
  IntegrationHealth,
  RunAdmission,
  StoredIntegrationBinding,
  StoredIntegrationState,
  StoredIntegrationTarget,
  TriggerOccurrenceInput,
} from './trigger-store.ts'

import { insertTriggerActivity, pruneTriggerActivities } from './trigger-activity.ts'

export interface IntegrationCandidate {
  readonly bindingId: string
  readonly checkpointJson: string | null
  readonly connectionId: string
  readonly endpointId: string
  readonly flowId: string
  readonly nodeId: string
  readonly operationId: string
  readonly reconcileAt: number | null
  readonly status: 'cleanup' | 'preparing' | 'ready'
  readonly subscriptionJson: string | null
  readonly triggerJson: string
}

export class IntegrationStore {
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
    integrations: readonly { readonly connectionId: string; readonly triggerJson: string; readonly triggerNodeId: string }[],
    now: number,
  ): boolean {
    const candidates = []
    for (const integration of integrations) {
      const current = this.integrationBinding(flowId, integration.triggerNodeId)
      if (current != null) {
        if (
          current.currentPublicationId != expectedLivePublicationId ||
          current.triggerJson != integration.triggerJson ||
          current.connectionId != integration.connectionId ||
          current.health != 'healthy'
        ) {
          return false
        }
        continue
      }
      const trigger = JSON.parse(integration.triggerJson) as TriggerNode
      if (trigger.kind != 'integration' || trigger.definition.key != 'stripe.on_event') return false
      candidates.push(integration)
    }
    for (const integration of candidates) {
      const bindingId = 'binding_' + crypto.randomUUID().replaceAll('-', '')
      const endpointId = 'endpoint_' + crypto.randomUUID().replaceAll('-', '')
      this.#database
        .prepare(
          `INSERT INTO integration_candidates (
             operation_id, node_id, binding_id, endpoint_id, flow_id, trigger_json, connection_id,
             checkpoint_json, subscription_json, reconcile_at, status, next_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'preparing', ?, ?, ?)`,
        )
        .run(operationId, integration.triggerNodeId, bindingId, endpointId, flowId, integration.triggerJson, integration.connectionId, now, now, now)
      this.#database
        .prepare(
          `INSERT INTO publish_work (
             work_id, operation_id, node_id, action, status, next_at, created_at, updated_at
           ) VALUES (?, ?, ?, 'integration.prepare', 'pending', ?, ?, ?)`,
        )
        .run('work_' + crypto.randomUUID().replaceAll('-', ''), operationId, integration.triggerNodeId, now, now, now)
    }
    return true
  }

  dueCandidates(now: number, limit: number): readonly IntegrationCandidate[] {
    return this.#transaction(() => {
      this.#database
        .prepare(
          `UPDATE integration_candidates
           SET status = 'cleanup', next_at = ?, updated_at = ?
           WHERE status != 'cleanup' AND EXISTS (
             SELECT 1 FROM publish_operations
             WHERE publish_operations.operation_id = integration_candidates.operation_id
               AND (publish_operations.status != 'pending' OR publish_operations.deadline_at <= ?)
           )`,
        )
        .run(now, now, now)
      return this.#database
        .prepare(
          `SELECT binding_id AS bindingId, checkpoint_json AS checkpointJson, connection_id AS connectionId,
                  endpoint_id AS endpointId, flow_id AS flowId, node_id AS nodeId, operation_id AS operationId,
                  reconcile_at AS reconcileAt, status, subscription_json AS subscriptionJson, trigger_json AS triggerJson
           FROM integration_candidates
           WHERE status IN ('preparing', 'cleanup') AND next_at <= ?
           ORDER BY next_at, operation_id, node_id
           LIMIT ?`,
        )
        .all(now, limit) as unknown as readonly IntegrationCandidate[]
    })
  }

  initializeCandidate(candidate: IntegrationCandidate, checkpoint: JsonValue, subscription: Readonly<Record<string, JsonValue>>, now: number): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE integration_candidates
           SET checkpoint_json = ?, subscription_json = ?, updated_at = ?
           WHERE operation_id = ? AND node_id = ? AND status = 'preparing'
             AND checkpoint_json IS NULL AND subscription_json IS NULL`,
        )
        .run(JSON.stringify(checkpoint), JSON.stringify(subscription), now, candidate.operationId, candidate.nodeId).changes == 1
    )
  }

  candidate(operationId: string, nodeId: string): IntegrationCandidate | undefined {
    return this.#database
      .prepare(
        `SELECT binding_id AS bindingId, checkpoint_json AS checkpointJson, connection_id AS connectionId,
                endpoint_id AS endpointId, flow_id AS flowId, node_id AS nodeId, operation_id AS operationId,
                reconcile_at AS reconcileAt, status, subscription_json AS subscriptionJson, trigger_json AS triggerJson
         FROM integration_candidates WHERE operation_id = ? AND node_id = ?`,
      )
      .get(operationId, nodeId) as IntegrationCandidate | undefined
  }

  retryCandidate(candidate: IntegrationCandidate, nextAt: number, now: number): void {
    this.#database
      .prepare(
        `UPDATE integration_candidates SET next_at = ?, updated_at = ?
         WHERE operation_id = ? AND node_id = ? AND status = ?`,
      )
      .run(nextAt, now, candidate.operationId, candidate.nodeId, candidate.status)
  }

  failCandidate(candidate: IntegrationCandidate, code: string, message: string, now: number): void {
    this.#transaction(() => {
      this.#database
        .prepare(
          `UPDATE publish_work
           SET status = 'failed', next_at = NULL, issue_code = ?, issue_message = ?, updated_at = ?
           WHERE operation_id = ? AND node_id = ? AND action = 'integration.prepare' AND status = 'pending'`,
        )
        .run(code, message.slice(0, 512), now, candidate.operationId, candidate.nodeId)
      this.#database
        .prepare(
          `UPDATE integration_candidates SET status = 'cleanup', next_at = ?, updated_at = ?
           WHERE operation_id = ? AND node_id = ? AND status = 'preparing'`,
        )
        .run(now, now, candidate.operationId, candidate.nodeId)
    })
  }

  markCandidateReady(candidate: IntegrationCandidate, now: number): boolean {
    return this.#transaction(() => {
      const changed = this.#database
        .prepare(
          `UPDATE integration_candidates
           SET status = 'ready', next_at = NULL, updated_at = ?
           WHERE operation_id = ? AND node_id = ? AND status = 'preparing'
             AND checkpoint_json IS NOT NULL AND subscription_json IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM publish_operations
               WHERE operation_id = ? AND status = 'pending' AND deadline_at > ?
             )`,
        )
        .run(now, candidate.operationId, candidate.nodeId, candidate.operationId, now).changes
      if (changed != 1) return false
      this.#database
        .prepare(
          `UPDATE publish_work SET status = 'ready', next_at = NULL, updated_at = ?
           WHERE operation_id = ? AND node_id = ? AND action = 'integration.prepare' AND status = 'pending'`,
        )
        .run(now, candidate.operationId, candidate.nodeId)
      return true
    })
  }

  deleteCandidate(candidate: IntegrationCandidate): boolean {
    return (
      this.#database
        .prepare("DELETE FROM integration_candidates WHERE operation_id = ? AND node_id = ? AND status = 'cleanup'")
        .run(candidate.operationId, candidate.nodeId).changes == 1
    )
  }

  cleanupCandidates(operationId: string, now: number): void {
    this.#database
      .prepare(
        `UPDATE integration_candidates SET status = 'cleanup', next_at = ?, updated_at = ?
         WHERE operation_id = ? AND status != 'cleanup'`,
      )
      .run(now, now, operationId)
  }

  candidatesReady(
    operationId: string,
    flowId: string,
    expectedLivePublicationId: string | null,
    integrations: readonly { readonly connectionId: string; readonly triggerJson: string; readonly triggerNodeId: string }[],
  ): boolean {
    for (const integration of integrations) {
      const current = this.integrationBinding(flowId, integration.triggerNodeId)
      if (
        current != null &&
        current.currentPublicationId == expectedLivePublicationId &&
        current.triggerJson == integration.triggerJson &&
        current.connectionId == integration.connectionId &&
        current.health == 'healthy'
      ) {
        continue
      }
      const candidate = this.candidate(operationId, integration.triggerNodeId)
      if (
        candidate?.status != 'ready' ||
        candidate.flowId != flowId ||
        candidate.triggerJson != integration.triggerJson ||
        candidate.connectionId != integration.connectionId
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
    integration: { readonly connectionId: string; readonly triggerJson: string; readonly triggerNodeId: string },
    now: number,
  ): boolean {
    const candidate = this.candidate(operationId, integration.triggerNodeId)
    if (
      candidate?.status != 'ready' ||
      candidate.flowId != flowId ||
      candidate.triggerJson != integration.triggerJson ||
      candidate.connectionId != integration.connectionId ||
      candidate.checkpointJson == null ||
      candidate.subscriptionJson == null
    ) {
      return false
    }
    this.#database
      .prepare(
        `INSERT INTO integration_bindings (
           binding_id, endpoint_id, flow_id, trigger_node_id, current_publication_id,
           runtime_version, trigger_json, connection_id, health, reconcile_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'healthy', ?, ?)`,
      )
      .run(
        candidate.bindingId,
        candidate.endpointId,
        flowId,
        integration.triggerNodeId,
        publicationId,
        integration.triggerJson,
        integration.connectionId,
        candidate.reconcileAt,
        now,
      )
    this.#database
      .prepare(
        `INSERT INTO integration_states (
           binding_id, runtime_version, trigger_json, connection_id,
           checkpoint_json, subscription_json, reconcile_at, updated_at
         ) VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        candidate.bindingId,
        integration.triggerJson,
        integration.connectionId,
        candidate.checkpointJson,
        candidate.subscriptionJson,
        candidate.reconcileAt,
        now,
      )
    this.#database.prepare('DELETE FROM integration_candidates WHERE operation_id = ? AND node_id = ?').run(operationId, integration.triggerNodeId)
    return true
  }

  updateCandidateCheckpoint(candidate: IntegrationCandidate, expected: string, checkpoint: string, now: number): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE integration_candidates SET checkpoint_json = ?, updated_at = ?
           WHERE operation_id = ? AND node_id = ? AND status = ? AND checkpoint_json = ?`,
        )
        .run(checkpoint, now, candidate.operationId, candidate.nodeId, candidate.status, expected).changes == 1
    )
  }

  updateCandidateSubscription(candidate: IntegrationCandidate, expected: string, subscription: string, reconcileAt: number, now: number): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE integration_candidates SET subscription_json = ?, reconcile_at = ?, updated_at = ?
           WHERE operation_id = ? AND node_id = ? AND status = ? AND subscription_json = ?`,
        )
        .run(subscription, reconcileAt, now, candidate.operationId, candidate.nodeId, candidate.status, expected).changes == 1
    )
  }

  acceptIntegrationTarget(
    input: StoredIntegrationTarget & { readonly occurrenceId: string; readonly payload: JsonValue; readonly requestDigest: string },
  ): RunAdmission | undefined {
    return this.#transaction(() => {
      const current = this.#database
        .prepare(
          `SELECT 1
           FROM integration_bindings AS bindings
           JOIN flow_live
             ON flow_live.flow_id = bindings.flow_id
            AND flow_live.publication_id = bindings.current_publication_id
           JOIN publications
             ON publications.publication_id = bindings.current_publication_id
           WHERE bindings.binding_id = ?
             AND bindings.endpoint_id = ?
             AND bindings.flow_id = ?
             AND bindings.trigger_node_id = ?
             AND bindings.current_publication_id = ?
             AND bindings.runtime_version = ?
             AND bindings.trigger_json = ?
             AND bindings.connection_id = ?
             AND bindings.health = 'healthy'
             AND bindings.operator_state = 'active'
             AND publications.revision_id = ?
             AND publications.revision_digest = ?
             AND publications.closure_digest = ?
             AND publications.engine_contract = ?
             AND publications.model_version = ?`,
        )
        .get(
          input.bindingId,
          input.endpointId,
          input.flowId,
          input.triggerNodeId,
          input.currentPublicationId,
          input.runtimeVersion,
          input.triggerJson,
          input.connectionId,
          input.revisionId,
          input.revisionDigest,
          input.closureDigest,
          input.engineContract,
          input.modelVersion,
        )
      if (current == null) return

      const accepted = this.#acceptTriggerOccurrence({
        content: input.content,
        closureDigest: input.closureDigest,
        flowId: input.flowId,
        modelVersion: input.modelVersion,
        occurrenceId: input.occurrenceId,
        payload: input.payload,
        publicationId: input.currentPublicationId,
        requestDigest: input.requestDigest,
        revisionDigest: input.revisionDigest,
        revisionId: input.revisionId,
        source: 'trigger',
        triggerNodeId: input.triggerNodeId,
      })
      if (accepted.kind == 'overloaded') return accepted
      if (accepted.kind == 'accepted' && accepted.created) {
        this.#database
          .prepare('INSERT INTO integration_admissions (run_id, binding_id, runtime_version, publication_id) VALUES (?, ?, ?, ?)')
          .run(accepted.runId, input.bindingId, input.runtimeVersion, input.currentPublicationId)
      }
      return accepted
    })
  }

  createIntegrationState(
    binding: Pick<StoredIntegrationBinding, 'bindingId' | 'connectionId' | 'runtimeVersion' | 'triggerJson'>,
    checkpoint: JsonValue,
    subscription: Readonly<Record<string, JsonValue>>,
    now: number,
  ): boolean {
    return (
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO integration_states (
             binding_id, runtime_version, trigger_json, connection_id,
             checkpoint_json, subscription_json, reconcile_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          binding.bindingId,
          binding.runtimeVersion,
          binding.triggerJson,
          binding.connectionId,
          JSON.stringify(checkpoint),
          JSON.stringify(subscription),
          now,
          now,
        ).changes == 1
    )
  }

  deleteIntegrationState(bindingId: string, runtimeVersion: number): boolean {
    return this.#database.prepare('DELETE FROM integration_states WHERE binding_id = ? AND runtime_version = ?').run(bindingId, runtimeVersion).changes == 1
  }

  dueIntegrations(now: number, limit: number): readonly StoredIntegrationBinding[] {
    return this.#database
      .prepare(
        `SELECT binding_id AS bindingId, endpoint_id AS endpointId, flow_id AS flowId, trigger_node_id AS triggerNodeId,
                current_publication_id AS currentPublicationId, runtime_version AS runtimeVersion,
                trigger_json AS triggerJson, connection_id AS connectionId, health
         FROM integration_bindings AS bindings
         WHERE bindings.operator_state = 'active'
           AND (bindings.retry_at <= ?
            OR (
              bindings.retry_at IS NULL AND (
                bindings.reconcile_at <= ? OR EXISTS (
                  SELECT 1 FROM integration_states AS states
                  WHERE states.binding_id = bindings.binding_id AND states.reconcile_at <= ?
                )
              )
            ))
         ORDER BY COALESCE(bindings.retry_at, bindings.reconcile_at), bindings.binding_id
         LIMIT ?`,
      )
      .all(now, now, now, limit) as unknown as readonly StoredIntegrationBinding[]
  }

  failIntegration(
    bindingId: string,
    runtimeVersion: number,
    outcome:
      | {
          readonly errorCode: string
          readonly health: Extract<IntegrationHealth, 'failed' | 'needs_reauth'>
          readonly now: number
        }
      | { readonly retryAt: number },
  ): void {
    if ('retryAt' in outcome) {
      this.#database
        .prepare('UPDATE integration_bindings SET retry_at = ?, reconcile_at = NULL WHERE binding_id = ? AND runtime_version = ?')
        .run(outcome.retryAt, bindingId, runtimeVersion)
      return
    }
    this.#transaction(() => {
      const current = this.#database
        .prepare('SELECT health, last_error_code AS lastErrorCode FROM integration_bindings WHERE binding_id = ? AND runtime_version = ?')
        .get(bindingId, runtimeVersion) as { readonly health: IntegrationHealth; readonly lastErrorCode: string | null } | undefined
      const changed = this.#database
        .prepare(
          `UPDATE integration_bindings
           SET health = ?, last_error_code = ?, retry_at = NULL, reconcile_at = NULL, updated_at = ?
           WHERE binding_id = ? AND runtime_version = ?`,
        )
        .run(outcome.health, outcome.errorCode, outcome.now, bindingId, runtimeVersion)
      if (changed.changes == 1 && current?.health != outcome.health) {
        insertTriggerActivity(
          this.#database,
          bindingId,
          outcome.health == 'needs_reauth' ? 'health.needs_reauth' : 'health.failed',
          outcome.now,
          outcome.errorCode,
        )
      }
      this.#database.prepare('UPDATE integration_states SET reconcile_at = NULL WHERE binding_id = ?').run(bindingId)
      pruneTriggerActivities(this.#database, outcome.now, 100)
    })
  }

  integrationBinding(flowId: string, triggerNodeId: string): StoredIntegrationBinding | undefined {
    return this.#database
      .prepare(
        `SELECT binding_id AS bindingId, endpoint_id AS endpointId, flow_id AS flowId, trigger_node_id AS triggerNodeId,
                current_publication_id AS currentPublicationId, runtime_version AS runtimeVersion,
                trigger_json AS triggerJson, connection_id AS connectionId, health
         FROM integration_bindings WHERE flow_id = ? AND trigger_node_id = ?`,
      )
      .get(flowId, triggerNodeId) as StoredIntegrationBinding | undefined
  }

  integrationState(bindingId: string): StoredIntegrationState | undefined {
    return this.#database
      .prepare(
        `SELECT binding_id AS bindingId, runtime_version AS runtimeVersion,
                trigger_json AS triggerJson, connection_id AS connectionId,
                checkpoint_json AS checkpointJson, subscription_json AS subscriptionJson,
                reconcile_at AS reconcileAt, updated_at AS updatedAt
         FROM integration_states WHERE binding_id = ?`,
      )
      .get(bindingId) as StoredIntegrationState | undefined
  }

  integrationTarget(endpointId: string): StoredIntegrationTarget | undefined {
    const row = this.#database
      .prepare(
        `SELECT bindings.binding_id AS bindingId, bindings.endpoint_id AS endpointId, bindings.flow_id AS flowId,
                bindings.trigger_node_id AS triggerNodeId,
                bindings.current_publication_id AS currentPublicationId,
                bindings.runtime_version AS runtimeVersion, bindings.trigger_json AS triggerJson,
                bindings.connection_id AS connectionId, bindings.health,
                publications.revision_id AS revisionId, publications.revision_digest AS revisionDigest,
                publications.closure_digest AS closureDigest, publications.engine_contract AS engineContract,
                publications.model_version AS modelVersion,
                revisions.content,
                states.binding_id AS stateBindingId, states.runtime_version AS stateRuntimeVersion,
                states.trigger_json AS stateTriggerJson, states.connection_id AS stateConnectionId,
                states.checkpoint_json AS stateCheckpointJson, states.subscription_json AS stateSubscriptionJson,
                states.reconcile_at AS stateReconcileAt, states.updated_at AS stateUpdatedAt
         FROM integration_bindings AS bindings
         JOIN flow_live
           ON flow_live.flow_id = bindings.flow_id
          AND flow_live.publication_id = bindings.current_publication_id
         JOIN publications ON publications.publication_id = bindings.current_publication_id
         JOIN revisions ON revisions.revision_id = publications.revision_id
         LEFT JOIN integration_states AS states ON states.binding_id = bindings.binding_id
         WHERE bindings.endpoint_id = ?
           AND bindings.operator_state = 'active'`,
      )
      .get(endpointId) as
      | (Omit<StoredIntegrationTarget, 'state'> & {
          readonly stateBindingId: string | null
          readonly stateCheckpointJson: string | null
          readonly stateConnectionId: string | null
          readonly stateReconcileAt: number | null
          readonly stateRuntimeVersion: number | null
          readonly stateSubscriptionJson: string | null
          readonly stateTriggerJson: string | null
          readonly stateUpdatedAt: number | null
        })
      | undefined
    if (row == null) return
    const {
      stateBindingId,
      stateCheckpointJson,
      stateConnectionId,
      stateReconcileAt,
      stateRuntimeVersion,
      stateSubscriptionJson,
      stateTriggerJson,
      stateUpdatedAt,
      ...target
    } = row
    if (
      stateBindingId == null ||
      stateCheckpointJson == null ||
      stateConnectionId == null ||
      stateRuntimeVersion == null ||
      stateSubscriptionJson == null ||
      stateTriggerJson == null ||
      stateUpdatedAt == null
    ) {
      return target
    }
    return {
      ...target,
      state: {
        bindingId: stateBindingId,
        checkpointJson: stateCheckpointJson,
        connectionId: stateConnectionId,
        reconcileAt: stateReconcileAt,
        runtimeVersion: stateRuntimeVersion,
        subscriptionJson: stateSubscriptionJson,
        triggerJson: stateTriggerJson,
        updatedAt: stateUpdatedAt,
      },
    }
  }

  markIntegrationSynced(bindingId: string, runtimeVersion: number, active: boolean, now: number): boolean {
    return this.#transaction(() => {
      const current = this.#database
        .prepare('SELECT health, last_error_code AS lastErrorCode FROM integration_bindings WHERE binding_id = ? AND runtime_version = ?')
        .get(bindingId, runtimeVersion) as { readonly health: IntegrationHealth; readonly lastErrorCode: string | null } | undefined
      const changed = this.#database
        .prepare(
          `UPDATE integration_bindings
           SET reconcile_at = NULL, retry_at = NULL,
               health = CASE WHEN ? = 1 THEN 'healthy' ELSE health END,
               last_error_code = CASE WHEN ? = 1 THEN NULL ELSE last_error_code END,
               updated_at = ?
           WHERE binding_id = ? AND runtime_version = ?`,
        )
        .run(active ? 1 : 0, active ? 1 : 0, now, bindingId, runtimeVersion).changes
      if (changed == 1 && active && current?.lastErrorCode != null) {
        insertTriggerActivity(this.#database, bindingId, 'health.recovered', now)
      }
      this.#database
        .prepare(
          `UPDATE integration_states SET reconcile_at = NULL
           WHERE binding_id = ? AND runtime_version = ? AND reconcile_at <= ?`,
        )
        .run(bindingId, runtimeVersion, now)
      pruneTriggerActivities(this.#database, now, 100)
      return changed == 1
    })
  }

  nextIntegrationAt(): number | undefined {
    const row = this.#database
      .prepare(
        `SELECT MIN(next_at) AS nextAt FROM (
           SELECT retry_at AS next_at FROM integration_bindings WHERE operator_state = 'active' AND retry_at IS NOT NULL
           UNION ALL
           SELECT reconcile_at AS next_at FROM integration_bindings WHERE operator_state = 'active' AND retry_at IS NULL
           UNION ALL
           SELECT states.reconcile_at AS next_at
           FROM integration_states AS states
           JOIN integration_bindings AS bindings USING (binding_id)
           WHERE bindings.operator_state = 'active' AND bindings.retry_at IS NULL
           UNION ALL
           SELECT next_at FROM integration_candidates WHERE status IN ('preparing', 'cleanup') AND next_at IS NOT NULL
         )`,
      )
      .get() as { readonly nextAt: number | null }
    return row.nextAt ?? undefined
  }

  updateIntegrationCheckpoint(bindingId: string, runtimeVersion: number, expected: string, checkpoint: string, now: number): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE integration_states SET checkpoint_json = ?, updated_at = ?
           WHERE binding_id = ? AND runtime_version = ? AND checkpoint_json = ?`,
        )
        .run(checkpoint, now, bindingId, runtimeVersion, expected).changes == 1
    )
  }

  updateIntegrationSubscription(bindingId: string, runtimeVersion: number, expected: string, subscription: string, reconcileAt: number, now: number): boolean {
    return (
      this.#database
        .prepare(
          `UPDATE integration_states SET subscription_json = ?, reconcile_at = ?, updated_at = ?
           WHERE binding_id = ? AND runtime_version = ? AND subscription_json = ?`,
        )
        .run(subscription, reconcileAt, now, bindingId, runtimeVersion, expected).changes == 1
    )
  }
}
