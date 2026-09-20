import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it, vi } from 'vitest'
import { DefinitionField } from '../../../../form/browser/definitionField.tsx'
import { FieldValueEditor } from '../../../../form/browser/fieldValueEditor.tsx'
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
    expect(markup).toContain('answer Field settings')
    expect(markup).toContain('number')
    expect(markup).not.toContain('JSON Schema')
    expect(markup).toContain('aria-label="Group settings"')
    expect(markup).toContain('i-lucide-light:settings-2')
    expect(markup).not.toContain('value="Result"')
    expect(markup).not.toContain('Set value')
    expect(markup).not.toContain('Set empty string')
    expect(markup).not.toMatch(/<(?:button|input|select|textarea)\b[^>]*aria-label="answer"(?:\s|>)/)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('disables mutations when inspecting fixed task or subflow outputs', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <PortDefinitionEditor
          groups
          layout="ports"
          output
          disabled
          values={[{ handle: 'answer', jsonSchema: { type: 'string' }, nullable: true }]}
          onChange={vi.fn()}
        />
      </I18nProvider>,
    )
    const controls = markup.match(/<(?:input|button|select|textarea)\b[^>]*>/g) ?? []
    expect(controls.length).toBeGreaterThan(0)
    expect(controls.every((control) => control.includes('disabled'))).toBe(true)
    expect(markup).toContain('data-field-control="true"')
    expect(markup).toContain('data-readonly="true"')
    expect(markup).toContain('border-input')
    expect(markup).toContain('bg-[var(--ui-control-background,var(--ui-muted))]')
    expect(markup).toContain('>Text</span>')
  })
})

