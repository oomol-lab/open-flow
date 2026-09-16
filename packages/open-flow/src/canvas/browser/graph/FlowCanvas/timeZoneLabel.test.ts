import { describe, expect, it } from 'vitest'
import { uiLanguages } from '../../../../localization/common/languages.ts'
import { selectableTimeZones, timeZoneLabel, timeZoneLongLabel, timeZoneOffset, timeZoneOffsetMinutes } from '../../../../trigger/browser/timeZones.ts'
import { createI18n } from '../../i18n/i18n-loader.ts'

describe('timeZoneLabel', () => {
  it('offers UTC and each Studio time zone exactly once', () => {
    expect(selectableTimeZones).toHaveLength(79)
    expect(selectableTimeZones[0]).toBe('UTC')
    expect(new Set(selectableTimeZones).size).toBe(selectableTimeZones.length)
  })

  it('has Studio long names for the complete selectable list', () => {
    for (const language of ['en', 'zh-CN']) {
      for (const timezone of selectableTimeZones) {
        const label = timeZoneLongLabel(timezone, language)
        expect(label.length).toBeGreaterThan(0)
        if (timezone !== 'UTC') expect(label).not.toBe(timezone)
      }
    }
  })

  it('derives missing compact translations from the first long-name item', () => {
    const chinese = createI18n('zh-CN')
    const english = createI18n('en')
    expect(timeZoneLabel('Europe/Belgrade', chinese.t, 'zh-CN')).toBe('贝尔格莱德')
    expect(timeZoneLabel('Europe/Belgrade', english.t, 'en')).toBe('Belgrade')
    for (const timezone of selectableTimeZones) {
      expect(timeZoneLabel(timezone, chinese.t, 'zh-CN')).not.toMatch(/[/，,]/)
      expect(timeZoneLabel(timezone, english.t, 'en')).not.toMatch(/[/，,]/)
    }
    chinese.dispose()
    english.dispose()
  })

  it('uses the Studio long names in schedule menus', () => {
    expect(timeZoneLongLabel('UTC', 'en')).toBe('UTC')
    expect(timeZoneLongLabel('UTC', 'zh-CN')).toBe('UTC')
    expect(timeZoneLongLabel('Asia/Shanghai', 'en')).toBe('Beijing, Chongqing, Hong Kong SAR, Urumqi')
    expect(timeZoneLongLabel('Asia/Shanghai', 'zh-CN')).toBe('北京，重庆，香港特别行政区，乌鲁木齐')
    expect(timeZoneLongLabel('America/Detroit', 'zh-CN')).toBe('东部时间')
  })

  it('formats numeric UTC offsets and follows daylight saving time', () => {
    expect(timeZoneOffset('UTC', new Date('2026-09-17T00:00:00Z'))).toBe('UTC+00:00')
    expect(timeZoneOffset('Asia/Kolkata', new Date('2026-09-17T00:00:00Z'))).toBe('UTC+05:30')
    expect(timeZoneOffset('America/New_York', new Date('2026-09-17T00:00:00Z'))).toBe('UTC-04:00')
    expect(timeZoneOffset('America/New_York', new Date('2026-01-17T00:00:00Z'))).toBe('UTC-05:00')
    expect(timeZoneOffsetMinutes('America/New_York', new Date('2026-09-17T00:00:00Z'))).toBe(-240)
    expect(timeZoneOffsetMinutes('Asia/Kolkata', new Date('2026-09-17T00:00:00Z'))).toBe(330)
  })

  it.each([
    ['en', 'Asia/Shanghai', 'Shanghai'],
    ['zh-CN', 'Asia/Shanghai', '上海'],
    ['zh-TW', 'America/Argentina/Buenos_Aires', '布宜諾斯艾利斯'],
    ['zh-CN', 'America/Buenos_Aires', '布宜诺斯艾利斯'],
    ['zh-CN', 'Asia/Calcutta', '加尔各答'],
    ['fr', 'Europe/London', 'Londres'],
    ['en', 'America/Port_of_Spain', 'Port of Spain'],
    ['en', 'Etc/GMT+3', 'Etc/GMT+3'],
    ['en', 'Etc/UTC', 'UTC'],
    ['en', 'Unknown/Long_Timezone', 'Unknown/Long_Timezone'],
  ])('formats %s %s as %s', (language, zone, expected) => {
    const i18n = createI18n(language)
    expect(timeZoneLabel(zone, i18n.t, language)).toBe(expected)
    i18n.dispose()
  })
  it.each(uiLanguages)('has a short translated label in %s', (language) => {
    const i18n = createI18n(language)
    const label = timeZoneLabel('America/Argentina/Buenos_Aires', i18n.t, language)
    expect(label).not.toContain('/')
    expect(label).not.toContain('_')
    expect(label).not.toContain('Georgetown')
    i18n.dispose()
  })
})
