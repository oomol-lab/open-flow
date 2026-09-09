import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { Group, InputPort } from '../../src/workbench/browser/runtime/api.ts'
import type { DesignerStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { PortDefinitionEditor } from '../../src/workbench/browser/runtime/designer/portDefinitionEditor.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'

function ValueStory({ dark, language, log, reservedNames }: { dark: boolean; language: UiLanguage; log: LogAction; reservedNames?: readonly string[] }) {
  const [values, setValues] = useState<readonly InputPort[]>([
    { handle: 'value', jsonSchema: { type: 'object', properties: { count: { type: 'number' } } }, nullable: true, value: { count: 1 } },
  ])
  const [disabled, setDisabled] = useState(false)
  const i18n = useMemo(() => createI18n(language), [language])
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ height: '100%', overflow: 'auto', padding: 24 }}>
        <label>
          <input type="checkbox" checked={disabled} onChange={(event) => setDisabled(event.target.checked)} /> Read only
        </label>
        <div style={{ maxWidth: 520 }}>
          <PortDefinitionEditor
            reservedNames={reservedNames}
            values={values}
            disabled={disabled}
            onChange={(next) => {
              setValues(next)
              log('Save values', next)
            }}
          />
        </div>
        <pre aria-label="Saved values">{JSON.stringify(values, null, 2)}</pre>
      </div>
    </I18nProvider>
  )
}
export const valueNodeStory: DesignerStory = {
  id: 'value-node-editor',
  title: 'Value Node Editor',
  group: 'Workbench',
  standalone: true,
  render: (log, dark, language) => <ValueStory log={log} dark={dark} language={language} />,
}

export const additionalInputsStory: DesignerStory = {
  id: 'additional-inputs',
  title: 'Additional Inputs',
  group: 'Workbench',
  standalone: true,
  render: (log, dark, language) => <ValueStory log={log} dark={dark} language={language} reservedNames={['value1', 'message']} />,
}

function GroupedInputsStory({ dark, language, log, output = false }: { dark: boolean; language: UiLanguage; log: LogAction; output?: boolean }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [values, setValues] = useState<readonly (InputPort | Group)[]>([
    { group: 'Request', collapsed: true },
    { handle: 'message', jsonSchema: { type: 'string' }, nullable: false, ...(output ? {} : { value: 'hello' }) },
  ])
  return (
    <I18nProvider i18n={i18n}>
      <div
        className="open-flow-workbench open-flow-theme"
        data-theme={dark ? 'dark' : 'light'}
        style={{ overflow: 'auto', height: '100%', width: 520, padding: 24 }}
      >
        <PortDefinitionEditor
          groups
          output={output}
          values={values}
          disabled={false}
          onChange={(next) => {
            setValues(next)
            log('Save grouped inputs', next)
          }}
        />
        <pre aria-label="Saved ports">{JSON.stringify(values, null, 2)}</pre>
      </div>
    </I18nProvider>
  )
}
export const groupedInputsStory: DesignerStory = {
  id: 'grouped-inputs',
  title: 'Grouped Inputs',
  group: 'Workbench',
  standalone: true,
  render: (log, dark, language) => <GroupedInputsStory log={log} dark={dark} language={language} />,
}

export const outputPortsStory: DesignerStory = {
  id: 'output-ports',
  title: 'Output Ports',
  group: 'Workbench',
  standalone: true,
  render: (log, dark, language) => <GroupedInputsStory log={log} dark={dark} language={language} output />,
}
