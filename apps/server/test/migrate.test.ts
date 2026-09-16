import { readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { Database } from '../node/storage/database.ts'

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

function legacyDatabase(file: string, schemaVersion: number): DatabaseSync {
  const database = new DatabaseSync(file)
  const directory = new URL('../migrations/', import.meta.url)
  for (const name of readdirSync(directory)
    .filter((fileName) => fileName.endsWith('.sql'))
    .toSorted()
    .slice(0, schemaVersion)) {
    database.exec(readFileSync(new URL(name, directory), 'utf8'))
  }
  database.exec(`PRAGMA user_version = ${schemaVersion}`)
  return database
}

it('applies the Flow-first schema without foreign keys', async () => {
  const file = await databaseFile()
  Database.open(file).close()
  const database = new DatabaseSync(file)
  try {
    expect(version(database)).toBe(19)
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
    expect(tables.map(({ name }) => name)).toContain('run_checkpoints')
    expect(tables.map(({ name }) => name)).toContain('wait_notifications')
    expect(tables.map(({ name }) => name)).toContain('event_sources')
    expect(tables.map(({ name }) => name)).toContain('source_events')
    expect(tables.map(({ name }) => name)).toContain('source_deliveries')
    expect(tables.map(({ name }) => name)).toContain('source_subscriptions')
    expect(tables.map(({ name }) => name)).toContain('source_demands')
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

  Database.open(file).close()

  const reopened = new DatabaseSync(file)
  try {
    expect(version(reopened)).toBe(19)
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

  Database.open(file).close()

  const reopened = new DatabaseSync(file)
  try {
    expect(version(reopened)).toBe(19)
    expect(reopened.prepare('SELECT flow_id AS flowId, team_id AS teamId FROM flow_connector_teams').all()).toEqual([{ flowId: 'flow-a', teamId: null }])
    expect(reopened.prepare("SELECT name FROM pragma_table_info('runs') WHERE name = 'connector_team_id'").get()).toEqual({ name: 'connector_team_id' })
  } finally {
    reopened.close()
  }
})

it('does not reapply the current schema', async () => {
  const file = await databaseFile()
  Database.open(file).close()
  const database = new DatabaseSync(file)
  database.prepare('INSERT INTO revisions (revision_id, digest, content) VALUES (?, ?, ?)').run('revision-a', 'digest-a', '{}')
  database.close()

  Database.open(file).close()

  const reopened = new DatabaseSync(file)
  try {
    expect(reopened.prepare('SELECT revision_id AS revisionId FROM revisions').all()).toEqual([{ revisionId: 'revision-a' }])
  } finally {
    reopened.close()
  }
})

it('preserves an old Project schema until an explicit migration is available', async () => {
  const file = await databaseFile()
  const database = new DatabaseSync(file)
  database.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT')
  database.prepare('INSERT INTO projects (project_id, name) VALUES (?, ?)').run('project-old', 'Old Project')
  database.exec('PRAGMA user_version = 9')
  database.close()

  expect(() => Database.open(file)).toThrow('Legacy application schema requires an explicit migration')

  const reset = new DatabaseSync(file)
  try {
    expect(version(reset)).toBe(9)
    expect(reset.prepare('SELECT * FROM projects').all()).toEqual([{ project_id: 'project-old', name: 'Old Project' }])
  } finally {
    reset.close()
  }
})

it('rejects a newer Flow schema version without modifying it', async () => {
  const file = await databaseFile()
  Database.open(file).close()
  const database = new DatabaseSync(file)
  database.exec('PRAGMA user_version = 20')
  database.close()

  expect(() => Database.open(file)).toThrow('SQLite schema version 20 is newer than the supported version 19.')

  const reopened = new DatabaseSync(file)
  expect(version(reopened)).toBe(20)
  reopened.close()
})

it('preserves an unversioned application schema', async () => {
  const file = await databaseFile()
  const database = new DatabaseSync(file)
  database.exec('CREATE TABLE revisions (revision_id TEXT PRIMARY KEY) STRICT')
  database.close()

  expect(() => Database.open(file)).toThrow('Legacy application schema requires an explicit migration')

  const reset = new DatabaseSync(file)
  try {
    expect(version(reset)).toBe(0)
    expect(reset.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'flows'").get()).toBeUndefined()
  } finally {
    reset.close()
  }
})

it('preserves old checkpoint bytes for explicit recovery validation', async () => {
  const file = await databaseFile()
  const database = legacyDatabase(file, 9)
  database
    .prepare(`
    INSERT INTO run_waits (
      run_id, wait_id, node_id, job_id, job_order, waiting_since, expires_at,
      checkpoint_json, checkpoint_version, checkpoint_digest, checkpoint_bytes, remaining_ms
    ) VALUES ('run-a', 'wait-a', 'node-a', 'job-a', 0, 1, 100, '{"value":42}', 1, 'digest-a', 12, 99)
  `)
    .run()
  database.close()

  Database.open(file).close()

  const reopened = new DatabaseSync(file)
  try {
    expect(version(reopened)).toBe(19)
    expect(reopened.prepare('SELECT * FROM run_checkpoints').get()).toEqual({
      run_id: 'run-a',
      checkpoint_json: '{"value":42}',
      checkpoint_digest: 'digest-a',
      checkpoint_bytes: 12,
      remaining_ms: 99,
    })
  } finally {
    reopened.close()
  }
})

it('upgrades version 14 while preserving existing Integration progress, subscriptions, and Revision bytes', async () => {
  const file = await databaseFile()
  const database = legacyDatabase(file, 14)
  database.prepare('INSERT INTO revisions (revision_id, digest, content) VALUES (?, ?, ?)').run('legacy-revision', 'legacy-digest', '{ "legacy": true }')
  database
    .prepare(`INSERT INTO integration_bindings (binding_id, endpoint_id, flow_id, trigger_node_id, current_publication_id,
    runtime_version, trigger_json, connection_id, health, reconcile_at, updated_at)
    VALUES ('binding-legacy', 'endpoint-legacy', 'flow-legacy', 'node-legacy', 'publication-legacy', 4, '{}', 'connection-legacy', 'healthy', 5000, 1)`)
    .run()
  database
    .prepare(`INSERT INTO integration_states (binding_id, runtime_version, trigger_json, connection_id,
    checkpoint_json, subscription_json, reconcile_at, updated_at)
    VALUES ('binding-legacy', 4, '{}', 'connection-legacy', '{"pageToken":"saved"}', '{"channelId":"existing"}', 5000, 1)`)
    .run()
  const tables = ['revisions', 'integration_bindings', 'integration_states']
  const before = tables.map((table) => database.prepare('SELECT * FROM ' + table).all())
  database.close()
  Database.open(file).close()
  const upgraded = new DatabaseSync(file)
  try {
    expect(version(upgraded)).toBe(19)
    expect(tables.map((table) => upgraded.prepare('SELECT * FROM ' + table).all())).toEqual(before)
    expect(upgraded.prepare('SELECT * FROM listener_work').all()).toEqual([])
  } finally {
    upgraded.close()
  }
})
