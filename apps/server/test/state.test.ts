import { hashIdentities, stateReadLimits } from '@oomol-lab/open-flow/flow-state'
import { afterEach, describe, expect, it } from 'vitest'
import { isolatedVmEngineDigest } from '../node/runtime/isolated-vm.ts'
import { Database } from '../node/storage/database.ts'
import { migrate } from '../node/storage/migrate.ts'
import { StateStore, stateLimits } from '../node/storage/state-store.ts'
import { Store } from '../node/storage/store.ts'
import { restoreGroupedServiceSettings } from './support/legacySettings.ts'

const databases: Database[] = []
afterEach(() => databases.splice(0).forEach((database) => database.close()))
function setup(limits = stateLimits) {
  const database = Database.open(':memory:')
  databases.push(database)
  return new StateStore(
    database.connection,
    (operation) => database.transaction(operation),
    () => 1000,
    limits,
  )
}

describe('Flow State storage', () => {
  it('reads named values in request order without exposing unrequested data or crossing scopes', () => {
    const store = setup()
    store.set('a', 'draft', 'run', 'zero', 0)
    store.set('a', 'draft', 'run', 'false', false)
    store.set('a', 'draft', 'run', 'empty', '')
    store.set('a', 'draft', 'run', 'unrequested', { secret: 'body' })
    store.set('a', 'live', 'run', 'zero', 42)
    store.set('b', 'draft', 'run', 'zero', 99)
    expect(store.readValues('a', 'draft', ['empty', 'zero', 'missing', 'false'])).toEqual([
      { key: 'empty', value: '' },
      { key: 'zero', value: 0 },
      { key: 'missing', value: null },
      { key: 'false', value: false },
    ])
    expect(store.view('a', 'draft').values.every((item) => !('value' in item))).toBe(true)
  })
  it('admits exactly 1 MiB of stored JSON and rejects an entire read one byte over budget', () => {
    const store = setup({ ...stateLimits, maxValueBytes: 65537 })
    const keys = Array.from({ length: stateReadLimits.maxKeys }, (_, index) => String(index))
    keys.forEach((key) => store.set('a', 'draft', 'run', key, 'x'.repeat(65534)))
    expect(store.readValues('a', 'draft', keys)).toHaveLength(16)
    store.set('a', 'draft', 'run', keys[0]!, 'x'.repeat(65535))
    expect(() => store.readValues('a', 'draft', keys)).toThrow('1 MiB read limit')
    expect(store.readValues('a', 'draft', keys.slice(1))).toHaveLength(15)
  })
  it('persists independent values, conditionally inserts and isolates Flow and source', () => {
    const store = setup()
    store.set('a', 'draft', 'run1', 'key', { nested: [1] })
    expect(store.set('a', 'draft', 'run2', 'key', 2, true)).toBe(false)
    expect(store.get('a', 'draft', 'key')).toEqual({ nested: [1] })
    expect(store.get('a', 'live', 'key')).toBeNull()
    expect(store.get('b', 'draft', 'key')).toBeNull()
    store.set('a', 'draft', 'run2', 'key', null)
    expect(store.list('a', 'draft')).toEqual([])
    expect(store.view('a', 'draft').values).toEqual([])
  })
  it('rolls back the complete batch on capacity and permits duplicate-only batches at capacity', async () => {
    const store = setup({ ...stateLimits, maxIdentities: 2 })
    const ids = ['a', 'b', 'c']
    const hashes = await hashIdentities(ids)
    expect(store.insert('f', 'draft', 'flow', hashes.slice(0, 2))).toEqual([true, true])
    expect(() => store.insert('f', 'draft', 'flow', hashes)).toThrow('full')
    expect(store.has('f', 'draft', 'flow', hashes)).toEqual([true, true, false])
    expect(store.insert('f', 'draft', 'flow', [hashes[1]!, hashes[1]!])).toEqual([false, false])
    expect(store.dedupeCount('f', 'draft')).toBe(2)
    store.clearSpace('f', 'draft', 'flow')
    expect(store.dedupeCount('f', 'draft')).toBe(0)
  })
  it('accepts duplicate-only batches after lowering the limit but rejects new identities atomically', async () => {
    const store = setup({ ...stateLimits, maxIdentities: 2 })
    const ids = ['a', 'b', 'c']
    const hashes = await hashIdentities(ids)
    store.insert('f', 'draft', 'flow', hashes.slice(0, 2))
    const reduced = new StateStore(store.database, store.transaction, store.clock, { ...stateLimits, maxIdentities: 1 })
    expect(reduced.insert('f', 'draft', 'flow', [hashes[1]!, hashes[1]!])).toEqual([false, false])
    expect(() => reduced.insert('f', 'draft', 'flow', hashes)).toThrow('full')
    expect(reduced.has('f', 'draft', 'flow', hashes)).toEqual([true, true, false])
    expect(reduced.dedupeCount('f', 'draft')).toBe(2)
  })

  it('limits distinct keys while allowing updates, conditional inserts, deletions and independent scopes', () => {
    const store = setup({ ...stateLimits, maxValues: 1, maxValueBytes: 9 })
    store.set('f', 'draft', 'r', 'k', 'x')
    expect(() => store.set('f', 'draft', 'r', 'other', 'x')).toThrow('entry limit')
    store.set('f', 'draft', 'r', 'k', 'updated')
    expect(store.set('f', 'draft', 'r', 'k', 'ignored', true)).toBe(false)
    expect(() => store.set('f', 'draft', 'r', 'k', 'too large')).toThrow('size limit')
    expect(store.get('f', 'draft', 'k')).toBe('updated')
    store.set('f', 'live', 'r', 'other', 1)
    store.set('other', 'draft', 'r', 'k', 1)
    store.set('f', 'draft', 'r', 'k', null)
    expect(store.set('f', 'draft', 'r', 'other', 1, true)).toBe(true)
    store.clearValues('f', 'draft')
    expect(store.list('f', 'draft')).toEqual([])
  })

  it('accepts values beyond the retired total byte quota when each value and the entry count fit', () => {
    const store = setup()
    const value = 'x'.repeat(stateLimits.maxValueBytes - 2)
    Array.from({ length: 33 }, (_, index) => store.set('f', 'draft', 'r', String(index), value))
    expect(store.list('f', 'draft')).toHaveLength(33)
  })
})

