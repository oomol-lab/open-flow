import { describe, expect, it } from 'vitest'
import { resolveMetadataLanguage, uiLanguages } from '../../localization/common/languages.ts'
import { triggerDefinitions } from './definitions.ts'
import { englishTriggerFieldDescriptions } from './fieldDescriptions.ts'
import { loadTriggerTranslations, localizeTrigger } from './localization.ts'

const handles = (fields: readonly ({ readonly handle: string } | { readonly group: string })[]) =>
  fields.flatMap((field) => ('handle' in field ? [field.handle] : [])).toSorted()

describe('Provider Trigger localization', () => {
  it('defines English descriptions for every configuration and output field', () => {
    expect(Object.keys(englishTriggerFieldDescriptions).toSorted()).toEqual(triggerDefinitions.map(({ snapshot }) => snapshot.key).toSorted())
    for (const { snapshot } of triggerDefinitions) {
      const fields = englishTriggerFieldDescriptions[snapshot.key as keyof typeof englishTriggerFieldDescriptions]
      expect(Object.keys(fields.configInputs).toSorted(), `${snapshot.key} configuration`).toEqual(handles(snapshot.configInputs))
      expect(Object.keys(fields.outputs).toSorted(), `${snapshot.key} outputs`).toEqual(handles(snapshot.outputs))
    }
  })

  it.each(uiLanguages)('presents every Provider field in %s', async (language) => {
    const translations = await loadTriggerTranslations(language)
    for (const { snapshot } of triggerDefinitions) {
      const display = await localizeTrigger(snapshot, language)
      expect(Object.keys(display.configInputs).toSorted(), `${snapshot.key} configuration`).toEqual(handles(snapshot.configInputs))
      expect(Object.keys(display.outputs).toSorted(), `${snapshot.key} outputs`).toEqual(handles(snapshot.outputs))
      expect(Object.keys(display.configInputLabels).toSorted(), `${snapshot.key} required labels`).toEqual(
        snapshot.configInputs.flatMap((field) => ('handle' in field && !field.nullable && field.value === undefined ? [field.handle] : [])).toSorted(),
      )
      expect(Object.values(display.configInputs).every(Boolean)).toBe(true)
      expect(Object.values(display.configInputLabels).every(Boolean)).toBe(true)
      expect(Object.values(display.outputs).every(Boolean)).toBe(true)
      if (language == 'en') continue
      expect(Object.keys(translations[snapshot.key]?.configInputs ?? {}).toSorted(), `${snapshot.key} translated configuration`).toEqual(
        handles(snapshot.configInputs),
      )
      expect(Object.keys(translations[snapshot.key]?.outputs ?? {}).toSorted(), `${snapshot.key} translated outputs`).toEqual(handles(snapshot.outputs))
    }
  })

  // Coverage protects resource ownership and completeness when definitions are added or removed.
  it('covers every registered key in every UI language and allows only display copy', async () => {
    const keys = triggerDefinitions.map(({ snapshot }) => snapshot.key).toSorted()
    for (const locale of uiLanguages) {
      if (locale == 'en') continue
      const translations = await loadTriggerTranslations(locale)
      expect(Object.keys(translations).toSorted()).toEqual(keys)
      for (const copy of Object.values(translations)) {
        expect(Object.keys(copy).toSorted()).toEqual(['configInputs', 'description', 'displayName', 'outputs'])
        expect(copy.description?.trim().length).toBeGreaterThan(0)
        expect(copy.displayName?.trim().length).toBeGreaterThan(0)
        expect(Object.values(copy.configInputs ?? {}).every((description) => description.trim().length > 0)).toBe(true)
        expect(Object.values(copy.outputs ?? {}).every((description) => description.trim().length > 0)).toBe(true)
      }
    }
  })

  it('projects translated display copy without mutating definitions and falls back for unknown keys', async () => {
    const snapshot = triggerDefinitions[0]!.snapshot
    const before = structuredClone(snapshot)
    expect((await localizeTrigger(snapshot, 'zh-CN')).displayName).not.toBe(snapshot.displayName)
    expect(snapshot).toEqual(before)
    expect(await localizeTrigger({ ...snapshot, key: 'custom.trigger' }, 'zh-CN')).toEqual({
      configInputs: Object.fromEntries(
        snapshot.configInputs.flatMap((field) => ('handle' in field && field.description != null ? [[field.handle, field.description]] : [])),
      ),
      configInputLabels: {},
      displayName: snapshot.displayName,
      description: snapshot.description,
      outputs: Object.fromEntries(snapshot.outputs.flatMap((field) => (field.description == null ? [] : [[field.handle, field.description]]))),
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
