// Move to this file to avoid breaking React Fast Refresh.
import type { DesignerOption as IBasicOption } from './select.tsx'

import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import localeData from 'dayjs/plugin/localeData.js'
import weekday from 'dayjs/plugin/weekday.js'

dayjs.extend(weekday)
dayjs.extend(localeData)
dayjs.extend(customParseFormat)

export const DateTimeFormats = ['date', 'time', 'date-time'] as const

export type DateTimeFormat = (typeof DateTimeFormats)[number]

export function isDateTimeFormat(format: unknown): format is DateTimeFormat {
  return DateTimeFormats.includes(format as DateTimeFormat)
}
export function asDate(value: unknown): Date {
  const date = dayjs(value as any)
  return date.isValid() ? date.toDate() : new Date()
}
export function asDateTimeFormat(value: unknown): DateTimeFormat {
  return DateTimeFormats.includes(value as DateTimeFormat) ? (value as DateTimeFormat) : defaultDateTimeFormat
}
export const defaultDateTimeFormat: DateTimeFormat = 'date-time'
export interface DateTimeFormatOption extends IBasicOption {
  value: DateTimeFormat
}

export const dateTimeFormatOptions: DateTimeFormatOption[] = /*#__PURE__*/ DateTimeFormats.map((e) => ({ value: e }))

export function optionOfDateTimeFormat(type: DateTimeFormat): DateTimeFormatOption {
  return dateTimeFormatOptions.find((e) => e.value === type)!
}
export function formatDate(date: Date, format: DateTimeFormat = defaultDateTimeFormat): string {
  return dayjs(date).format(getDayjsFormat(format))
}

function getDayjsFormat(format: DateTimeFormat): string {
  switch (format) {
    case 'date':
      return 'YYYY-MM-DD'
    case 'time':
      return 'HH:mm:ssZ'
    case 'date-time':
      return 'YYYY-MM-DDTHH:mm:ssZ'
  }
}
