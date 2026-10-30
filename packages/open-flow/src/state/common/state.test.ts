import { describe, expect, it } from 'vitest'
import { dedupeIdentities, hashIdentities, increasingIdentities, itemIdentities, watermarkValue } from './state.ts'

describe('Flow State identities', () => {
  it('uses deterministic typed hashes and normalizes numeric zero', async () => {
    const hashes = await hashIdentities([1, '1', -0, 0, ''])
    expect(hashes.every((hash) => hash.length === 16)).toBe(true)
    expect(hashes[0]).not.toEqual(hashes[1])
    expect(hashes[2]).toEqual(hashes[3])
    expect(await hashIdentities([1])).toEqual([hashes[0]])
  })
  it('selects nested fields and rejects missing or non-scalar identities', () => {
    expect(itemIdentities([{ record: { id: 0 } }, { record: { id: 'x' } }], 'record.id')).toEqual([0, 'x'])
    expect(() => itemIdentities([{}], 'id')).toThrow()
    expect(() => dedupeIdentities([NaN])).toThrow()
  })
  it('compares against the initial watermark and preserves unsorted new items', () => {
    expect(increasingIdentities([5, 3, 5, 1, 4], 2)).toEqual({ inserted: [true, true, false, false, true], watermark: 5 })
    expect(increasingIdentities([], 5)).toEqual({ inserted: [], watermark: 5 })
  })
  it('compares timestamps by instant, including offsets and equal batch values', () => {
    expect(increasingIdentities(['2026-10-30T09:00:00+08:00', '2026-10-30T01:00:00Z', '2026-10-30T02:00:00Z'], '2026-10-30T00:00:00Z')).toEqual({
      inserted: [true, false, true],
      watermark: '2026-10-30T02:00:00Z',
    })
  })
  it('rejects ambiguous times, invalid dates and mixed watermark types', () => {
    for (const value of ['2026-02-30T00:00:00Z', '2026-10-30', '2026-10-30T00:00:00', '2026-10-30T24:00:00Z', '2026-10-30T00:00:00.0001Z'])
      expect(() => watermarkValue(value)).toThrow()
    expect(() => increasingIdentities([1, '2026-10-30T00:00:00Z'], null)).toThrow()
    expect(() => increasingIdentities([1], '2026-10-30T00:00:00Z')).toThrow()
  })
})
