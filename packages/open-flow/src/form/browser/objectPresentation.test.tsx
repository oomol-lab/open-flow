import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../../workbench/browser/runtime/i18n.ts'
import { ObjectValueFields } from './collectionValueFields.tsx'
import { DefinitionField } from './definitionField.tsx'

describe('object definition presentation', () => {
  it.each([
    [{ type: 'object' }, 'No predefined fields'],
    [{ type: 'object', additionalProperties: true }, 'No predefined fields'],
    [{ type: 'object', additionalProperties: false }, 'Empty object only'],
    [{ type: 'object', additionalProperties: { type: 'string' } }, 'Additional field values'],
    [{ type: 'object', additionalProperties: false, patternProperties: { '^x': { type: 'string' } } }, 'Fields constrained by schema'],
  ])('describes the schema without claiming a runtime value: %j', (schema, message) => {
    const onChange = vi.fn()
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <DefinitionField schema={schema} label="result" disabled expansionPolicy={() => true} onChange={onChange} />
      </I18nProvider>,
    )
    expect(markup).toContain(message)
    expect(markup).not.toContain('>Empty object<')
    if ('additionalProperties' in schema && typeof schema.additionalProperties === 'object') expect(markup).toContain('result type: Text')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('read-only object values', () => {
  it.each([
    [{}, false, 'Empty object'],
    [null, false, 'null'],
    [null, true, 'null'],
    [undefined, false, 'Unset'],
    [undefined, true, 'null'],
  ])('describes %j with nullable=%s independently of schema openness', (value, nullable, message) => {
    for (const additionalProperties of [true, false, { type: 'string' }]) {
      const onChange = vi.fn()
      const markup = renderToStaticMarkup(
        <I18nProvider i18n={createI18n('en')}>
          <ObjectValueFields
            schema={{ type: 'object', additionalProperties }}
            value={value}
            nullable={nullable}
            disabled
            empty={value == null}
            label="input"
            path="/input"
            onChange={onChange}
            onDraftIssue={vi.fn()}
          />
        </I18nProvider>,
      )
      expect(markup).toContain(`>${message}<`)
      if (value == null) expect(markup).not.toContain('Empty object')
      expect(markup).not.toContain('Empty object only')
      expect(onChange).not.toHaveBeenCalled()
    }
  })
})
