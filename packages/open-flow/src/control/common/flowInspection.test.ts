import type { Draft, Flow, Live } from './api.ts'

import { expect, it } from 'vitest'
import { currentFlowModelVersion } from '../../flow/common/change.ts'
import { flowInspection, inspectFlowDraft } from './flowInspection.ts'

const port = { handle: 'limit', jsonSchema: { type: 'number', description: 'Catalog documentation. '.repeat(100) }, nullable: false, value: 20 }
const flow: Flow = {
  flowId: 'flow',
  name: 'Mail',
  status: 'active',
  draftRevisionId: 'r1',
  createdAt: '2026-09-22T00:00:00Z',
  updatedAt: '2026-09-22T00:00:00Z',
  version: 1,
}
const draft = {
  actorId: 'actor',
  createdAt: flow.createdAt,
  digest: 'digest',
  modelVersion: currentFlowModelVersion,
  parentRevisionId: null,
  flowId: flow.flowId,
  revisionId: 'r1',
  version: 1,
  content: {
    modelVersion: currentFlowModelVersion,
    modules: { script: { name: 'Script', imports: [], source: 'export default () => ({ limit: 20 });' } },
    document: {
      bindings: { token: { kind: 'variable', target: 'TOKEN' } },
      tasks: {
        mail: {
          name: 'Mail',
          inputs: [port],
          outputs: [{ ...port, handle: 'messages' }],
          executor: { kind: 'connector', action: 'mail.list', connectionId: 'connection' },
        },
      },
      graph: {
        nodes: {
          start: { kind: 'cron', name: 'Schedule', cronTimes: [{ type: 'every', unit: 'hour', value: 1 }] },
          mail: { kind: 'task', name: 'Read', taskId: 'mail', inputs: { limit: { kind: 'value', value: 50 } } },
          defaults: { kind: 'task', name: 'Default', taskId: 'mail', inputs: {} },
          unset: { kind: 'task', name: 'Unset', taskId: 'mail', inputs: { limit: { kind: 'unset' } } },
          code: {
            kind: 'task',
            name: 'Code',
            task: { name: 'Code', moduleId: 'script', inputs: [port], outputs: [port] },
            inputs: { limit: { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'token' }] } },
          },
          poll: {
            kind: 'poll',
            name: 'Poll',
            connectionId: 'connection',
            config: { limit: { kind: 'value', value: 10 } },
            pollTimes: [{ type: 'every', unit: 'minute', value: 5 }],
            definition: {
              type: 'poll',
              key: 'mail.received',
              name: 'received',
              displayName: 'Received',
              description: 'Catalog',
              provider: 'mail',
              definitionVersion: 1,
              configInputs: [port],
              outputs: [port],
            },
          },
          child: {
            kind: 'subflow',
            name: 'Child',
            subflowId: 'child',
            inputs: { limit: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'code', output: 'limit' }] } },
          },
        },
        edges: [{ source: 'start', target: 'mail' }],
      },
      subflows: {
        child: {
          name: 'Child',
          inputs: [port],
          outputs: [{ ...port, sources: [{ kind: 'node', nodeId: 'nested', output: 'messages' }] }],
          graph: {
            nodes: {
              nested: { kind: 'task', name: 'Nested', taskId: 'mail', inputs: { limit: { kind: 'sources', sources: [{ kind: 'flow', input: 'limit' }] } } },
            },
            edges: [],
          },
        },
      },
    },
  },
} satisfies Draft

const live: Live = { flowId: 'flow', hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 }

