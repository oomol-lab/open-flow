import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { LeinaBotSelect } from './leinaBotSelect.tsx'

function render(value: string | null | undefined) {
  return renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <LeinaBotSelect source={{ listLeinaBots: async () => [] }} flowId="flow" value={value} disabled={false} onChange={vi.fn()} />
    </I18nProvider>,
  )
}

it.each([undefined, null, '', '   '])('shows required feedback for an unselected robot (%s)', (value) => {
  const html = render(value)
  expect(html).toContain('aria-invalid="true"')
  expect(html).toContain('role="alert"')
  expect(html).toContain('Select a Leina robot')
})

it('shows loading instead of a raw saved identifier before names arrive', () => {
  const html = render('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  expect(html).toContain('Loading robots…')
  expect(html).not.toContain('>aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa<')
  expect(html).not.toContain('aria-invalid="true"')
})
