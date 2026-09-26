import type { FieldValueEditorProps } from './fieldValueEditor.tsx'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../../workbench/browser/runtime/i18n.ts'
import { FieldValueEditor } from './fieldValueEditor.tsx'

function render(props: Partial<FieldValueEditorProps> = {}) {
  const onChange = vi.fn()
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <FieldValueEditor
        schema={{ type: 'string' }}
        value={undefined}
        label="parameter"
        path="parameter"
        compact
        hideOptions
        onChange={onChange}
        onDraftIssue={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  )
  expect(onChange).not.toHaveBeenCalled()
  return markup
}

describe('Field unset policy', () => {
  it.each([
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'string', enum: ['one'] },
    { type: 'object', properties: { required: { type: 'string' } }, required: ['required'] },
    { type: 'array', items: { type: 'string' } },
    {},
    { 'type': 'string', 'ui:widget': 'text' },
  ])('allows delegated unset values for %j, including nullable fields', (schema) => {
    for (const nullable of [false, true]) {
      const markup = render({ schema, nullable, unset: { label: 'Provided later', required: false } })
      expect(markup).toContain('Provided later')
      expect(markup).not.toContain('aria-invalid="true"')
      expect(markup).not.toContain('role="alert"')
    }
  })

  it('keeps the normal required behavior and supports required custom prompts', () => {
    expect(render()).toContain('aria-invalid="true"')
    expect(render({ nullable: true, unset: { label: 'Set parameter', required: true } })).toContain('aria-invalid="true"')
  })

  it.each([null, '', false, 0, [], {}])('does not replace a stored %j with an unset prompt', (value) => {
    expect(render({ schema: {}, value, unset: { label: 'Provided later', required: false } })).not.toContain('Provided later')
  })

  it('does not apply the parent policy to missing object children', () => {
    const markup = render({
      schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      value: {},
      compact: false,
      unset: { label: 'Provided later', required: false },
    })
    expect(markup).not.toContain('Provided later')
    expect(markup).toContain('aria-invalid="true"')
  })
})
