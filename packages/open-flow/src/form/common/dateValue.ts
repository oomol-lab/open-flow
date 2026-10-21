import { timeZoneOffsetMinutes } from '../../localization/common/timeZone.ts'

export type DateFormat = 'date' | 'time' | 'date-time'

/** Keep editable wall text, including incomplete drafts, independently of its numeric offset. */
export function dateTimeWall(value: unknown): string {
  return typeof value == 'string' ? value.replace(/((?:^|T)\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(?:Z|[+-]\d{2}:\d{2})$/i, '$1') : ''
}

export function isDateFormat(value: unknown): value is DateFormat {
  return value === 'date' || value === 'time' || value === 'date-time'
}

/** Preserve the stored wall time and offset. Rendering never rewrites a value. */
export function datePickerValue(value: unknown, format: DateFormat): string {
  if (typeof value !== 'string') return ''
  if (format === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''
  const wall = dateTimeWall(value)
  const pattern = format === 'time' ? /^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/
  if (!pattern.test(wall)) return ''
  return /(?:^|T)\d{2}:\d{2}$/.test(wall) ? `${wall}:00` : wall
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

/** Format an instant for the shared editor without using the browser's local timezone. */
export function dateInTimeZone(at: string, timezone: string): string | undefined {
  const date = new Date(at)
  const offset = timeZoneOffsetMinutes(timezone, date)
  if (offset == null || !Number.isFinite(date.getTime())) return
  const wall = new Date(date.getTime() + offset * 60_000)
    .toISOString()
    .slice(0, 23)
    .replace(/\.000$/, '')
  return datePickerChange(wall, undefined, 'date-time', -offset)
}

/** Interpret an editor wall time in a named zone. Gaps are invalid; repeated times choose the earlier instant. */
export function dateFromTimeZone(value: string, timezone: string): string | undefined {
  const wall = dateTimeWall(value)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(wall)) return
  const normalized = wall.length == 16 ? `${wall}:00` : wall
  const naive = Date.parse(`${normalized}Z`)
  if (!Number.isFinite(naive)) return
  const expected = new Date(naive).toISOString().slice(0, 23)
  if (expected.slice(0, 19) != normalized.slice(0, 19)) return
  // Sampling either side of the wall date captures both offsets at a clock transition.
  const offsets = new Set([-86_400_000, 0, 86_400_000].map((delta) => timeZoneOffsetMinutes(timezone, new Date(naive + delta))))
  return [...offsets]
    .flatMap((offset) => {
      if (offset == null) return []
      const candidate = new Date(naive - offset * 60_000).toISOString()
      return Date.parse(`${datePickerValue(dateInTimeZone(candidate, timezone), 'date-time')}Z`) == naive ? [candidate] : []
    })
    .toSorted()[0]
}
