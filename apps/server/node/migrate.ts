import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const migrationFiles = ['0001_flow.sql', '0002_variables.sql', '0003_connector_team.sql', '0004_deployment.sql'] as const
const migrationsDirectory = new URL('../migrations/', import.meta.url)

export function migrateDatabase(file: string): void {
  const database = new DatabaseSync(file)
  try {
    database.exec('BEGIN IMMEDIATE')
    try {
      let currentVersion = (database.prepare('PRAGMA user_version').get() as { readonly user_version: number }).user_version
      if (hasApplicationTables(database) && !hasFlowSchema(database)) {
        resetApplicationTables(database)
        currentVersion = 0
      }
      if (currentVersion > migrationFiles.length) {
        throw new Error(`SQLite schema version ${currentVersion} is newer than the supported version ${migrationFiles.length}.`)
      }
      for (let index = currentVersion; index < migrationFiles.length; index += 1) {
        database.exec(readFileSync(new URL(migrationFiles[index], migrationsDirectory), 'utf8'))
        database.exec(`PRAGMA user_version = ${index + 1}`)
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  } finally {
    database.close()
  }
}

function hasFlowSchema(database: DatabaseSync): boolean {
  return database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'flows'").get() != null
}

function resetApplicationTables(database: DatabaseSync): void {
  const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as unknown as readonly {
    readonly name: string
  }[]
  for (const { name } of tables) database.exec(`DROP TABLE "${name.replaceAll('"', '""')}"`)
  database.exec('PRAGMA user_version = 0')
}

function hasApplicationTables(database: DatabaseSync): boolean {
  return database.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1").get() != null
}
