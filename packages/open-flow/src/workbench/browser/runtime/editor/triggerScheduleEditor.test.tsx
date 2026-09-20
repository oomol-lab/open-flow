import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { TriggerScheduleEditor } from './triggerScheduleEditor.tsx'

describe('Trigger schedule editor', () => {
  it('renders a fixed Trigger schedule section title and starts collapsed', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <TriggerScheduleEditor schedules={[{ type: 'every', unit: 'minute', value: 5 }]} disabled={false} onChange={() => {}} />
      </I18nProvider>,
    )

    expect(markup).toContain('<details class="inspector-disclosure"')
    expect(markup).not.toContain('inspector-section-divider')
    expect(markup).not.toMatch(/<details[^>]*\sopen(?:=""|(?=[\s>]))/)
    expect(markup).toContain('<strong class="inspector-section-title-text">Trigger schedule</strong>')
  })
})
