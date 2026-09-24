import type { DatabaseSync } from 'node:sqlite'

import { decodeConnectorAccessSnapshot } from '@oomol-lab/open-flow/control-api'
import { z } from 'zod'

const legacySnapshot = z.object({
  version: z.literal(1),
  mode: z.enum(['implicit', 'selectable']),
  providerAccessDigest: z.string().optional(),
  sharedAccessDigest: z.string().optional(),
  bindings: z.array(z.record(z.string(), z.unknown())),
  nodeBindings: z.array(z.record(z.string(), z.unknown())).optional(),
})
const implicitSnapshot = JSON.stringify({ sharedBindings: [], selectedBindings: [], mode: 'implicit', sharedAccessDigest: 'implicit', version: 2 })

/** Runs inside the schema migration transaction; stored Revision identities remain unchanged. */
export function migrateConnectorAccess(database: DatabaseSync): void {
  for (const table of ['publications', 'flow_provider_access']) {
    if (hasColumn(database, table, 'provider_access_digest')) database.exec(`ALTER TABLE ${table} RENAME COLUMN provider_access_digest TO shared_access_digest`)
  }
  for (const table of ['publications', 'publish_operations', 'runs', 'source_subscriptions', 'integration_states', 'integration_candidates']) {
    const exists = hasColumn(database, table, 'provider_access_snapshot')
    database.exec(`ALTER TABLE ${table} ADD COLUMN migrated_access_snapshot TEXT NOT NULL DEFAULT '${implicitSnapshot}'
      CHECK (json_valid(migrated_access_snapshot) AND json_type(migrated_access_snapshot) = 'object')`)
    if (exists) {
      const update = database.prepare(`UPDATE ${table} SET migrated_access_snapshot = ? WHERE rowid = ?`)
      for (const row of database.prepare(`SELECT rowid, provider_access_snapshot FROM ${table}`).all()) {
        const value: unknown = JSON.parse(String(row.provider_access_snapshot))
        const legacy = legacySnapshot.safeParse(value)
        let snapshot
        if (legacy.success) {
          const source = legacy.data
          const digest = source.providerAccessDigest ?? source.sharedAccessDigest
          snapshot = decodeConnectorAccessSnapshot({
            version: 2,
            mode: source.mode,
            sharedAccessDigest: digest == 'legacy' ? 'implicit' : digest,
            sharedBindings: source.mode == 'implicit' ? [] : grants(source.bindings),
            selectedBindings: source.mode == 'implicit' ? [] : grants(source.nodeBindings ?? source.bindings),
          })
        } else snapshot = decodeConnectorAccessSnapshot(value)
        update.run(JSON.stringify(snapshot), row.rowid!)
      }
      database.exec(`ALTER TABLE ${table} DROP COLUMN provider_access_snapshot`)
    }
    database.exec(`ALTER TABLE ${table} RENAME COLUMN migrated_access_snapshot TO provider_access_snapshot`)
  }
  database.exec(`
    ALTER TABLE publications ADD COLUMN migrated_access_digest TEXT NOT NULL DEFAULT 'implicit';
    UPDATE publications SET migrated_access_digest = json_extract(provider_access_snapshot, '$.sharedAccessDigest');
    ALTER TABLE publications DROP COLUMN shared_access_digest;
    ALTER TABLE publications RENAME COLUMN migrated_access_digest TO shared_access_digest;
  `)
}

function hasColumn(database: DatabaseSync, table: string, column: string): boolean {
  return database.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`).get(table, column) != null
}

function grants(entries: readonly Record<string, unknown>[]): unknown[] {
  return entries
    .filter((entry) => entry.status == 'active')
    .map((entry) => {
      const grant: Record<string, unknown> = {
        accessBindingId: entry.accessBindingId,
        connectionId: entry.connectionId,
        providerId: entry.providerId,
        source: entry.source,
        connectionDisplayName: entry.connectionDisplayName ?? entry.displayName,
      }
      if ('permissionGroupName' in entry) grant.permissionGroupName = entry.permissionGroupName
      return grant
    })
}
