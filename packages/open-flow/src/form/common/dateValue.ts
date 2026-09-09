export type DateFormat = 'date' | 'time' | 'date-time'

export function isDateFormat(value: unknown): value is DateFormat {
  return value === 'date' || value === 'time' || value === 'date-time'
}

/** Preserve the stored wall time and offset. Rendering never rewrites a value. */
export function datePickerValue(value: unknown, format: DateFormat): string {
  if (typeof value !== 'string') return ''
  if (format === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
  const wall = value.replace(/(?:Z|[+-]\d{2}:\d{2})$/i, '')
  const pattern = format === 'time' ? /^\d{2}:\d{2}:\d{2}(?:\.\d+)?$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/
  return pattern.test(wall) ? wall : ''
}

export function datePickerChange(value: string, previous: unknown, format: DateFormat, offsetMinutes: number): string | undefined {
  if (value === '') return undefined
  if (format === 'date') return value
  const suffix = typeof previous === 'string' ? previous.match(/(?:Z|[+-]\d{2}:\d{2})$/i)?.[0] : undefined
  const minutes = Math.abs(offsetMinutes)
  const offset = suffix ?? `${offsetMinutes <= 0 ? '+' : '-'}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  const wall = /\d{2}:\d{2}$/.test(value) && value.split(':').length === 2 ? `${value}:00` : value
  return `${wall}${offset}`
}
