import type { TFunction } from 'val-i18n'

import { resolveUiLanguage } from '../../localization/common/languages.ts'
import studioEnglishTimeZoneLongNames from './locales/timeZoneLongNames.en.json'
import studioChineseTimeZoneLongNames from './locales/timeZoneLongNames.zh-CN.json'

export const selectableTimeZones: readonly string[] = [
  'UTC',
  'Pacific/Midway',
  'Pacific/Honolulu',
  'America/Juneau',
  'America/Boise',
  'America/Dawson',
  'America/Chihuahua',
  'America/Phoenix',
  'America/Chicago',
  'America/Regina',
  'America/Mexico_City',
  'America/Belize',
  'America/Detroit',
  'America/Bogota',
  'America/Caracas',
  'America/Santiago',
  'America/St_Johns',
  'America/Sao_Paulo',
  'America/Tijuana',
  'America/Montevideo',
  'America/Argentina/Buenos_Aires',
  'America/Godthab',
  'America/Los_Angeles',
  'Atlantic/Azores',
  'Atlantic/Cape_Verde',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Africa/Casablanca',
  'Atlantic/Canary',
  'Europe/Belgrade',
  'Europe/Sarajevo',
  'Europe/Brussels',
  'Europe/Amsterdam',
  'Africa/Algiers',
  'Europe/Bucharest',
  'Africa/Cairo',
  'Europe/Helsinki',
  'Europe/Athens',
  'Asia/Jerusalem',
  'Africa/Harare',
  'Europe/Moscow',
  'Asia/Kuwait',
  'Africa/Nairobi',
  'Asia/Baghdad',
  'Asia/Tehran',
  'Asia/Dubai',
  'Asia/Baku',
  'Asia/Kabul',
  'Asia/Yekaterinburg',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Dhaka',
  'Asia/Colombo',
  'Asia/Almaty',
  'Asia/Rangoon',
  'Asia/Bangkok',
  'Asia/Krasnoyarsk',
  'Asia/Shanghai',
  'Asia/Kuala_Lumpur',
  'Asia/Taipei',
  'Australia/Perth',
  'Asia/Irkutsk',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Asia/Yakutsk',
  'Australia/Darwin',
  'Australia/Adelaide',
  'Australia/Sydney',
  'Australia/Brisbane',
  'Australia/Hobart',
  'Asia/Vladivostok',
  'Pacific/Guam',
  'Asia/Magadan',
  'Asia/Kamchatka',
  'Pacific/Fiji',
  'Pacific/Auckland',
  'Pacific/Tongatapu',
]

// Long menu labels follow the Studio time-zone picker. Other supported languages use the
// browser's localized generic zone name rather than falling back to the compact canvas label.
const studioTimeZoneLongNames: Readonly<Record<'en' | 'zh-CN', Readonly<Record<string, string>>>> = {
  'en': studioEnglishTimeZoneLongNames,
  'zh-CN': studioChineseTimeZoneLongNames,
}

export function timeZoneLongLabel(timezone: string, language: string): string {
  if (timezone === 'UTC') return 'UTC'
  const resolved = resolveUiLanguage([language])
  if (resolved === 'en' || resolved === 'zh-CN') {
    const studioLabel = studioTimeZoneLongNames[resolved][timezone]
    if (studioLabel != null) return studioLabel
  }
  try {
    const label = new Intl.DateTimeFormat(resolved, { timeZone: timezone, timeZoneName: 'longGeneric' })
      .formatToParts()
      .find((part) => part.type === 'timeZoneName')?.value
    if (label != null && !/^(?:GMT|UTC)[+−-]/.test(label)) return label
  } catch {}
  return timezone
}

export function timeZoneOffset(timezone: string, at: Date = new Date()): string | undefined {
  const minutes = timeZoneOffsetMinutes(timezone, at)
  if (minutes == null) return
  const sign = minutes < 0 ? '-' : '+'
  const absolute = Math.abs(minutes)
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`
}

export function timeZoneOffsetMinutes(timezone: string, at: Date = new Date()): number | undefined {
  try {
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value
    if (offset == null) return
    if (offset === 'GMT') return 0
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset)
    if (match == null) return
    const minutes = Number(match[2]) * 60 + Number(match[3])
    return match[1] === '-' ? -minutes : minutes
  } catch {
    return
  }
}

// Prefer the compact canvas translations. Complete-list entries derive a compact label from the
// first location in the Studio menu copy so the two representations cannot drift apart.
export function timeZoneLabel(timezone: string, t: TFunction, language: string): string {
  let canonical: string
  try {
    canonical = new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone
  } catch {
    return timezone
  }
  if (canonical === 'UTC') return 'UTC'
  const aliases: Record<string, string> = {
    'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
    'Asia/Calcutta': 'Asia/Kolkata',
  }
  for (const zone of [timezone, aliases[canonical] ?? canonical]) {
    const key = `timeZoneNames.${zone}`
    const label = t(key)
    if (label !== key) return label
  }
  if (selectableTimeZones.includes(timezone)) {
    const longLabel = timeZoneLongLabel(timezone, language)
    if (longLabel !== timezone) return longLabel.split(/[,，]/, 1)[0]!.trim()
  }
  // Preserve the Etc/GMT sign convention instead of turning it into a misleading UTC offset.
  if (canonical.startsWith('Etc/')) return canonical
  return (canonical.split('/').at(-1) ?? canonical).replaceAll('_', ' ')
}
