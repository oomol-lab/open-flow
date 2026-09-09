import { describe, expect, it } from 'vitest'
import { datePickerChange, datePickerValue } from './dateValue.ts'

describe('date fields', () => {
  it('preserves date-only values without UTC conversion', () => {
    expect(datePickerValue('2026-09-09', 'date')).toBe('2026-09-09')
    expect(datePickerChange('2026-09-10', undefined, 'date', -480)).toBe('2026-09-10')
  })
  it('preserves existing offsets and fractions when editing wall time', () => {
    expect(datePickerValue('2026-09-09T10:20:30.123+05:30', 'date-time')).toBe('2026-09-09T10:20:30.123')
    expect(datePickerChange('2026-09-10T11:20', '2026-09-09T10:20:30+05:30', 'date-time', -480)).toBe('2026-09-10T11:20:00+05:30')
    expect(datePickerChange('11:20:01.123', '10:00:00Z', 'time', -480)).toBe('11:20:01.123Z')
  })
  it('adds the selected local offset only for new zoned values', () => {
    expect(datePickerChange('10:20', undefined, 'time', -330)).toBe('10:20:00+05:30')
    expect(datePickerChange('10:20', undefined, 'time', 420)).toBe('10:20:00-07:00')
  })
  it('does not invent a current value for unset or malformed input', () => {
    expect(datePickerValue(undefined, 'date-time')).toBe('')
    expect(datePickerValue('bad', 'time')).toBe('')
    expect(datePickerChange('', '10:20:00Z', 'time', 0)).toBeUndefined()
  })
})
