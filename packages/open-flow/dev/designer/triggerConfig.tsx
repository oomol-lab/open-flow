import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { JsonValue } from '../../src/workbench/browser/runtime/api.ts'
import type { DesignerStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { TriggerConfigEditor } from '../../src/workbench/browser/runtime/designer/triggerConfigEditor.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'

const schema = {
  type: 'object',
  required: ['owner', 'events'],
  properties: {
    owner: { type: 'string', title: 'Owner', description: 'Repository owner.' },
    events: { type: 'array', title: 'Events', items: { enum: ['issues', 'push', 'release'] } },
    limit: { type: 'integer', title: 'Limit', default: 10 },
    enabled: { type: 'boolean', title: 'Enabled' },
    mode: { enum: ['all', 'matching'], title: 'Mode' },
    filters: { type: 'object', title: 'Filters', properties: { branch: { type: 'string' } } },
  },
} satisfies JsonValue

function ConfigStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [config, setConfig] = useState<Record<string, JsonValue>>({ owner: '', events: ['issues'], mode: 'all', filters: { branch: 'main' } })
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ padding: 24, maxWidth: 480 }}>
        <TriggerConfigEditor
          schema={schema}
          config={config}
          disabled={false}
          onChange={(name, value) => {
            const next = { ...config }
            if (value === undefined) delete next[name]
            else next[name] = value
            setConfig(next)
            log('Save configuration', next)
          }}
        />
        <output aria-label="Saved configuration">{JSON.stringify(config)}</output>
        <h3>Read only</h3>
        <TriggerConfigEditor schema={schema} config={config} disabled onChange={() => log('Unexpected read-only save')} />
      </div>
    </I18nProvider>
  )
}
export const triggerConfigStory: DesignerStory = {
  group: 'Workbench',
  id: 'trigger-config',
  title: 'Trigger Configuration',
  standalone: true,
  render: (log, dark, language) => <ConfigStory dark={dark} language={language} log={log} />,
}
