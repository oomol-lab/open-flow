import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { migrateDatabase } from '../node/migrate.ts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function databaseFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-migration-'))
  directories.push(directory)
  return path.join(directory, 'open-flow.sqlite')
}

function version(database: DatabaseSync): number {
  return (database.prepare('PRAGMA user_version').get() as { readonly user_version: number }).user_version
}

it('applies the Flow-first schema without foreign keys', async () => {
  const file = await databaseFile()
  migrateDatabase(file)
  const database = new DatabaseSync(file)
  try {
    expect(version(database)).toBe(8)
    const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {
      readonly name: string
    }[]
    expect(tables.map(({ name }) => name)).toContain('flows')
    expect(tables.map(({ name }) => name)).toContain('flow_revisions')
    expect(tables.map(({ name }) => name)).toContain('variables')
    expect(tables.map(({ name }) => name)).toContain('flow_connector_teams')
    expect(tables.map(({ name }) => name)).toContain('operator_auth')
    expect(tables.map(({ name }) => name)).toContain('deployment_settings')
    expect(tables.map(({ name }) => name)).toContain('publish_operations')
    expect(tables.map(({ name }) => name)).toContain('publish_work')
    expect(tables.map(({ name }) => name)).toContain('integration_candidates')
    expect(tables.map(({ name }) => name)).toContain('poll_candidates')
    expect(tables.map(({ name }) => name)).not.toContain('projects')
    expect(database.prepare("SELECT name FROM pragma_index_info('publish_work_operation') WHERE seqno = 0").get()).toEqual({ name: 'operation_id' })
    for (const { name } of tables) expect(database.prepare(`PRAGMA foreign_key_list(${name})`).all(), name).toEqual([])
  } finally {
    database.close()
  }
})

it('upgrades a version 1 Flow database without changing its data', async () => {
  const file = await databaseFile()
  const database = new DatabaseSync(file)
  database.exec(readFileSync(new URL('../migrations/0001_flow.sql', import.meta.url), 'utf8'))
  database.exec('PRAGMA user_version = 1')
  database.prepare('INSERT INTO revisions (revision_id, digest, content) VALUES (?, ?, ?)').run('revision-a', 'digest-a', '{}')
  database.close()

  migrateDatabase(file)

  const reopened = new DatabaseSync(file)
  try {
    expect(version(reopened)).toBe(8)
    expect(reopened.prepare('SELECT revision_id AS revisionId FROM revisions').all()).toEqual([{ revisionId: 'revision-a' }])
    expect(reopened.prepare('SELECT name FROM variables').all()).toEqual([])
  } finally {
    reopened.close()
  }
})

it('adds an immutable Connector Team binding to every existing Flow', async () => {
  const file = await databaseFile()
  const database = new DatabaseSync(file)
  for (const migration of ['0001_flow.sql', '0002_variables.sql']) {
    database.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'))
  }
  database.exec('PRAGMA user_version = 2')
  database.prepare('INSERT INTO revisions (revision_id, digest, content) VALUES (?, ?, ?)').run('revision-a', 'digest-a', '{}')
  database
    .prepare(
      `INSERT INTO flows (
         flow_id, name, status, draft_revision_id, create_idempotency_key,
         create_request_digest, created_at, updated_at
       ) VALUES ('flow-a', 'Flow A', 'active', 'revision-a', 'create-a', 'request-a', 1, 1)`,
    )
    .run()
  database.close()

  migrateDatabase(file)

  const reopened = new DatabaseSync(file)
  try {
    expect(version(reopened)).toBe(8)
    expect(reopened.prepare('SELECT flow_id AS flowId, team_id AS teamId FROM flow_connector_teams').all()).toEqual([{ flowId: 'flow-a', teamId: null }])
    expect(reopened.prepare("SELECT name FROM pragma_table_info('runs') WHERE name = 'connector_team_id'").get()).toEqual({ name: 'connector_team_id' })
  } finally {
    reopened.close()
  }
})

it('does not reapply the current schema', async () => {
  const file = await databaseFile()
  migrateDatabase(file)
  const database = new DatabaseSync(file)
  database.prepare('INSERT INTO revisions (revision_id, digest, content) VALUES (?, ?, ?)').run('revision-a', 'digest-a', '{}')
  database.close()

  migrateDatabase(file)

  const reopened = new DatabaseSync(file)
  try {
    expect(reopened.prepare('SELECT revision_id AS revisionId FROM revisions').all()).toEqual([{ revisionId: 'revision-a' }])
  } finally {
    reopened.close()
  }
})

it('discards an old Project schema instead of migrating its data', async () => {
  const file = await databaseFile()
  const database = new DatabaseSync(file)
  database.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT')
  database.prepare('INSERT INTO projects (project_id, name) VALUES (?, ?)').run('project-old', 'Old Project')
  database.exec('PRAGMA user_version = 9')
  database.close()

  migrateDatabase(file)

  const reset = new DatabaseSync(file)
  try {
    expect(version(reset)).toBe(8)
    expect(reset.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'projects'").get()).toBeUndefined()
    expect(reset.prepare('SELECT flow_id FROM flows').all()).toEqual([])
  } finally {
    reset.close()
  }
})

it('rejects a newer Flow schema version without modifying it', async () => {
  const file = await databaseFile()
  migrateDatabase(file)
  const database = new DatabaseSync(file)
  database.exec('PRAGMA user_version = 9')
  database.close()

  expect(() => migrateDatabase(file)).toThrow('SQLite schema version 9 is newer than the supported version 8.')

  const reopened = new DatabaseSync(file)
  expect(version(reopened)).toBe(9)
  reopened.close()
})

it('resets an unversioned application schema', async () => {
  const file = await databaseFile()
  const database = new DatabaseSync(file)
  database.exec('CREATE TABLE revisions (revision_id TEXT PRIMARY KEY) STRICT')
  database.close()

  migrateDatabase(file)

  const reset = new DatabaseSync(file)
  try {
    expect(version(reset)).toBe(8)
    expect(reset.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'flows'").get()).toEqual({ name: 'flows' })
  } finally {
    reset.close()
  }
})
