import { describe, expect, it } from 'vitest'
import { uiLanguages } from '../../localization/common/languages.ts'
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
      expect(Object.values(display.configInputs).every(Boolean)).toBe(true)
      expect(Object.values(display.outputs).every(Boolean)).toBe(true)
      if (language == 'en') continue
      expect(Object.keys(translations[snapshot.key]?.configInputs ?? {}).toSorted(), `${snapshot.key} translated configuration`).toEqual(
        handles(snapshot.configInputs),
      )
      expect(Object.keys(translations[snapshot.key]?.outputs ?? {}).toSorted(), `${snapshot.key} translated outputs`).toEqual(handles(snapshot.outputs))
    }
  })
})
