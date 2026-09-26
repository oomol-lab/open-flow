import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../../workbench/browser/runtime/i18n.ts'
import { ValueTools } from './valueTools.tsx'

describe('Value tools', () => {
  it('uses the destructive ghost treatment for a danger reset action', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <ValueTools label="payload" container={null} raw={false} danger onReset={vi.fn()} />
      </I18nProvider>,
    )
    expect(markup).toContain('data-variant="destructive-ghost"')
  })

  it('keeps clear neutral while marking the invalid field surface', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <ValueTools label="payload" container={null} raw={false} danger onClear={vi.fn()} />
      </I18nProvider>,
    )
    expect(markup).toContain('data-variant="ghost"')
    expect(markup).toContain('data-danger="true"')
  })

  it('places reset before every other inline action', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <ValueTools
          label="payload"
          container={null}
          raw={false}
          onReset={vi.fn()}
          onClear={vi.fn()}
          onToggleJson={vi.fn()}
          disclosure={{ controls: 'payload-body', disabled: false, expanded: true, onToggle: vi.fn() }}
        />
      </I18nProvider>,
    )
    const reset = markup.indexOf('aria-label="Reset to defaults payload"')
    const disclosure = markup.indexOf('aria-label="payload"')
    const clear = markup.indexOf('aria-label="Clear payload"')
    const json = markup.indexOf('aria-label="payload Edit raw data"')
    expect(reset).toBeGreaterThanOrEqual(0)
    expect(reset).toBeLessThan(disclosure)
    expect(reset).toBeLessThan(clear)
    expect(reset).toBeLessThan(json)
  })
})
