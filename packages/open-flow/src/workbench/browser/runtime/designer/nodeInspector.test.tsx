import type { Diagnostic, Draft, GraphNode, TriggerNode } from '../api.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { TriggerStore } from '../stores/triggerStore.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { describe, expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { revisionView } from '../revisionView.ts'
import { NodeInspector } from './nodeInspector.tsx'

const definition = {
  configSchema: {
    properties: { repository: { description: 'Repository name.', title: 'Repository', type: 'string' } },
    required: ['repository'],
    type: 'object',
  },
  definitionVersion: 1,
  description: 'Run when an issue changes.',
  displayName: 'GitHub Issue Event',
  key: 'github.issue_event',
  name: 'issue_event',
  payloadSchema: { type: 'object' },
  provider: 'github',
} as const

function project(trigger: TriggerNode): Draft {
  return {
    actorId: 'actor',
    content: {
      document: {
        bindings: trigger.kind == 'poll' || trigger.kind == 'integration' ? { connection: { kind: 'connection', target: 'github-work' } } : {},
        flows: { main: { graph: { nodes: { trigger } }, name: 'Main' } },
        subflows: {},
        tasks: {},
      },
      modelVersion: 1,
      modules: {},
    },
    createdAt: '2026-08-12T00:00:00.000Z',
    digest: 'digest',
    modelVersion: 1,
    parentRevisionId: null,
    projectId: 'project',
    revisionId: 'revision',
    version: 1,
  }
}

function renderTrigger(trigger: TriggerNode, diagnostics: readonly Diagnostic[] = []): string {
  const revision = revisionView(project(trigger))
  return renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <NodeInspector
        connectorAuthorizationPending={false}
        connectorLoading={false}
        connectors={{} as ConnectorStore}
        diagnostics={diagnostics}
        disabled={false}
        revision={revision}
        selection={revision.selection({ id: 'main', kind: 'flow' }, 'trigger')}
        store={{} as WorkspaceStore}
        target={{ id: 'main', kind: 'flow' }}
        theme="light"
        triggerActiveConnections={[]}
        triggerAuthorizationPending={false}
        triggerConnectionLoading={false}
        triggers={{} as TriggerStore}
      />
    </I18nProvider>,
  )
}

function nodeProject(
  nodeId: string,
  node: GraphNode,
  options: {
    readonly modules?: Draft['content']['modules']
    readonly tasks?: Draft['content']['document']['tasks']
  } = {},
): Draft {
  return {
    actorId: 'actor',
    content: {
      document: {
        bindings: {},
        flows: { main: { graph: { nodes: { [nodeId]: node } }, name: 'Main' } },
        subflows: {},
        tasks: options.tasks ?? {},
      },
      modelVersion: 1,
      modules: options.modules ?? {},
    },
    createdAt: '2026-08-12T00:00:00.000Z',
    digest: 'digest',
    modelVersion: 1,
    parentRevisionId: null,
    projectId: 'project',
    revisionId: 'revision',
    version: 1,
  }
}

function renderNode(draft: Draft, nodeId: string): string {
  const revision = revisionView(draft)
  return renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <NodeInspector
        connectorAuthorizationPending={false}
        connectorLoading={false}
        connectors={{} as ConnectorStore}
        diagnostics={[]}
        disabled={false}
        revision={revision}
        selection={revision.selection({ id: 'main', kind: 'flow' }, nodeId)}
        store={{ $: { moduleDiagnostics: val([]), moduleEditor: val(undefined) } } as unknown as WorkspaceStore}
        target={{ id: 'main', kind: 'flow' }}
        theme="light"
        triggerAuthorizationPending={false}
        triggerConnectionLoading={false}
        triggers={{} as TriggerStore}
      />
    </I18nProvider>,
  )
}

