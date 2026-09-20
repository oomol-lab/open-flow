import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { Group, InputPort, JsonValue } from '../../src/workbench/browser/runtime/api.ts'
import type { NodeInputField } from '../../src/workbench/browser/runtime/editor/nodeInputs.tsx'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { NodeInputs } from '../../src/workbench/browser/runtime/editor/nodeInputs.tsx'
import { PortDefinitionEditor } from '../../src/workbench/browser/runtime/editor/portDefinitionEditor.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { useStoryActions } from './storyActions.tsx'

function ValueStory({ dark, language, log, reservedNames }: { dark: boolean; language: UiLanguage; log: LogAction; reservedNames?: readonly string[] }) {
  const [values, setValues] = useState<readonly InputPort[]>([
    { handle: 'emptyText', description: 'A short display label for this record.', jsonSchema: { type: 'string' }, nullable: false, value: '' },
    {
      handle: 'emptyMultiline',
      description:
        'Summarize the request and explain the expected result.\nKeep issue identifiers, relevant context, and any constraints that the next step needs. Include enough detail for someone unfamiliar with the original request to continue the work.',
      jsonSchema: { 'type': 'string', 'ui:widget': 'text' },
      nullable: false,
      value: '',
    },
    { handle: 'number', jsonSchema: { type: 'number' }, nullable: false, value: 1.5 },
    { handle: 'integer', jsonSchema: { type: 'integer' }, nullable: false, value: 3 },
    { handle: 'select', jsonSchema: { enum: ['small', 'large'] }, nullable: false, value: 'small' },
    { handle: 'multiSelect', jsonSchema: { type: 'array', uniqueItems: true, items: { enum: ['red', 'blue'] } }, nullable: false, value: ['red'] },
    { handle: 'boolean', jsonSchema: { type: 'boolean' }, nullable: false, value: false },
    { handle: 'booleanTrue', jsonSchema: { type: 'boolean' }, nullable: false, value: true },
    { handle: 'booleanUnset', jsonSchema: { type: 'boolean' }, nullable: false },
    { handle: 'booleanNull', jsonSchema: { type: 'boolean' }, nullable: true, value: null },
    { handle: 'date', jsonSchema: { type: 'string', format: 'date' }, nullable: false, value: '2026-09-15' },
    { handle: 'time', jsonSchema: { type: 'string', format: 'time' }, nullable: false, value: '10:30:00+08:00' },
    { handle: 'dateTime', jsonSchema: { type: 'string', format: 'date-time' }, nullable: false, value: '2026-09-15T10:30:00+08:00' },
    { handle: 'color', jsonSchema: { 'type': 'string', 'ui:widget': 'color' }, nullable: false, value: '#7d7fe9' },
    { handle: 'array', jsonSchema: { type: 'array', items: { type: 'string' } }, nullable: false, value: ['first', 'second', 'third'] },
    { handle: 'emptyArray', jsonSchema: { type: 'array', items: {} }, nullable: false, value: [] },
    {
      handle: 'objectArray',
      jsonSchema: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } } } },
      nullable: false,
      value: [
        { name: 'Ada', tags: ['one', 'two'] },
        { name: 'Lin', tags: [] },
      ],
    },
    { handle: 'null', jsonSchema: { type: 'null' }, nullable: true, value: null },
    { handle: 'unsetText', jsonSchema: { type: 'string' }, nullable: false },
    { handle: 'jsonEmpty', jsonSchema: {}, nullable: false },
    { handle: 'jsonObject', jsonSchema: {}, nullable: true, value: { enabled: true, tags: ['sample'], count: 2 } },
    { handle: 'jsonNull', jsonSchema: {}, nullable: true, value: null },
    {
      handle: 'value',
      description: 'Structured values passed to the next step.',
      jsonSchema: {
        type: 'object',
        properties: {
          details: { type: 'object', properties: { count: { type: 'number', description: 'Number of records to process.' } } },
          count: { type: 'number' },
        },
      },
      nullable: true,
      value: { details: { count: 1 }, count: 1 },
    },
  ])
  const [disabled, setDisabled] = useState(false)
  const [wrapped, setWrapped] = useState(false)
  useStoryActions([
    { label: disabled ? 'Enable editing' : 'Read only', onClick: () => setDisabled(!disabled) },
    { label: wrapped ? 'Single-line layout' : 'Wrapped layout', onClick: () => setWrapped(!wrapped) },
  ])
  const i18n = useMemo(() => createI18n(language), [language])
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'} style={{ height: '100%', overflow: 'auto', padding: 24 }}>
        <div style={{ maxWidth: wrapped ? 340 : 520 }}>
          <PortDefinitionEditor
            layout="values"
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
  description:
    'All 15 field types, nested fields, and arrays. Hover field names to compare side descriptions, multiline descriptions, and name fallbacks above. Expand collections to inspect nested fields.',
  group: 'Node Fixed Values',
  propertyPanel: true,
  standalone: true,
  render: (log, dark, language) => <ValueStory log={log} dark={dark} language={language} />,
}

