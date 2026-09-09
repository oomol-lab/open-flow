import { describe, expect, it } from 'vitest'
import { initialValue, isJsonValue, renameObjectField, setObjectField } from './value.ts'

describe('JSON field editing', () => {
  it('adds, edits, renames and removes open object fields without mutating the original', () => {
    const original = { existing: true }
    const added = setObjectField(original, 'field', 'hello')
    expect(original).toEqual({ existing: true })
    const renamed = renameObjectField(added, 'field', 'message')
    expect(renamed).toEqual({ existing: true, message: 'hello' })
    expect(renameObjectField(added, 'field', 'existing')).toBeUndefined()
    expect(setObjectField(renamed, 'message', undefined)).toEqual(original)
  })

  it('treats prototype-like names as ordinary JSON properties', () => {
    const value = setObjectField({}, '__proto__', { enabled: true })
    expect(Object.hasOwn(value, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    expect(renameObjectField(value, '__proto__', 'constructor')).toEqual({ constructor: { enabled: true } })
  })

  it('rejects cyclic, non-finite, sparse and non-JSON values', () => {
    const cycle: unknown[] = []
    cycle.push(cycle)
    for (const value of [cycle, NaN, Infinity, 1n, undefined, new Date(), Array.from({ length: 1 }), { value: undefined }])
      expect(isJsonValue(value)).toBe(false)
    const shared = { value: 1 }
    expect(isJsonValue([shared, shared])).toBe(true)
  })

  it('clones explicit defaults when creating a value', () => {
    const schema = { default: { items: [] } }
    const value = initialValue(schema)
    expect(value).toEqual(schema.default)
    expect(value).not.toBe(schema.default)
  })
})
