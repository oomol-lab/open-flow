import type { ComponentProps } from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { FeishuEventFilters } from './feishuEventFilters.tsx'

function render(events: string[], config: ComponentProps<typeof FeishuEventFilters>['config'] = {}, managed = true) {
  return renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <FeishuEventFilters events={events} config={config} managed={managed} disabled={false} onChange={() => {}} />
    </I18nProvider>,
  )
}

it('shows optional chat filtering for received messages without resource fields', () => {
  const html = render(['im.message.receive_v1'])
  expect(html).toContain('Specific chats (optional)')
  expect(html).not.toContain('Subscribe to a specific resource')
})

it('keeps resource details hidden until explicitly enabled', () => {
  const html = render(['drive.file.edit_v1'])
  expect(html).toContain('Subscribe to a specific resource')
  expect(html).not.toContain('Document token')
  expect(html).not.toContain('Document type')
  expect(html).not.toContain('Specific chats')
})

it('shows only the fields appropriate to a calendar subscription', () => {
  const html = render(['calendar.calendar.event.changed_v4'], { resource: { kind: 'calendar', id: 'calendar' } })
  expect(html).toContain('Calendar ID')
  expect(html).not.toContain('Document type')
  expect(html).not.toContain('Approval definition code')
})

it('does not offer subscriptions for mixed or unsupported event families', () => {
  expect(render(['drive.file.edit_v1', 'im.message.receive_v1'])).toBe('')
  expect(render(['approval.instance.status_changed_v4'])).toBe('')
  expect(render([])).toBe('')
})

it('keeps incompatible saved settings visible for removal and explains unavailable management', () => {
  expect(render(['contact.user.created_v3'], { chatIds: ['chat'] })).toContain('Remove filter')
  expect(render(['contact.user.created_v3'], { resource: { kind: 'document', id: 'token' } })).toContain('does not match the selected events')
  const html = render(['drive.file.edit_v1'], {}, false)
  expect(html).toContain('Enable resource subscription management')
  expect(html).toMatch(/disabled/)
})
