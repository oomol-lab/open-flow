import type { GraphNode, InputPort, RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { NodeInspector } from '../../src/workbench/browser/runtime/editor/nodeInspector.tsx'
import { InspectorSamplePanel } from './inspectorSamplePanel.tsx'
import { createInspectorSession } from './inspectorSession.ts'
import { useStoryActions } from './storyActions.tsx'

const field = (handle: string, type = 'string'): InputPort => ({ handle, jsonSchema: { type }, nullable: false })
const values: readonly InputPort[] = [
  { ...field('message'), value: 'Review the release notes' },
  { ...field('instructions'), jsonSchema: { 'type': 'string', 'ui:widget': 'text' }, value: 'Keep the summary concise.\nInclude the next steps.' },
  { ...field('count', 'integer'), value: 3 },
  { ...field('enabled', 'boolean'), value: false },
  { ...field('priority'), jsonSchema: { enum: ['low', 'normal', 'high'] }, value: 'normal' },
  { ...field('channels', 'array'), jsonSchema: { type: 'array', uniqueItems: true, items: { enum: ['email', 'sms'] } }, value: ['email'] },
  { ...field('color'), jsonSchema: { 'type': 'string', 'ui:widget': 'color', 'ui:options': { colorType: 'HEX8' } }, value: '#7C73E6FF' },
  { ...field('date'), jsonSchema: { type: 'string', format: 'date' }, value: '2026-09-14' },
  { ...field('time'), jsonSchema: { type: 'string', format: 'time' }, value: '09:30:00' },
  { ...field('timestamp'), jsonSchema: { type: 'string', format: 'date-time' }, value: '2026-09-14T09:30:00+08:00' },
  {
    ...field('payload', 'object'),
    jsonSchema: { type: 'object', properties: { name: { type: 'string' }, active: { type: 'boolean' } } },
    value: { name: 'Ada', active: true },
  },
  { ...field('tags', 'array'), jsonSchema: { type: 'array', items: { type: 'string' } }, value: ['design', 'review'] },
  { ...field('choice'), jsonSchema: { 'oneOf': [{ type: 'string' }, { type: 'number' }], 'ui:options': { labels: ['Text', 'Number'] } }, value: 'hello' },
  { ...field('note'), nullable: true, value: null },
  field('unset'),
]

type Fixture = { id: string; group: string; node: GraphNode; content?: Partial<RevisionContent['document']> }
const fixtures: readonly Fixture[] = [
  { id: 'value', group: 'Fixed Values', node: { kind: 'value', name: 'Fixed values', inputs: {}, values } },
  {
    id: 'task',
    group: 'Task',
    node: {
      kind: 'task',
      name: 'Prepare report',
      description: 'Transform the request into a release report.',
      inputs: {},
      task: {
        name: 'Prepare report',
        moduleId: 'module',
        inputs: [{ group: 'Content' }, ...values.slice(0, 6), { group: 'Structured data' }, ...values.slice(10)],
        outputs: [field('report'), field('count', 'integer')],
      },
    },
  },
  {
    id: 'condition',
    group: 'Condition',
    node: {
      kind: 'condition',
      name: 'Review priority',
      inputs: { score: { kind: 'value', value: 75 } },
      input: field('score', 'number'),
      cases: [
        { output: 'priority', relation: 'all', expressions: [{ input: 'score', operator: '>=', value: 90 }] },
        { output: 'review', relation: 'any', expressions: [{ input: 'score', operator: '>=', value: 50 }] },
      ],
      defaultOutput: 'fallback',
    },
  },
  {
    id: 'wait',
    group: 'Wait',
    node: {
      kind: 'wait',
      name: 'Approve release',
      inputs: { report: { kind: 'value', value: 'Release notes are ready for review.' } },
      input: field('report'),
      actions: ['approve', 'reject'],
      prompt: 'Review the release notes before publishing.',
    },
  },
  {
    id: 'subflow',
    group: 'Subflow',
    node: { kind: 'subflow', name: 'Format report', subflowId: 'format', inputs: { message: { kind: 'value', value: 'Release summary' } } },
    content: {
      subflows: {
        format: {
          name: 'Report formatter',
          inputs: [field('message')],
          outputs: [{ ...field('result'), sources: [{ kind: 'flow', input: 'message' }] }],
          graph: { nodes: {}, edges: [] },
        },
      },
    },
  },
  {
    id: 'agent',
    group: 'Agent',
    node: {
      kind: 'task',
      name: 'Review assistant',
      taskId: 'agent',
      inputs: { request: { kind: 'value', value: 'Review the release notes for missing details.' } },
    },
    content: {
      tasks: {
        agent: {
          name: 'Review assistant',
          inputs: [field('request')],
          outputs: [field('result')],
          executor: {
            kind: 'agent',
            model: 'example-model',
            prompt: { kind: 'input', input: 'request' },
            system: 'Check facts and keep the response concise.',
            maxRounds: 8,
            tools: [],
          },
        },
      },
    },
  },
  {
    id: 'llm',
    group: 'LLM',
    node: {
      kind: 'task',
      name: 'Summarize report',
      taskId: 'llm',
      inputs: {
        messages: { kind: 'value', value: [{ role: 'user', content: 'Summarize the release notes.' }] },
        model: { kind: 'value', value: { model: 'example-model', temperature: 0.7 } },
      },
    },
    content: {
      tasks: {
        llm: {
          name: 'Summarize report',
          executor: { kind: 'llm', mode: 'chat' },
          inputs: [
            { ...field('messages', 'array'), jsonSchema: { 'type': 'array', 'ui:widget': 'llm/messages', 'minItems': 1 } },
            { ...field('model', 'object'), jsonSchema: { 'type': 'object', 'ui:widget': 'llm/model' } },
          ],
          outputs: [field('content')],
        },
      },
    },
  },
]

function contentFor(fixture: Fixture): RevisionContent {
  return {
    modelVersion: 1,
    modules: { module: { name: 'Prepare report', imports: [], source: 'export default (inputs) => ({ report: inputs.message, count: inputs.count })' } },
    document: { bindings: {}, tasks: {}, subflows: {}, ...fixture.content, graph: { nodes: { sample: fixture.node }, edges: [] } },
  }
}

function PropertySample({
  fixture,
  dark,
  language,
  log,
  disabled,
  reload,
}: {
  fixture: Fixture
  dark: boolean
  language: UiLanguage
  log: LogAction
  disabled: boolean
  reload: number
}) {
  const [session, setSession] = useState<ReturnType<typeof createInspectorSession>>()
  const logRef = useRef(log)
  logRef.current = log
  useEffect(() => {
    const next = createInspectorSession(language, (name, value) => logRef.current(name, value), contentFor(fixture))
    setSession(next)
    void next.start()
    return () => next.dispose()
  }, [fixture, language])
  useEffect(() => {
    if (reload > 0) void session?.start()
  }, [reload, session])
  const revision = useVal(session?.store.$.revision)
  const selection = revision?.selection({ kind: 'flow' }, 'sample')
  if (!session || !revision) return null
  return (
    <I18nProvider i18n={session.i18n}>
      <section className="node-properties-case" aria-label={disabled ? 'Read only' : 'Editable'}>
        <h3>{disabled ? 'Read only' : 'Editable'}</h3>
        <InspectorSamplePanel disabled={disabled} revision={revision} selection={selection} store={session.store} theme={dark ? 'dark' : 'light'}>
          <NodeInspector
            variables={{ enabled: false, names: [], loaded: true, loading: false, onOpen: () => {} }}
            connectorAuthorizationPending={false}
            connectorLoading={false}
            connectors={session.connectors}
            diagnostics={[]}
            disabled={disabled}
            onChooseWaitNotification={() => log('Choose notification')}
            revision={revision}
            selection={selection}
            store={session.store}
            theme={dark ? 'dark' : 'light'}
            target={{ kind: 'flow' }}
            triggerAuthorizationPending={false}
            triggerConnectionLoading={false}
            triggers={session.triggers}
          />
        </InspectorSamplePanel>
      </section>
    </I18nProvider>
  )
}

function PropertiesStory({ fixture, dark, language, log }: { fixture: Fixture; dark: boolean; language: UiLanguage; log: LogAction }) {
  const [generation, reset] = useState(0)
  const [reload, setReload] = useState(0)
  useStoryActions([
    { label: 'Reset samples', onClick: () => reset((value) => value + 1) },
    { label: 'Reload saved data', onClick: () => setReload((value) => value + 1) },
  ])
  return (
    <div className="node-properties-gallery open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'}>
      {[true, false].map((disabled) => (
        <PropertySample key={`${generation}-${disabled}`} fixture={fixture} dark={dark} language={language} log={log} disabled={disabled} reload={reload} />
      ))}
    </div>
  )
}

export const nodePropertiesStories: readonly FrontendStory[] = fixtures.map((fixture) => ({
  group: `Node ${fixture.group}`,
  id: `node-${fixture.id}-properties`,
  title: 'Properties',
  standalone: true,
  description:
    fixture.id === 'value'
      ? 'Editable and read-only properties, including typed dates, calendar selection, and time editing with timezone preservation. Samples save independently.'
      : 'Production properties panels at sidebar width. Edit and read-only samples save independently; reload verifies saved values.',
  render: (log, dark, language) => <PropertiesStory fixture={fixture} dark={dark} language={language} log={log} />,
}))
