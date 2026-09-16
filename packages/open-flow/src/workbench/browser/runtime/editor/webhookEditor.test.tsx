import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { WebhookEditor } from './webhookEditor.tsx'

describe('Webhook configuration', () => {
  it.each([undefined, ['PUT', 'CUSTOM']])('renders effective and custom methods for %j without a Designer provider', (allowedMethods) => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <WebhookEditor bodyFields={[]} options={{ allowedMethods }} disabled={false} onChange={() => {}} />
      </I18nProvider>,
    )
    expect(markup).toContain('Request body fields')
    expect(markup).toContain('Allowed methods')
    expect(markup).toContain('Status code')
    expect(markup).toContain('aria-checked="true"')
    for (const method of allowedMethods ?? ['POST']) expect(markup).toContain(method)
  })
  it('prevents configuration edits while retaining existing response values', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <WebhookEditor
          bodyFields={[{ handle: 'event', jsonSchema: { type: 'object' }, nullable: false }]}
          options={{ responseStatusCode: 202, responseData: 'accepted', responseHeaders: { 'X-Example': 'yes' } }}
          disabled
          onChange={() => {}}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('accepted')
    expect(markup).toContain('X-Example')
    const controls = markup.match(/<(?:input|button|select|textarea)\b[^>]*>/g) ?? []
    expect(controls.length).toBeGreaterThan(0)
    // Expanding a structured value only changes the view; editing remains disabled.
    const editingControls = controls.filter((control) => !control.includes('aria-expanded='))
    const editable = editingControls.filter((control) => {
      if (/\bdisabled(?:=|\s|>)/.test(control)) return false
      const readOnlyText =
        /^<(?:input|textarea)\b/.test(control) && !/\btype="(?:checkbox|radio|range|file|color)"/.test(control) && /\breadonly(?:=|\s|>)/.test(control)
      return !readOnlyText
    })
    expect(editable).toEqual([])
  })
})
