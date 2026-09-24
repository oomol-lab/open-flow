import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

const emptyDigest = 'sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'

export function resetProviderAccess(database: DatabaseSync, apply: boolean): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    const blockers = database
      .prepare(`
      SELECT 'unfinished Runs' AS reason, COUNT(*) AS count FROM runs WHERE status IN ('queued', 'starting', 'running', 'waiting')
      UNION ALL SELECT 'enabled Live', COUNT(*) FROM flow_live WHERE enabled = 1
      UNION ALL SELECT 'unfinished Publish', COUNT(*) FROM publish_operations WHERE status = 'pending'
      UNION ALL SELECT 'Integration state', COUNT(*) FROM integration_states
      UNION ALL SELECT 'Integration candidates', COUNT(*) FROM integration_candidates
      UNION ALL SELECT 'source subscriptions', COUNT(*) FROM source_subscriptions
      UNION ALL SELECT 'pending publish work', COUNT(*) FROM publish_work WHERE status = 'pending'
    `)
      .all()
      .filter((row) => Number(row.count) > 0)
    if (blockers.length > 0)
      throw new Error(
        `Provider Access reset blocked: ${blockers.map((row) => `${row.reason}: ${row.count}`).join(', ')}. Drain work and retire subscriptions with the old Server first.`,
      )
    if (apply) {
      database
        .prepare(`UPDATE flow_provider_access SET bindings_json = '[]', access_revision = access_revision + 1,
        shared_access_digest = ? WHERE bindings_json != '[]'`)
        .run(emptyDigest)
      for (const table of ['publications', 'publish_operations', 'runs']) {
        database
          .prepare(`UPDATE ${table} SET provider_access_snapshot = json_set(provider_access_snapshot,
          '$.sharedBindings', json('[]'), '$.selectedBindings', json('[]'), '$.sharedAccessDigest', ?)
          WHERE json_extract(provider_access_snapshot, '$.mode') = 'selectable'`)
          .run(emptyDigest)
      }
      database
        .prepare(`UPDATE publications SET shared_access_digest = ?
        WHERE json_extract(provider_access_snapshot, '$.mode') = 'selectable'`)
        .run(emptyDigest)
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

if (process.argv[1] != null && import.meta.url == pathToFileURL(process.argv[1]).href) {
  const [file, flag] = process.argv.slice(2)
  if (file == null || !existsSync(file) || (flag != null && flag != '--apply') || process.argv.length > 4) {
    throw new Error('Usage: node scripts/reset-provider-access.ts <existing-database.sqlite> [--apply]. Stop the Server and back up the database first.')
  }
  const database = new DatabaseSync(file)
  try {
    resetProviderAccess(database, flag == '--apply')
    process.stdout.write(
      flag == '--apply'
        ? 'Provider Access cleared. Reauthorize and republish before enabling Live.\n'
        : 'Provider Access reset preflight passed. No authorization records changed.\n',
    )
  } finally {
    database.close()
  }
}
