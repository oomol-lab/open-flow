import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultValue, typeOfSchema } from './schemaWidget.ts'

afterEach(() => vi.useRealTimers())

describe('widget value creation', () => {
  it('preserves widget precedence and keeps unconstrained or compound values unset', () => {
    for (const schema of [{}, true, { anyOf: [] }, { allOf: [] }, { oneOf: [] }, { contentMediaType: 'oomol/bin', type: 'string' }]) {
      expect(getDefaultValue(typeOfSchema(schema), schema)).toBeUndefined()
    }
    const schema = { 'type': 'string', 'ui:widget': 'color', 'enum': ['red'], 'default': 'blue' }
    expect(typeOfSchema(schema)).toBe('color')
    expect(getDefaultValue(typeOfSchema(schema), schema)).toBe('#7d7fe9')
    expect(typeOfSchema({ 'type': 'string', 'ui:widget': 'unknown' })).toBe('string')
  })

  it('retains falsy literals and enumerated values and creates independent mutable values', () => {
    for (const value of [false, 0, '', null]) {
      expect(getDefaultValue('literal', { const: value })).toBe(value)
      expect(getDefaultValue('select', { enum: [value] })).toBe(value)
    }
    expect(getDefaultValue('select', { enum: [] })).toBeNull()
    const first = getDefaultValue('object') as Record<string, unknown>
    first.changed = true
    expect(getDefaultValue('object')).toEqual({})
    expect(getDefaultValue('array')).toEqual([])
    expect(getDefaultValue('boolean')).toBe(false)
    expect(getDefaultValue('integer')).toBe(0)
  })

  it('creates local date and time strings with the existing offset format', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 9, 15, 4, 5))
    expect(getDefaultValue('date', { format: 'date' })).toBe('2026-09-09')
    expect(getDefaultValue('date', { format: 'time' })).toMatch(/^15:04:05[+-]\d{2}:\d{2}$/)
    expect(getDefaultValue('date')).toMatch(/^2026-09-09T15:04:05[+-]\d{2}:\d{2}$/)
    expect(typeOfSchema({ type: 'string', format: 'date-time' })).toBe('date')
  })
})
