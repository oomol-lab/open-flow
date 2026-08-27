import { describe, expect, it } from 'vitest'
import { createI18n } from './i18n.ts'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'

function keys(value: Readonly<Record<string, unknown>>, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix == '' ? key : `${prefix}.${key}`
    return typeof child == 'object' && child != null ? keys(child as Readonly<Record<string, unknown>>, path) : [path]
  })
}

describe('Workbench i18n', () => {
  it('keeps locale resources in sync', () => {
    expect(keys(zhCN).toSorted()).toEqual(keys(en).toSorted())
  })

  it('translates messages and interpolates values', () => {
    const i18n = createI18n('zh-CN')

    expect(i18n.t('resource.flows')).toBe('工作流')
    expect(i18n.t('notice.created', { name: '演示' })).toBe('已创建 演示。')

    i18n.dispose()
  })

  it('switches to the host language', async () => {
    const i18n = createI18n('zh-CN')

    await i18n.switchLang('en')

    expect(i18n.lang).toBe('en')

    i18n.dispose()
  })
})
