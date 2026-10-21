import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { DatabaseSync } from 'node:sqlite'

import { canonicalJsonBytes, decodeRevision, encodeRevision, upgradeWorkflowInterfaceDocument } from '@oomol-lab/open-flow/flow-encoding'
import { encodeFlowClosure, flowResourceReferences } from '@oomol-lab/open-flow/flow-semantics'
import { publishedWorkflowInterface } from '@oomol-lab/open-flow/workflow'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { FlowResourceReferenceStore } from './flow-resource-reference-store.ts'
import { RevisionStore } from './revision-store.ts'

/** Runs inside the schema migration transaction, before any request or background work starts. */
export function migrateWorkflowInterfaces(database: DatabaseSync): void {
  // Also accepts development databases created by the node-owned interface implementation.
  if (database.prepare("SELECT 1 FROM pragma_table_info('publications') WHERE name = 'interface_json'").get() != null) return
  const revisions = new RevisionStore(database)
  // Resolve and verify all old delta chains before rewriting any base or digest.
  for (const row of database.prepare('SELECT revision_id FROM revision_deltas').all()) revisions.materialize(String(row.revision_id))

  const migrated = new Map<string, RevisionContent>()
  for (const row of database.prepare('SELECT revision_id, content, digest FROM revisions').all()) {
    const revisionId = String(row.revision_id)
    try {
      const original = JSON.parse(String(row.content))
      if (original.document == null) continue // Unrelated unsupported historical content remains available for explicit repair.
      const document = upgradeWorkflowInterfaceDocument(original.document)
      if (isDeepStrictEqual(document, original.document)) continue
      if (hash(String(row.content)) != row.digest) throw new Error('Stored content does not match its digest.')
      const content = decodeRevision(canonicalJsonBytes({ ...original, document }))
      const encoded = new TextDecoder().decode(encodeRevision(content))
      const digest = hash(encoded)
      const closure = hash(encodeFlowClosure(content))
      database.prepare('UPDATE revisions SET content = ?, digest = ? WHERE revision_id = ?').run(encoded, digest, revisionId)
      database.prepare('UPDATE flow_revisions SET digest = ? WHERE revision_id = ?').run(digest, revisionId)
      database.prepare('UPDATE publications SET revision_digest = ?, closure_digest = ? WHERE revision_id = ?').run(digest, closure, revisionId)
      database.prepare('UPDATE publish_operations SET revision_digest = ?, closure_digest = ? WHERE revision_id = ?').run(digest, closure, revisionId)
      for (const run of database.prepare('SELECT run_id, source, trigger_node_id FROM runs WHERE revision_id = ?').all(revisionId)) {
        const triggerId = run.source == 'draft' && run.trigger_node_id != null ? String(run.trigger_node_id) : undefined
        database
          .prepare('UPDATE runs SET revision_digest = ?, closure_digest = ? WHERE run_id = ?')
          .run(digest, hash(encodeFlowClosure(content, triggerId)), run.run_id!)
      }
      migrated.set(revisionId, content)
    } catch (cause) {
      throw new Error(`Cannot migrate workflow interface for Revision ${revisionId}. The database upgrade was rolled back.`, { cause })
    }
  }

  function read(revisionId: string, interfaceOnly = false): RevisionContent {
    const content = migrated.get(revisionId)
    if (content != null) return content
    const stored = revisions.read(revisionId)
    if (stored == null) throw new Error(`Cannot migrate publication interface: Revision ${revisionId} is missing.`)
    if (hash(stored.content) != stored.digest) throw new Error(`Cannot migrate publication interface: Revision ${revisionId} has an invalid digest.`)
    if (!interfaceOnly) return decodeRevision(new TextEncoder().encode(stored.content))
    // Historical Task/Subflow definitions remain unsupported, but must not block interface snapshots.
    const source = JSON.parse(stored.content)
    const nodes = z.record(z.string(), z.looseObject({ kind: z.string() })).parse(source.document?.graph?.nodes)
    return decodeRevision(
      canonicalJsonBytes({
        ...source,
        document: {
          bindings: {},
          graph: { nodes: Object.fromEntries(Object.entries(nodes).filter(([, node]) => node.kind == 'start' || node.kind == 'outputs')), edges: [] },
        },
        modules: {},
      }),
    )
  }

  // Build the replacement table with the final NOT NULL constraint and no placeholder default.
  const schema = database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'publications'").get()!
  const indexes = database.prepare("SELECT sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'publications' AND sql IS NOT NULL").all()
  const columns = database
    .prepare("PRAGMA table_info('publications')")
    .all()
    .map((row) => `"${String(row.name)}"`)
    .join(', ')
  database.exec(
    String(schema.sql).replace(
      /CREATE TABLE ["`]?publications["`]?\s*\(/i,
      `CREATE TABLE publications_with_interfaces (interface_json TEXT NOT NULL CHECK (json_valid(interface_json) AND json_type(interface_json) = 'object'),`,
    ),
  )
  const insert = database.prepare(
    `INSERT INTO publications_with_interfaces (interface_json, ${columns}) SELECT ?, ${columns} FROM publications WHERE publication_id = ?`,
  )
  for (const row of database.prepare('SELECT publication_id, revision_id FROM publications').all()) {
    insert.run(JSON.stringify(publishedWorkflowInterface(read(String(row.revision_id), true))), row.publication_id!)
  }
  database.exec('DROP TABLE publications; ALTER TABLE publications_with_interfaces RENAME TO publications;')
  for (const index of indexes) database.exec(String(index.sql))

  // Pending work owns a serialized copy of the fixed Revision, independently of the Draft.
  for (const row of database.prepare('SELECT operation_id, revision_id, input_json, status FROM publish_operations').all()) {
    const input = JSON.parse(String(row.input_json))
    const revisionId = String(row.revision_id)
    const stored = revisions.read(revisionId)
    if (stored == null) {
      if (row.status == 'pending') throw new Error(`Cannot migrate pending publication: Revision ${revisionId} is missing.`)
      continue
    }
    let content: RevisionContent
    try {
      content = read(revisionId)
    } catch (error) {
      if (
        !(error instanceof TypeError) ||
        ![
          'Independent Task definitions are no longer supported.',
          'Task references are no longer supported.',
          'Subflows are no longer supported.',
          'Subflow nodes are no longer supported.',
        ].includes(error.message)
      )
        throw error
      if (row.status === 'pending') {
        database
          .prepare("UPDATE publish_operations SET status = 'failed', issue_code = 'flow.invalid', issue_message = ?, updated_at = ? WHERE operation_id = ?")
          .run(error.message, Date.now(), row.operation_id!)
        database
          .prepare("UPDATE integration_candidates SET status = 'cleanup', next_at = ?, updated_at = ? WHERE operation_id = ?")
          .run(Date.now(), Date.now(), row.operation_id!)
        database.prepare('DELETE FROM poll_candidates WHERE operation_id = ?').run(row.operation_id!)
      }
      continue
    }
    const upgraded = {
      ...input,
      content: stored.content,
      revisionDigest: stored.digest,
      closureDigest: hash(encodeFlowClosure(content)),
      interface: publishedWorkflowInterface(content),
    }
    database.prepare('UPDATE publish_operations SET input_json = ? WHERE operation_id = ?').run(JSON.stringify(upgraded), row.operation_id!)
  }

  // Earlier migrations may have encountered the old interface shape while building these summaries.
  const references = new FlowResourceReferenceStore(database)
  for (const row of database
    .prepare(`SELECT f.flow_id, f.owner_id, f.draft_revision_id, p.revision_id AS live_revision_id
    FROM flows f LEFT JOIN flow_live l USING (flow_id) LEFT JOIN publications p USING (publication_id)`)
    .all()) {
    const draft = migrated.get(String(row.draft_revision_id))
    if (draft != null) {
      const summary = flowResourceReferences(draft)
      database.prepare('UPDATE flows SET draft_resource_references = ? WHERE flow_id = ?').run(JSON.stringify(summary), row.flow_id!)
      references.replaceResources(String(row.owner_id), String(row.flow_id), 'draft', summary)
    }
    const live = migrated.get(String(row.live_revision_id))
    if (live != null) references.replaceResources(String(row.owner_id), String(row.flow_id), 'live', flowResourceReferences(live))
  }
}

function hash(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}
