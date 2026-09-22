import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { WebhookEditor } from './webhookEditor.tsx'

function renderWebhook(method: 'GET' | 'POST') {
  return renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <WebhookEditor bodyFields={[]} method={method} options={{}} disabled={false} onChange={vi.fn()} />
    </I18nProvider>,
  )
}

describe('Webhook configuration', () => {
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)('renders %s as one of the five single-select methods', (method) => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <WebhookEditor bodyFields={[]} method={method} options={{}} disabled={false} onChange={vi.fn()} />
      </I18nProvider>,
    )
    expect(markup).toContain('Request method')
    expect(markup).toMatch(new RegExp(`<button[^>]*aria-label="Request method"[^>]*>[\\s\\S]*?${method}`))
    expect(markup).not.toContain('>HEAD<')
    expect(markup).not.toContain('>OPTIONS<')
    expect(markup).not.toContain('Click Run and enter sample request data')
    expect(markup).toContain('<details class="inspector-disclosure"')
    expect(markup).not.toContain('<details class="inspector-disclosure" open=""')
    expect(markup).toContain('Advanced settings')
  })

  it('hides request body fields for GET and shows the owned empty state for POST', () => {
    expect(renderWebhook('GET')).not.toContain('Request body fields')
    const post = renderWebhook('POST')
    expect(post.indexOf('Request body fields')).toBeLessThan(post.indexOf('The request body accepts an empty object.'))
  })

  it('orders Request, Outputs, and collapsed Advanced settings', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <WebhookEditor bodyFields={[]} method="POST" options={{}} disabled={false} outputSection={<section>Outputs marker</section>} onChange={vi.fn()} />
      </I18nProvider>,
    )
    expect(markup.indexOf('Request method')).toBeLessThan(markup.indexOf('Outputs marker'))
    expect(markup.indexOf('Outputs marker')).toBeLessThan(markup.indexOf('Advanced settings'))
    expect(markup.indexOf('Allowed request origins')).toBeLessThan(markup.indexOf('Response status code'))
  })

  it('uses an empty response body field to represent no response body', () => {
    const markup = renderWebhook('POST')
    expect(markup).toContain('Leave blank to return no response body.')
    expect(markup).not.toContain('No response body')
  })

  it('requests a numeric keyboard for the status code while preserving text draft behavior', () => {
    const statusInput = renderWebhook('POST').match(/<input\b[^>]*placeholder="200 \(default\)"[^>]*>/)?.[0]
    expect(statusInput).toContain('inputMode="numeric"')
    expect(statusInput).not.toContain('type="number"')
  })

  it('uses the same muted placeholder treatment for single-line and multiline drafts', () => {
    const markup = renderWebhook('POST')
    const origins = markup.match(/<input\b[^>]*placeholder="https:\/\/example\.com, \*"[^>]*>/)?.[0]
    const responseBody = markup.match(/<textarea\b[^>]*placeholder="Leave blank to return no response body\."[^>]*>/)?.[0]
    expect(origins).toContain('placeholder:text-muted-foreground/60')
    expect(responseBody).toContain('placeholder:text-muted-foreground/60')
  })

  it('prevents configuration edits while retaining existing response values', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <WebhookEditor
          bodyFields={[{ handle: 'event', jsonSchema: { type: 'object' }, nullable: false }]}
          method="POST"
          options={{ responseStatusCode: 202, responseData: 'accepted', responseHeaders: { 'X-Example': 'yes' } }}
          disabled
          onChange={vi.fn()}
        />
      </I18nProvider>,
    )
    expect(markup).toContain('accepted')
    expect(markup).toContain('X-Example')
    expect(markup.match(/aria-disabled="true"/g)?.length).toBeGreaterThanOrEqual(1)
    expect(markup).not.toContain('aria-label="Add field"')
    expect(markup).not.toContain('aria-label="Add header"')
    expect(markup).not.toContain('aria-label="Delete header"')
  })
})