describe('Property panel port layout', () => {
  it('uses the value-table controls and exposes nullable in the main row', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <PortDefinitionEditor
          layout="ports"
          title="Input ports"
          titleIcon="input"
          disabled
          values={[{ handle: 'message', jsonSchema: { type: 'string' }, nullable: true, value: 'Hello' }]}
          onChange={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('Input ports')
    expect(markup).toContain('i-carbon:port-input')
    expect(markup).toContain('data-layout="ports"')
    expect(markup).toContain('aria-label="Field name"')
    const typeDisplay = (markup.match(/<span\b[^>]*>/g) ?? []).find((tag) => tag.includes('aria-label="message type: Text"'))
    expect(typeDisplay).toContain('role="img"')
    expect(typeDisplay).not.toContain('tabindex=')
    expect(markup).toContain('message Nullable')
  })

  it('renders unique free-entry arrays separately from multi-select choices', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <PortDefinitionEditor
          layout="ports"
          title="Configuration"
          disabled={false}
          values={[
            { handle: 'chatIds', jsonSchema: { type: 'array', uniqueItems: true, items: { type: 'string' } }, nullable: false, value: [] },
            { handle: 'updates', jsonSchema: { type: 'array', uniqueItems: true, items: { enum: ['message', 'callback'] } }, nullable: false },
          ]}
          onChange={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('aria-label="chatIds type: Array"')
    expect(markup).toContain('aria-label="chatIds[] type: Text"')
    expect(markup).toContain('aria-label="updates type: Multi-select"')
    expect(markup).toContain('aria-label="updates"')
    expect(markup).toContain('Select values')
  })

  it('keeps output type icons and names visible in the wider output layout', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <PortDefinitionEditor
          layout="ports"
          title="Outputs"
          output
          disabled={false}
          values={[{ handle: 'result', jsonSchema: { type: 'number' }, nullable: false }]}
          onChange={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('data-output="true"')
    expect(markup).toContain('i-carbon:port-output')
    expect(markup).toContain('i-lucide-light:hash')
    expect(markup).toContain('>Number</span>')
  })

  it('exposes nested object output definitions without value controls', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <PortDefinitionEditor
          layout="ports"
          title="Outputs"
          output
          disabled={false}
          values={[
            {
              handle: 'result',
              jsonSchema: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  details: { type: 'object', properties: { count: { type: 'integer' } } },
                  tags: { type: 'array', items: { type: 'string' } },
                },
              },
              nullable: false,
            },
            { handle: 'items', jsonSchema: { type: 'array', items: { type: 'string' } }, nullable: false },
          ]}
          onChange={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('aria-label="result" aria-expanded="false"')
    expect(markup).toContain('data-composite-types="true"')
    expect(markup).toContain('aria-label="items[] type: Text"')
    expect(markup).toContain('>of</span>')
    expect(markup).not.toContain('aria-label="items" aria-expanded')
    expect(markup).not.toContain('aria-label="result.status Set value"')
    expect(markup).not.toContain('aria-label="result Set value"')
  })

  it('uses read-only object type surfaces as disclosure controls', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <PortDefinitionEditor
          layout="ports"
          output
          disabled
          values={[{ handle: 'result', jsonSchema: { type: 'object', properties: { status: { type: 'string' } } }, nullable: false }]}
          onChange={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(markup).toMatch(/<button[^>]*aria-label="result type: Object"[^>]*aria-expanded="false"[^>]*aria-controls=/)
  })

  it('renders nested read-only output types with the output control surface', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <DefinitionField
          layout="ports"
          label="result"
          schema={{ type: 'object', properties: { status: { type: 'string' }, details: { type: 'object', properties: { count: { type: 'integer' } } } } }}
          disabled
          expansionPolicy={({ depth }) => depth === 0}
          onChange={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(markup).toMatch(/aria-label="result.status type: Text"[^>]*data-field-control="true"/)
    expect(markup).toMatch(/<button[^>]*aria-label="result.details type: Object"[^>]*aria-expanded="false"/)
    expect(markup).toContain('>Text</span>')
    expect(markup).toContain('>Object</span>')
    expect(markup.match(/data-readonly-object-action-slots/g)).toHaveLength(2)
    expect(markup).not.toContain('aria-label="Add field result.status"')
    expect(markup).not.toContain('aria-label="Remove status"')
  })

  it('starts an invalid expandable value open', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <FieldValueEditor
          compact
          label="payload"
          path="/payload"
          schema={{ type: 'object', properties: { name: { type: 'string' } } }}
          value={{}}
          validationError="Invalid payload"
          onChange={vi.fn()}
          onDraftIssue={vi.fn()}
        />
      </I18nProvider>,
    )

    expect(markup).toContain('aria-label="payload Set value" aria-expanded="true"')
    expect(markup).toContain('data-value-body="true"')
  })

  it.each([
    { state: 'valid empty', validationError: undefined, expanded: false },
    { state: 'invalid empty', validationError: 'Invalid payload', expanded: true },
  ])('starts a $state top-level JSON value with expanded=$expanded', ({ validationError, expanded }) => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <FieldValueEditor
          compact
          label="payload"
          path="/payload"
          schema={{}}
          value={undefined}
          nullable
          validationError={validationError}
          onChange={vi.fn()}
          onDraftIssue={vi.fn()}
        />
      </I18nProvider>,
    )

    expect(markup).toContain(`aria-expanded="${expanded}"`)
    expect(markup.includes('data-value-body="true"')).toBe(expanded)
  })

  it('does not place an empty value body over output array type controls', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <PortDefinitionEditor
          layout="ports"
          output
          disabled={false}
          values={[{ handle: 'items', jsonSchema: { type: 'array' }, nullable: false }]}
          onChange={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('aria-label="items type: Array"')
    expect(markup).toContain('aria-label="items[] type: JSON"')
    expect(markup).not.toContain('data-value-body')
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
    expect(onChange).toHaveBeenCalledWith([{ handle: 'priority', jsonSchema: { type: 'string', enum: ['high'] }, nullable: false, value: 'high' }], undefined)
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

describe('Fixed definitions with custom value editors', () => {
  it('does not grant definition editing when only the value is editable', () => {
    const renderValue = vi.fn((_port: unknown, _presentation: unknown) => null)
    renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <PortDefinitionEditor
          layout="ports"
          disabled
          values={[{ handle: 'priority', jsonSchema: { enum: ['low', 'high'] }, nullable: false }]}
          onChange={vi.fn()}
          renderValue={renderValue}
        />
      </I18nProvider>,
    )
    expect(renderValue.mock.calls[0]?.[1]).toMatchObject({ onDefinitionChange: undefined })
  })
})

it.each([true, false])('shows the no-output state only when fields cannot be edited (disabled=%s)', (disabled) => {
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <PortDefinitionEditor layout="ports" title="Outputs" output disabled={disabled} values={[]} onChange={vi.fn()} />
    </I18nProvider>,
  )
  expect(markup.includes('This node does not provide output data.')).toBe(disabled)
  expect(markup.includes('aria-label="Add field"')).toBe(!disabled)
})

it.each([true, false])('shows the no-input state only when fields cannot be edited (disabled=%s)', (disabled) => {
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <PortDefinitionEditor layout="ports" title="Inputs" titleIcon="input" disabled={disabled} values={[]} onChange={vi.fn()} />
    </I18nProvider>,
  )
  expect(markup.includes('This node does not require input data.')).toBe(disabled)
  expect(markup.includes('aria-label="Add field"')).toBe(!disabled)
})
