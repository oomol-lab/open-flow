import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { insert } from '../node/storage/insert.ts'

it('binds values to their columns and quotes identifiers', () => {
  const database = new DatabaseSync(':memory:')
  try {
    database.exec('CREATE TABLE "odd""table" (id INTEGER PRIMARY KEY, "select" TEXT, "a""b" BLOB, optional TEXT, count INTEGER DEFAULT 7)')
    const text = "'); DROP TABLE runs; --"
    const bytes = new Uint8Array([0, 128, 255])
    const result = insert(database, 'odd"table', { 'optional': null, 'a"b': bytes, 'select': text, 'id': 1n })
    expect(result.changes).toBe(1)
    expect(result.lastInsertRowid).toBe(1)
    const row = database.prepare('SELECT * FROM "odd""table"').get()
    expect(row).toMatchObject({ id: 1, select: text, optional: null, count: 7 })
    expect(Array.from(row?.['a"b'] as Uint8Array)).toEqual(Array.from(bytes))
  } finally {
    database.close()
  }
})

it('propagates constraint errors and participates in the caller transaction', () => {
  const database = new DatabaseSync(':memory:')
  try {
    database.exec('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
    database.exec('BEGIN IMMEDIATE')
    insert(database, 'records', { id: 1, value: 'first' })
    expect(() => insert(database, 'records', { id: 1, value: 'duplicate' })).toThrow(/UNIQUE constraint failed/)
    expect(() => insert(database, 'records', { id: 2, value: null })).toThrow(/NOT NULL constraint failed/)
    database.exec('ROLLBACK')
    expect(database.prepare('SELECT * FROM records').all()).toEqual([])
  } finally {
    database.close()
  }
})
