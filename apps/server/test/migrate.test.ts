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
    expect(version(database)).toBe(2)
    const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {
      readonly name: string
    }[]
    expect(tables.map(({ name }) => name)).toContain('flows')
    expect(tables.map(({ name }) => name)).toContain('flow_revisions')
    expect(tables.map(({ name }) => name)).toContain('variables')
    expect(tables.map(({ name }) => name)).not.toContain('projects')
    for (const { name } of tables) expect(database.prepare(`PRAGMA foreign_key_list(${name})`).all(), name).toEqual([])
  } finally {
    database.close()
  }
})

it('upgrades a version 1 Flow database without changing its data', async () => {
  const file = await databaseFile()
  migrateDatabase(file)
  const database = new DatabaseSync(file)
  database.prepare('INSERT INTO revisions (revision_id, digest, content) VALUES (?, ?, ?)').run('revision-a', 'digest-a', '{}')
  database.exec('DROP TABLE variables; PRAGMA user_version = 1;')
  database.close()

  migrateDatabase(file)

  const reopened = new DatabaseSync(file)
  try {
    expect(version(reopened)).toBe(2)
    expect(reopened.prepare('SELECT revision_id AS revisionId FROM revisions').all()).toEqual([{ revisionId: 'revision-a' }])
    expect(reopened.prepare('SELECT name FROM variables').all()).toEqual([])
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
    expect(version(reset)).toBe(2)
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
  database.exec('PRAGMA user_version = 3')
  database.close()

  expect(() => migrateDatabase(file)).toThrow('SQLite schema version 3 is newer than the supported version 2.')

  const reopened = new DatabaseSync(file)
  expect(version(reopened)).toBe(3)
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
    expect(version(reset)).toBe(2)
    expect(reset.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'flows'").get()).toEqual({ name: 'flows' })
  } finally {
    reset.close()
  }
})
