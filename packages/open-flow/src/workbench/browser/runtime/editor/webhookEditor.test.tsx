import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { WebhookEditor } from './webhookEditor.tsx'

describe('Webhook configuration', () => {
  it.each([undefined, ['PUT', 'CUSTOM']])('renders effective and custom methods for %j without a Designer provider', (allowedMethods) => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <WebhookEditor inputs={[]} options={{ allowedMethods }} disabled={false} onChange={() => {}} />
      </I18nProvider>,
    )
    expect(markup).toContain('Request data')
    expect(markup).toContain('Allowed methods')
    expect(markup).toContain('Status code')
    expect(markup).toContain('aria-checked="true"')
    for (const method of allowedMethods ?? ['POST']) expect(markup).toContain(method)
  })
  it('disables configuration controls while retaining existing response values', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <WebhookEditor
          inputs={[{ handle: 'event', jsonSchema: { type: 'object' }, nullable: false }]}
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
    expect(controls.every((control) => /\bdisabled(?:=|\s|>)/.test(control))).toBe(true)
  })
})
