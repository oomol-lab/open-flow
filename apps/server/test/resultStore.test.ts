import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { ResultStore } from '../node/storage/result-store.ts'

const databases: DatabaseSync[] = []
afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})
function fixture() {
  const database = new DatabaseSync(':memory:')
  databases.push(database)
  database.exec("CREATE TABLE runs (run_id TEXT PRIMARY KEY, status TEXT); INSERT INTO runs VALUES ('run', 'running'), ('other', 'running');")
  database.exec(readFileSync(new URL('../migrations/0014_run_results.sql', import.meta.url), 'utf8'))
  const transaction = <Value>(operation: () => Value): Value => {
    database.exec('BEGIN IMMEDIATE')
    try {
      const value = operation()
      database.exec('COMMIT')
      return value
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }
  return { database, store: new ResultStore(database, transaction), transaction }
}
const tool = { kind: 'connector' as const, id: 'mail', name: 'mail', description: 'Mail', action: 'gmail.fetch_emails', approval: false, inputs: [] }

describe('Run result storage', () => {
  it('retains complete data across store instances and isolates Run and invocation reads', () => {
    const { store, database, transaction } = fixture()
    const output = { body: 'x'.repeat(2 * 1024 * 1024) }
    const info = store.put('run', 'node', 'call', tool, {}, output)
    const reopened = new ResultStore(database, transaction)
    expect(reopened.get('run', info.resultId, 'node')?.content).toBe(JSON.stringify(output))
    expect(reopened.get('other', info.resultId)).toBeUndefined()
    expect(reopened.get('run', info.resultId, 'other-node')).toBeUndefined()
    expect(reopened.list('run').results).toEqual([info])
    expect(reopened.list('other').results).toEqual([])
    expect(reopened.put('run', 'node', 'call', tool, {}, output)).toEqual(info)
    expect(() => reopened.put('run', 'node', 'call', tool, { changed: true }, output)).toThrow('identity changed')
    expect(() => reopened.put('run', 'node', 'call', tool, {}, { changed: true })).toThrow('identity changed')
  })

  it('rejects writes after cancellation and detects corrupted content', () => {
    const { store, database } = fixture()
    const info = store.put('run', 'node', 'call', tool, {}, { ok: true })
    database.prepare('UPDATE run_results SET content = ? WHERE result_id = ?').run('{}', info.resultId)
    expect(() => store.get('run', info.resultId)).toThrow('digest')
    database.exec("UPDATE runs SET status = 'canceled'")
    expect(() => store.put('run', 'node', 'next', tool, {}, {})).toThrow('no longer accepts')
  })
})

it('checks the Run quota atomically before inserting another result', () => {
  const { store, database } = fixture()
  for (let index = 0; index < 4; index++) store.put('run', 'node', String(index), tool, {}, {})
  database.exec('UPDATE run_results SET bytes = 33554432')
  expect(() => store.put('run', 'node', 'overflow', tool, {}, {})).toThrow('128 MiB')
  expect(store.list('run').results).toHaveLength(4)
  expect(store.put('other', 'node', 'independent', tool, {}, {}).bytes).toBe(2)
})

it('stores code results with their source and detects changed code arguments', () => {
  const { store } = fixture()
  const call = { id: 'run_code', kind: 'code' as const }
  const input = { code: 'export default () => 1', inputs: {} }
  const result = store.put('run', 'node', 'compute', call, input, 1)
  expect(result.source).toEqual({ kind: 'code' })
  expect(store.find('run', 'node', 'compute', call, input)?.result).toEqual(result)
  expect(() => store.find('run', 'node', 'compute', call, { ...input, code: 'export default () => 2' })).toThrow('identity changed')
})
