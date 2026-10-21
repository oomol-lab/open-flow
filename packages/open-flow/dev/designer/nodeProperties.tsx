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
const providerInputs: readonly InputPort[] = [
  { ...field('cc'), nullable: true },
  field('to'),
  { ...field('replyTo'), nullable: true },
  field('subject'),
  field('body'),
  { ...field('bcc'), nullable: true },
  { ...field('priority'), nullable: true, value: 'normal', jsonSchema: { type: 'string', enum: ['low', 'normal', 'high'] } },
  { ...field('trackOpens', 'boolean'), nullable: true, value: false },
  { ...field('tags', 'array'), nullable: true, jsonSchema: { type: 'array', items: { type: 'string' } } },
  { ...field('metadata', 'object'), nullable: true, jsonSchema: { type: 'object', properties: { campaign: { type: 'string' } } } },
  { ...field('scheduledAt'), nullable: true },
]

type Fixture = {
  id: string
  group: string
  node: GraphNode
  content?: Partial<RevisionContent['document']>
  transport?: Parameters<typeof createInspectorSession>[3]
}
const fixtures: readonly Fixture[] = [
  {
    id: 'error-handling',
    group: 'Task',
    node: {
      kind: 'task',
      name: 'System error outputs',
      onError: 'error',
      task: { moduleId: 'module', name: 'Consumer', inputs: [{ handle: 'issue', jsonSchema: {}, nullable: true }], outputs: [field('error')] },
      inputs: { issue: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'upstream', output: 'error', system: true }] } },
    },
    content: {
      graph: {
        nodes: {
          upstream: {
            kind: 'task',
            name: 'Upstream task',
            onError: 'error',
            inputs: {},
            task: { moduleId: 'module', name: 'Source', inputs: [], outputs: [field('error')] },
          },
        },
        edges: [{ source: 'upstream', target: 'sample' }],
      },
    },
  },

  {
    id: 'retry-disabled',
    group: 'Task',
    node: { kind: 'task', name: 'Retry disabled', inputs: {}, task: { name: 'Task', inputs: [], outputs: [], executor: { kind: 'llm', mode: 'chat' } } },
  },
  {
    id: 'retry-enabled',
    group: 'Task',
    node: {
      kind: 'task',
      name: 'Retry enabled',
      inputs: {},
      retry: { maxRetries: 2, intervalMs: 2000 },
      onError: 'error',
      task: { name: 'Task', inputs: [], outputs: [], executor: { kind: 'llm', mode: 'chat' } },
    },
  },
  {
    id: 'provider-inputs',
    group: 'Task',
    transport: {
      providers: [{ service: 'mail', displayName: 'Mail', authTypes: ['no_auth'] }],
      actions: [
        {
          actionId: 'mail.send',
          authenticated: false,
          description: 'Send email with optional delivery settings.',
          inputs: Object.fromEntries(providerInputs.map(({ handle, ...definition }) => [handle, definition])),
          outputs: { messageId: { jsonSchema: { type: 'string' }, nullable: false } },
          inputSchema: {
            type: 'object',
            properties: Object.fromEntries(providerInputs.map(({ handle, jsonSchema }) => [handle, jsonSchema])),
            required: providerInputs.filter((input) => !input.nullable).map((input) => input.handle),
          },
          outputSchema: { type: 'object', properties: { messageId: { type: 'string' } }, required: ['messageId'] },
          name: 'Send email',
          serviceId: 'mail',
          serviceName: 'Mail',
        },
      ],
    },
    node: {
      kind: 'task',
      name: 'Send email',
      inputs: {
        to: { kind: 'value', value: 'ada@example.com' },
        subject: { kind: 'value', value: 'Release notes' },
        cc: { kind: 'value', value: 'team@example.com' },
      },
      task: {
        name: 'Send email',
        executor: { kind: 'connector', action: 'mail.send' },
        inputs: providerInputs,
        outputs: [field('messageId')],
      },
    },
  },
  {
    id: 'code-actions-loading',
    group: 'Task',
    node: { kind: 'task', name: 'Code with slow services', inputs: {}, task: { name: 'Code with slow services', moduleId: 'module', inputs: [], outputs: [] } },
    transport: {
      actionDelay: 4000,
      providers: ['example', 'other'].map((service) => ({ service, displayName: service, authTypes: ['no_auth'] })),
      actions: ['example', 'other'].map((serviceId) => ({
        actionId: `${serviceId}.echo`,
        serviceId,
        serviceName: serviceId,
        name: 'Echo',
        description: '',
        authenticated: false,
        inputs: {},
        outputs: {},
        inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { result: { type: 'string' } } },
      })),
    },
  },
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
    id: 'agent',
    group: 'Agent',
    node: {
      kind: 'task',
      name: 'Review assistant',
      task: {
        name: 'Review assistant',
        inputs: [field('request')],
        outputs: [field('result')],
        executor: {
          kind: 'agent',
          model: 'example-model',
          prompt: 'Check facts and keep the response concise.\n\n{{request}}',
          maxRounds: 8,
          tools: [],
        },
      },
      inputs: { request: { kind: 'value', value: 'Review the release notes for missing details.' } },
    },
    content: {},
  },
  {
    id: 'llm',
    group: 'LLM',
    node: {
      kind: 'task',
      name: 'Summarize report',
      task: {
        name: 'Summarize report',
        executor: { kind: 'llm', mode: 'chat' },
        inputs: [
          { ...field('messages', 'array'), jsonSchema: { 'type': 'array', 'ui:widget': 'llm/messages', 'minItems': 1 } },
          { ...field('model', 'object'), jsonSchema: { 'type': 'object', 'ui:widget': 'llm/model' } },
        ],
        outputs: [field('content')],
      },
      inputs: {
        messages: { kind: 'value', value: [{ role: 'user', content: 'Summarize the release notes.' }] },
        model: { kind: 'value', value: { model: 'example-model', temperature: 0.7 } },
      },
    },
    content: {},
  },
]

