import { describe, expect, it } from 'vitest'
import { getDefaultValue, typeOfSchema, widgetSelectOptions } from './preset.ts'

describe('JSON Schema capability profile', () => {
  it('offers portable values without host-path or retired credential widgets', () => {
    const options = widgetSelectOptions(
      (key) => key,
      () => true,
    )
    const widgetTypes = options.flatMap((option) => ('options' in option ? option.options.map((nested) => nested.value) : [option.value]))

    expect(widgetTypes).toContain('binary')
    expect(widgetTypes).not.toContain('reference')
    expect(widgetTypes).not.toContain('secret')
    expect(widgetTypes).not.toContain('credential')
    expect(widgetTypes).not.toContain('file')
    expect(widgetTypes).not.toContain('dir')
    expect(widgetTypes).not.toContain('save')
    expect(widgetTypes).not.toContain('literal')
  })

  it('projects const schemas as fixed literals without offering them to schema authors', () => {
    const schema = { const: 'pretty', description: 'Pretty-print the response.' }

    expect(typeOfSchema(schema)).toBe('literal')
    expect(getDefaultValue('literal', schema)).toBe('pretty')
  })

  it('returns independently translated options for each call', () => {
    const englishOptions = widgetSelectOptions(
      (key) => `en:${key}`,
      () => true,
    )
    const chineseOptions = widgetSelectOptions(
      (key) => `zh:${key}`,
      () => true,
    )

    expect(englishOptions[0]?.label).toBe('en:preset.string')
    expect(chineseOptions[0]?.label).toBe('zh:preset.string')
    expect(englishOptions[1]?.label).toBe('en:preset.number')
    expect(chineseOptions[1]?.label).toBe('zh:preset.number')
  })
})
