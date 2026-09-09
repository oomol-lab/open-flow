import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { WebhookSettings } from '../../src/workbench/browser/runtime/editor/flowChanges.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { Checkbox } from '../../src/ui/browser/checkbox.tsx'
import { TriggerSummary } from '../../src/workbench/browser/runtime/editor/triggerSummary.tsx'
import { WebhookEditor } from '../../src/workbench/browser/runtime/editor/webhookEditor.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'

function WebhookStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [disabled, setDisabled] = useState(false)
  const [webhook, setWebhook] = useState<WebhookSettings>({ inputs: [{ handle: 'event', jsonSchema: { type: 'object' }, nullable: false }], options: {} })
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ padding: 24, maxWidth: 520 }}>
        <label className="flex items-center gap-2">
          <Checkbox checked={disabled} onCheckedChange={(value) => setDisabled(value === true)} />
          Read only
        </label>
        <WebhookEditor
          {...webhook}
          disabled={disabled}
          onChange={(next) => {
            setWebhook(next)
            log('Save webhook', next)
          }}
        />
        <TriggerSummary trigger={{ kind: 'webhook', name: 'Webhook', inputsDef: webhook.inputs, options: webhook.options }} />
        <output aria-label="Saved webhook" style={{ overflowWrap: 'anywhere' }}>
          {JSON.stringify(webhook)}
        </output>
      </div>
    </I18nProvider>
  )
}
export const webhookStory: FrontendStory = {
  group: 'Workbench',
  id: 'webhook-editor',
  title: 'Webhook Editor',
  standalone: true,
  render: (log, dark, language) => <WebhookStory dark={dark} language={language} log={log} />,
}
