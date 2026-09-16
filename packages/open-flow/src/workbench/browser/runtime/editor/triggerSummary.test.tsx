import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { expect, it } from 'vitest'
import { feishuEvents } from '../../../../trigger/providers/feishu/on-event.ts'
import { localizeTrigger } from '../../../../trigger/providers/localization.ts'
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

it('uses translated provider copy without changing the stored trigger definition', async () => {
  const definition = feishuEvents[0]!.snapshot
  const display = await localizeTrigger(definition, 'zh-CN')
  const html = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('zh-CN')}>
      <TriggerSummary trigger={{ kind: 'integration', name: 'Feishu', bindingId: 'app', definition, config: {} }} display={display} />
    </I18nProvider>,
  )
  expect(html).toContain('通过共享事件源接收所选飞书应用事件。')
  expect(html).not.toContain(definition.description)
  expect(definition.description).toBe('Receives selected Feishu application events through a shared event source.')
})
