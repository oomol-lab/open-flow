import type { InputSourceCheck } from '../../../../flow/common/graph.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { NodeInputValue } from './nodeInputValue.tsx'

const variables = { enabled: true, names: ['API_TOKEN'], loaded: true, loading: false, onOpen: vi.fn() }

describe('Independent node inputs', () => {
  it('orders an editable Any literal as source, value, then data type', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <NodeInputValue
          definition={{ handle: 'payload', jsonSchema: {}, nullable: false }}
          value={42}
          connected={false}
          variables={variables}
          disabled={false}
          onValue={vi.fn()}
          onVariable={vi.fn()}
        />
      </I18nProvider>,
    )
    const sourceControl = markup.indexOf('aria-label="payload Select input source"')
    const valueControl = markup.match(/<input[^>]*aria-label="payload"/)?.index ?? -1
    const typeControl = markup.indexOf('aria-label="payload, data type: Number"')
    expect(sourceControl).toBeGreaterThan(-1)
    expect(valueControl).toBeGreaterThan(sourceControl)
    expect(typeControl).toBeGreaterThan(valueControl)
  })

  it.each([
    { state: 'variable', variableName: 'API_TOKEN', connected: false },
    { state: 'upstream', variableName: undefined, connected: true },
  ])('hides the Any data type for a bound $state source', ({ variableName, connected }) => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <NodeInputValue
          definition={{ handle: 'payload', jsonSchema: {}, nullable: false }}
          value={undefined}
          variableName={variableName}
          connected={connected}
          variables={variables}
          disabled={false}
          onValue={vi.fn()}
          onVariable={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('aria-label="payload Select input source"')
    expect(markup).not.toContain('data type')
  })

  it('keeps an explicit widget without adding an Any data type', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <NodeInputValue
          definition={{ handle: 'payload', jsonSchema: { 'ui:widget': 'text' }, nullable: false }}
          value="hello"
          connected={false}
          variables={variables}
          disabled={false}
          onValue={vi.fn()}
          onVariable={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('aria-label="payload Set value"')
    expect(markup).not.toContain('data type')
  })

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
    expect(markup.indexOf('aria-label="items Select input source"')).toBeLessThan(markup.indexOf('aria-label="items Set value"'))
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
    expect(markup).toContain('i-lucide-light:sliders-horizontal')
    expect(markup).toContain('role="img"')
    expect(markup).toContain('aria-label="Env"')
    expect(markup).toContain('role="alert"')
    expect(onValue).not.toHaveBeenCalled()
    expect(onVariable).not.toHaveBeenCalled()
  })

  it('explains an incompatible environment variable binding', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <NodeInputValue
          definition={{ handle: 'count', jsonSchema: { type: 'number' }, nullable: false }}
          value={undefined}
          variableName="API_TOKEN"
          connected={false}
          variables={variables}
          disabled={false}
          onValue={vi.fn()}
          onVariable={vi.fn()}
        />
      </I18nProvider>,
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Environment variables are text and are not compatible with this input.')
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
    expect(markup).toContain('Input source selected')
    expect(markup).not.toMatch(/<(?:textarea|select)\b/)
    expect(markup).toContain('aria-label="message Select input source"')
    expect(onValue).not.toHaveBeenCalled()
  })

  it.each([
    ['The issue title returned by GitHub.', 'GitHub issue · title\nThe issue title returned by GitHub.'],
    [undefined, 'GitHub issue · title'],
    ['   ', 'GitHub issue · title'],
  ])('shows the selected upstream node icon and keeps its full label in the tooltip', (description, tooltip) => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <NodeInputValue
          definition={{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false }}
          value={undefined}
          connected
          upstream={{
            current: [
              {
                description,
                icon: 'data:application/vnd.open-flow.initials,GH',
                nodeId: 'github',
                nodeName: 'GitHub issue',
                output: 'title',
                check: { kind: 'available' },
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
    expect(markup).toContain('data-slot="tooltip-trigger"')
    expect(markup).toContain(`aria-description="${tooltip}"`)
  })

  const sourceIssues: readonly { readonly check: InputSourceCheck; readonly message: string }[] = [
    { check: { kind: 'source-missing' }, message: 'The original input source no longer exists. Choose again.' },
    { check: { kind: 'output-missing' }, message: '“result” could not be found in “Source”. Choose again.' },
    { check: { kind: 'not-ready' }, message: '“Source result” may not have a value when this step runs.' },
    {
      check: { kind: 'schema', mismatch: { kind: 'keyword', keyword: 'type', path: ['properties', 'name'], source: 'string', target: 'number' } },
      message: '“name” must be Number, but it is String.',
    },
    {
      check: { kind: 'schema', mismatch: { kind: 'keyword', keyword: 'type', path: [], source: 'string', target: 'number' } },
      message: 'Expected Number, but the selected field is String.',
    },
    {
      check: { kind: 'schema', mismatch: { kind: 'keyword', keyword: 'minLength', path: ['properties', 'name'], source: undefined, target: 2 } },
      message: '“name” must contain at least 2 characters.',
    },
    {
      check: { kind: 'schema-error' },
      message: 'Could not check the data format.',
    },
  ]

  it.each(sourceIssues)('explains an invalid source ($check.kind)', ({ check, message }) => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <NodeInputValue
          definition={{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false }}
          value={undefined}
          connected
          upstream={{
            current: [{ nodeId: 'source', nodeName: 'Source', output: 'result', check }],
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

    expect(markup).toContain('role="alert"')
    const errorId = markup.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(errorId).toBeDefined()
    expect(markup).toContain(`id="${errorId}"`)
    expect(markup).toContain(message)
  })

  it('hides a deleted node ID and uses the neutral source icon with its saved output', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <NodeInputValue
          definition={{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false }}
          value={undefined}
          connected
          upstream={{
            current: [{ nodeId: '0199b784-internal', output: 'result', check: { kind: 'source-missing' } }],
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

    expect(markup).toContain('i-lucide-light:workflow')
    expect(markup).not.toContain('data-icon-kind="initials"')
    expect(markup).toContain('>result</span>')
    expect(markup).not.toContain('0199b784-internal')
    expect(markup).not.toMatch(/<(?:textarea|select)\b/)
  })

  it('uses concise field-context copy for a type mismatch', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('zh-CN')}>
        <NodeInputValue
          definition={{ handle: '数量', jsonSchema: { type: 'number' }, nullable: false }}
          value={undefined}
          connected
          upstream={{
            current: [
              {
                nodeId: 'source',
                nodeName: '读取商品',
                output: 'price',
                check: { kind: 'schema', mismatch: { kind: 'keyword', keyword: 'type', path: [], source: 'string', target: 'number' } },
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

    expect(markup).toContain('需要数字，但所选字段是字符串。')
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
    const trigger = (markup.match(/<button\b[^>]*>/g) ?? []).find((tag) =>
      tag.includes(nullable ? 'aria-label="missing null"' : 'aria-label="missing Set value"'),
    )
    expect(trigger).toBeDefined()
    expect(trigger!.includes('aria-invalid="true"')).toBe(!nullable)
    expect(markup).toContain(nullable ? '>null</span>' : '>Set value</span>')
    expect(onValue).not.toHaveBeenCalled()
  })
})

it('checks a saved binding synchronously without enumerating candidates', () => {
  const i18n = createI18n('en')
  const check = vi.fn(() => ({ conflict: false, sources: [{ kind: 'not-ready' }] as readonly InputSourceCheck[] }))
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
            current: [{ nodeId: 'source', nodeName: 'Saved source', output: 'text', check: undefined }],
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
    expect(html).not.toContain('Checking mapping…')
    expect(html).not.toContain('aria-busy')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('“Saved source text” may not have a value when this step runs.')
    expect(check).toHaveBeenCalledOnce()
    expect(candidates).not.toHaveBeenCalled()
  } finally {
    i18n.dispose()
  }
})

it.each([undefined, null, []])('keeps array item type separate from the literal value (%j)', (value) => {
  const onValue = vi.fn()
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <NodeInputValue
        definition={{ handle: 'items', jsonSchema: { type: 'array' }, nullable: true }}
        presentation={{ header: <span>items</span>, layout: 'ports', onDefinitionChange: vi.fn() }}
        value={value}
        connected={false}
        variables={variables}
        disabled={false}
        onValue={onValue}
        onVariable={vi.fn()}
      />
    </I18nProvider>,
  )
  expect(markup).toContain('aria-label="items Set value"')
  expect(markup).toContain('aria-label="items[] type: JSON"')
  expect(onValue).not.toHaveBeenCalled()
})

it('shows a bound array source alongside its independent item type', () => {
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <NodeInputValue
        definition={{ handle: 'items', jsonSchema: { type: 'array' }, nullable: true }}
        presentation={{ header: <span>items</span>, layout: 'ports', onDefinitionChange: vi.fn() }}
        value={undefined}
        variableName="API_TOKEN"
        connected={false}
        variables={variables}
        disabled={false}
        onValue={vi.fn()}
        onVariable={vi.fn()}
      />
    </I18nProvider>,
  )
  expect(markup).toContain('API_TOKEN')
  expect(markup).toContain('aria-label="items[] type: JSON"')
  expect(markup).toContain('aria-invalid="true"')
})