it('preserves editable graph relationships and defaults without catalog schemas or source code', async () => {
  const inspected = await inspectFlowDraft(flow, () => draft)
  const compact = flowInspection(inspected, live)
  expect(compact).toMatchObject({
    flow: { flowId: 'flow', name: 'Mail' },
    draft: {
      revisionId: 'r1',
      graph: {
        edges: draft.content.document.graph.edges,
        nodes: {
          start: { cronTimes: [{ type: 'every', unit: 'hour', value: 1 }] },
          mail: {
            taskId: 'mail',
            inputs: { limit: { kind: 'value', value: 50 } },
            executor: { action: 'mail.list', connectionId: 'connection' },
            inputHandles: ['limit'],
            outputHandles: ['messages'],
          },
          defaults: { inputDefaults: { limit: 20 } },
          unset: { inputs: { limit: { kind: 'unset' } } },
          code: { moduleId: 'script', inputs: draft.content.document.graph.nodes.code!.inputs },
          child: { subflowId: 'child', inputs: draft.content.document.graph.nodes.child!.inputs },
          poll: {
            config: { limit: { kind: 'value', value: 10 } },
            connectionId: 'connection',
            pollTimes: [{ type: 'every', unit: 'minute', value: 5 }],
            definition: { key: 'mail.received', definitionVersion: 1 },
          },
        },
      },
      subflows: {
        child: {
          graph: { nodes: { nested: { taskId: 'mail', inputs: { limit: { kind: 'sources', sources: [{ kind: 'flow', input: 'limit' }] } } } } },
          outputs: [{ handle: 'limit', sources: [{ kind: 'node', nodeId: 'nested', output: 'messages' }] }],
        },
      },
      bindings: draft.content.document.bindings,
      modules: { script: { name: 'Script', imports: [] } },
    },
    live: { status: 'not-published', publication: null, hasUnpublishedChanges: true },
  })
  expect(compact).not.toHaveProperty('draft.graph.nodes.mail.inputDefaults')
  expect(compact).not.toHaveProperty('draft.graph.nodes.unset.inputDefaults')
  expect(compact).not.toHaveProperty('draft.graph.nodes.code.task')
  expect(compact).not.toHaveProperty('draft.actorId')
  expect(compact).not.toHaveProperty('draft.modules.script.source')
  const serialized = JSON.stringify(compact)
  expect(serialized).not.toContain('Catalog documentation')
  expect(serialized.length).toBeLessThan(JSON.stringify(flowInspection(inspected, live, true)).length / 2)
  expect(flowInspection(inspected, live, true)).toEqual({ ...inspected, live })
})

it('preserves unreadable Draft diagnostics and published identity in either mode', async () => {
  const metadata = { ...flow, live: { enabled: true, publicationId: 'p1', revisionId: 'published' } }
  const inspected = await inspectFlowDraft(metadata, () => {
    throw Object.assign(new Error('Upgrade required'), { code: 'flow.revision-upgrade-required' })
  })
  for (const full of [false, true]) {
    expect(flowInspection(inspected, undefined, full)).toEqual({
      flow: metadata,
      draft: null,
      draftIssue: { code: 'flow.revision-upgrade-required', message: 'Upgrade required', revisionId: 'r1' },
      version: 1,
    })
  }
})

it('keeps condition logic, approval prompts and webhook settings without stripping schema-like user data', async () => {
  const content: Draft = {
    ...draft,
    content: {
      ...draft.content,
      document: {
        ...draft.content.document,
        graph: {
          edges: [],
          nodes: {
            webhook: { kind: 'webhook', name: 'Webhook', method: 'POST', bodyFields: [port], options: { responseStatusCode: 202 } },
            approval: { kind: 'approval', name: 'Approve', inputs: {}, inputDefinitions: [port], prompt: 'Approve this?' },
            value: { kind: 'value', name: 'Payload', inputs: {}, values: [{ ...port, value: { jsonSchema: { type: 'string' }, source: 'User data' } }] },
            condition: {
              kind: 'condition',
              name: 'Condition',
              inputs: {},
              matchMode: 'first',
              cases: [
                {
                  output: 'yes',
                  groups: [
                    { expressions: [{ left: { kind: 'value', value: 5, jsonSchema: { type: 'number' } }, operator: '>', right: { kind: 'value', value: 1 } }] },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  }
  const result = flowInspection(await inspectFlowDraft(flow, () => content), live)
  expect(result).toMatchObject({
    draft: {
      graph: {
        nodes: {
          webhook: { method: 'POST', bodyFields: [{ handle: 'limit', value: 20 }], options: { responseStatusCode: 202 } },
          approval: { prompt: 'Approve this?', inputHandles: ['limit'], inputDefaults: { limit: 20 } },
          value: { values: [{ handle: 'limit', value: { jsonSchema: { type: 'string' }, source: 'User data' } }] },
          condition: {
            matchMode: 'first',
            cases: [{ output: 'yes', groups: [{ expressions: [{ left: { kind: 'value', value: 5 }, operator: '>', right: { kind: 'value', value: 1 } }] }] }],
          },
        },
      },
    },
  })
  expect(result).not.toHaveProperty('draft.graph.nodes.approval.inputDefinitions')
  expect(result).not.toHaveProperty('draft.graph.nodes.condition.cases.0.groups.0.expressions.0.left.jsonSchema')
})
