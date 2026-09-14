import { describe, expect, it } from 'vitest'
import { enumIndex, toggleEnumValue } from './choices.ts'

describe('schema choices', () => {
  it('compares structured enum values regardless of property order', () => {
    expect(enumIndex([{ a: 1, b: 2 }], { b: 2, a: 1 })).toBe(0)
    expect(enumIndex([1], '1')).toBe(-1)
  })
  it('preserves other values when toggling and does not create duplicates', () => {
    const options = [{ a: 1, b: 2 }, 'second']
    const original = [{ b: 2, a: 1 }, 'external']
    expect(toggleEnumValue(options, original, 0, true)).toEqual(original)
    expect(toggleEnumValue(options, original, 0, false)).toEqual(['external'])
    expect(toggleEnumValue(options, original, 1, true)).toEqual([...original, 'second'])
    expect(original).toHaveLength(2)
  })
})
