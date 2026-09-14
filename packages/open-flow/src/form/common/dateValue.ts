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

/** Calendar dates represent stored wall dates, never an instant converted through UTC. */
export function calendarDate(value: unknown, format: DateFormat): Date | undefined {
  const wall = datePickerValue(value, format)
  if (format === 'time' || !wall) return undefined
  const [year, month, day] = wall.slice(0, 10).split('-').map(Number)
  const date = new Date(0)
  date.setFullYear(year!, month! - 1, day!)
  date.setHours(12, 0, 0, 0)
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day ? date : undefined
}

export function calendarChange(date: Date, previous: unknown, format: DateFormat): string {
  const day = `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  if (format === 'date') return day
  const time = datePickerValue(previous, 'date-time').split('T')[1] ?? '00:00:00'
  return datePickerChange(`${day}T${time}`, previous, 'date-time', date.getTimezoneOffset())!
}
