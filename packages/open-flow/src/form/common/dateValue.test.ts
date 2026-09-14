import { describe, expect, it } from 'vitest'
import { calendarChange, calendarDate, datePickerChange, datePickerValue } from './dateValue.ts'

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

describe('calendar wall dates', () => {
  it('keeps the stored day even when the offset crosses a UTC date boundary', () => {
    const date = calendarDate('2026-09-14T00:30:12.345+14:00', 'date-time')!
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 8, 14])
    date.setDate(15)
    expect(calendarChange(date, '2026-09-14T00:30:12.345+14:00', 'date-time')).toBe('2026-09-15T00:30:12.345+14:00')
  })
  it('rejects impossible dates and preserves early years', () => {
    expect(calendarDate('2026-02-30', 'date')).toBeUndefined()
    expect(calendarDate('2024-02-29', 'date')?.getDate()).toBe(29)
    expect(calendarDate('0099-01-01', 'date')?.getFullYear()).toBe(99)
  })
  it('selects a date without inventing a timezone for date-only values', () => {
    expect(calendarChange(new Date(2026, 8, 20), undefined, 'date')).toBe('2026-09-20')
    expect(calendarDate(undefined, 'date')).toBeUndefined()
  })
})
