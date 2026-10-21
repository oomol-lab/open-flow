// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18n } from 'val-i18n'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it, vi } from 'vitest'
import { uiLocales } from '../locales.ts'
import { CompactValue } from './CompactValue.tsx'
import { DataRender } from './DataRender.tsx'

const renderValue = (value: unknown, stringTruncateLength?: number): string => {
  return renderToStaticMarkup(
    <I18nProvider i18n={new I18n('en', uiLocales)}>
      <DataRender value={value} lastElement level={0} shouldExpandNode={() => true} clickToExpandNode stringTruncateLength={stringTruncateLength} />
    </I18nProvider>,
  )
}

describe('DataRender', () => {
  it('uses the configured string truncation length', () => {
    const markup = renderValue('abcdef', 3)

    expect(markup).toContain('&quot;ab...')
    expect(markup).not.toContain('&quot;abcdef&quot;')
  })

  it('renders bigint values without invoking the BigInt constructor', () => {
    expect(renderValue(42n)).toContain('42n')
  })

  it('renders useful values in a compact object preview', () => {
    const markup = renderToStaticMarkup(<CompactValue value={{ message: 'Hello, World', ok: true }} />)

    expect(markup).toContain('message: ')
    expect(markup).toContain('&quot;Hello, World&quot;')
    expect(markup).toContain('ok: ')
    expect(markup).toContain('true')
  })
})

it('expands and collapses JSON through named buttons without submitting its containing form', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const i18n = new I18n('en', uiLocales)
  const submit = vi.fn((event: Event) => event.preventDefault())
  try {
    await act(async () =>
      root.render(
        <I18nProvider i18n={i18n}>
          <form>
            <DataRender value={{ answer: 42 }} lastElement level={0} shouldExpandNode={() => false} clickToExpandNode />
          </form>
        </I18nProvider>,
      ),
    )
    container.querySelector('form')!.addEventListener('submit', submit)
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="expand JSON"]')!
    expect(toggle).not.toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-label')).toBe('collapse JSON')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const contents = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(contents).not.toBeNull()
    expect(contents.textContent).toContain('answer:42')
    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(contents.isConnected).toBe(false)
    expect(submit).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    i18n.dispose()
    vi.unstubAllGlobals()
  }
})