function contentFor(fixture: Fixture): RevisionContent {
  return {
    modelVersion: currentFlowModelVersion,
    modules: { module: { name: 'Prepare report', imports: [], source: 'export default (inputs) => ({ report: inputs.message, count: inputs.count })' } },
    document: {
      bindings: {},
      ...fixture.content,
      graph: { nodes: { ...fixture.content?.graph?.nodes, sample: fixture.node }, edges: fixture.content?.graph?.edges ?? [] },
    },
  }
}

function PropertySample({
  fixture,
  dark,
  language,
  log,
  disabled,
  showCodeIssue,
  reload,
  mount,
}: {
  fixture: Fixture
  dark: boolean
  language: UiLanguage
  log: LogAction
  disabled: boolean
  showCodeIssue: boolean
  reload: number
  mount: number
}) {
  const [session, setSession] = useState<ReturnType<typeof createInspectorSession>>()
  const logRef = useRef(log)
  logRef.current = log
  useEffect(() => {
    const next = createInspectorSession(language, (name, value) => logRef.current(name, value), contentFor(fixture), fixture.transport)
    setSession(next)
    void next.start().then(() => next.store.selectNodes(['sample']))
    return () => next.dispose()
  }, [fixture, language])
  useEffect(() => {
    if (reload > 0) void session?.start().then(() => session.store.selectNodes(['sample']))
  }, [reload, session])
  const revision = useVal(session?.store.$.revision)
  const action = useVal(session?.connectors.$.selectedAction)
  const selection = revision?.selection('sample')
  if (!session || !revision) return null
  return (
    <I18nProvider i18n={session.i18n}>
      <section className="node-properties-case" aria-label={disabled ? 'Read only' : 'Editable'}>
        <h3>{disabled ? 'Read only' : 'Editable'}</h3>
        <InspectorSamplePanel disabled={disabled} revision={revision} selection={selection} store={session.store} theme={dark ? 'dark' : 'light'}>
          <NodeInspector
            key={mount}
            connectorAction={action}
            activeConnectorConnections={[]}
            variables={{ enabled: true, names: ['API_TOKEN', 'TEAM_NAME'], loaded: true, loading: false, onOpen: () => {} }}
            connectorAuthorizationPending={false}
            connectorLoading={false}
            connectors={session.connectors}
            disabled={disabled}
            diagnostics={
              showCodeIssue && fixture.id == 'task'
                ? [
                    {
                      code: 'module.syntax',
                      column: 1,
                      line: 2,
                      message: 'CodeModule "module" contains invalid JavaScript syntax.',
                      path: '/modules/module/source',
                      values: { moduleId: 'module' },
                    },
                  ]
                : undefined
            }
            revision={revision}
            selection={selection}
            store={session.store}
            theme={dark ? 'dark' : 'light'}

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
  const [showCodeIssue, setShowCodeIssue] = useState(false)
  useStoryActions([
    { label: 'Reset samples', onClick: () => reset((value) => value + 1) },
    { label: 'Reopen panels', onClick: () => setMount((value) => value + 1) },
    { label: 'Reload saved data', onClick: () => setReload((value) => value + 1) },
    ...(fixture.id == 'task' ? [{ label: showCodeIssue ? 'Clear code issue' : 'Show code issue', onClick: () => setShowCodeIssue((value) => !value) }] : []),
  ])
  return (
    <div className="node-properties-gallery open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'}>
      {(fixture.id == 'code-actions-loading' ? [false] : [true, false]).map((disabled) => (
        <PropertySample
          key={`${generation}-${disabled}`}
          fixture={fixture}
          dark={dark}
          language={language}
          log={log}
          disabled={disabled}
          showCodeIssue={showCodeIssue}
          reload={reload}
          mount={mount}
        />
      ))}
      {fixture.id != 'code-actions-loading' && <FixedDefinitionSample key={generation} dark={dark} language={language} log={log} />}
    </div>
  )
}

export const nodePropertiesStories: readonly FrontendStory[] = fixtures.map((fixture) => ({
  group: `Node ${fixture.group}`,
  id: `node-${fixture.id}-properties`,
  title:
    fixture.id == 'error-handling'
      ? 'Error handling'
      : fixture.id.startsWith('retry-')
        ? fixture.node.name!
        : fixture.id == 'provider-inputs'
          ? 'Provider inputs'
          : fixture.id == 'code-actions-loading'
            ? 'Code · Slow actions'
            : fixture.id == 'execution-limit'
              ? 'Execution limit'
              : 'Properties',
  standalone: true,
  description:
    fixture.id == 'error-handling'
      ? 'Compare the ordinary error field with the quiet system-output group. Expand error and hover each field name to inspect localized help. Open the input source menu to inspect the separate system section, switch failure handling off and on, and reload saved data. Canvas connections are unchanged.'
      : fixture.id.startsWith('retry-')
        ? 'Open Node settings to configure retries. Choose No retries or a retry count, edit the interval, test invalid intervals and the help beside Retry on error, and reload to verify persistence. Compare editable and read-only samples in either theme.'
        : fixture.id == 'provider-inputs'
          ? 'Provider inputs group required fields before optional fields. Optional starts collapsed, including configured values. Expand it, edit values and sources, then reload saved data; reopening panels restores the default expansion.'
          : fixture.id == 'code-actions-loading'
            ? 'Opening the editor makes no shared Action requests. Trigger completion with Ctrl+Space; Actions take four seconds to load while editing remains available. Reset samples to repeat.'
            : fixture.id == 'execution-limit'
              ? 'Per-run node execution limits. Change the limit, test invalid values, or clear it to restore the default of 1000; reload verifies persistence.'
              : fixture.id === 'value'
                ? 'Editable and read-only properties, including typed dates, calendar selection, and time editing with timezone preservation. Use Sort to reorder fields and nested object properties; Done sorting restores disclosure arrows. Samples save independently.'
                : fixture.id === 'task'
                  ? 'Editable and read-only task properties. Toggle the code issue to inspect its attached error above Node settings.'
                  : 'Editable, read-only and fixed-type value panels. Inspector samples save independently; reload verifies saved values.',
  render: (log, dark, language) => <PropertiesStory fixture={fixture} dark={dark} language={language} log={log} />,
}))
