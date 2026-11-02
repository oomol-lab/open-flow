import { describe, expect, it } from 'vitest'
import { dedupeIdentities, hashIdentities, skipDuplicatesConfigSchema, skipDuplicatesIdentities } from './state.ts'

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
