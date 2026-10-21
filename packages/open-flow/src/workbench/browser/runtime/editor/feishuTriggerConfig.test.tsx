import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { expect, it } from 'vitest'
import { sourceEvents } from '../../../../trigger/providers/source-events.ts'
import { createI18n } from '../i18n.ts'
import { EventSourceTriggerConfig } from './eventSourceTriggerConfig.tsx'

it('shows both required Feishu fields before an event source is selected', () => {
  const html = renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <EventSourceTriggerConfig
        inputs={sourceEvents.find((item) => item.snapshot.key === 'feishu_app_bot.on_event')!.snapshot.configInputs}
        fieldLabels={{ sourceId: 'Event source', eventTypes: 'Events to receive' }}
        config={{}}
        nodeId="trigger"
        disabled={false}
        store={{ $: { flowId: { value: 'flow' } } } as never}
      />
    </I18nProvider>,
  )

  expect(html).toContain('data-port="sourceId"')
  expect(html).toContain('data-port="eventTypes"')
  expect(html).toContain('Events to receive')
  expect(html).toContain('Select an event source first')
  expect(html).not.toContain('Search by name or event ID')
  expect(html).not.toContain('Only events allowed by the selected source are available.')
})
