import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it, vi } from 'vitest'
import { ValueEditor } from '../src/form/browser/valueEditor.tsx'
import { ajv } from '../src/form/common/validation/validator.ts'
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
  it.each(['oneOf', 'anyOf'])('always uses JSON editing while preserving %s validation', (keyword) => {
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
      const fixedDefinition = render('hello', false)
      expect(fixedDefinition).toContain('aria-label="choice JSON"')
      expect(fixedDefinition).toContain('&quot;hello&quot;')
      expect(fixedDefinition).not.toContain('choice variant')
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

describe('Read-only value controls', () => {
  it.each([
    ['text', { type: 'string' }, 'Copy this text'],
    ['multiline', { 'type': 'string', 'ui:widget': 'text' }, 'Copy\nthese lines'],
    ['number', { type: 'number' }, 42],
    ['date', { type: 'string', format: 'date' }, '2026-09-14'],
  ])('keeps %s selectable while preventing edits', (_name, schema, value) => {
    const i18n = createI18n('en')
    try {
      const markup = renderToStaticMarkup(
        <I18nProvider i18n={i18n}>
          <ValueEditor label="sample" schema={schema} value={value} disabled path="/sample" onChange={vi.fn()} onDraftIssue={vi.fn()} />
        </I18nProvider>,
      )
      const input = markup.match(/<(?:input|textarea)\b[^>]*(?:aria-label="sample"|id="[^"]+")[^>]*>/)?.[0]
      expect(input).toBeDefined()
      expect(input).toContain('readonly=""')
      expect(input).not.toContain('disabled=""')
    } finally {
      i18n.dispose()
    }
  })
})

describe('Collapsed field mounting', () => {
  it.each([
    [{ type: 'object', properties: { child: { type: 'string' } } }, { child: 'hello' }],
    [{ type: 'array', items: { type: 'string' } }, ['hello']],
    [{ 'ui:widget': 'any' }, { child: 'hello' }],
    [{ 'type': 'string', 'ui:widget': 'text' }, 'hello'],
  ])('defers compact bodies while keeping standalone editors mounted', (schema, value) => {
    const i18n = createI18n('en')
    const onChange = vi.fn()
    const render = (compact: boolean) =>
      renderToStaticMarkup(
        <I18nProvider i18n={i18n}>
          <ValueEditor compact={compact} label="sample" schema={schema} value={value} onChange={onChange} path="/sample" onDraftIssue={vi.fn()} />
        </I18nProvider>,
      )
    try {
      const collapsed = render(true)
      expect(collapsed).toContain('aria-expanded="false"')
      expect(collapsed).not.toContain('data-value-body')
      expect(collapsed).not.toContain('<textarea')
      expect(render(false)).toContain('data-value-body')
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      i18n.dispose()
    }
  })
})

it('restores object field display order without reordering or changing the value', () => {
  const onValue = vi.fn()
  const value = { '1': 'one', '2': 'two', 'extra': 'three' }
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <ValueEditor
        label="object"
        path="/object"
        schema={{ 'type': 'object', 'ui:order': ['2', 'missing', '2', '1'] }}
        value={value}
        disabled={false}
        onChange={onValue}
        onDraftIssue={vi.fn()}
      />
    </I18nProvider>,
  )
  expect([...markup.matchAll(/data-object-field="([^"]+)"/g)].map((match) => match[1])).toEqual(['2', '1', 'extra'])
  expect(value).toEqual({ '1': 'one', '2': 'two', 'extra': 'three' })
  expect(onValue).not.toHaveBeenCalled()
})

it('offers to repair a non-nullable array item cleared to null', () => {
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <ValueEditor
        label="items"
        path="/items"
        schema={{ type: 'array', items: { type: 'object', default: { enabled: true } } }}
        value={[null]}
        onChange={vi.fn()}
        onDraftIssue={vi.fn()}
      />
    </I18nProvider>,
  )
  expect(markup).toContain('aria-label="items.0 Set value"')
  expect(markup).toContain('>Set value<')
})

describe('Lazy schema compilation', () => {
  it('compiles only when a value needs schema validation', () => {
    const i18n = createI18n('en')
    const compile = vi.spyOn(ajv, 'compile')
    const onChange = vi.fn()
    const schema = { type: 'string', minLength: 5 }
    const render = (value: unknown, nullable = false, invalid = false) =>
      renderToStaticMarkup(
        <I18nProvider i18n={i18n}>
          <ValueEditor label="sample" compact schema={schema} value={value} nullable={nullable} invalid={invalid} onChange={onChange} />
        </I18nProvider>,
      )
    try {
      render(undefined)
      render(null, true)
      expect(render('abc', false, true)).toContain('aria-invalid="true"')
      expect(compile).not.toHaveBeenCalled()
      expect(render('abc')).toContain('aria-invalid="true"')
      expect(compile).toHaveBeenCalledWith(schema)
      expect(render('valid text')).not.toContain('aria-invalid="true"')
      expect(render(null)).toContain('aria-invalid="true"')
      expect(render('')).toContain('aria-invalid="true"')
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      compile.mockRestore()
      i18n.dispose()
    }
  })
})

const renderFixedValue = (schema: unknown, value: unknown, compact = true) =>
  renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <ValueEditor compact={compact} label="fixed" schema={schema} value={value} onChange={vi.fn()} path="/fixed" onDraftIssue={vi.fn()} hideOptions />
    </I18nProvider>,
  )
describe('Fixed schema value presentation', () => {
  it('keeps empty objects expandable and explains the fixed object constraint', () => {
    const fixed = renderFixedValue({ type: 'object', additionalProperties: false }, {})
    expect(fixed).toContain('{}')
    expect(fixed).toContain('aria-expanded="false"')
    const expandedContent = renderFixedValue({ type: 'object', additionalProperties: false }, {}, false)
    expect(expandedContent).toContain('Empty object only')
    expect(expandedContent).toMatch(/disabled=""[^>]*aria-label="Empty object only fixed"/)
    expect(expandedContent).not.toContain('aria-label="Add field fixed"')
    expect(renderFixedValue({ type: 'object' }, {})).toContain('aria-expanded="false"')
    expect(renderFixedValue({ type: 'object', additionalProperties: false }, undefined)).toContain('Set value')
  })
  it.each([{ enum: [] }, { type: 'array', uniqueItems: true, items: { enum: [] } }])('does not offer to edit missing fixed options', (schema) => {
    expect(renderFixedValue(schema, undefined)).toContain('No options available')
    expect(renderFixedValue(schema, undefined)).not.toContain('Edit options')
  })
  it('keeps an empty string choice distinguishable from an unset value', () => {
    expect(renderFixedValue({ enum: ['', 'other'] }, '')).toContain('Empty string')
    expect(renderFixedValue({ enum: ['', 'other'] }, undefined)).toContain('Select a value')
  })
  it('disables removal at the minimum array length', () => {
    const markup = renderFixedValue({ type: 'array', items: { type: 'string' }, minItems: 1 }, ['one'], false)
    expect(markup).toMatch(/aria-label="Remove fixed.0"[^>]*disabled/)
  })
})

describe('Null editor', () => {
  it('shows an incompatible stored value instead of calling it unset', () => {
    const i18n = createI18n('en')
    const onChange = vi.fn()
    try {
      const render = (value: unknown) =>
        renderToStaticMarkup(
          <I18nProvider i18n={i18n}>
            <ValueEditor label="sample" schema={{ type: 'null' }} nullable value={value} onChange={onChange} path="/sample" onDraftIssue={vi.fn()} />
          </I18nProvider>,
        )
      expect(render('old value')).toContain('old value')
      expect(render('old value')).toContain('aria-invalid="true"')
      expect(render('old value')).not.toContain('Unset')
      expect(render(null)).toContain('>null</span>')
      expect(render(null)).not.toContain('aria-invalid="true"')
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      i18n.dispose()
    }
  })
})
