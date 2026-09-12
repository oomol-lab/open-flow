import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { DatabaseSync } from 'node:sqlite'
import type { RevisionStore } from './revision-store.ts'

export interface StoredFlow {
  readonly liveEnabled: number | null
  readonly publicationId: string | null
  readonly publishedRevisionId: string | null

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

const flowColumns = `(SELECT enabled FROM flow_live WHERE flow_live.flow_id = flows.flow_id) AS liveEnabled,
                     (SELECT publication_id FROM flow_live WHERE flow_live.flow_id = flows.flow_id) AS publicationId,
                     (SELECT publications.revision_id FROM flow_live JOIN publications USING (publication_id) WHERE flow_live.flow_id = flows.flow_id) AS publishedRevisionId, create_request_digest AS createRequestDigest, created_at AS createdAt,
                     draft_revision_id AS draftRevisionId, name, flow_id AS flowId, status, updated_at AS updatedAt`

/**
 * Flow identity, its Draft head, and its Presentation.
 *
 * A Flow is a top-level product resource: it has its own name, lifecycle,
 * Draft head, and Presentation, and it does not belong to a Project.
 */
export class FlowStore {
  readonly #database: DatabaseSync
  readonly #revisions: RevisionStore
  readonly #transaction: <Value>(operation: () => Value) => Value

  constructor(database: DatabaseSync, transaction: <Value>(operation: () => Value) => Value, revisions: RevisionStore) {
    this.#database = database
    this.#revisions = revisions
    this.#transaction = transaction
  }

  createFlow(input: {
    readonly actorId: string
    readonly connectorTeamId?: string
    readonly content: string
    readonly createdAt: number
    readonly digest: string
    readonly flowId: string
    readonly idempotencyKey: string
    readonly name: string
    readonly requestDigest: string
    readonly revisionId: string
  }): { readonly created: boolean; readonly flow: StoredFlow } | { readonly kind: 'conflict' } {
    return this.#transaction(() => {
      const existing = this.#database
        .prepare('SELECT flow_id AS flowId, create_request_digest AS requestDigest FROM flows WHERE create_idempotency_key = ?')
        .get(input.idempotencyKey) as { readonly flowId: string; readonly requestDigest: string } | undefined
      if (existing != null) {
        if (existing.requestDigest != input.requestDigest) return { kind: 'conflict' }
        return { created: false, flow: this.get(existing.flowId)! }
      }

      this.#revisions.ensure({ content: input.content, revisionDigest: input.digest, revisionId: input.revisionId })
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
      return { created: true, flow: this.get(input.flowId)! }
    })
  }

  get(flowId: string): StoredFlow | undefined {
    return this.#database.prepare(`SELECT ${flowColumns} FROM flows WHERE flow_id = ?`).get(flowId) as StoredFlow | undefined
  }

  list(
    limit: number,
    after?: { readonly createdAt: number; readonly flowId: string },
    includeTotal = false,
  ): { readonly flows: readonly StoredFlow[]; readonly total?: number } {
    const flows =
      after == null
        ? (this.#database.prepare(`SELECT ${flowColumns} FROM flows ORDER BY created_at, flow_id LIMIT ?`).all(limit) as unknown as StoredFlow[])
        : (this.#database
            .prepare(
              `SELECT ${flowColumns} FROM flows
               WHERE created_at > ? OR (created_at = ? AND flow_id > ?)
               ORDER BY created_at, flow_id LIMIT ?`,
            )
            .all(after.createdAt, after.createdAt, after.flowId, limit) as unknown as StoredFlow[])
    if (!includeTotal) return { flows }
    const total = (this.#database.prepare('SELECT COUNT(*) AS total FROM flows').get() as { readonly total: number }).total
    return { flows, total }
  }

  rename(flowId: string, name: string, updatedAt: number): StoredFlow | undefined {
    this.#database.prepare("UPDATE flows SET name = ?, updated_at = ? WHERE flow_id = ? AND status = 'active'").run(name, updatedAt, flowId)
    return this.get(flowId)
  }

  setEnabled(flowId: string, publicationId: string, enabled: boolean): StoredFlow | undefined {
    return this.#transaction(() => {
      const changed = this.#database
        .prepare(`UPDATE flow_live SET enabled = ?
        WHERE flow_id = ? AND publication_id = ?
          AND EXISTS (SELECT 1 FROM flows WHERE flows.flow_id = flow_live.flow_id AND status = 'active')`)
        .run(enabled ? 1 : 0, flowId, publicationId)
      return changed.changes == 0 ? undefined : this.get(flowId)
    })
  }

  retire(flowId: string, updatedAt: number): StoredFlow | undefined {
    return this.#transaction(() => {
      const flow = this.get(flowId)
      if (flow == null) return
      if (flow.status == 'retiring') {
        this.#database.prepare('UPDATE flows SET deletion_requested_at = COALESCE(deletion_requested_at, ?) WHERE flow_id = ?').run(updatedAt, flowId)
        return this.get(flowId)
      }
      this.#database
        .prepare("UPDATE flows SET status = 'retiring', updated_at = ?, deletion_requested_at = ? WHERE flow_id = ?")
        .run(updatedAt, updatedAt, flowId)
      this.#retire(flowId, updatedAt)
      return this.get(flowId)
    })
  }

  claimRetiring(attemptedAt: number): string | undefined {
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

  /** Whether an Integration still holds provider state that blocks physical deletion. */
  hasIntegrationState(flowId: string): boolean {
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

  /** Physically deletes a retired Flow once every Run of that Flow is gone. */
  delete(flowId: string): boolean {
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
      this.#database.prepare('DELETE FROM listener_work WHERE binding_id IN (SELECT binding_id FROM integration_bindings WHERE flow_id = ?)').run(flowId)
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

      const flow = this.get(input.flowId)
      if (flow == null) return { kind: 'not-found' }
      if (flow.status != 'active') return { kind: 'busy' }
      if (flow.draftRevisionId != input.expectedRevisionId) return { kind: 'conflict' }

      this.#revisions.ensure({ content: input.content, revisionDigest: input.digest, revisionId: input.revisionId })
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
      const flow = this.get(flowId)
      if (flow == null) return { kind: 'not-found' }
      if (flow.status != 'active') return { kind: 'busy' }
      const changed = this.#database
        .prepare('UPDATE flow_presentations SET revision = revision + 1, value = ?, updated_at = ? WHERE flow_id = ? AND revision = ?')
        .run(JSON.stringify(value), updatedAt, flowId, expectedRevision)
      if (changed.changes != 1) return { kind: 'conflict' }
      return { kind: 'updated', presentation: this.presentation(flowId)! }
    })
  }

  /** Detaches a retiring Flow from every live Trigger binding before physical deletion. */
  #retire(flowId: string, retiredAt: number): void {
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
}
