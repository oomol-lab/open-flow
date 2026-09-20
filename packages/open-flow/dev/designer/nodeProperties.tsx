import type { GraphNode, InputPort, RevisionContent } from '../../src/flow/common/change.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { NodeInspector } from '../../src/workbench/browser/runtime/editor/nodeInspector.tsx'
import { FixedDefinitionSample, propertyValues as values } from './fixedDefinitionSample.tsx'
import { InspectorSamplePanel } from './inspectorSamplePanel.tsx'
import { createInspectorSession } from './inspectorSession.ts'
import { useStoryActions } from './storyActions.tsx'

const field = (handle: string, type = 'string'): InputPort => ({ handle, jsonSchema: { type }, nullable: false })
const taskFields: readonly InputPort[] = [
  { handle: 'boundArray', nullable: true, jsonSchema: { type: 'array' } },
  ...values.slice(0, 6),
  ...values.slice(10),
  {
    handle: 'clearedObject',
    nullable: true,
    jsonSchema: { type: 'object', properties: { title: { type: 'string', default: 'Do not apply on creation' }, count: { type: 'number' } } },
  },
]
const taskInputValues = Object.fromEntries(
  taskFields.flatMap((port) => (port.value === undefined ? [] : [[port.handle, { kind: 'value' as const, value: port.value }]])),
)
const taskInputDefinitions = taskFields.map(({ value: _value, ...definition }) => definition)

type Fixture = { id: string; group: string; node: GraphNode; content?: Partial<RevisionContent['document']> }
const fixtures: readonly Fixture[] = [
  { id: 'execution-limit', group: 'Fixed Values', node: { kind: 'value', name: 'Loop step', inputs: {}, values: [], maxExecutions: 1000 } },
  { id: 'value', group: 'Fixed Values', node: { kind: 'value', name: 'Fixed values', inputs: {}, values } },
  {
    id: 'task',
    group: 'Task',
    content: { bindings: { arrayVariable: { kind: 'variable', target: 'API_TOKEN' } } },
    node: {
      kind: 'task',
      name: 'Prepare report',
      description: 'Transform the request into a release report.',
      inputs: {
        ...taskInputValues,
        clearedObject: { kind: 'unset' },
        boundArray: { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'arrayVariable' }] },
      },
      task: {
        name: 'Prepare report',
        moduleId: 'module',
        inputs: [{ group: 'Content' }, ...taskInputDefinitions.slice(0, 6), { group: 'Structured data' }, ...taskInputDefinitions.slice(6)],
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
      cases: [
        {
          output: 'priority',
          groups: [{ expressions: [{ left: { kind: 'value' as const, value: 75 }, operator: '>=', right: { kind: 'value' as const, value: 90 } }] }],
        },
        {
          output: 'review',
          groups: [{ expressions: [{ left: { kind: 'value' as const, value: 75 }, operator: '>=', right: { kind: 'value' as const, value: 50 } }] }],
        },
      ],
      inputs: {},
      matchMode: 'first' as const,
    },
  },
  {
    id: 'wait',
    group: 'Wait',
    node: {
      kind: 'wait',
      name: 'Wait for review',
      maxExecutions: 25,
      inputs: { report: { kind: 'value', value: 'Release notes are ready for review.' } },
      inputDefinitions: [field('report')],
      prompt: 'Continue after reviewing the release notes.',
    },
  },
  {
    id: 'approval',
    group: 'Approval',
    node: {
      kind: 'approval',
      name: 'Approve release',
      maxExecutions: 25,
      inputs: { report: { kind: 'value', value: 'Release notes are ready for review.' }, release: { kind: 'value', value: 42 } },
      inputDefinitions: [field('report'), { handle: 'release', jsonSchema: { type: 'number' }, nullable: false }],
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
    modelVersion: currentFlowModelVersion,
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
  mount,
}: {
  fixture: Fixture
  dark: boolean
  language: UiLanguage
  log: LogAction
  disabled: boolean
  reload: number
  mount: number
}) {
  const [session, setSession] = useState<ReturnType<typeof createInspectorSession>>()
  const logRef = useRef(log)
  logRef.current = log
  useEffect(() => {
    const next = createInspectorSession(language, (name, value) => logRef.current(name, value), contentFor(fixture))
    setSession(next)
    void next.start().then(() => next.store.selectNodes(['sample']))
    return () => next.dispose()
  }, [fixture, language])
  useEffect(() => {
    if (reload > 0) void session?.start().then(() => session.store.selectNodes(['sample']))
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
            key={mount}
            variables={{ enabled: true, names: ['API_TOKEN', 'TEAM_NAME'], loaded: true, loading: false, onOpen: () => {} }}
            connectorAuthorizationPending={false}
            connectorLoading={false}
            connectors={session.connectors}
            disabled={disabled}
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
  const [mount, setMount] = useState(0)
  useStoryActions([
    { label: 'Reset samples', onClick: () => reset((value) => value + 1) },
    { label: 'Reopen panels', onClick: () => setMount((value) => value + 1) },
    { label: 'Reload saved data', onClick: () => setReload((value) => value + 1) },
  ])
  return (
    <div className="node-properties-gallery open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'}>
      {[true, false].map((disabled) => (
        <PropertySample
          key={`${generation}-${disabled}`}
          fixture={fixture}
          dark={dark}
          language={language}
          log={log}
          disabled={disabled}
          reload={reload}
          mount={mount}
        />
      ))}
      <FixedDefinitionSample key={generation} dark={dark} language={language} log={log} />
    </div>
  )
}

export const nodePropertiesStories: readonly FrontendStory[] = fixtures.map((fixture) => ({
  group: `Node ${fixture.group}`,
  id: `node-${fixture.id}-properties`,
  title: fixture.id == 'execution-limit' ? 'Execution limit' : 'Properties',
  standalone: true,
  description:
    fixture.id == 'execution-limit'
      ? 'Per-run node execution limits. Change the limit, test invalid values, or clear it to restore the default of 1000; reload verifies persistence.'
      : fixture.id === 'value'
        ? 'Editable and read-only properties, including typed dates, calendar selection, and time editing with timezone preservation. Use Sort to reorder fields and nested object properties; Done sorting restores disclosure arrows. Samples save independently.'
        : 'Editable, read-only and fixed-type value panels. Inspector samples save independently; reload verifies saved values.',
  render: (log, dark, language) => <PropertiesStory fixture={fixture} dark={dark} language={language} log={log} />,
}))
