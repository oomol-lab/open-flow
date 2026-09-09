import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { DesignerStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { NodeDescription } from '../../src/workbench/browser/runtime/designer/nodeDescription.tsx'
import { NodeHeading } from '../../src/workbench/browser/runtime/designer/nodeHeading.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'

function MetadataStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const [value, setValue] = useState<string | undefined>('Explain what this node does.')
  const [title, setTitle] = useState('Example node')
  const [icon, setIcon] = useState(':carbon:code:')
  const i18n = useMemo(() => createI18n(language), [language])
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ padding: 24, maxWidth: 480 }}>
        <NodeHeading
          title={title}
          icon={icon}
          fallback={null}
          disabled={false}
          validate={(next) => (next.trim() === '' ? 'Enter a name.' : next === 'Existing node' ? 'Name already exists.' : undefined)}
          onRename={(next) => {
            setTitle(next)
            log('Save name', next)
          }}
          onIconChange={(next) => {
            setIcon(next)
            log('Save icon', next)
          }}
        />
        <output aria-label="Saved name">{title}</output>
        <output aria-label="Saved icon">{icon}</output>
        <NodeDescription
          value={value}
          disabled={false}
          onSave={(next) => {
            setValue(next)
            log('Save description', next ?? null)
          }}
        />
        <NodeDescription value="Read-only node description." disabled onSave={() => log('Unexpected read-only save')} />
        <output aria-label="Saved description">{JSON.stringify({ description: value })}</output>
      </div>
    </I18nProvider>
  )
}

export const metadataStory: DesignerStory = {
  group: 'Workbench',
  id: 'node-metadata',
  title: 'Node Metadata',
  standalone: true,
  render: (log, dark, language) => <MetadataStory dark={dark} language={language} log={log} />,
}
