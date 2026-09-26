import type { AgentInput } from '../../../../flow/common/change.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { AgentInputSource } from './agentInputSource.tsx'

function render(source: AgentInput, disabled = false) {
  const onChange = vi.fn()
  const markup = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <AgentInputSource
        port={{ handle: 'payload', jsonSchema: {}, nullable: true }}
        inputs={[{ handle: 'request', jsonSchema: {}, nullable: true }]}
        source={source}
        disabled={disabled}
        onChange={onChange}
        onValidChange={vi.fn()}
      />
    </I18nProvider>,
  )
  expect(onChange).not.toHaveBeenCalled()
  return markup
}

describe('Agent parameter sources', () => {
  it('shows bound inputs without literal-value type or clear actions', () => {
    const markup = render({ kind: 'input', input: 'request' })
    expect(markup).toContain('request')
    expect(markup).not.toContain('data type:')
    expect(markup).not.toContain('aria-label="Clear payload"')
    expect(markup).not.toContain('aria-invalid="true"')
  })

  it('preserves missing input references and marks them invalid', () => {
    const markup = render({ kind: 'input', input: 'deleted_input' })
    expect(markup).toContain('deleted_input')
    expect(markup).toContain('aria-invalid="true"')
  })

  it('allows the Agent to fill nullable parameters without treating them as null', () => {
    const markup = render({ kind: 'model' })
    expect(markup).toContain('Let the Agent fill this')
    expect(markup).not.toContain('aria-invalid="true"')
  })

  it('keeps literal editing and clearing available for an assigned value', () => {
    const markup = render({ kind: 'value', value: 'result' })
    expect(markup).toContain('value="result"')
    expect(markup).toContain('aria-label="Clear payload"')
    expect(render({ kind: 'value', value: 'result' }, true)).not.toContain('aria-label="Clear payload"')
  })
})
