import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { Group, InputPort } from '../../src/workbench/browser/runtime/api.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { PortDefinitionEditor } from '../../src/workbench/browser/runtime/editor/portDefinitionEditor.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { useStoryActions } from './storyActions.tsx'

function ValueStory({ dark, language, log, reservedNames }: { dark: boolean; language: UiLanguage; log: LogAction; reservedNames?: readonly string[] }) {
  const [values, setValues] = useState<readonly InputPort[]>([
    { handle: 'emptyText', jsonSchema: { type: 'string' }, nullable: false, value: '' },
    { handle: 'emptyMultiline', jsonSchema: { 'type': 'string', 'ui:widget': 'text' }, nullable: false, value: '' },
    { handle: 'unsetText', jsonSchema: { type: 'string' }, nullable: false },
    { handle: 'jsonEmpty', jsonSchema: {}, nullable: false },
    { handle: 'jsonObject', jsonSchema: {}, nullable: true, value: { enabled: true, tags: ['sample'], count: 2 } },
    { handle: 'jsonNull', jsonSchema: { 'ui:widget': 'any' }, nullable: true, value: null },
    { handle: 'value', jsonSchema: { type: 'object', properties: { count: { type: 'number' } } }, nullable: true, value: { count: 1 } },
  ])
  const [disabled, setDisabled] = useState(false)
  useStoryActions([{ label: disabled ? 'Enable editing' : 'Read only', onClick: () => setDisabled(!disabled) }])
  const i18n = useMemo(() => createI18n(language), [language])
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ height: '100%', overflow: 'auto', padding: 24 }}>
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
export const valueNodeStory: FrontendStory = {
  id: 'value-node-editor',
  title: 'Fixed Values Editor',
  group: 'Node Fixed Values',
  standalone: true,
  render: (log, dark, language) => <ValueStory log={log} dark={dark} language={language} />,
}

export const additionalInputsStory: FrontendStory = {
  id: 'additional-inputs',
  title: 'Additional Inputs',
  group: 'Node Task',
  standalone: true,
  render: (log, dark, language) => <ValueStory log={log} dark={dark} language={language} reservedNames={['value1', 'message']} />,
}

function GroupedInputsStory({ dark, language, log, output = false }: { dark: boolean; language: UiLanguage; log: LogAction; output?: boolean }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [emptyValues, setEmptyValues] = useState<readonly (InputPort | Group)[]>([])
  const [values, setValues] = useState<readonly (InputPort | Group)[]>([
    { group: 'Request', collapsed: !output },
    { handle: 'message', jsonSchema: { type: 'string' }, nullable: false, ...(output ? {} : { value: 'hello' }) },
    ...(output
      ? [
          { handle: 'issues', jsonSchema: { type: 'array', items: { type: 'string' } }, nullable: true },
          { handle: 'count', jsonSchema: { type: 'integer' }, nullable: false },
        ]
      : []),
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
          layout={output ? 'ports' : undefined}
          output={output}
          values={values}
          disabled={false}
          onChange={(next) => {
            setValues(next)
            log('Save grouped inputs', next)
          }}
        />
        <h3>Empty {output ? 'outputs' : 'inputs'}</h3>
        <PortDefinitionEditor
          groups
          layout="ports"
          title={output ? 'Outputs' : 'Inputs'}
          output={output}
          values={emptyValues}
          disabled={false}
          onChange={(next) => {
            setEmptyValues(next)
            log('Save empty sample ports', next)
          }}
        />
        <h3>Empty read-only {output ? 'outputs' : 'inputs'}</h3>
        <PortDefinitionEditor groups layout="ports" title={output ? 'Outputs' : 'Inputs'} output={output} values={[]} disabled onChange={() => {}} />
        <pre aria-label="Saved ports">{JSON.stringify(values, null, 2)}</pre>
      </div>
    </I18nProvider>
  )
}
export const groupedInputsStory: FrontendStory = {
  id: 'grouped-inputs',
  title: 'Grouped Inputs',
  group: 'Node Task',
  standalone: true,
  render: (log, dark, language) => <GroupedInputsStory log={log} dark={dark} language={language} />,
}

export const outputPortsStory: FrontendStory = {
  id: 'output-ports',
  title: 'Output Ports',
  group: 'Node Task',
  standalone: true,
  render: (log, dark, language) => <GroupedInputsStory log={log} dark={dark} language={language} output />,
}
