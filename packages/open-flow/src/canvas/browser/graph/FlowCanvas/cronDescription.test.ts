import { Cron } from 'croner'
import { describe, expect, it } from 'vitest'
import { uiLanguages } from '../../../../localization/common/languages.ts'
import { createI18n } from '../../i18n/i18n-loader.ts'
import { cronDescription, cronLabel } from './cronDescription.ts'

describe('cronDescription', () => {
  it.each([
    ['0 9 * * *', 'At 09:00'],
    ['0 9 * * 1-5', 'At 09:00, Monday through Friday'],
    ['*/15 * * * *', 'Every 15 minutes'],
    ['0 9 L * *', 'At 09:00, on the last day of the month'],
    ['0 9 * * MON#2', 'At 09:00, on the second Monday of the month'],
    ['0 9 * * 0', 'At 09:00, only on Sunday'],
    ['0 9 * * 7', 'At 09:00, only on Sunday'],
  ])('describes %s using standard weekday numbering and 24-hour time', (expression, expected) => {
    expect(cronDescription(expression, 'en')).toBe(expected)
  })
  it.each(uiLanguages)('loads the %s locale', (language) => {
    const description = cronDescription('0 9 * * *', language)
    expect(description).toContain('09:00')
    expect(description).not.toBe('0 9 * * *')
    if (language !== 'en') expect(description).not.toBe('At 09:00')
  })
  it.each(['0 9 1 * MON', '0 9 1 * +MON', '0 9 * * 5#L'])('preserves Croner semantics for %s', (expression) => {
    expect(() => new Cron(expression)).not.toThrow()
    for (const language of uiLanguages) expect(cronDescription(expression, language)).toBe(expression)
  })
  it('keeps OR day rules distinct from explicit AND rules', () => {
    const after = new Date('2026-09-02T00:00:00Z')
    expect(new Cron('0 9 1 * MON', { timezone: 'UTC' }).nextRun(after)?.toISOString()).toBe('2026-09-07T09:00:00.000Z')
    expect(new Cron('0 9 1 * +MON', { timezone: 'UTC' }).nextRun(after)?.toISOString()).toBe('2027-02-01T09:00:00.000Z')
  })
  it.each(['invalid', '0 99 * * *', '0 9 * *', '0 0 9 * * *'])('preserves invalid or non-five-field input %s', (expression) => {
    expect(cronDescription(expression, 'en')).toBe(expression)
  })
})

describe('compact cron labels', () => {
  it.each([
    ['0 9 * * *', 'Every day · 09:00'],
    ['0 9 * * 1-5', 'Mon to Fri · 09:00'],
    ['0 9 * * MON-FRI', 'Mon to Fri · 09:00'],
    ['0 9 * * 7', 'Sun · 09:00'],
    ['0 9 * * 0-7', 'Every day · 09:00'],
    ['*/15 * * * *', 'Every 15 min'],
    ['0 */2 * * *', 'Every 2 hr'],
    ['0 9 L * *', 'Month end · 09:00'],
    ['0 9 1,15 * *', 'Days 1, 15 · 09:00'],
  ])('formats %s without full sentences', (expression, expected) => {
    const i18n = createI18n('en')
    expect(cronLabel(expression, 'en', i18n.t)).toBe(expected)
    i18n.dispose()
  })
  it.each(['*/7 * * * *', '0 */5 * * *', '*/15 9-17 * * 1-5', '0 9 * * MON#2', '0 9 1 * MON', '0 9 * * 5#L', '0 99 * * *', 'invalid'])(
    'retains complex or invalid input %s',
    (expression) => {
      const i18n = createI18n('en')
      expect(cronLabel(expression, 'en', i18n.t)).toBe(expression)
      i18n.dispose()
    },
  )
  it('uses localized short weekdays and labels', () => {
    const i18n = createI18n('zh-CN')
    expect(cronLabel('0 9 * * 1-5', 'zh-CN', i18n.t)).toBe('周一至周五 · 09:00')
    expect(cronLabel('0 9 L * *', 'zh-CN', i18n.t)).toBe('月末 · 09:00')
    i18n.dispose()
  })
})
