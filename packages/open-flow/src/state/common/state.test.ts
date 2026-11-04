import { describe, expect, it } from 'vitest'
import {
  dedupeIdentities,
  flowStateViewSchema,
  hashIdentities,
  skipDuplicatesConfigSchema,
  skipDuplicatesIdentities,
  stateQuerySchema,
  stateReadSchema,
} from './state.ts'

describe('State management reads', () => {
  it('requires bounded explicit keys and keeps the legacy metadata-only query', () => {
    expect(stateQuerySchema.parse({ scope: 'draft', values: false })).toEqual({ scope: 'draft', values: false })
    expect(stateQuerySchema.safeParse({ scope: 'draft', values: true }).success).toBe(false)
    expect(stateReadSchema.parse({ scope: 'live', keys: ['cursor', 'last run/时间'] }).keys).toEqual(['cursor', 'last run/时间'])
    for (const input of [
      { scope: 'live' },
      { keys: ['cursor'] },
      { scope: 'live', keys: [] },
      { scope: 'live', keys: ['cursor', 'cursor'] },
      { scope: 'live', keys: [''] },
      { scope: 'live', keys: ['汉'.repeat(86)] },
      { scope: 'live', keys: Array.from({ length: 17 }, (_, index) => String(index)) },
      { scope: 'live', keys: ['cursor'], values: true },
    ])
      expect(stateReadSchema.safeParse(input).success).toBe(false)
  })
  it('rejects overview responses containing value bodies', () => {
    expect(flowStateViewSchema.shape.values.safeParse([{ key: 'cursor', size: 1, updatedAt: 1, value: 0 }]).success).toBe(false)
  })
})

describe('Flow State identities', () => {
  it('uses deterministic typed hashes and normalizes numeric zero', async () => {
    const hashes = await hashIdentities([1, '1', -0, 0, ''])
    expect(hashes.every((hash) => hash.length === 16)).toBe(true)
    expect(hashes[0]).not.toEqual(hashes[1])
    expect(hashes[2]).toEqual(hashes[3])
    expect(await hashIdentities([1])).toEqual([hashes[0]])
    expect(() => dedupeIdentities([NaN])).toThrow()
  })
  it('preserves field definitions and scalar types in composite identities', async () => {
    const items = [
      { record: { id: 1 }, company: 'a' },
      { record: { id: '1' }, company: 'a' },
      { record: { id: 1 }, company: 'b' },
    ]
    const ids = skipDuplicatesIdentities(items, ['record.id', 'company'])
    expect(new Set(ids).size).toBe(3)
    expect(skipDuplicatesIdentities(items, ['company', 'record.id'])).toEqual(ids)
    expect(skipDuplicatesIdentities([{ a: 1, b: 1 }], ['a'])).not.toEqual(skipDuplicatesIdentities([{ a: 1, b: 1 }], ['b']))
    expect(await hashIdentities(ids)).toEqual(await hashIdentities(skipDuplicatesIdentities(items, ['company', 'record.id'])))
    expect(
      new Set(
        skipDuplicatesIdentities(
          [
            { a: 'x:y', b: 'z' },
            { a: 'x', b: 'y:z' },
          ],
          ['a', 'b'],
        ),
      ).size,
    ).toBe(2)
  })
  it('supports scalar lists without fields, including empty strings and numeric zero', () => {
    const ids = skipDuplicatesIdentities(['', 0, -0, 1, '1'], [])
    expect(ids[1]).toBe(ids[2])
    expect(ids[3]).not.toBe(ids[4])
    expect(skipDuplicatesIdentities([], [])).toEqual([])
  })
  it.each([undefined, null, {}, [], true])('identifies the item and invalid field value %j', (value) => {
    expect(() => skipDuplicatesIdentities([{ id: 1 }, value === undefined ? {} : { id: value }], ['id'])).toThrow('Item 2, field "id"')
  })
  it('rejects complex scalar items and invalid configurations instead of accepting retired options', () => {
    expect(() => skipDuplicatesIdentities([{}], [])).toThrow('the item itself')
    expect(() => skipDuplicatesIdentities(null, [])).toThrow('array')
    for (const fields of [[''], ['a..b'], ['a', 'a']]) expect(skipDuplicatesConfigSchema.safeParse({ fields }).success).toBe(false)
    expect(skipDuplicatesConfigSchema.safeParse({ field: 'id', mode: 'new', space: 'node' }).success).toBe(false)
  })
})
