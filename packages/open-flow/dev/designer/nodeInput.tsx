import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { InputMapping, JsonValue } from '../../src/workbench/browser/runtime/api.ts'
import type { InputVariables } from '../../src/workbench/browser/runtime/editor/nodeInputValue.tsx'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { NodeInputValue } from '../../src/workbench/browser/runtime/editor/nodeInputValue.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { providerIcon } from '../../src/workbench/browser/runtime/providerIcon.ts'
function AddonSample({ schema, initial, variables }: { schema: JsonValue; initial: JsonValue | undefined; variables: InputVariables }) {
  const [definition, setDefinition] = useState(schema)
  const [value, setValue] = useState(initial)
  const [variableName, setVariableName] = useState<string>()
  return (
    <NodeInputValue
      embedded
      definition={{ handle: 'sample', jsonSchema: definition, nullable: false }}
      value={value}
      connected={false}
      variableName={variableName}
      variables={variables}
      disabled={false}
      onValue={setValue}
      onVariable={setVariableName}
      presentation={{
        header: <span data-field-name>sample</span>,
        onDefinitionChange: (next, nextValue) => {
          setDefinition(next as JsonValue)
          setValue(nextValue as JsonValue | undefined)
        },
      }}
    />
  )
}
function NodeInputStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [mapping, setMapping] = useState<InputMapping | undefined>({ kind: 'value', value: 'hello' })
  const [variableName, setVariableName] = useState<string>()
  const variables = { enabled: true, names: ['API_TOKEN', 'TEAM_NAME'], loaded: true, loading: false, onOpen: () => log('Refresh names') }
  const definition = { handle: 'value', jsonSchema: { type: 'string' }, nullable: true, value: 'default' }
  const providerSource = {
    current: [
      {
        description:
          'The issue title exactly as returned by GitHub. This can be a long description that explains the output in enough detail to verify the tooltip layout.',
        icon: providerIcon({ icon: ':simple-icons:github:', serviceId: 'github', serviceName: 'GitHub' }, {}),
        nodeId: 'github',
        nodeName: 'GitHub issue',
        output: 'title',
        check: { kind: 'available' as const },
      },
    ],
    groups: [
      {
        icon: providerIcon({ icon: ':simple-icons:github:', serviceId: 'github', serviceName: 'GitHub' }, {}),
        nodeId: 'github',
        nodeName: 'GitHub issue',
        outputs: [{ output: 'title', check: { kind: 'available' as const } }],
      },
    ],
    onChange: () => log('Select upstream source'),
  }
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ padding: 24, width: 900, maxWidth: '100%' }}>
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
        <h3>Invalid sources</h3>
        <div className="editor-context-panel grid grid-cols-3 gap-4">
          <NodeInputValue
            definition={{ ...definition, handle: 'missingNode' }}
            value={undefined}
            connected
            upstream={{
              current: [
                {
                  nodeId: 'deleted-node',
                  output: 'result',
                  check: { kind: 'source-missing' as const },
                },
              ],
              groups: [],
              onChange: () => log('Replace missing upstream source'),
            }}
            variables={variables}
            disabled={false}
            onValue={() => {}}
            onVariable={() => {}}
          />
          <NodeInputValue
            definition={{ ...definition, handle: 'missingOutput' }}
            value={undefined}
            connected
            upstream={{
              ...providerSource,
              current: providerSource.current.map((source) =>
                Object.assign({}, source, { output: 'deleted-output', check: { kind: 'output-missing' as const } }),
              ),
            }}
            variables={variables}
            disabled={false}
            onValue={() => {}}
            onVariable={() => {}}
          />
          <NodeInputValue
            definition={{ ...definition, handle: 'invalidUpstream' }}
            value={undefined}
            connected
            upstream={{
              ...providerSource,
              current: providerSource.current.map((source) => Object.assign({}, source, { check: { kind: 'not-ready' as const } })),
            }}
            variables={variables}
            disabled={false}
            onValue={() => {}}
            onVariable={() => {}}
          />
          <NodeInputValue
            definition={{ handle: 'typeMismatch', jsonSchema: { type: 'number' }, nullable: false }}
            value={undefined}
            connected
            upstream={{
              ...providerSource,
              current: providerSource.current.map((source) =>
                Object.assign({}, source, {
                  output: 'result',
                  check: {
                    kind: 'schema' as const,
                    mismatch: { kind: 'keyword' as const, keyword: 'type' as const, path: [], source: 'string', target: 'number' },
                  },
                }),
              ),
            }}
            variables={variables}
            disabled={false}
            onValue={() => {}}
            onVariable={() => {}}
          />
          <NodeInputValue
            definition={{ ...definition, handle: 'missingVariable' }}
            value={undefined}
            connected={false}
            variableName="MISSING"
            variables={variables}
            disabled
            onValue={() => {}}
            onVariable={() => {}}
          />
        </div>
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
        <h3>Value addons · editor types</h3>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {(
            [
              { label: 'Boolean', schema: { type: 'boolean' }, value: false },
              { label: 'Select', schema: { type: 'string', enum: ['one', 'two'] }, value: 'one' },
              { label: 'Multi-select', schema: { type: 'array', uniqueItems: true, items: { enum: ['one', 'two'] } }, value: ['one'] },
              { label: 'JSON', schema: { 'ui:widget': 'any' }, value: { answer: 42 } },
              { label: 'Date', schema: { type: 'string', format: 'date' }, value: '2026-09-15' },
              { label: 'Color', schema: { 'type': 'string', 'ui:widget': 'color' }, value: '#ff6600' },
              { label: 'Object', schema: { type: 'object', properties: { name: { type: 'string' } } }, value: { name: 'sample' } },
              { label: 'Array', schema: { type: 'array', items: { type: 'string' } }, value: ['one'] },
              { label: 'Multiline', schema: { 'type': 'string', 'ui:widget': 'text' }, value: 'Multiple lines' },
              { label: 'LLM model', schema: { 'type': 'object', 'ui:widget': 'llm/model' }, value: { model: 'sample-model' } },
              { label: 'LLM messages', schema: { 'type': 'array', 'ui:widget': 'llm/messages' }, value: [{ role: 'user', content: 'Hello' }] },
              { label: 'Empty messages', schema: { 'type': 'array', 'ui:widget': 'llm/messages' }, value: [] },
            ] as { label: string; schema: JsonValue; value: JsonValue }[]
          ).map(({ label, schema, value }) => (
            <div key={label} style={{ containerType: 'inline-size', containerName: 'value-fields' }}>
              <h4>{label}</h4>
              <AddonSample schema={schema} initial={value} variables={variables} />
            </div>
          ))}
        </div>
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
