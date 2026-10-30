import { hashIdentities } from '@oomol-lab/open-flow/flow-state'
import { afterEach, describe, expect, it } from 'vitest'
import { isolatedVmEngineDigest } from '../node/runtime/isolated-vm.ts'
import { Database } from '../node/storage/database.ts'
import { migrate } from '../node/storage/migrate.ts'
import { StateStore, stateLimits } from '../node/storage/state-store.ts'
import { Store } from '../node/storage/store.ts'

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
    expect(store.insert('f', 'draft', 'flow', 'new', ids.slice(0, 2), hashes.slice(0, 2))).toEqual([true, true])
    expect(() => store.insert('f', 'draft', 'flow', 'new', ids, hashes)).toThrow('full')
    expect(store.has('f', 'draft', 'flow', hashes)).toEqual([true, true, false])
    expect(store.insert('f', 'draft', 'flow', 'new', ['b', 'b'], [hashes[1]!, hashes[1]!])).toEqual([false, false])
    expect(store.dedupeCount('f', 'draft')).toBe(2)
    store.clearSpace('f', 'draft', 'flow')
    expect(store.dedupeCount('f', 'draft')).toBe(0)
  })
  it('accepts duplicate-only batches after lowering the limit but rejects new identities atomically', async () => {
    const store = setup({ ...stateLimits, maxIdentities: 2 })
    const ids = ['a', 'b', 'c']
    const hashes = await hashIdentities(ids)
    store.insert('f', 'draft', 'flow', 'new', ids.slice(0, 2), hashes.slice(0, 2))
    const reduced = new StateStore(store.database, store.transaction, store.clock, { ...stateLimits, maxIdentities: 1 })
    expect(reduced.insert('f', 'draft', 'flow', 'new', ['b', 'b'], [hashes[1]!, hashes[1]!])).toEqual([false, false])
    expect(() => reduced.insert('f', 'draft', 'flow', 'new', ids, hashes)).toThrow('full')
    expect(reduced.has('f', 'draft', 'flow', hashes)).toEqual([true, true, false])
    expect(reduced.dedupeCount('f', 'draft')).toBe(2)
  })
  it('changes modes atomically and leaves prior history intact after invalid watermarks', async () => {
    const store = setup()
    const ids = ['a']
    const hashes = await hashIdentities(ids)
    store.insert('f', 'draft', 'flow', 'new', ids, hashes)
    expect(() => store.insert('f', 'draft', 'flow', 'increasing', ['invalid'], [])).toThrow()
    expect(store.has('f', 'draft', 'flow', hashes)).toEqual([true])
    expect(store.insert('f', 'draft', 'flow', 'increasing', [10, 2, 10], [])).toEqual([true, true, false])
    expect(store.insert('f', 'draft', 'flow', 'increasing', [9, 11], [])).toEqual([false, true])
    expect(() => store.has('f', 'draft', 'flow', hashes)).toThrow()
    expect(store.insert('f', 'draft', 'flow', 'new', ids, hashes)).toEqual([true])
    expect(store.dedupeCount('f', 'draft')).toBe(1)
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
  it('shares identity capacity across spaces and frees it on clearing or switching to a watermark', async () => {
    const store = setup({ ...stateLimits, maxIdentities: 2 })
    const hashes = await hashIdentities(['a', 'b'])
    store.insert('f', 'draft', 'flow', 'new', ['a'], [hashes[0]!])
    store.insert('f', 'draft', 'node:a', 'new', ['a'], [hashes[0]!])
    expect(() => store.insert('f', 'draft', 'node:b', 'new', ['b'], [hashes[1]!])).toThrow('full')
    expect(store.view('f', 'draft').spaces).toHaveLength(2)
    store.insert('f', 'live', 'flow', 'new', ['a', 'b'], hashes)
    store.insert('f', 'draft', 'node:a', 'increasing', [1], [])
    store.insert('f', 'draft', 'node:b', 'new', ['b'], [hashes[1]!])
    expect(() => store.insert('f', 'draft', 'node:a', 'new', ['a'], [hashes[0]!])).toThrow('full')
    expect(store.view('f', 'draft').spaces.find((item) => item.space === 'node:a')?.watermark).toBe(1)
    store.clearSpace('f', 'draft', 'flow')
    store.insert('f', 'draft', 'node:a', 'new', ['a'], [hashes[0]!])
    expect(store.dedupeCount('f', 'draft')).toBe(2)
  })
  it('bounds watermark spaces, including empty switched spaces, and releases slots on clearing', async () => {
    const store = setup({ ...stateLimits, maxSpaces: 1 })
    store.insert('f', 'draft', 'node:a', 'increasing', [1], [])
    expect(() => store.insert('f', 'draft', 'node:b', 'increasing', [2], [])).toThrow('space limit')
    expect(store.insert('f', 'draft', 'node:b', 'increasing', [], [])).toEqual([])
    store.insert('f', 'draft', 'node:a', 'increasing', [2], [])
    store.insert('f', 'draft', 'node:a', 'new', [], [])
    expect(() => store.insert('f', 'draft', 'node:b', 'increasing', [2], [])).toThrow('space limit')
    store.clearSpace('f', 'draft', 'node:a')
    expect(() => store.insert('f', 'draft', 'node:' + 'x'.repeat(252), 'increasing', [1], [])).toThrow('256')
    store.insert('f', 'draft', 'node:b', 'increasing', [2], [])
    expect(store.view('f', 'draft').spaces).toHaveLength(1)
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
    store.state.insert('flow', scope, 'node:removed', 'new', ['a'], hashes)
  }
  store.flows.retire('flow', 2)
  expect(store.flows.delete('flow')).toBe(true)
  for (const table of ['flow_state_values', 'flow_dedupe_spaces', 'flow_dedupe_identities']) {
    expect(database.connection.prepare(`SELECT * FROM ${table} WHERE flow_id = ?`).all('flow')).toEqual([])
  }
})

it('resets a changed mode even when the first batch is empty', async () => {
  const store = setup()
  const hashes = await hashIdentities(['a'])
  store.insert('f', 'draft', 'flow', 'new', ['a'], hashes)
  expect(store.insert('f', 'draft', 'flow', 'increasing', [], [])).toEqual([])
  expect(store.view('f', 'draft')).toMatchObject({ spaces: [{ mode: 'increasing', watermark: null, count: 0 }] })
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
  store.insert('f', 'draft', 'flow', 'new', ['a'], await hashIdentities(['a']))
  database.connection.exec(
    'CREATE TABLE flow_state_usage (flow_id TEXT, scope TEXT, bytes INTEGER); UPDATE flow_state_values SET size = 999; PRAGMA user_version = 57',
  )
  migrate(database)
  expect(store.view('f', 'draft', true)).toMatchObject({ values: [{ key: 'key', value: '你好', size: 8 }], spaces: [{ count: 1 }] })
  expect(database.connection.prepare("SELECT name FROM sqlite_master WHERE name = 'flow_state_usage'").get()).toBeUndefined()
})
