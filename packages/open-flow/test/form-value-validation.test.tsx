import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it, vi } from 'vitest'
import { ValueEditor } from '../src/form/browser/valueEditor.tsx'
import { createI18n } from '../src/workbench/browser/runtime/i18n.ts'

const cases = [
  ['text', { type: 'string', minLength: 5 }, 'abc', 'valid text'],
  ['multiline', { 'type': 'string', 'ui:widget': 'text', 'minLength': 5 }, 'abc', 'valid text'],
  ['number', { type: 'number', minimum: 0 }, -1, 2],
  ['date', { type: 'string', format: 'date' }, '2026-02-30', '2026-02-28'],
  ['time', { type: 'string', format: 'time' }, '25:00:00Z', '12:00:00Z'],
  ['timestamp', { type: 'string', format: 'date-time' }, 'invalid', '2026-02-28T12:00:00Z'],
  ['boolean', { type: 'boolean' }, 'missing', false],
  ['select', { enum: ['one', 'two'] }, 'missing', 'one'],
  ['multiple select', { type: 'array', uniqueItems: true, items: { enum: ['one', 'two'] }, minItems: 1 }, [], ['one']],
  ['JSON', { 'type': 'object', 'ui:widget': 'any', 'required': ['title'] }, {}, { title: 'valid' }],
] as const

describe('Field validation presentation', () => {
  it.each(cases)('marks %s schema violations without changing the value', (_label, schema, invalid, valid) => {
    const onChange = vi.fn()
    const i18n = createI18n('en')
    const render = (value: unknown, nullable = false) =>
      renderToStaticMarkup(
        <I18nProvider i18n={i18n}>
          <ValueEditor label="sample" schema={schema} value={value} nullable={nullable} onChange={onChange} path="/sample" onDraftIssue={vi.fn()} />
        </I18nProvider>,
      )
    try {
      expect(render(invalid)).toContain('aria-invalid="true"')
      expect(render(valid)).not.toContain('aria-invalid="true"')
      // Nullable null follows the existing unset presentation, including selection prompts.
      if (_label === 'boolean' || _label === 'multiple select') {
        expect(render(null, true).includes('aria-invalid="true"')).toBe(render(undefined, true).includes('aria-invalid="true"'))
      } else {
        expect(render(null, true)).not.toContain('aria-invalid="true"')
      }
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      i18n.dispose()
    }
  })
})

describe('Empty string presentation', () => {
  it.each(['string', 'text'])('distinguishes an empty %s from an unset value without writing either', (widget) => {
    const onChange = vi.fn()
    const i18n = createI18n('en')
    const render = (value: string | undefined) =>
      renderToStaticMarkup(
        <I18nProvider i18n={i18n}>
          <ValueEditor
            label="sample"
            schema={{ 'type': 'string', 'ui:widget': widget }}
            value={value}
            onChange={onChange}
            path="/sample"
            onDraftIssue={vi.fn()}
          />
        </I18nProvider>,
      )
    try {
      expect(render('')).toContain('placeholder="Empty string"')
      expect(render(undefined)).not.toContain('placeholder="Empty string"')
      expect(render('')).not.toContain('aria-invalid="true"')
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      i18n.dispose()
    }
  })
})

describe('JSON component with union schemas', () => {
  it.each(['oneOf', 'anyOf'])('uses JSON editing for editable definitions while preserving %s validation', (keyword) => {
    const i18n = createI18n('en')
    const onChange = vi.fn()
    const onDefinitionChange = vi.fn()
    const schema = { [keyword]: [{ type: 'string' }, { type: 'number' }] }
    const render = (value: unknown, editDefinition: boolean) =>
      renderToStaticMarkup(
        <I18nProvider i18n={i18n}>
          <ValueEditor
            label="choice"
            schema={schema}
            value={value}
            onChange={onChange}
            onDefinitionChange={editDefinition ? onDefinitionChange : undefined}
            path="/choice"
            onDraftIssue={vi.fn()}
          />
        </I18nProvider>,
      )
    try {
      const json = render('hello', true)
      expect(json).toContain('aria-label="choice JSON"')
      expect(json).toContain('&quot;hello&quot;')
      expect(json).not.toContain('choice variant')
      expect(json).not.toContain('aria-invalid="true"')
      expect(render(false, true)).toContain('aria-invalid="true"')
      expect(render('hello', false)).toContain('choice variant')
      expect(onChange).not.toHaveBeenCalled()
      expect(onDefinitionChange).not.toHaveBeenCalled()
    } finally {
      i18n.dispose()
    }
  })
})

describe('Nullable field presentation', () => {
  it('presents a nullable text null as unset without writing a value', () => {
    const i18n = createI18n('en')
    const onChange = vi.fn()
    try {
      const render = (value: unknown, schema: unknown = { type: 'string' }) =>
        renderToStaticMarkup(
          <I18nProvider i18n={i18n}>
            <ValueEditor
              label="note"
              header={<span>note</span>}
              schema={schema}
              value={value}
              nullable
              onChange={onChange}
              path="/note"
              onDraftIssue={vi.fn()}
            />
          </I18nProvider>,
        )
      for (const value of [null, undefined]) {
        const markup = render(value)
        expect(markup).toContain('note Set value')
        expect(markup).not.toContain('aria-invalid="true"')
        expect(markup).toContain('>null</span>')
      }
      expect(render('', { type: 'string' })).toContain('placeholder="Empty string"')
      expect(render(null, { type: 'null' })).toContain('>null</span>')
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      i18n.dispose()
    }
  })
})
