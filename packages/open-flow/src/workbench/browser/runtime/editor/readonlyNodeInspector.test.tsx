import type { TriggerNode } from '../api.ts'
import type { ResolvedSelection } from '../revisionView.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { expect, it, vi } from 'vitest'
import { publicationFixture } from '../../../../../dev/designer/publicationFixture.ts'
import { createI18n } from '../i18n.ts'
import { revisionView } from '../revisionView.ts'
import { NodeInspector } from './nodeInspector.tsx'

vi.mock('virtual:uno.css', () => ({}))

it('inspects saved values and definitions without exposing writable controls or requiring a workspace', () => {
  const i18n = createI18n('en')
  const { draft } = publicationFixture('flow', 'fixed')
  const revision = revisionView(draft)
  const extra: ResolvedSelection[] = [
    { id: 'wait', kind: 'wait', node: { kind: 'wait', inputs: {}, inputDefinitions: [], prompt: 'Continue review' } },
    {
      id: 'condition',
      kind: 'condition',
      node: {
        kind: 'condition',
        inputs: {},
        matchMode: 'first',
        cases: [{ output: 'yes', groups: [{ expressions: [{ left: { kind: 'value', value: 1 }, operator: '==', right: { kind: 'value', value: 1 } }] }] }],
      },
    },
    {
      id: 'agent',
      kind: 'task',
      node: { kind: 'task', inputs: {}, taskId: 'agent' },
      definition: {
        name: 'Agent',
        inputs: [],
        outputs: [],
        executor: { kind: 'agent', prompt: 'Review the request', model: 'model', maxRounds: 3, tools: [] },
      },
    },
    {
      id: 'connector',
      kind: 'task',
      node: { kind: 'task', inputs: {}, taskId: 'connector' },
      definition: { name: 'Connector', inputs: [], outputs: [], executor: { kind: 'connector', action: 'saved.action', connectionId: 'saved-connection' } },
    },
    {
      id: 'llm',
      kind: 'task',
      node: { kind: 'task', inputs: {}, taskId: 'llm' },
      definition: { name: 'LLM', inputs: [], outputs: [], executor: { kind: 'llm', mode: 'chat' } },
    },
  ]
  const triggers: TriggerNode[] = [
    { kind: 'cron', name: 'Schedule', cronTimes: [{ type: 'every', unit: 'hour', value: 1 }] },
    { kind: 'webhook', name: 'Webhook', method: 'POST', bodyFields: [], options: { responseData: 'Accepted' } },
    {
      kind: 'poll',
      name: 'Saved provider',
      connectionId: 'saved-connection',
      config: { query: { kind: 'value', value: 'saved query' } },
      pollTimes: [{ type: 'every', unit: 'minute', value: 5 }],
      definition: {
        type: 'poll',
        key: 'saved.poll',
        provider: 'saved',
        definitionVersion: 1,
        name: 'Saved',
        displayName: 'Saved',
        description: '',
        configInputs: [],
        outputs: [],
      },
    },
  ]
  extra.push(...triggers.map((trigger, index): ResolvedSelection => ({ kind: 'trigger', id: `trigger-${index}`, node: trigger, trigger })))
  try {
    for (const selection of [...Object.keys(draft.content.document.graph.nodes).map((id) => revision.node({ kind: 'flow' }, id)!), ...extra]) {
      const html = renderToStaticMarkup(
        <I18nProvider i18n={i18n}>
          <NodeInspector
            readOnly
            revision={revisionView({
              ...draft,
              content: {
                ...draft.content,
                document: {
                  ...draft.content.document,
                  graph: { ...draft.content.document.graph, nodes: { ...draft.content.document.graph.nodes, [selection.id]: selection.node } },
                },
              },
            })}
            selection={selection}
            target={{ kind: 'flow' }}
            theme="light"
          />
        </I18nProvider>,
      )
      for (const input of html.matchAll(/<(?:input|textarea)\b[^>]*>/g)) expect(input[0]).toMatch(/readonly|disabled|type="hidden"/)
      expect(html).not.toMatch(/>Save<|>Add Action<|>Connect account</)
      expect(html).toContain('Purpose')
    }
  } finally {
    i18n.dispose()
  }
})

it('preserves saved input groups, defaults and references through the shared inspector', () => {
  const i18n = createI18n('en')
  const { draft } = publicationFixture('flow', 'fixed')
  const node = draft.content.document.graph.nodes.prepare!
  if (node.kind !== 'task' || node.task == null) throw new Error('Expected inline task')
  const snapshot = {
    ...draft,
    content: {
      ...draft.content,
      document: {
        ...draft.content.document,
        graph: {
          ...draft.content.document.graph,
          nodes: {
            ...draft.content.document.graph.nodes,
            prepare: {
              ...node,
              inputs: { ...node.inputs, region: { kind: 'sources' as const, sources: [{ kind: 'binding' as const, bindingId: 'region' }] } },
              task: {
                ...node.task,
                inputs: [
                  { group: 'Saved group' },
                  ...node.task.inputs,
                  { handle: 'region', jsonSchema: { type: 'string' }, nullable: false },
                  { handle: 'default', jsonSchema: { type: 'string' }, nullable: false, value: 'Saved default' },
                ],
              },
            },
          },
        },
      },
    },
  }
  const revision = revisionView(snapshot)
  const selection = revision.node({ kind: 'flow' }, 'prepare')!
  try {
    const html = renderToStaticMarkup(
      <I18nProvider i18n={i18n}>
        <NodeInspector readOnly revision={revision} selection={selection} target={{ kind: 'flow' }} theme="light" />
      </I18nProvider>,
    )
    expect(html).toContain('Saved group')
    expect(html).toContain('Saved default')
    expect(html).toContain('Customer details')
    expect(html).toContain('REGION')
    expect(html).not.toContain('aria-invalid="true"')
    expect(html).not.toContain('Input source</h3>')
  } finally {
    i18n.dispose()
  }
})
