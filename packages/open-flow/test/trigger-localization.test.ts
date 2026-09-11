import { describe, expect, it } from 'vitest'
import { resolveMetadataLanguage, uiLanguages } from '../src/localization/common/languages.ts'
import { triggerDefinitions } from '../src/trigger/providers/definitions.ts'
import { localizeTrigger, loadTriggerTranslations } from '../src/trigger/providers/localization.ts'

// Coverage protects resource ownership and completeness when definitions are added or removed.
describe('Trigger localization', () => {
  it('covers every registered key in every UI language and allows only display copy', async () => {
    const keys = triggerDefinitions.map(({ snapshot }) => snapshot.key).toSorted()
    for (const locale of uiLanguages) {
      if (locale == 'en') continue
      const translations = await loadTriggerTranslations(locale)
      expect(Object.keys(translations).toSorted()).toEqual(keys)
      for (const copy of Object.values(translations)) {
        expect(Object.keys(copy).toSorted()).toEqual(['description', 'displayName'])
        expect(copy.description?.trim().length).toBeGreaterThan(0)
        expect(copy.displayName?.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('projects translated display copy without mutating definitions and falls back for unknown keys', async () => {
    const snapshot = triggerDefinitions[0]!.snapshot
    const before = structuredClone(snapshot)
    expect((await localizeTrigger(snapshot, 'zh-CN')).displayName).not.toBe(snapshot.displayName)
    expect(snapshot).toEqual(before)
    expect(await localizeTrigger({ ...snapshot, key: 'custom.trigger' }, 'zh-CN')).toEqual({
      displayName: snapshot.displayName,
      description: snapshot.description,
    })
  })

  it.each([
    [undefined, undefined, 'en'],
    ['zh-hant-HK', 'en', 'zh-TW'],
    ['fr-CA', 'zh', 'fr'],
    ['de', 'zh-CN', 'en'],
    [undefined, 'fr;q=0.2,zh-CN;q=0.9', 'zh-CN'],
    [undefined, 'zh;q=0,*;q=1', 'en'],
    [undefined, 'en;q=0,fr;q=0.8', 'fr'],
    [undefined, 'invalid_tag, ja;q=0.7', 'ja'],
  ])('resolves %s / %s as %s', (query, header, expected) => {
    expect(resolveMetadataLanguage(query, header)).toBe(expected)
  })
  it.each(['', ' ', 'invalid_tag', 'en,zh'])('rejects an invalid locale query %s', (query) => {
    expect(() => resolveMetadataLanguage(query)).toThrow()
  })
})
