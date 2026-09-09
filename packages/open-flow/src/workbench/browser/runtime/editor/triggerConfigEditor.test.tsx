import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { TriggerConfigEditor } from './triggerConfigEditor.tsx'

describe('Trigger configuration editor', () => {
  it('shows missing required fields and defaults without writing values during rendering', () => {
    const onChange = vi.fn()
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <TriggerConfigEditor
          schema={{
            type: 'object',
            required: ['owner'],
            properties: {
              owner: { type: 'string', title: 'Owner', default: 'example' },
              limit: { type: 'integer', default: 10 },
            },
          }}
          config={{}}
          disabled={false}
          onChange={onChange}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('data-invalid="true"')
    expect(markup).toContain('value="example"')
    expect(markup).toContain('value="10"')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('preserves enum multi-selection and disables all read-only controls', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <TriggerConfigEditor
          schema={{
            type: 'object',
            properties: {
              events: { type: 'array', items: { enum: ['issues', 'push'] } },
              active: { type: 'boolean' },
            },
          }}
          config={{ events: ['issues'], active: false }}
          disabled
          onChange={() => {}}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('aria-checked="true"')
    expect(markup).toContain('aria-checked="false"')
    expect(markup).toContain('issues')
    expect(markup).toContain('push')
    const controls = markup.match(/<(?:input|button|select|textarea)\b[^>]*>/g) ?? []
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.every((control) => /\bdisabled(?:=|\s|>)/.test(control))).toBe(true)
  })
})