describe('Trigger Inspector', () => {
  it('keeps Webhook input definitions and options in the node instead of duplicating them in the Inspector', () => {
    const markup = renderTrigger({
      inputsDef: [{ handle: 'event', jsonSchema: { type: 'object' }, nullable: false }],
      kind: 'webhook',
      name: 'Incoming webhook',
      options: { allowedMethods: ['POST'] },
    })

    expect(markup).not.toContain('Webhook input definitions (JSON)')
    expect(markup).not.toContain('&quot;handle&quot;: &quot;event&quot;')
    expect(markup).not.toContain('Webhook options (JSON)')
    expect(markup).not.toContain('&quot;POST&quot;')
  })

  it('keeps Cron and Poll schedules in the node instead of duplicating them in the Inspector', () => {
    const cron = renderTrigger({
      cronTimes: [{ expression: '0 * * * *', timezone: 'UTC', type: 'cron' }],
      kind: 'cron',
      name: 'Hourly',
    })
    const poll = renderTrigger({
      bindingId: 'connection',
      config: { repository: 'oomol/open-flow' },
      definition: { ...definition, type: 'poll' },
      kind: 'poll',
      name: 'Poll issues',
      pollTimes: [{ type: 'every', unit: 'minute', value: 5 }],
    })

    expect(cron).not.toContain('Schedule (JSON)')
    expect(cron).not.toContain('0 * * * *')
    expect(poll).not.toContain('Schedule (JSON)')
    expect(poll).not.toContain('Repository *')
  })

  it('keeps Integration config fields in the node instead of duplicating them in the Inspector', () => {
    const markup = renderTrigger({
      bindingId: 'connection',
      config: { repository: 'oomol/open-flow' },
      definition: {
        ...definition,
        endpoint: { body: { allowArray: false, allowEmpty: false, formats: ['json'] }, methods: ['POST'], successStatus: 202 },
        type: 'integration',
      },
      kind: 'integration',
      name: 'GitHub Issue Event',
    })

    expect(markup).not.toContain('Repository *')
    expect(markup).not.toContain('value="oomol/open-flow"')
    expect(markup).not.toContain('Repository name.')
  })

  it('presents missing required Trigger config as incomplete rather than an error', () => {
    const markup = renderTrigger(
      {
        bindingId: 'connection',
        config: {},
        definition: {
          ...definition,
          endpoint: { body: { allowArray: false, allowEmpty: false, formats: ['json'] }, methods: ['POST'], successStatus: 202 },
          type: 'integration',
        },
        kind: 'integration',
        name: 'GitHub Issue Event',
      },
      [
        {
          code: 'trigger.config-incomplete',
          column: 0,
          line: 1,
          message: 'Complete the required Trigger config fields: repository.',
          path: '/document/flows/main/graph/nodes/trigger/config',
        },
      ],
    )

    expect(markup).toContain('diagnostics-section incomplete')
    expect(markup).toContain('Configuration required')
    expect(markup).toContain('Complete the required Trigger config fields: repository.')
  })
})

describe('Task Inspector', () => {
  it('shows Connector ports as a read-only summary', () => {
    const markup = renderNode(
      nodeProject(
        'connector',
        { concurrency: 1, inputs: {}, kind: 'task', taskId: 'connector-task' },
        {
          tasks: {
            'connector-task': {
              executor: { action: 'feishu.send_text_message', kind: 'connector' },
              inputs: { text: { jsonSchema: { type: 'string' }, nullable: false } },
              name: 'Send Text Message',
              outputs: { code: { jsonSchema: { type: 'integer' }, nullable: false } },
            },
          },
        },
      ),
      'connector',
    )

    expect(markup).toContain('Input ports')
    expect(markup).toContain('Output ports')
    expect(markup).toContain('text')
    expect(markup).toContain('code')
    expect(markup).not.toContain('Input ports (JSON)')
    expect(markup).not.toContain('task-connector-inputs')
    expect(markup).not.toContain('&quot;jsonSchema&quot;')
  })

  it('does not duplicate Code or LLM port editing in the Inspector', () => {
    const codeMarkup = renderNode(
      nodeProject(
        'code',
        {
          concurrency: 1,
          inputs: {},
          kind: 'task',
          task: {
            inputs: { input: { jsonSchema: { type: 'string' }, nullable: false } },
            moduleId: 'module',
            name: 'Code',
            outputs: { output: { jsonSchema: { type: 'string' }, nullable: false } },
          },
        },
        {
          modules: { module: { imports: [], name: 'Code', source: 'export default () => ({ output: "ok" })' } },
        },
      ),
      'code',
    )
    const llmMarkup = renderNode(
      nodeProject(
        'llm',
        { concurrency: 1, inputs: {}, kind: 'task', taskId: 'llm-task' },
        {
          tasks: {
            'llm-task': {
              executor: { kind: 'llm', mode: 'json' },
              inputs: { input: { jsonSchema: { type: 'string' }, nullable: false } },
              name: 'Structured output',
              outputs: { output: { jsonSchema: { type: 'object' }, nullable: false } },
            },
          },
        },
      ),
      'llm',
    )

    expect(codeMarkup).not.toContain('task-code-inputs')
    expect(codeMarkup).not.toContain('&quot;jsonSchema&quot;')
    expect(llmMarkup).not.toContain('task-llm-inputs')
    expect(llmMarkup).not.toContain('&quot;jsonSchema&quot;')
  })
})

describe('Condition Inspector', () => {
  it('keeps routing and schema editing in the structured node controls', () => {
    const markup = renderNode(
      nodeProject('condition', {
        cases: [{ expressions: [{ input: 'value', operator: 'isTrue' }], output: 'true', relation: 'any' }],
        concurrency: 1,
        defaultOutput: 'false',
        input: { handle: 'value', jsonSchema: { type: 'boolean' }, nullable: true },
        inputs: {},
        kind: 'condition',
        name: 'Condition',
      }),
      'condition',
    )

    expect(markup).not.toContain('Condition routing')
    expect(markup).not.toContain('Input JSON Schema')
    expect(markup).not.toContain('Cases (JSON)')
    expect(markup).not.toContain('&quot;operator&quot;')
  })
})
