import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it } from 'vitest'
import { createI18n } from '../../src/designer/browser/i18n/index.ts'
import { formatPreviewText, TextPreview } from '../../src/designer/browser/preview/textPreview.tsx'

describe('TextPreview', () => {
  it('formats structured data without depending on an editor implementation', () => {
    expect(formatPreviewText({ ok: true })).toBe('{\n  "ok": true\n}')
    expect(
      renderToStaticMarkup(
        <I18nProvider i18n={createI18n('en')}>
          <TextPreview data={{ ok: true }} language="json" />
        </I18nProvider>,
      ),
    ).toContain('data-language="json"')
  })

  it('uses a stable fallback when a value cannot be stringified', () => {
    const value: Record<string, unknown> = {}
    value.self = value
    value.toString = () => {
      throw new Error('unavailable')
    }
    expect(formatPreviewText(value)).toBe('<Data is not previewable>')
  })
})
