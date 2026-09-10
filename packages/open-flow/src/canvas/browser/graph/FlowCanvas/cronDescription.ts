/* Locale entry points register translations with cronstrue. */
/* oxlint-disable import/no-unassigned-import */
import 'cronstrue/locales/zh_CN'
import 'cronstrue/locales/zh_TW'
import 'cronstrue/locales/ja'
import 'cronstrue/locales/ko'
import 'cronstrue/locales/ru'
import 'cronstrue/locales/fr'
/* oxlint-enable import/no-unassigned-import */
import type { TFunction } from 'val-i18n'

import { Cron } from 'croner'
import cronstrue from 'cronstrue'
import { resolveUiLanguage } from '../../../../localization/common/languages.ts'

/** Descriptions are presentation only; Croner remains the scheduling authority. */
export function cronDescription(expression: string, language: string): string {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return expression
  const day = fields[2]!
  const weekday = fields[4]!
  // Croner extensions and combined day fields are not described consistently across locales.
  if (weekday.includes('+') || /L/i.test(weekday) || (!['*', '?'].includes(day) && !['*', '?'].includes(weekday))) return expression
  try {
    const cron = new Cron(expression)
    return cronstrue.toString(cron.getPattern() ?? expression, {
      locale: resolveUiLanguage([language]).replace('-', '_'),
      use24HourTimeFormat: true,
      dayOfWeekStartIndexZero: true,
      logicalAndDayFields: false,
      throwExceptionOnParseError: true,
    })
  } catch {
    return expression
  }
}

/** Only concise, familiar patterns get labels; other expressions remain directly inspectable. */
export function cronLabel(expression: string, language: string, t: TFunction): string {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return expression
  try {
    const cron = new Cron(expression)
    if (cron.getPattern() == null) return expression
  } catch {
    return expression
  }
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string]
  if (month !== '*') return expression
  if (day === '*' && weekday === '*') {
    const step = /^\*\/(\d+)$/.exec(minute)
    if (hour === '*' && (minute === '*' || step)) {
      if (step && 60 % Number(step[1]) !== 0) return expression
      return t('canvasCard.every', { value: step ? Number(step[1]) : 1, unit: t('canvasCard.shortUnits.minute') })
    }
    const hourStep = /^\*\/(\d+)$/.exec(hour)
    if (minute === '0' && (hour === '*' || hourStep)) {
      if (hourStep && 24 % Number(hourStep[1]) !== 0) return expression
      return t('canvasCard.every', { value: hourStep ? Number(hourStep[1]) : 1, unit: t('canvasCard.shortUnits.hour') })
    }
  }
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return expression
  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  let label: string
  if (weekday === '*') {
    if (day === '*') label = t('canvasCard.scheduleDaily')
    else if (day === 'L') label = t('canvasCard.scheduleMonthEnd')
    else if (/^\d+(,\d+){0,2}$/.test(day)) label = t('canvasCard.scheduleDays', { days: day.split(',').map(Number).join(', ') })
    else return expression
  } else if (day === '*') {
    const weekdayNumbers: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }
    const parts = weekday.toUpperCase().split('-')
    if (parts.length > 2) return expression
    const days = parts.map((part) => (/^[0-7]$/.test(part) ? Number(part) : weekdayNumbers[part]))
    if (days.some((value) => value === undefined)) return expression
    const formatter = new Intl.DateTimeFormat(resolveUiLanguage([language]), { weekday: 'short', timeZone: 'UTC' })
    const names = days.map((value) => formatter.format(new Date(Date.UTC(2026, 0, 4 + (value! % 7)))))
    label =
      days[0] === 0 && days[1] === 7
        ? t('canvasCard.scheduleDaily')
        : names.length === 1
          ? names[0]!
          : t('canvasCard.scheduleRange', { start: names[0]!, end: names[1]! })
  } else return expression
  const result = `${label} · ${time}`
  return result.length <= 40 ? result : expression
}
