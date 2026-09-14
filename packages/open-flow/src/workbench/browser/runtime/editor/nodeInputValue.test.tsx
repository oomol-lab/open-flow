import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { NodeInputValue } from './nodeInputValue.tsx'

const variables = { enabled: true, names: ['API_TOKEN'], loaded: true, loading: false, onOpen: vi.fn() }

describe('Independent node inputs', () => {
  it('renders an explicit false value without replacing it with the definition default', () => {
    const onValue = vi.fn()
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <NodeInputValue
          definition={{ handle: 'enabled', jsonSchema: { type: 'boolean' }, nullable: false, value: true }}
          value={false}
          connected={false}
          variables={variables}
          disabled={false}
          onValue={onValue}
          onVariable={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(markup).toMatch(/data-slot="select-value"[^>]*>false<\/span>/)
    expect(onValue).not.toHaveBeenCalled()
  })

  it.each([true, false])('keeps existing incompatible or unavailable variable bindings visible (enabled=%s)', (enabled) => {
    const onValue = vi.fn()
    const onVariable = vi.fn()
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <NodeInputValue
          definition={{ handle: 'count', jsonSchema: { type: 'number' }, nullable: false }}
          value={undefined}
          variableName="MISSING"
          connected={false}
          variables={{ ...variables, enabled }}
          disabled={false}
          onValue={onValue}
          onVariable={onVariable}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('MISSING')
    expect(markup).toContain('i-heroicons:variable-20-solid')
    expect(markup).toContain('role="alert"')
    expect(onValue).not.toHaveBeenCalled()
    expect(onVariable).not.toHaveBeenCalled()
  })

  it('renders LLM message controls through the product input without writing defaults', () => {
    const onValue = vi.fn()
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <NodeInputValue
          definition={{ handle: 'messages', nullable: false, jsonSchema: { 'type': 'array', 'ui:widget': 'llm/messages', 'minItems': 1 } }}
          value={[{ role: 'user', content: 'Read {{topic}}' }]}
          handleNames={['topic']}
          connected={false}
          variables={variables}
          disabled
          onValue={onValue}
          onVariable={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('Add message')
    expect(markup).toContain('<mark>{{topic}}</mark>')
    expect(markup).toMatch(/<textarea[^>]*readonly/)
    expect(onValue).not.toHaveBeenCalled()
  })

  it('shows connected sources without rendering a literal editor or overwriting them', () => {
    const onValue = vi.fn()
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <NodeInputValue
          definition={{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false, value: 'default' }}
          value="default"
          connected
          variables={variables}
          disabled={false}
          onValue={onValue}
          onVariable={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('Connected to an upstream source')
    expect(markup).not.toMatch(/<(?:textarea|select)\b/)
    expect(markup).toContain('aria-label="message Input sources"')
    expect(onValue).not.toHaveBeenCalled()
  })

  it('shows the selected upstream node icon with its value label', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <NodeInputValue
          definition={{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false }}
          value={undefined}
          connected
          upstream={{
            current: [
              {
                icon: 'data:application/vnd.open-flow.initials,GH',
                nodeId: 'github',
                nodeName: 'GitHub issue',
                output: 'title',
                valid: true,
              },
            ],
            groups: [],
            onChange: vi.fn(),
          }}
          variables={variables}
          disabled={false}
          onValue={vi.fn()}
          onVariable={vi.fn()}
        />
      </I18nProvider>,
    )

    expect(markup).toContain('data-icon-kind="initials"')
    expect(markup).toContain('GitHub issue · title')
  })
})

describe('Unset input presentation', () => {
  it.each([false, true])('shows nullable=%s without creating a value', (nullable) => {
    const onValue = vi.fn()
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <NodeInputValue
          definition={{ handle: 'missing', jsonSchema: { type: 'string' }, nullable }}
          value={undefined}
          connected={false}
          variables={variables}
          disabled={false}
          onValue={onValue}
          onVariable={vi.fn()}
        />
      </I18nProvider>,
    )
    const trigger = (markup.match(/<button\b[^>]*>/g) ?? []).find((tag) => tag.includes('aria-label="missing Set value"'))
    expect(trigger).toBeDefined()
    expect(trigger!.includes('aria-invalid="true"')).toBe(!nullable)
    expect(markup).toContain(nullable ? '>null</span>' : '>Set value</span>')
    expect(onValue).not.toHaveBeenCalled()
  })
})

it('restores object field display order without reordering or changing the value', () => {
  const onValue = vi.fn()
  const value = { '1': 'one', '2': 'two', 'extra': 'three' }
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <NodeInputValue
        definition={{ handle: 'object', nullable: false, jsonSchema: { 'type': 'object', 'ui:order': ['2', 'missing', '2', '1'] } }}
        value={value}
        connected={false}
        variables={variables}
        disabled={false}
        onValue={onValue}
        onVariable={vi.fn()}
      />
    </I18nProvider>,
  )
  expect([...markup.matchAll(/data-object-field="([^"]+)"/g)].map((match) => match[1])).toEqual(['2', '1', 'extra'])
  expect(value).toEqual({ '1': 'one', '2': 'two', 'extra': 'three' })
  expect(onValue).not.toHaveBeenCalled()
})
