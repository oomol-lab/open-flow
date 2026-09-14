import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { InputMapping } from '../../src/workbench/browser/runtime/api.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { NodeInputValue } from '../../src/workbench/browser/runtime/editor/nodeInputValue.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { providerIcon } from '../../src/workbench/browser/runtime/providerIcon.ts'
function NodeInputStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [mapping, setMapping] = useState<InputMapping | undefined>({ kind: 'value', value: 'hello' })
  const [variableName, setVariableName] = useState<string>()
  const variables = { enabled: true, names: ['API_TOKEN', 'TEAM_NAME'], loaded: true, loading: false, onOpen: () => log('Refresh names') }
  const definition = { handle: 'value', jsonSchema: { type: 'string' }, nullable: true, value: 'default' }
  const providerSource = {
    current: [
      {
        icon: providerIcon({ icon: ':simple-icons:github:', serviceId: 'github', serviceName: 'GitHub' }, {}),
        nodeId: 'github',
        nodeName: 'GitHub issue',
        output: 'title',
        valid: true,
      },
    ],
    groups: [
      {
        icon: providerIcon({ icon: ':simple-icons:github:', serviceId: 'github', serviceName: 'GitHub' }, {}),
        nodeId: 'github',
        nodeName: 'GitHub issue',
        outputs: ['title'],
      },
    ],
    onChange: () => log('Select upstream source'),
  }
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ padding: 24, width: 460 }}>
        <NodeInputValue
          definition={definition}
          value={mapping?.kind === 'value' ? mapping.value : definition.value}
          connected={mapping?.kind === 'sources' && variableName == null}
          variableName={variableName}
          variables={variables}
          disabled={false}
          onValue={(value) => {
            setVariableName(undefined)
            setMapping(value === undefined ? undefined : { kind: 'value', value })
            log('Save literal', value ?? null)
          }}
          onVariable={(name) => {
            setVariableName(name)
            setMapping(name == null ? undefined : { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'sample' }] })
            log('Save binding', name ?? null)
          }}
        />
        <output aria-label="Saved input">{JSON.stringify({ mapping, variableName })}</output>
        <h3>Connected source</h3>
        <NodeInputValue
          definition={definition}
          value={undefined}
          connected
          upstream={providerSource}
          variables={variables}
          disabled={false}
          onValue={() => {}}
          onVariable={() => {}}
        />
        <h3>No available sources</h3>
        <NodeInputValue
          definition={definition}
          value={undefined}
          connected={false}
          variables={{ ...variables, names: [] }}
          disabled={false}
          onValue={() => {}}
          onVariable={() => {}}
        />
        <h3>Read only</h3>
        <NodeInputValue
          definition={definition}
          value={mapping?.kind === 'value' ? mapping.value : definition.value}
          connected={mapping?.kind === 'sources' && variableName == null}
          variableName={variableName}
          variables={variables}
          disabled
          onValue={() => {}}
          onVariable={() => {}}
        />
      </div>
    </I18nProvider>
  )
}
export const nodeInputStory: FrontendStory = {
  group: 'Node Task',
  id: 'node-input',
  title: 'Node Input',
  standalone: true,
  render: (log, dark, language) => <NodeInputStory dark={dark} language={language} log={log} />,
}
