import { describe, expect, it } from 'vitest'
import { choiceSchema, enumIndex, toggleEnumValue } from './choices.ts'
import { compile } from './validation/validator.ts'

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
  it('retains shared constraints without re-entering the same union', () => {
    const schema = { 'minLength': 3, 'oneOf': [{ type: 'string' }, { type: 'number' }], 'ui:options': { labels: ['Text', 'Number'] } }
    expect(choiceSchema(schema, 0)).toEqual({ minLength: 3, type: 'string' })
    const [validate] = compile(schema)
    expect(validate?.('ab')).toBe(false)
    expect(validate?.('abc')).toBe(true)
    expect(validate?.(42)).toBe(true)
  })
})
