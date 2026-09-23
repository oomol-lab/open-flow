import type { DatabaseSync } from 'node:sqlite'
import type { LlmConfig } from '../deployment/llm.ts'
import type { VariableStore } from './variable-store.ts'

import { decodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { canonicalJsonBytes } from '@oomol-lab/open-flow/flow-encoding'
import { flowDependencies, variableBindings } from '@oomol-lab/open-flow/flow-semantics'
import { createHash } from 'node:crypto'
import { AcceptanceError } from '../error.ts'
import { applyRevisionPatch, createRevisionPatch } from './revision-delta.ts'

const encoder = new TextEncoder()
const maxDeltaDepth = 32

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
    const delta = this.#database.prepare('SELECT 1 FROM revision_deltas WHERE revision_id = ?').get(input.revisionId)
    if (delta != null) {
      const stored = this.read(input.revisionId)!
      if (stored.digest != input.revisionDigest) throw new AcceptanceError('revision-conflict', 'Revision identity already refers to different content.')
      this.materialize(input.revisionId)
      return
    }
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

  read(revisionId: string): { readonly content: string; readonly digest: string } | undefined {
    const chain: { readonly digest: string; readonly patch: string }[] = []
    let currentId = revisionId
    for (;;) {
      const full = this.#database.prepare('SELECT content, digest FROM revisions WHERE revision_id = ?').get(currentId) as
        | { readonly content: string; readonly digest: string }
        | undefined
      if (full != null) {
        let content = full.content
        const digest = chain[0]?.digest ?? full.digest
        for (const delta of chain.toReversed()) {
          content = new TextDecoder().decode(canonicalJsonBytes(applyRevisionPatch(content, delta.patch)))
          if (`sha256:${createHash('sha256').update(content).digest('hex')}` != delta.digest)
            throw new Error('Stored Revision delta does not match its digest.')
        }
        return { content, digest }
      }
      const delta = this.#database
        .prepare(`SELECT revision_deltas.base_revision_id AS baseRevisionId, revision_deltas.patch, metadata.digest
                  FROM revision_deltas JOIN flow_revisions AS metadata USING (revision_id) WHERE revision_deltas.revision_id = ?`)
        .get(currentId) as { readonly baseRevisionId: string; readonly digest: string | null; readonly patch: string } | undefined
      if (delta == null) {
        if (chain.length > 0) throw new Error('Stored Revision delta is missing its base.')
        return
      }
      if (delta.digest == null || chain.length >= maxDeltaDepth) throw new Error('Stored Revision delta chain is invalid.')
      chain.push({ digest: delta.digest, patch: delta.patch })
      currentId = delta.baseRevisionId
    }
  }

  saveDraft(input: { readonly content: string; readonly revisionDigest: string; readonly revisionId: string }, baseRevisionId: string): void {
    const base = this.read(baseRevisionId)
    if (base == null) throw new Error('Draft base Revision is missing.')
    const depth =
      (this.#database.prepare('SELECT depth FROM revision_deltas WHERE revision_id = ?').get(baseRevisionId) as { readonly depth: number } | undefined)
        ?.depth ?? 0
    if (depth < maxDeltaDepth) {
      const patch = createRevisionPatch(base.content, input.content)
      if (Buffer.byteLength(patch) < Buffer.byteLength(input.content)) {
        const restored = new TextDecoder().decode(canonicalJsonBytes(applyRevisionPatch(base.content, patch)))
        if (restored != input.content) throw new Error('Revision delta does not reproduce the committed content.')
        this.#database
          .prepare('INSERT INTO revision_deltas (revision_id, base_revision_id, patch, depth) VALUES (?, ?, ?, ?)')
          .run(input.revisionId, baseRevisionId, patch, depth + 1)
        return
      }
    }
    this.ensure(input)
  }

  materialize(revisionId: string): void {
    if (this.#database.prepare('SELECT 1 FROM revisions WHERE revision_id = ?').get(revisionId) != null) return
    const revision = this.read(revisionId)
    if (revision == null) throw new Error('Revision to materialize is missing.')
    this.#database.prepare('INSERT INTO revisions (revision_id, digest, content) VALUES (?, ?, ?)').run(revisionId, revision.digest, revision.content)
    this.#database.prepare('DELETE FROM revision_deltas WHERE revision_id = ?').run(revisionId)
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
    if (model == null || bindings == null) throw new AcceptanceError('flow-invalid', 'Agent model or environment variable configuration is unavailable.')
    return { model, bindings }
  }
}
