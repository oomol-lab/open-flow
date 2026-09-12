import type { DatabaseSync } from 'node:sqlite'
import type { LlmConfig } from '../deployment/llm.ts'
import type { VariableStore } from './variable-store.ts'

import { decodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { flowDependencies, variableBindings } from '@oomol-lab/open-flow/flow-semantics'
import { AcceptanceError } from '../error.ts'

const encoder = new TextEncoder()

export interface AgentSnapshot {
  readonly bindings: Readonly<Record<string, string>>
  readonly model: LlmConfig
}

/**
 * Revision bodies, addressed by content identity.
 *
 * One Revision can back many Flows and Publications, so identity is shared:
 * storing the same identity with different content is always a conflict.
 */
export class RevisionStore {
  readonly #database: DatabaseSync
  readonly #llmConfig: () => LlmConfig | undefined
  readonly #variables: VariableStore

  constructor(database: DatabaseSync, variables: VariableStore, llmConfig: () => LlmConfig | undefined) {
    this.#database = database
    this.#llmConfig = llmConfig
    this.#variables = variables
  }

  /** Stores a Revision body once, rejecting a reused identity with different content. */
  ensure(input: { readonly content: string; readonly revisionDigest: string; readonly revisionId: string }): void {
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

  /**
   * Fixes the model deployment and resolved Variable values an Agent Run must
   * reuse for its first execution and every approval resume.
   */
  agentSnapshot(revisionId: string, triggerId?: string): AgentSnapshot | undefined {
    const row = this.#database
      .prepare(`SELECT content FROM revisions WHERE revision_id = ? AND EXISTS (
      SELECT 1 FROM json_each(revisions.content, '$.document.tasks') WHERE json_extract(value, '$.executor.kind') = 'agent'
    )`)
      .get(revisionId) as { readonly content: string } | undefined
    if (row == null) return
    const revision = decodeRevision(encoder.encode(row.content))
    const dependencies = flowDependencies(revision, triggerId)
    if (![...dependencies.tasks].some((id) => revision.document.tasks[id]?.executor.kind == 'agent')) return
    const model = this.#llmConfig()
    const bindings = this.#variables.resolve(variableBindings(revision, dependencies.inputBindings))
    if (model == null || bindings == null) throw new AcceptanceError('flow-invalid', 'Agent model or Variable configuration is unavailable.')
    return { model, bindings }
  }
}
