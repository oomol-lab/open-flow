import { describe, expect, it } from 'vitest'
import { uiLanguages } from '../../../localization/common/languages.ts'
import { createI18n, locales } from './i18n.ts'

describe('Workbench i18n', () => {
  it('ships every supported language', () => {
    expect(Object.keys(locales)).toEqual([...uiLanguages])
  })

  it('translates messages and interpolates values', () => {
    const i18n = createI18n('zh-CN')

    expect(i18n.t('resource.flows')).toBe('工作流')
    expect(i18n.t('notice.created', { name: '演示' })).toBe('已创建 演示。')
    expect(i18n.t('timeZoneNames.Asia/Shanghai')).toBe('上海')

    i18n.dispose()
  })

  it.each(uiLanguages)('interpolates Trigger permission names in %s', (language) => {
    const i18n = createI18n(language)
    const triggers = 'on_message_received, on_message_changed'

    const label = i18n.t('connectorAccess.permissionTriggers', { triggers })

    expect(label).toContain(triggers)
    expect(label).not.toContain('{triggers}')

    i18n.dispose()
  })

  it('resolves the host language tag', () => {
    const i18n = createI18n('zh-Hant-HK')

    expect(i18n.lang).toBe('zh-TW')

    i18n.dispose()
  })

  it('falls back to English for unsupported host languages', () => {
    const i18n = createI18n('de-DE')

    expect(i18n.lang).toBe('en')

    i18n.dispose()
  })

  it('switches to the host language', async () => {
    const i18n = createI18n('zh-CN')

    await i18n.switchLang('en')

    expect(i18n.lang).toBe('en')

    i18n.dispose()
  })
})
