import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { TriggerScheduleEditor } from './triggerScheduleEditor.tsx'

describe('Trigger schedule editor', () => {
  it('renders Trigger schedule as an always-visible section', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <TriggerScheduleEditor schedules={[{ type: 'every', unit: 'minute', value: 5 }]} disabled={false} onChange={() => {}} />
      </I18nProvider>,
    )

    expect(markup).not.toContain('<details')
    expect(markup).toContain('Trigger schedule')
    expect(markup).toContain('Schedule type')
  })

  it('keeps the optional disclosure presentation collapsed', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <TriggerScheduleEditor schedules={[{ type: 'every', unit: 'minute', value: 5 }]} disabled={false} collapsible onChange={() => {}} />
      </I18nProvider>,
    )

    expect(markup).toContain('<details')
    expect(markup).not.toMatch(/<details[^>]*\sopen(?:=""|(?=[\s>]))/)
    expect(markup).toContain('Trigger schedule')
  })
})
