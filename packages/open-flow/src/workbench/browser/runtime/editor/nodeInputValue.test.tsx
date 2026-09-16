import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { NodeInputValue } from './nodeInputValue.tsx'

const variables = { enabled: true, names: ['API_TOKEN'], loaded: true, loading: false, onOpen: vi.fn() }

describe('Independent node inputs', () => {
  it('keeps a standalone array source on its collapsed preview, including enum item schemas', () => {
    const onValue = vi.fn()
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <NodeInputValue
          definition={{ handle: 'items', jsonSchema: { type: 'array', items: { enum: ['one', 'two'] } }, nullable: false }}
          value={['one']}
          connected={false}
          variables={variables}
          disabled={false}
          onValue={onValue}
          onVariable={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('aria-label="items Set value"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('data-value-body')
    expect(markup.indexOf('aria-label="items Input sources"')).toBeLessThan(markup.indexOf('aria-label="items Set value"'))
    expect(onValue).not.toHaveBeenCalled()
  })

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
    const toggle = (markup.match(/<button\b[^>]*>[^<]*<\/button>/g) ?? []).find((tag) => tag.includes('role="switch"'))
    expect(toggle).toContain('aria-label="enabled"')
    expect(toggle).toContain('aria-checked="false"')
    expect(toggle).toContain('>False</button>')
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

it('renders a saved binding as pending without running compatibility or candidate queries', () => {
  const i18n = createI18n('en')
  const check = vi.fn(() => [false])
  const candidates = vi.fn(() => ({}))
  try {
    const html = renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <NodeInputValue
          definition={{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false }}
          value={undefined}
          connected
          disabled={false}
          variables={{ enabled: true, loaded: false, loading: false, names: [], onOpen: vi.fn() }}
          upstream={{
            current: [{ nodeId: 'source', nodeName: 'Saved source', output: 'text', valid: undefined }],
            query: { check, candidates },
            groups: [],
            onChange: vi.fn(),
          }}
          onValue={vi.fn()}
          onVariable={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(html).toContain('Saved source · text')
    expect(html).toContain('Checking source…')
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('aria-invalid="true"')
    expect(check).not.toHaveBeenCalled()
    expect(candidates).not.toHaveBeenCalled()
  } finally {
    i18n.dispose()
  }
})
