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
  it('uses the value-table controls and exposes nullable in the main row', () => {
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
    expect(markup).toContain('message Allow null')
  })

  it('passes definition editing through custom input value renderers', () => {
    const onChange = vi.fn()
    let changeDefinition: ((schema: unknown, value: unknown) => void) | undefined
    renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <PortDefinitionEditor
          groups
          layout="ports"
          disabled={false}
          values={[{ handle: 'priority', jsonSchema: { type: 'string', enum: ['low', 'normal'] }, nullable: false, value: 'normal' }]}
          onChange={onChange}
          renderValue={(_port, presentation) => {
            changeDefinition = presentation.onDefinitionChange
            return null
          }}
        />
      </I18nProvider>,
    )

    expect(changeDefinition).toBeTypeOf('function')
    changeDefinition?.({ type: 'string', enum: ['high'] }, 'high')
    expect(onChange).toHaveBeenCalledWith([{ handle: 'priority', jsonSchema: { type: 'string', enum: ['high'] }, nullable: false, value: 'high' }])
  })
})

describe('Nested field definition editing', () => {
  it.each(['values', 'definition'] as const)('keeps schema editing scoped to the %s layout', (layout) => {
    const onChange = vi.fn()
    const renderValue = vi.fn((_port: unknown, _presentation: unknown) => null)
    renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <PortDefinitionEditor
          renderValue={renderValue}
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
    const presentation = renderValue.mock.calls[0]?.[1] as { onDefinitionChange?: unknown } | undefined
    expect(presentation).toBeDefined()
    expect(typeof presentation?.onDefinitionChange).toBe(layout === 'values' ? 'function' : 'undefined')
    expect(onChange).not.toHaveBeenCalled()
  })
})
