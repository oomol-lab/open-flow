import type { NodeSource, RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { InputMapping, InputPort, JsonValue } from '../../src/workbench/browser/runtime/api.ts'
import type { NodeInputField } from '../../src/workbench/browser/runtime/editor/nodeInputs.tsx'
import type { InputVariables } from '../../src/workbench/browser/runtime/editor/sourceValueEditor.tsx'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { currentFlowModelVersion } from '../../src/flow/common/change.ts'
import { checkInputSource, inputSourceCandidates } from '../../src/flow/common/graph.ts'
import { NodeInputs } from '../../src/workbench/browser/runtime/editor/nodeInputs.tsx'
import { NodeInputValue } from '../../src/workbench/browser/runtime/editor/nodeInputValue.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { providerIcon } from '../../src/workbench/browser/runtime/providerIcon.ts'
function AddonSample({
  schema,
  initial,
  variables,
  fixed,
  schemaEditable,
  initialVariableName,
}: {
  schema: JsonValue
  initial: JsonValue | undefined
  variables: InputVariables
  fixed?: boolean
  schemaEditable?: boolean
  initialVariableName?: string
}) {
  const [definition, setDefinition] = useState(schema)
  const [value, setValue] = useState(initial)
  const [variableName, setVariableName] = useState<string | undefined>(initialVariableName)
  return (
    <NodeInputValue
      embedded
      fixed={fixed}
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
        ...(schemaEditable
          ? {
              onDefinitionChange: (next: unknown, nextValue: unknown) => {
                setDefinition(next as JsonValue)
                setValue(nextValue as JsonValue | undefined)
              },
            }
          : {}),
      }}
    />
  )
}
function ObjectSourceSample({ variables }: { variables: InputVariables }) {
  const [selected, setSelected] = useState<NodeSource>({ kind: 'node', nodeId: 'data', output: 'payload', field: 'name' })
  const content: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      tasks: {},
      subflows: {},
      graph: {
        edges: [{ source: 'data', target: 'sink' }],
        nodes: {
          data: {
            kind: 'value',
            name: 'Customer',
            inputs: {},
            values: [
              {
                handle: 'payload',
                nullable: false,
                value: { name: 'Ada', count: 2 },
                jsonSchema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    'name': { type: 'string', description: 'Customer name used in messages and reports.' },
                    'count': { type: 'number' },
                    'profile': { type: 'object', description: 'Structured customer profile returned by the upstream step.' },
                    'display.name': { type: 'string', description: 'Preferred display name, including punctuation and spacing.' },
                    '': { type: 'string' },
                  },
                },
              },
            ],
          },
          sink: {
            kind: 'wait',
            name: 'Wait',
            prompt: 'Continue?',
            inputs: {},
            inputDefinitions: [{ handle: 'customer', jsonSchema: { type: 'string' }, nullable: true }],
          },
        },
      },
    },
  }
  const { document } = content
  const outputs = inputSourceCandidates(document, document.graph, 'sink', 'customer').data ?? []
  return (
    <div className="editor-context-panel" style={{ width: 320, maxWidth: '100%' }}>
      <NodeInputValue
        definition={{ handle: 'customer', jsonSchema: { type: 'string' }, nullable: true }}
        value={undefined}
        connected
        variables={variables}
        disabled={false}
        onValue={() => {}}
        onVariable={() => {}}
        upstream={{
          current: [{ ...selected, nodeName: 'Customer', check: checkInputSource(document, document.graph, 'sink', 'customer', selected) }],
          groups: [{ nodeId: 'data', nodeName: 'Customer', outputs }],
          onChange: (source) => setSelected({ kind: 'node', ...source }),
        }}
      />
      <output aria-label="Saved object source">{JSON.stringify(selected)}</output>
      <h3>Adjacent section</h3>
      <NodeInputValue
        definition={{ handle: 'note', jsonSchema: { type: 'string' }, nullable: true }}
        value="Follow-up"
        connected={false}
        variables={variables}
        disabled={false}
        onValue={() => {}}
        onVariable={() => {}}
      />
    </div>
  )
}

function EditableDefinitionSample({ variables }: { variables: InputVariables }) {
  const [definition, setDefinition] = useState<InputPort>({ handle: 'value', jsonSchema: {}, nullable: true, value: false })
  const [value, setValue] = useState<JsonValue | undefined>(null)
  const entry: NodeInputField = { definition, value, connected: false, onReset: () => setValue(definition.value) }
  return (
    <NodeInputs
      entries={[entry]}
      variables={variables}
      disabled={false}
      onDefinitions={(definitions) => {
        const next = definitions.find((item): item is InputPort => 'handle' in item)
        if (next != null) setDefinition(next)
      }}
      onValue={(_handle, next) => setValue(next)}
      onVariable={() => {}}
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
        <h3>Editable definition · no inherited reset</h3>
        <EditableDefinitionSample variables={variables} />
        <output aria-label="Saved input">{JSON.stringify({ mapping, variableName })}</output>
        <h3>Object fields</h3>
        <ObjectSourceSample variables={variables} />
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
        <h3>Any data types</h3>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <div>
            <h4>Source + value + data type</h4>
            <AddonSample schema={{}} initial="hello" variables={variables} />
          </div>
          <div>
            <h4>Data type + value</h4>
            <AddonSample fixed schema={{}} initial={42} variables={variables} />
          </div>
          <div>
            <h4>Editable Schema type + JSON</h4>
            <AddonSample schemaEditable schema={{}} initial={{ answer: 42 }} variables={variables} />
          </div>
          <div>
            <h4>Variable binding</h4>
            <AddonSample schema={{}} initial={undefined} initialVariableName="API_TOKEN" variables={variables} />
          </div>
          <div>
            <h4>Upstream binding</h4>
            <NodeInputValue
              embedded
              definition={{ handle: 'sample', jsonSchema: {}, nullable: false }}
              value={undefined}
              connected
              upstream={providerSource}
              variables={variables}
              disabled={false}
              onValue={() => {}}
              onVariable={() => {}}
            />
          </div>
        </div>
        <h3>Value addons · editor types</h3>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {(
            [
              { label: 'Boolean', schema: { type: 'boolean' }, value: false },
              { label: 'Select', schema: { type: 'string', enum: ['one', 'two'] }, value: 'one' },
              { label: 'Multi-select', schema: { type: 'array', uniqueItems: true, items: { enum: ['one', 'two'] } }, value: ['one'] },
              { label: 'JSON', schema: {}, value: { answer: 42 } },
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
  propertyPanel: true,
  title: 'Node Input',
  description:
    'Literal, variable and upstream sources, including fixed-schema Any fields with source + value + data type, source-free data type + value, and bound values without a data-type control. Editable definitions omit Reset; editable Any Schema types retain the generic JSON editor. Also covers whole objects, first-level fields, missing references and type mismatches.',
  standalone: true,
  render: (log, dark, language) => <NodeInputStory dark={dark} language={language} log={log} />,
}