it('removes values, spaces, hashes for both scopes when a Flow is physically deleted', async () => {
  const database = Database.open(':memory:')
  databases.push(database)
  const store = new Store(database, { engineDigest: isolatedVmEngineDigest, snapshot: () => undefined })
  store.flows.createFlow({
    actorId: 'test',
    content: '{}',
    createdAt: 1,
    digest: 'digest',
    flowId: 'flow',
    idempotencyKey: 'create',
    modelVersion: 13,
    name: 'Flow',
    requestDigest: 'create',
    revisionId: 'initial',
  })
  const hashes = await hashIdentities(['a'])
  for (const scope of ['draft', 'live'] as const) {
    store.state.set('flow', scope, 'run', 'value', 1)
    store.state.insert('flow', scope, 'node:removed', hashes)
    database.connection
      .prepare('INSERT INTO flow_dedupe_pending VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`orphan-${scope}`, 'job', 'flow', scope, 'node:pending', hashes[0]!, 0)
  }
  store.flows.retire('flow', 2)
  expect(store.flows.delete('flow')).toBe(true)
  for (const table of ['flow_state_values', 'flow_dedupe_spaces', 'flow_dedupe_identities', 'flow_dedupe_pending']) {
    expect(database.connection.prepare(`SELECT * FROM ${table} WHERE flow_id = ?`).all('flow')).toEqual([])
  }
})

it('allows deletion even when the configured value limit is smaller than serialized null', () => {
  const store = setup({ ...stateLimits, maxValueBytes: 1 })
  store.set('f', 'draft', 'run', 'k', 0)
  store.set('f', 'draft', 'run', 'k', null)
  expect(store.get('f', 'draft', 'k')).toBeNull()
  expect(store.dedupeCount('f', 'draft')).toBe(0)
})

it('migrates byte-accounted data without losing values or history', async () => {
  const database = Database.open(':memory:')
  databases.push(database)
  const store = new StateStore(database.connection, (operation) => database.transaction(operation))
  store.set('f', 'draft', 'r', 'key', '你好')
  store.insert('f', 'draft', 'flow', await hashIdentities(['a']))
  restoreGroupedServiceSettings(database.connection)
  database.connection.exec('ALTER TABLE flows DROP COLUMN icon; ALTER TABLE flows DROP COLUMN description;')
  database.connection.exec(
    "CREATE TABLE flow_state_usage (flow_id TEXT, scope TEXT, bytes INTEGER); ALTER TABLE flow_dedupe_spaces ADD COLUMN mode TEXT NOT NULL DEFAULT 'new'; ALTER TABLE flow_dedupe_spaces ADD COLUMN watermark_json TEXT; DROP TABLE flow_dedupe_pending; UPDATE flow_state_values SET size = 999; DROP TABLE workflow_bundle_imports; PRAGMA user_version = 58",
  )
  migrate(database)
  expect(store.view('f', 'draft')).toMatchObject({ values: [{ key: 'key', size: 8 }], spaces: [{ count: 1 }] })
  expect(store.readValues('f', 'draft', ['key'])).toEqual([{ key: 'key', value: '你好' }])
  expect(database.connection.prepare("SELECT name FROM sqlite_master WHERE name = 'flow_state_usage'").get()).toBeUndefined()
})

function activeRun(store: StateStore, runId: string, scope: 'draft' | 'live' = 'draft') {
  store.database
    .prepare(`INSERT INTO runs (run_id, idempotency_key, request_digest, flow_id, revision_id, revision_digest,
    closure_digest, model_version, engine_contract, engine_digest, inputs, source, status, created_at)
    VALUES (?, ?, ?, 'f', 'revision', 'digest', 'closure', 13, 'engine', 'digest', '{}', ?, 'running', 0)`)
    .run(runId, runId, runId, scope)
}

it('stages per invocation, filters within a Run, and commits idempotently', async () => {
  const store = setup()
  activeRun(store, 'r1')
  const hashes = await hashIdentities(['a', 'b', 'a'])
  expect(store.stage('f', 'draft', 'r1', 'job1', 'filter', hashes)).toEqual([true, true, false])
  expect(store.has('f', 'draft', 'node:filter', hashes)).toEqual([false, false, false])
  expect(store.stage('f', 'draft', 'r1', 'job2', 'filter', hashes)).toEqual([false, false, false])
  expect(store.view('f', 'draft').spaces).toMatchObject([{ count: 0, pendingCount: 2 }])
  expect(store.clearSpace('f', 'draft', 'node:filter')).toBe(false)
  store.transaction(() => store.finishRun('r1', true))
  store.transaction(() => store.finishRun('r1', true))
  expect(store.has('f', 'draft', 'node:filter', hashes)).toEqual([true, true, true])
  expect(store.view('f', 'draft').spaces).toMatchObject([{ count: 2, pendingCount: 0 }])
  expect(store.clearSpace('f', 'draft', 'node:filter')).toBe(true)
})

it('releases failed invocation reservations without losing other successful invocations', async () => {
  const store = setup()
  activeRun(store, 'r1')
  const hashes = await hashIdentities(['a', 'b'])
  store.stage('f', 'draft', 'r1', 'job1', 'filter', hashes.slice(0, 1))
  store.stage('f', 'draft', 'r1', 'job2', 'filter', hashes.slice(1))
  store.discardInvocation('r1', 'job2')
  store.transaction(() => store.finishRun('r1', true))
  expect(store.has('f', 'draft', 'node:filter', hashes)).toEqual([true, false])
})

it('reserves capacity across pending Runs and Code writes without suppressing another Run', async () => {
  const store = setup({ ...stateLimits, maxIdentities: 2, maxSpaces: 1 })
  activeRun(store, 'r1')
  activeRun(store, 'r2')
  const hashes = await hashIdentities(['a', 'b', 'c'])
  expect(store.stage('f', 'draft', 'r1', 'job1', 'filter', hashes.slice(0, 2))).toEqual([true, true])
  expect(store.stage('f', 'draft', 'r2', 'job1', 'filter', hashes.slice(0, 2))).toEqual([true, true])
  expect(store.dedupeCount('f', 'draft')).toBe(2)
  expect(() => store.stage('f', 'draft', 'r2', 'job2', 'filter', hashes)).toThrow('full')
  expect(() => store.insert('f', 'draft', 'flow', hashes.slice(2))).toThrow('space limit')
  store.transaction(() => store.finishRun('r1', false))
  expect(store.dedupeCount('f', 'draft')).toBe(2)
  store.transaction(() => store.finishRun('r2', false))
  expect(store.view('f', 'draft').spaces).toEqual([])
  store.insert('f', 'draft', 'flow', hashes.slice(2))
  expect(store.view('f', 'draft').spaces).toMatchObject([{ count: 1, pendingCount: 0 }])
})

it('includes pending reservations in Code identity capacity and isolates scopes', async () => {
  const store = setup({ ...stateLimits, maxIdentities: 1 })
  activeRun(store, 'r1')
  const hashes = await hashIdentities(['a'])
  store.stage('f', 'draft', 'r1', 'job1', 'filter', hashes)
  expect(() => store.insert('f', 'draft', 'flow', hashes)).toThrow('full')
  expect(store.insert('f', 'live', 'flow', hashes)).toEqual([true])
  store.transaction(() => store.finishRun('r1', false))
  expect(store.insert('f', 'draft', 'flow', hashes)).toEqual([true])
})

it('does not publish or release provisional history when the terminal transaction rolls back', async () => {
  const store = setup()
  activeRun(store, 'r1')
  const hashes = await hashIdentities(['a'])
  store.stage('f', 'draft', 'r1', 'job1', 'filter', hashes)
  expect(() =>
    store.transaction(() => {
      store.finishRun('r1', true)
      throw new Error('terminal failure')
    }),
  ).toThrow('terminal failure')
  expect(store.view('f', 'draft').spaces).toMatchObject([{ count: 0, pendingCount: 1 }])
  expect(store.has('f', 'draft', 'node:filter', hashes)).toEqual([false])
})

it('does not double count overlapping reservations after another Run commits but still protects reset', async () => {
  const store = setup({ ...stateLimits, maxIdentities: 1 })
  activeRun(store, 'r1')
  activeRun(store, 'r2')
  const hashes = await hashIdentities(['a'])
  store.stage('f', 'draft', 'r1', 'job1', 'filter', hashes)
  store.stage('f', 'draft', 'r2', 'job1', 'filter', hashes)
  store.transaction(() => store.finishRun('r1', true))
  expect(store.view('f', 'draft').spaces).toMatchObject([{ count: 1, pendingCount: 1, reservedCount: 1 }])
  expect(store.dedupeCount('f', 'draft')).toBe(1)
  expect(store.clearSpace('f', 'draft', 'node:filter')).toBe(false)
  store.transaction(() => store.finishRun('r2', false))
  expect(store.has('f', 'draft', 'node:filter', hashes)).toEqual([true])
  expect(store.clearSpace('f', 'draft', 'node:filter')).toBe(true)
})

it('summarizes surviving keys and their last write using effective limits and isolated scopes', () => {
  const store = setup({ ...stateLimits, maxValues: 7 })
  expect(store.summary('f', 'draft')).toEqual({ version: 1, scope: 'draft', limits: store.limits, values: { count: 0, updatedAt: null }, spaces: [] })
  store.set('f', 'draft', 'r', 'first', { private: true })
  store.set('f', 'draft', 'r', 'last', 2)
  store.database.prepare('UPDATE flow_state_values SET updated_at = ? WHERE key = ?').run(2000, 'last')
  store.set('f', 'live', 'r', 'production', 3)
  store.set('other', 'draft', 'r', 'unrelated', 4)
  expect(store.summary('f', 'draft').values).toEqual({ count: 2, updatedAt: 2000 })
  expect(store.summary('f', 'draft').limits.maxValues).toBe(7)
  expect(store.summary('f', 'live').values).toEqual({ count: 1, updatedAt: 1000 })
  store.clearValues('f', 'draft', 'last')
  expect(store.summary('f', 'draft').values).toEqual({ count: 1, updatedAt: 1000 })
  store.clearValues('f', 'draft')
  expect(store.summary('f', 'draft').values).toEqual({ count: 0, updatedAt: null })
})

it('shares source statistics with metadata reads and preserves overlapping pending capacity and reset protection', async () => {
  const store = setup()
  activeRun(store, 'summary-1')
  activeRun(store, 'summary-2')
  const hashes = await hashIdentities(['a', 'b'])
  store.insert('f', 'draft', 'flow', hashes)
  store.stage('f', 'draft', 'summary-1', 'job', 'filter', hashes)
  store.stage('f', 'draft', 'summary-2', 'job', 'filter', hashes)
  store.transaction(() => store.finishRun('summary-1', true))
  const summary = store.summary('f', 'draft')
  expect(summary.spaces).toEqual(store.view('f', 'draft').spaces)
  expect(summary.spaces).toMatchObject([
    { space: 'flow', count: 2, pendingCount: 0, reservedCount: 2, updatedAt: 1000 },
    { space: 'node:filter', count: 2, pendingCount: 2, reservedCount: 2, updatedAt: 1000 },
  ])
  expect(store.clearSpace('f', 'draft', 'node:filter')).toBe(false)
  store.transaction(() => store.finishRun('summary-2', false))
  expect(store.clearSpace('f', 'draft', 'node:filter')).toBe(true)
  expect(store.summary('f', 'draft').spaces.map((space) => space.space)).toEqual(['flow'])
})

it('clears only available history sources atomically and preserves complete pending sources and other data', async () => {
  const store = setup()
  const hashes = await hashIdentities(['a', 'b'])
  store.insert('f', 'draft', 'flow', hashes)
  store.insert('f', 'draft', 'node:filter', hashes)
  store.insert('f', 'live', 'flow', hashes)
  store.insert('other', 'draft', 'flow', hashes)
  store.set('f', 'draft', 'seed', 'saved', 42)
  activeRun(store, 'clear-pending')
  const pendingHashes = await hashIdentities(['pending'])
  expect(store.stage('f', 'draft', 'clear-pending', 'job', 'filter', pendingHashes)).toEqual([true])
  expect(store.stage('f', 'draft', 'clear-pending', 'other-job', 'new', pendingHashes)).toEqual([true])
  expect(store.clearAvailableSpaces('f', 'draft')).toBe(true)
  expect(store.summary('f', 'draft').spaces).toMatchObject([
    { space: 'node:filter', count: 2, pendingCount: 1 },
    { space: 'node:new', count: 0, pendingCount: 1 },
  ])
  expect(store.has('f', 'draft', 'node:filter', hashes)).toEqual([true, true])
  expect(store.has('f', 'draft', 'flow', hashes)).toEqual([false, false])
  expect(store.has('f', 'live', 'flow', hashes)).toEqual([true, true])
  expect(store.has('other', 'draft', 'flow', hashes)).toEqual([true, true])
  expect(store.get('f', 'draft', 'saved')).toBe(42)
  expect(store.clearAvailableSpaces('f', 'draft')).toBe(false)
  store.transaction(() => store.finishRun('clear-pending', false))
  expect(store.clearAvailableSpaces('f', 'draft')).toBe(true)
  expect(store.summary('f', 'draft').spaces).toEqual([])
  expect(store.clearAvailableSpaces('f', 'draft')).toBe(true)
})
