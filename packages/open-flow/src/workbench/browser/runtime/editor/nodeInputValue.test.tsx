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
    expect(markup).toMatch(/<option value="false" selected="">false<\/option>/)
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
    expect(markup).not.toMatch(/<(?:input|textarea|select)\b/)
    expect(onValue).not.toHaveBeenCalled()
  })
})
