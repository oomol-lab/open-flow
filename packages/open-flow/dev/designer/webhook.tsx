import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { WebhookSettings } from '../../src/workbench/browser/runtime/editor/flowChanges.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useCallback, useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { TriggerSummary } from '../../src/workbench/browser/runtime/editor/triggerSummary.tsx'
import { WebhookEditor } from '../../src/workbench/browser/runtime/editor/webhookEditor.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { useStoryActions } from './storyActions.tsx'

function WebhookStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [disabled, setDisabled] = useState(false)
  const [webhook, setWebhook] = useState<WebhookSettings>({
    bodyFields: [{ handle: 'event', jsonSchema: { type: 'object' }, nullable: false }],
    method: 'POST',
    options: {},
  })
  const setSample = useCallback(
    (next: WebhookSettings) => {
      setWebhook(next)
      log('Load webhook sample', next)
    },
    [log],
  )
  useStoryActions(
    useMemo(
      () => [
        { label: 'Default POST', onClick: () => setSample({ bodyFields: [], method: 'POST', options: {} }) },
        { label: 'GET', onClick: () => setSample({ bodyFields: [], method: 'GET', options: {} }) },
        {
          label: 'Request fields',
          onClick: () => setSample({ bodyFields: [{ handle: 'event', jsonSchema: { type: 'object' }, nullable: false }], method: 'POST', options: {} }),
        },
        {
          label: 'Full response',
          onClick: () =>
            setSample({
              bodyFields: [{ handle: 'event', jsonSchema: { type: 'object' }, nullable: false }],
              method: 'POST',
              options: { responseData: '{"accepted":true}', responseHeaders: { 'X-Webhook': 'accepted' }, responseStatusCode: 202 },
            }),
        },
        {
          label: 'Empty response',
          onClick: () => setSample({ bodyFields: [], method: 'POST', options: { responseHeaders: { 'X-Webhook': 'accepted' } } }),
        },
        { label: disabled ? 'Enable editing' : 'Read only', onClick: () => setDisabled((value) => !value) },
      ],
      [disabled, setSample],
    ),
  )
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme open-flow-property-panel" data-theme={dark ? 'dark' : 'light'} style={{ padding: 24, maxWidth: 420 }}>
        <WebhookEditor
          {...webhook}
          disabled={disabled}
          outputSection={
            <TriggerSummary trigger={{ kind: 'webhook', method: webhook.method, name: 'Webhook', bodyFields: webhook.bodyFields, options: webhook.options }} />
          }
          onChange={(next) => {
            setWebhook(next)
            log('Save webhook', next)
          }}
        />
        <output aria-label="Saved webhook" style={{ overflowWrap: 'anywhere' }}>
          {JSON.stringify(webhook)}
        </output>
      </div>
    </I18nProvider>
  )
}
export const webhookStory: FrontendStory = {
  group: 'Trigger Webhook',
  id: 'webhook-editor',
  propertyPanel: true,
  title: 'Webhook Editor',
  standalone: true,
  render: (log, dark, language) => <WebhookStory dark={dark} language={language} log={log} />,
}
