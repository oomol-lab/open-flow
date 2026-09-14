import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { PortDefinitionEditor } from './portDefinitionEditor.tsx'

describe('Output definitions', () => {
  it('renders output summaries with a single options entry and no input value controls', () => {
    const onChange = vi.fn()
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <PortDefinitionEditor
          groups
          output
          disabled={false}
          values={[
            { group: 'Result', collapsed: true },
            { handle: 'answer', jsonSchema: { type: 'number' }, nullable: false },
          ]}
          onChange={onChange}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('Value options for answer')
    expect(markup).toContain('number')
    expect(markup).not.toContain('JSON Schema')
    expect(markup).toContain('aria-label="Group settings"')
    expect(markup).toContain('i-lucide-light:settings-2')
    expect(markup).not.toContain('value="Result"')
    expect(markup).not.toContain('Set value')
    expect(markup).not.toContain('Set empty string')
    expect(markup).not.toContain('aria-label="answer"')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('disables mutations when inspecting fixed task or subflow outputs', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <PortDefinitionEditor groups output disabled values={[{ handle: 'answer', jsonSchema: { type: 'string' }, nullable: true }]} onChange={vi.fn()} />
      </I18nProvider>,
    )
    const controls = markup.match(/<(?:input|button|select|textarea)\b[^>]*>/g) ?? []
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.every((control) => control.includes('disabled'))).toBe(true)
  })
})

describe('Property panel port layout', () => {
  it('uses the value-table controls without adding the value-only nullable column', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <PortDefinitionEditor
          layout="ports"
          title="Input ports"
          disabled
          values={[{ handle: 'message', jsonSchema: { type: 'string' }, nullable: true, value: 'Hello' }]}
          onChange={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('Input ports')
    expect(markup).toContain('data-layout="ports"')
    expect(markup).toContain('aria-label="Field name"')
    expect(markup).toContain('aria-label="message type"')
    expect(markup).not.toContain('message Allow null')
  })
})

describe('Nested field definition editing', () => {
  it.each(['values', 'definition'] as const)('keeps schema editing scoped to the %s layout', (layout) => {
    const onChange = vi.fn()
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <PortDefinitionEditor
          layout={layout}
          disabled={false}
          values={[
            {
              handle: 'payload',
              nullable: false,
              jsonSchema: { type: 'object', properties: { name: { type: 'string' } } },
              value: { name: 'Ada' },
            },
          ]}
          onChange={onChange}
        />
      </I18nProvider>,
    )
    const trigger = (markup.match(/<button\b[^>]*>/g) ?? []).find((tag) => tag.includes('aria-label="payload.name type"'))
    expect(trigger).toBeDefined()
    expect(trigger!.includes('disabled=""')).toBe(layout !== 'values')
    expect(onChange).not.toHaveBeenCalled()
  })
})