export const additionalInputsStory: FrontendStory = {
  id: 'additional-inputs',
  title: 'Additional Inputs',
  group: 'Node Task',
  propertyPanel: true,
  standalone: true,
  render: (log, dark, language) => <ValueStory log={log} dark={dark} language={language} reservedNames={['value1', 'message']} />,
}

function GroupedInputsStory({ dark, language, log, output = false }: { dark: boolean; language: UiLanguage; log: LogAction; output?: boolean }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [emptyValues, setEmptyValues] = useState<readonly (InputPort | Group)[]>([])
  const [singleValue, setSingleValue] = useState<readonly (InputPort | Group)[]>([
    { group: 'Request' },
    { handle: 'message', jsonSchema: { type: 'string' }, nullable: false },
  ])
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
        <h3>Single field {output ? 'output' : 'input'}</h3>
        <PortDefinitionEditor
          groups
          layout="ports"
          title={output ? 'Outputs' : 'Inputs'}
          titleIcon={output ? 'output' : 'input'}
          output={output}
          disabled={false}
          values={singleValue}
          onChange={setSingleValue}
        />
        <h3>Empty {output ? 'outputs' : 'inputs'}</h3>
        <PortDefinitionEditor
          groups
          layout="ports"
          title={output ? 'Outputs' : 'Inputs'}
          titleIcon={output ? 'output' : 'input'}
          output={output}
          values={emptyValues}
          disabled={false}
          onChange={(next) => {
            setEmptyValues(next)
            log('Save empty sample ports', next)
          }}
        />
        <h3>Empty read-only {output ? 'outputs' : 'inputs'}</h3>
        <PortDefinitionEditor
          groups
          layout="ports"
          title={output ? 'Outputs' : 'Inputs'}
          titleIcon={output ? 'output' : 'input'}
          output={output}
          values={[]}
          disabled
          onChange={() => {}}
        />
        <pre aria-label="Saved ports">{JSON.stringify(values, null, 2)}</pre>
      </div>
    </I18nProvider>
  )
}
export const groupedInputsStory: FrontendStory = {
  id: 'grouped-inputs',
  title: 'Grouped Inputs',
  group: 'Node Task',
  propertyPanel: true,
  standalone: true,
  render: (log, dark, language) => <GroupedInputsStory log={log} dark={dark} language={language} />,
}

export const outputPortsStory: FrontendStory = {
  id: 'output-ports',
  title: 'Output Ports',
  group: 'Node Task',
  propertyPanel: true,
  standalone: true,
  render: (log, dark, language) => <GroupedInputsStory log={log} dark={dark} language={language} output />,
}

