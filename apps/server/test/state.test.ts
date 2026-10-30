import { hashIdentities } from '@oomol-lab/open-flow/flow-state'
import { afterEach, describe, expect, it } from 'vitest'
import { isolatedVmEngineDigest } from '../node/runtime/isolated-vm.ts'
import { Database } from '../node/storage/database.ts'
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
    expect(store.view('a', 'draft').bytes).toBe(0)
  })
  it('rolls back the complete batch on capacity and permits duplicate-only batches at capacity', async () => {
    const store = setup({ ...stateLimits, maxIdentities: 2 })
    const ids = ['a', 'b', 'c']
    const hashes = await hashIdentities(ids)
    expect(store.insert('f', 'draft', 'flow', 'new', ids.slice(0, 2), hashes.slice(0, 2))).toEqual([true, true])
    expect(() => store.insert('f', 'draft', 'flow', 'new', ids, hashes)).toThrow('full')
    expect(store.has('f', 'draft', 'flow', hashes)).toEqual([true, true, false])
    expect(store.insert('f', 'draft', 'flow', 'new', ['b', 'b'], [hashes[1]!, hashes[1]!])).toEqual([false, false])
    expect(store.view('f', 'draft').bytes).toBe(192)
    store.clearSpace('f', 'draft', 'flow')
    expect(store.view('f', 'draft').bytes).toBe(0)
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
    expect(store.view('f', 'draft').bytes).toBe(96)
  })
  it('enforces total bytes without changing stored values or dedupe history', async () => {
    const store = setup({ ...stateLimits, maxBytes: 100 })
    store.set('f', 'draft', 'r', 'k', 'x')
    expect(() => store.set('f', 'draft', 'r', 'other', 'x')).toThrow('size limit')
    const hashes = await hashIdentities(['a'])
    expect(() => store.insert('f', 'draft', 'flow', 'new', ['a'], hashes)).toThrow('size limit')
    expect(store.view('f', 'draft').spaces).toEqual([])
    expect(store.list('f', 'draft')).toEqual(['k'])
    store.clearValues('f', 'draft')
    expect(store.view('f', 'draft').bytes).toBe(0)
  })
})

it('removes values, spaces, hashes and accounting for both scopes when a Flow is physically deleted', async () => {
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
  for (const table of ['flow_state_values', 'flow_dedupe_spaces', 'flow_dedupe_identities', 'flow_state_usage']) {
    expect(database.connection.prepare(`SELECT * FROM ${table} WHERE flow_id = ?`).all('flow')).toEqual([])
  }
})

it('resets a changed mode even when the first batch is empty', async () => {
  const store = setup()
  const hashes = await hashIdentities(['a'])
  store.insert('f', 'draft', 'flow', 'new', ['a'], hashes)
  expect(store.insert('f', 'draft', 'flow', 'increasing', [], [])).toEqual([])
  expect(store.view('f', 'draft')).toMatchObject({ bytes: 0, spaces: [{ mode: 'increasing', watermark: null, count: 0 }] })
})

it('allows deletion even when the configured value limit is smaller than serialized null', () => {
  const store = setup({ ...stateLimits, maxValueBytes: 1 })
  store.set('f', 'draft', 'run', 'k', 0)
  store.set('f', 'draft', 'run', 'k', null)
  expect(store.get('f', 'draft', 'k')).toBeNull()
  expect(store.view('f', 'draft').bytes).toBe(0)
})
