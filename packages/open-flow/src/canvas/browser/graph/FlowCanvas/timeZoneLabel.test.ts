import { describe, expect, it } from 'vitest'
import { uiLanguages } from '../../../../localization/common/languages.ts'
import { createI18n } from '../../i18n/i18n-loader.ts'
import { timeZoneLabel } from './timeZoneLabel.ts'

describe('timeZoneLabel', () => {
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
    expect(timeZoneLabel(zone, i18n.t)).toBe(expected)
    i18n.dispose()
  })
  it.each(uiLanguages)('has a short translated label in %s', (language) => {
    const i18n = createI18n(language)
    const label = timeZoneLabel('America/Argentina/Buenos_Aires', i18n.t)
    expect(label).not.toContain('/')
    expect(label).not.toContain('_')
    expect(label).not.toContain('Georgetown')
    i18n.dispose()
  })
})
