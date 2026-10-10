import type { DatabaseSync } from 'node:sqlite'

import { draftResourceReferences } from './flow-resources.ts'
import { RevisionIntegrityError, RevisionStore } from './revision-store.ts'

export function migrateFlowResources(database: DatabaseSync): void {
  database.exec(`ALTER TABLE flows ADD COLUMN draft_resource_references TEXT
    CHECK (draft_resource_references IS NULL OR (json_valid(draft_resource_references) AND json_type(draft_resource_references) = 'object'))`)
  const revisions = new RevisionStore(database)
  const update = database.prepare('UPDATE flows SET draft_resource_references = ? WHERE flow_id = ?')
  for (const row of database.prepare('SELECT flow_id, draft_revision_id FROM flows').all()) {
    let revision
    try {
      revision = revisions.read(String(row.draft_revision_id))
    } catch (error) {
      if (error instanceof RevisionIntegrityError) continue
      throw error
    }
    if (revision != null) update.run(draftResourceReferences(revision.content), row.flow_id!)
  }
}
