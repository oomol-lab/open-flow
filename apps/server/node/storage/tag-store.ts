import type { Tag, TagListItem } from '@oomol-lab/open-flow/control-api'
import type { DatabaseSync } from 'node:sqlite'

import { randomUUID } from 'node:crypto'

export class TagAssignmentError extends Error {}

/** Owns the account tag directory and membership edges. Flow transactions borrow replace(). */
export class TagStore {
  private readonly database: DatabaseSync
  private readonly transaction: <Value>(operation: () => Value) => Value

  constructor(database: DatabaseSync, transaction: <Value>(operation: () => Value) => Value) {
    this.database = database
    this.transaction = transaction
  }

  list(ownerId: string): readonly TagListItem[] {
    return this.database
      .prepare(`SELECT t.tag_id AS tagId, t.name, 1 AS version,
      (SELECT COUNT(*) FROM flow_tags ft JOIN flows f ON f.flow_id = ft.flow_id
       WHERE ft.tag_id = t.tag_id AND f.owner_id = t.owner_id AND f.status = 'active') AS referenceCount
      FROM tags t WHERE t.owner_id = ? ORDER BY t.name_key, t.tag_id`)
      .all(ownerId) as unknown as TagListItem[]
  }

  get(ownerId: string, tagId: string): Tag | undefined {
    return this.database.prepare('SELECT tag_id AS tagId, name, 1 AS version FROM tags WHERE owner_id = ? AND tag_id = ?').get(ownerId, tagId) as
      | Tag
      | undefined
  }

  save(ownerId: string, name: string, tagId = `tag_${randomUUID().replaceAll('-', '')}`): Tag | undefined {
    return this.transaction(() => {
      const duplicate = this.database.prepare('SELECT tag_id AS tagId FROM tags WHERE owner_id = ? AND name_key = ?').get(ownerId, name.toLowerCase()) as
        | { tagId: string }
        | undefined
      if (duplicate != null && duplicate.tagId != tagId) return
      this.database
        .prepare(`INSERT INTO tags (tag_id, owner_id, name, name_key) VALUES (?, ?, ?, ?)
        ON CONFLICT(tag_id) DO UPDATE SET name = excluded.name, name_key = excluded.name_key`)
        .run(tagId, ownerId, name, name.toLowerCase())
      return this.get(ownerId, tagId)
    })
  }

  delete(ownerId: string, tagId: string): void {
    this.transaction(() => {
      this.database.prepare('DELETE FROM flow_tags WHERE tag_id IN (SELECT tag_id FROM tags WHERE owner_id = ? AND tag_id = ?)').run(ownerId, tagId)
      this.database.prepare('DELETE FROM tags WHERE owner_id = ? AND tag_id = ?').run(ownerId, tagId)
    })
  }

  replace(ownerId: string, flowId: string, tagIds: readonly string[]): void {
    const ids = [...new Set(tagIds)]
    if (ids.length > 0) {
      const { count } = this.database
        .prepare('SELECT COUNT(*) AS count FROM tags WHERE owner_id = ? AND tag_id IN (SELECT value FROM json_each(?))')
        .get(ownerId, JSON.stringify(ids)) as { count: number }
      if (count != ids.length) throw new TagAssignmentError('A selected tag is unavailable.')
    }
    this.database.prepare('DELETE FROM flow_tags WHERE flow_id = ?').run(flowId)
    const insert = this.database.prepare('INSERT INTO flow_tags (flow_id, tag_id) VALUES (?, ?)')
    for (const tagId of ids) insert.run(flowId, tagId)
  }
}