function LazyFieldsStory({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [generation, setGeneration] = useState(0)
  useStoryActions([{ label: 'Reset samples', onClick: () => setGeneration((value) => value + 1) }])
  return (
    <I18nProvider i18n={i18n}>
      <div
        className="open-flow-workbench open-flow-theme"
        data-theme={dark ? 'dark' : 'light'}
        style={{ display: 'flex', flexWrap: 'wrap', alignContent: 'start', gap: 16, padding: 16, overflow: 'auto', height: '100%' }}
      >
        {['A', 'B'].map((sample) => (
          <LazyFieldsSample key={`${generation}:${sample}`} sample={sample} log={log} />
        ))}
        <FlatInputsSample key={`flat:${generation}`} log={log} />
      </div>
    </I18nProvider>
  )
}

function FlatInputsSample({ log }: { log: LogAction }) {
  const [values, setValues] = useState<Readonly<Record<string, JsonValue | undefined>>>({
    nullableArray: null,
    nullableObject: null,
    unconstrainedObject: { model: 'deepseek-v4-flash' },
    fixedEmptyObject: {},
  })
  const handles = [
    'nullableArray',
    'nullableObject',
    'unconstrainedObject',
    'fixedEmptyObject',
    'receiveId',
    'receiveIdType',
    'contentKind',
    'text',
    'markdown',
    'imageKey',
    'imageUrl',
    'fileKey',
    'fileUrl',
    'fileName',
    'fileType',
    'videoCoverKey',
    'videoCoverUrl',
    'rawMsgType',
    'rawContent',
    'idempotency',
  ]
  return (
    <section aria-label="Flat inputs" style={{ width: 520, flexShrink: 0 }}>
      <h3>Flat inputs</h3>
      <NodeInputs
        title="Inputs"
        disabled={false}
        variables={{ enabled: false, names: [], loaded: true, loading: false, onOpen: () => {} }}
        entries={handles.map(
          (handle): NodeInputField => ({
            definition: {
              handle,
              nullable: !['receiveId', 'contentKind', 'fixedEmptyObject'].includes(handle),
              jsonSchema:
                handle === 'nullableArray'
                  ? { type: 'array', items: { type: 'object' } }
                  : handle === 'nullableObject'
                    ? { type: 'object' }
                    : handle === 'unconstrainedObject'
                      ? { type: 'object' }
                      : handle === 'fixedEmptyObject'
                        ? { type: 'object', additionalProperties: false }
                        : handle === 'rawContent'
                          ? {}
                          : ['receiveIdType', 'contentKind', 'fileType'].includes(handle)
                            ? { type: 'string', enum: ['text', 'image', 'file'] }
                            : { type: 'string' },
            },
            value: Object.hasOwn(values, handle)
              ? values[handle]
              : ['receiveId', 'contentKind', 'receiveIdType', 'fileType', 'rawContent'].includes(handle)
                ? undefined
                : null,
            connected: false,
          }),
        )}
        onValue={(handle, value) => {
          setValues((previous) => ({ ...previous, [handle]: value }))
          log('Save flat input', { handle, value })
        }}
        onVariable={() => {}}
      />
    </section>
  )
}

function LazyFieldsSample({ sample, log }: { sample: string; log: LogAction }) {
  const [values, setValues] = useState<readonly InputPort[]>((): readonly InputPort[] => [
    { nullable: false, handle: 'text', jsonSchema: { type: 'string' }, value: `Sample ${sample}` },
    {
      nullable: false,
      handle: 'object',
      jsonSchema: { type: 'object', properties: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`field${index}`, { type: 'string' }])) },
      value: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`field${index}`, `${sample}-${index}`])),
    },
    {
      nullable: false,
      handle: 'array',
      jsonSchema: { type: 'array', items: { type: 'string' } },
      value: Array.from({ length: 40 }, (_, index) => `${sample}-${index}`),
    },
    { nullable: false, handle: 'json', jsonSchema: {}, value: { sample, enabled: true } },
    { nullable: false, handle: 'multiline', jsonSchema: { 'type': 'string', 'ui:widget': 'text' }, value: `Sample ${sample}\nSecond line` },
    { nullable: false, handle: 'unsetObject', jsonSchema: { type: 'object', properties: { name: { type: 'string' } } } },
  ])
  return (
    <section aria-label={`Sample ${sample}`} style={{ width: 520, flexShrink: 0 }}>
      <h3>Sample {sample}</h3>
      <PortDefinitionEditor
        disabled={false}
        layout="values"
        values={values}
        onChange={(next) => {
          setValues(next)
          log(`Save ${sample}`, next)
        }}
      />
    </section>
  )
}

export const lazyFieldsStory: FrontendStory = {
  id: 'lazy-fields',
  title: 'Collapsed Fields',
  description: 'Compare 40-entry collections with flat connector inputs. Expand to edit; reset to inspect initial mounting.',
  group: 'Node Fixed Values',
  propertyPanel: true,
  standalone: true,
  render: (log, dark, language) => <LazyFieldsStory log={log} dark={dark} language={language} />,
}
