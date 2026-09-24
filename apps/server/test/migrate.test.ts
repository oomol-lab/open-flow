import { readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { Database } from '../node/storage/database.ts'

const directories: string[] = []

it.each([true, false])('migrates grants without rewriting Revision content (nodeBindings present: %s)', async (hasSelected) => {
  const file = await databaseFile()
  const old = legacyDatabase(file, 29)
  const grant = {
    accessBindingId: 'shared',
    connectionId: 'account',
    providerId: 'mail',
    source: { kind: 'policy', ruleId: null },
    connectionDisplayName: 'Account',
  }
  const selected = { ...grant, accessBindingId: 'selected', connectionId: 'second' }
  const snapshot = JSON.stringify({
    version: 1,
    mode: 'selectable',
    providerAccessDigest: 'digest',
    accessRevision: 7,
    bindings: [
      { ...grant, status: 'active', policyRevision: 'policy' },
      { ...grant, accessBindingId: 'forbidden', status: 'forbidden' },
    ],
    ...(hasSelected ? { nodeBindings: [{ ...selected, status: 'active' }] } : {}),
  })
  old.prepare('INSERT INTO flow_provider_access VALUES (?, ?, ?, ?, ?)').run('flow', 7, '[]', 'digest', '["mail"]')
  old.prepare("INSERT INTO revisions VALUES ('revision', 'digest', '{\"modelVersion\":3}')").run()
  old
    .prepare(`INSERT INTO publications (publication_id, flow_id, revision_id, revision_digest, closure_digest, engine_contract,
    idempotency_key, request_digest, actor_id, operation, model_version, created_at, provider_access_digest, provider_access_snapshot)
    VALUES ('publication', 'flow', 'revision', 'digest', 'closure', 'engine', 'key', 'request', 'actor', 'publish', 3, 1, 'digest', ?)`)
    .run(snapshot)
  old.close()
  const upgraded = Database.open(file)
  const expected = { version: 2, mode: 'selectable', sharedAccessDigest: 'digest', sharedBindings: [grant], selectedBindings: [hasSelected ? selected : grant] }
  expect(JSON.parse(String(upgraded.connection.prepare('SELECT provider_access_snapshot FROM publications').get()!.provider_access_snapshot))).toEqual(expected)
  expect(upgraded.connection.prepare('SELECT shared_access_digest, access_revision FROM flow_provider_access').get()).toEqual({
    shared_access_digest: 'digest',
    access_revision: 7,
  })
  expect(upgraded.connection.prepare('SELECT content FROM revisions').get()).toEqual({ content: '{"modelVersion":3}' })
  upgraded.close()
  const reopened = Database.open(file)
  expect(JSON.parse(String(reopened.connection.prepare('SELECT provider_access_snapshot FROM publications').get()!.provider_access_snapshot))).toEqual(expected)
  reopened.close()
})

it('rolls back column changes and the schema version when a stored grant is invalid', async () => {
  const file = await databaseFile()
  const old = legacyDatabase(file, 29)
  old
    .prepare(`INSERT INTO runs (run_id, idempotency_key, request_digest, flow_id, revision_id, revision_digest, closure_digest,
    model_version, engine_contract, engine_digest, inputs, source, status, created_at, provider_access_snapshot)
    VALUES ('run', 'key', 'request', 'flow', 'revision', 'digest', 'closure', 3, 'engine', 'engine', '{}', 'draft', 'completed', 1, ?)`)
    .run(JSON.stringify({ version: 1, mode: 'selectable', providerAccessDigest: 'digest', bindings: [{ status: 'active' }] }))
  old.close()
  expect(() => Database.open(file)).toThrow()
  const unchanged = new DatabaseSync(file)
  expect(version(unchanged)).toBe(29)
  expect(unchanged.prepare("SELECT name FROM pragma_table_info('publications') WHERE name = 'provider_access_digest'").get()).toBeDefined()
  expect(unchanged.prepare("SELECT name FROM pragma_table_info('publications') WHERE name = 'migrated_access_snapshot'").get()).toBeUndefined()
  unchanged.close()
})

it('accepts databases already rebuilt with the new column names and snapshot format', async () => {
  const file = await databaseFile()
  const database = Database.open(file)
  database.connection.exec('PRAGMA user_version = 29')
  database.close()
  const upgraded = Database.open(file)
  expect(version(upgraded.connection)).toBe(30)
  expect(upgraded.connection.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
  upgraded.close()
})

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

function accessSnapshot(digest: string): string {
  return JSON.stringify({ version: 1, mode: 'implicit', accessRevision: 0, bindings: [], providerAccessDigest: digest })
}

it('backfills Revision metadata needed after old content is pruned', async () => {
  const file = await databaseFile()
  const database = legacyDatabase(file, 27)
  database.prepare('INSERT INTO revisions (revision_id, digest, content) VALUES (?, ?, ?)').run('revision', 'digest', '{"modelVersion":3}')
  database
    .prepare(`INSERT INTO flow_revisions (revision_id, flow_id, parent_revision_id, actor_id, created_at, change_id, change_request_digest)
              VALUES ('revision', 'flow', NULL, 'operator', 1, 'change', 'request')`)
    .run()
  database.close()

  const upgraded = Database.open(file)
  try {
    expect(version(upgraded.connection)).toBe(30)
    expect(upgraded.connection.prepare('SELECT digest, model_version AS modelVersion FROM flow_revisions WHERE revision_id = ?').get('revision')).toEqual({
      digest: 'digest',
      modelVersion: 3,
    })
  } finally {
    upgraded.close()
  }
})

it('backfills each candidate with its creation snapshot, including failed and retired subscriptions', async () => {
  const file = await databaseFile()
  const database = legacyDatabase(file, 24)
  database
    .prepare(`INSERT INTO publications (publication_id, flow_id, revision_id, revision_digest, closure_digest, engine_contract,
    idempotency_key, request_digest, actor_id, operation, model_version, created_at, provider_access_snapshot)
    VALUES ('previous', 'flow', 'revision', 'revision', 'closure', 'engine', 'previous', 'previous', 'actor', 'publish', 3, 1, ?)`)
    .run(accessSnapshot('previous'))
  database
    .prepare(`INSERT INTO publish_operations (operation_id, flow_id, revision_id, revision_digest, closure_digest, engine_contract,
    expected_live_publication_id, idempotency_key, request_digest, input_json, status, deadline_at, created_at, updated_at, expires_at, provider_access_snapshot)
    VALUES ('operation', 'flow', 'revision', 'revision', 'closure', 'engine', 'previous', 'operation', 'operation', '{}', 'pending', 100, 1, 1, 1000, ?)`)
    .run(accessSnapshot('candidate'))
  for (const [nodeId, status] of [
    ['new', 'preparing'],
    ['failed', 'cleanup'],
    ['retired:old', 'cleanup'],
  ]) {
    database
      .prepare(`INSERT INTO integration_candidates (operation_id, node_id, binding_id, endpoint_id, flow_id, trigger_json,
      connection_id, status, created_at, updated_at) VALUES ('operation', ?, ?, ?, 'flow', '{}', 'connection', ?, 1, 1)`)
      .run(nodeId!, nodeId!, nodeId!, status!)
  }
  database.close()
  const upgraded = Database.open(file)
  try {
    expect(
      upgraded.connection
        .prepare(`SELECT node_id AS nodeId, json_extract(provider_access_snapshot, '$.sharedAccessDigest') AS digest
      FROM integration_candidates ORDER BY node_id`)
        .all(),
    ).toEqual([
      { nodeId: 'failed', digest: 'candidate' },
      { nodeId: 'new', digest: 'candidate' },
      { nodeId: 'retired:old', digest: 'previous' },
    ])
  } finally {
    upgraded.close()
  }
})

it('applies the Flow-first schema without foreign keys', async () => {
  const file = await databaseFile()
  Database.open(file).close()
  const database = new DatabaseSync(file)
  try {
    expect(version(database)).toBe(30)
    const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {
      readonly name: string
    }[]
    expect(tables.map(({ name }) => name)).toContain('flows')
    expect(tables.map(({ name }) => name)).toContain('flow_revisions')
    expect(tables.map(({ name }) => name)).toContain('variables')
    expect(tables.map(({ name }) => name)).toContain('flow_connector_teams')
    expect(tables.map(({ name }) => name)).toContain('flow_provider_access')
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
    expect(version(reopened)).toBe(30)
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
    expect(version(reopened)).toBe(30)
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

it('rejects an unsupported old Project schema without modifying it', async () => {
  const file = await databaseFile()
  const database = new DatabaseSync(file)
  database.exec('CREATE TABLE projects (project_id TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT')
  database.prepare('INSERT INTO projects (project_id, name) VALUES (?, ?)').run('project-old', 'Old Project')
  database.exec('PRAGMA user_version = 9')
  database.close()

  expect(() => Database.open(file)).toThrow('Legacy application schema is unsupported')

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
  database.exec('PRAGMA user_version = 31')
  database.close()

  expect(() => Database.open(file)).toThrow('SQLite schema version 31 is newer than the supported version 30.')

  const reopened = new DatabaseSync(file)
  expect(version(reopened)).toBe(31)
  reopened.close()
})

it('preserves an unversioned application schema', async () => {
  const file = await databaseFile()
  const database = new DatabaseSync(file)
  database.exec('CREATE TABLE revisions (revision_id TEXT PRIMARY KEY) STRICT')
  database.close()

  expect(() => Database.open(file)).toThrow('Legacy application schema is unsupported')

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
    expect(version(reopened)).toBe(30)
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
    expect(version(upgraded)).toBe(30)
    const after = tables.map((table) => upgraded.prepare('SELECT * FROM ' + table).all())
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2))
    expect(after[2]).toEqual(
      before[2]!.map((row) =>
        Object.assign({}, row, {
          provider_access_snapshot: '{"mode":"implicit","sharedAccessDigest":"implicit","sharedBindings":[],"selectedBindings":[],"version":2}',
        }),
      ),
    )
    expect(upgraded.prepare('SELECT * FROM listener_work').all()).toEqual([])
  } finally {
    upgraded.close()
  }
})

it('removes the event source tenant binding while preserving source configuration and queued events', async () => {
  const file = await databaseFile()
  const database = legacyDatabase(file, 23)
  database
    .prepare(`INSERT INTO event_sources
    (source_id, revision, name, provider, app_id, tenant_key, connection_id, verification_token, encrypt_key,
     event_types_json, manage_subscriptions, verified_at, updated_at)
    VALUES ('source', 2, 'Events', 'feishu_app_bot', 'cli_test', 'tenant', 'connection', 'token', 'key', '[]', 0, 100, 100)`)
    .run()
  database.prepare('INSERT INTO source_events VALUES (?, ?, ?, ?)').run('source', 'event', '{"tenantKey":"tenant"}', 100)
  const { tenant_key: _tenant, ...source } = database.prepare('SELECT * FROM event_sources').get()!
  const events = database.prepare('SELECT * FROM source_events').all()
  database.close()

  Database.open(file).close()

  const upgraded = new DatabaseSync(file)
  try {
    expect(upgraded.prepare('SELECT * FROM event_sources').get()).toEqual(source)
    expect(upgraded.prepare('SELECT * FROM source_events').all()).toEqual(events)
  } finally {
    upgraded.close()
  }
})

it('adds Cron health without changing existing schedules', async () => {
  const file = await databaseFile()
  const database = legacyDatabase(file, 19)
  database
    .prepare(`INSERT INTO cron_bindings (binding_id, flow_id, trigger_node_id, current_publication_id, runtime_version, next_at, updated_at)
    VALUES ('binding', 'flow', 'cron', 'publication', 3, 60000, 0)`)
    .run()
  const before = database.prepare('SELECT * FROM cron_bindings').get()
  database.close()
  Database.open(file).close()
  const upgraded = new DatabaseSync(file)
  try {
    expect(upgraded.prepare('SELECT * FROM cron_bindings').get()).toEqual({ ...before, last_error_code: null })
  } finally {
    upgraded.close()
  }
})

it('clears only old Draft shared access once and preserves new Code usage on reopen', async () => {
  const file = await databaseFile()
  const old = legacyDatabase(file, 26)
  old
    .prepare('INSERT INTO flow_provider_access (flow_id, access_revision, bindings_json, provider_access_digest, provider_ids_json) VALUES (?, ?, ?, ?, ?)')
    .run('flow', 4, '[]', 'old', '["mail"]')
  const snapshot = accessSnapshot('preserved')
  old
    .prepare(`INSERT INTO publications (publication_id, flow_id, revision_id, revision_digest, closure_digest, engine_contract,
    idempotency_key, request_digest, actor_id, operation, model_version, created_at, provider_access_snapshot)
    VALUES ('published', 'flow', 'revision', 'revision', 'closure', 'engine', 'published', 'published', 'actor', 'publish', 3, 1, ?)`)
    .run(snapshot)
  old
    .prepare(`INSERT INTO runs (run_id, idempotency_key, request_digest, flow_id, revision_id, revision_digest, closure_digest,
    model_version, engine_contract, engine_digest, inputs, source, status, created_at, provider_access_snapshot)
    VALUES ('run', 'run', 'run', 'flow', 'revision', 'revision', 'closure', 3, 'engine', 'engine', '{}', 'live', 'queued', 1, ?)`)
    .run(snapshot)
  const graph = JSON.stringify({ connectionId: 'account', source: 'preserved' })
  old.prepare("INSERT INTO revisions (revision_id, digest, content) VALUES ('revision', 'digest', ?)").run(graph)
  old.close()
  const migrated = Database.open(file)
  expect(migrated.connection.prepare('SELECT * FROM flow_provider_access').all()).toEqual([])
  expect(JSON.parse(String(migrated.connection.prepare('SELECT provider_access_snapshot FROM publications').get()!.provider_access_snapshot))).toEqual({
    version: 2,
    mode: 'implicit',
    sharedAccessDigest: 'preserved',
    sharedBindings: [],
    selectedBindings: [],
  })
  expect(JSON.parse(String(migrated.connection.prepare('SELECT provider_access_snapshot FROM runs').get()!.provider_access_snapshot))).toEqual({
    version: 2,
    mode: 'implicit',
    sharedAccessDigest: 'preserved',
    sharedBindings: [],
    selectedBindings: [],
  })
  expect(migrated.connection.prepare('SELECT content FROM revisions').get()).toEqual({ content: graph })
  migrated.connection
    .prepare('INSERT INTO flow_provider_access (flow_id, access_revision, bindings_json, shared_access_digest, provider_ids_json) VALUES (?, ?, ?, ?, ?)')
    .run('flow', 1, '[]', 'new', '["mail"]')
  migrated.close()
  const reopened = Database.open(file)
  expect(reopened.connection.prepare('SELECT shared_access_digest FROM flow_provider_access').get()).toEqual({ shared_access_digest: 'new' })
  reopened.close()
})
