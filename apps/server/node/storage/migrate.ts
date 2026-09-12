import type { Database } from './database.ts'

import { readFileSync } from 'node:fs'

const migrationFiles = [
  '0001_flow.sql',
  '0002_variables.sql',
  '0003_connector_team.sql',
  '0004_deployment.sql',
  '0005_publish_operations.sql',
  '0006_integration_candidates.sql',
  '0007_poll_candidates.sql',
  '0008_draft_changes.sql',
  '0009_wait_runs.sql',
  '0010_wait_order.sql',
  '0011_run_trigger.sql',
  '0012_flow_enabled.sql',
  '0013_agent_runs.sql',
  '0014_run_results.sql',
  '0015_listener_work.sql',
  '0016_publish_retry.sql',
] as const
const migrationsDirectory = new URL(import.meta.url.endsWith('.ts') ? '../../migrations/' : '../migrations/', import.meta.url)

/** Brings an open database to the current schema version inside one transaction. */
export function migrate(database: Database): void {
  database.transaction(() => {
    const currentVersion = (database.connection.prepare('PRAGMA user_version').get() as { readonly user_version: number }).user_version
    if (hasApplicationTables(database) && !hasFlowSchema(database)) {
      throw new Error('Legacy application schema requires an explicit migration; the database was not modified.')
    }
    if (currentVersion > migrationFiles.length) {
      throw new Error(`SQLite schema version ${currentVersion} is newer than the supported version ${migrationFiles.length}.`)
    }
    for (let index = currentVersion; index < migrationFiles.length; index += 1) {
      database.connection.exec(readFileSync(new URL(migrationFiles[index], migrationsDirectory), 'utf8'))
      database.connection.exec(`PRAGMA user_version = ${index + 1}`)
    }
  })
}

function hasFlowSchema(database: Database): boolean {
  return database.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'flows'").get() != null
}

function hasApplicationTables(database: Database): boolean {
  return database.connection.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get() != null
}
