import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { expect, it } from 'vitest'
import { feishuEvents } from '../../../../trigger/providers/feishu/on-event.ts'
import { createI18n } from '../i18n.ts'
import { TriggerSummary } from './triggerSummary.tsx'

it('renders schedule outputs with the standard output section', () => {
  const html = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('zh-CN')}>
      <TriggerSummary trigger={{ kind: 'cron', name: 'Schedule', cronTimes: [] }} />
    </I18nProvider>,
  )
  expect(html).toContain('data-inspector-section="outputs"')
  expect(html).toContain('输出')
  expect(html).toContain('scheduledAt')
})

it('renders Provider outputs with the standard output section', () => {
  const definition = feishuEvents[0]!.snapshot
  const html = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('zh-CN')}>
      <TriggerSummary trigger={{ kind: 'integration', name: 'Feishu', bindingId: 'app', definition, config: {} }} />
    </I18nProvider>,
  )
  expect(html).toContain('data-inspector-section="outputs"')
  expect(html).toContain('输出')
  expect(html).toContain('event')
  expect(html).toContain('deliveryId')
  expect(html).toContain('body')
  expect(html).not.toContain('payload')
  expect(html).not.toContain(definition.description)
  expect(html).not.toContain(definition.provider)
})
