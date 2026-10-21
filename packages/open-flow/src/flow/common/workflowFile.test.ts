import type { GraphNode } from './change.ts'
import type { WorkflowFile } from './workflowFile.ts'

import { describe, expect, it } from 'vitest'
import { decodeRevision, encodeRevision } from './encoding.ts'
import { cleanWorkflowFile, decodeWorkflowFile, encodeWorkflowFile, parseWorkflowFile, workflowFileName } from './workflowFile.ts'

const value = (literal: null | string) => ({ kind: 'value' as const, value: literal })
const binding = { kind: 'binding' as const, bindingId: 'secret' }
const task = { name: 'Send', inputs: [], outputs: [] }
const definition = {
  key: 'feishu_app_bot.on_event',
  provider: 'feishu_app_bot',
  name: 'on_event',
  displayName: 'Event',
  description: '',
  definitionVersion: 2,
  configInputs: [],
  outputs: [],
  type: 'integration' as const,
  endpoint: { methods: ['POST' as const], successStatus: 200, body: { allowArray: false, allowEmpty: true, formats: ['json' as const] } },
}
function fixture(): WorkflowFile {
  return {
    kind: 'open-flow-workflow',
    version: 1,
    name: 'Template',
    presentation: { positions: { code: { x: 10, y: 20 } }, viewport: { x: 1, y: 2, zoom: 0.5 }, comments: [{ text: 'secret literal stays' }] },
    content: {
      modelVersion: 6,
      modules: { shared: { name: 'Shared', imports: [], source: 'const secret = "account"; export default () => ({})' } },
      document: {
        bindings: { secret: { kind: 'variable', target: 'TOKEN' } },
        graph: {
          edges: [{ source: 'start', target: 'code' }],
          nodes: {
            start: { kind: 'manual', name: 'Start' },
            source: { kind: 'value', inputs: {}, values: [] },
            connector: {
              kind: 'task',
              inputs: {
                token: { kind: 'sources', sources: [binding] },
                mixed: { kind: 'sources', sources: [binding, { kind: 'node', nodeId: 'source', output: 'out' }] },
                literal: value('account'),
                nullable: value(null),
                unset: { kind: 'unset' },
              },
              task: { ...task, executor: { kind: 'connector', action: 'mail.send', connectionId: 'account' } },
            },
            code: {
              kind: 'task',
              inputs: {},
              task: {
                ...task,
                moduleId: 'shared',
                capabilities: [{ kind: 'connector', mode: 'independent', actions: [{ action: 'mail.send', connectionId: 'account' }] }],
              },
            },
            shared: { kind: 'task', inputs: {}, task: { ...task, moduleId: 'shared', capabilities: [{ kind: 'connector', mode: 'shared' }] } },
            legacy: {
              kind: 'task',
              inputs: {},
              task: {
                ...task,
                moduleId: 'shared',
                capabilities: [{ kind: 'connector', action: 'mail.send', connectionId: 'account', connections: [{ connectionId: 'account', alias: 'work' }] }],
              },
            },
            hints: {
              kind: 'task',
              inputs: {},
              task: {
                ...task,
                moduleId: 'shared',
                capabilities: [{ kind: 'connector', actionHints: ['mail.send'], connectionHints: [{ action: 'mail.send', connectionId: 'account' }] }],
              },
            },
            agent: {
              kind: 'task',
              inputs: {},
              task: {
                ...task,
                executor: {
                  kind: 'agent',
                  model: 'model',
                  prompt: 'secret literal stays',
                  maxRounds: 2,
                  tools: [{ id: 'send', name: 'Send', description: '', action: 'mail.send', connectionId: 'account', approval: true, inputs: [] }],
                  notification: {
                    action: 'mail.send',
                    connectionId: 'account',
                    inputDefinitions: [],
                    inputs: { message: value('secret literal stays') },
                    messageHandle: 'message',
                  },
                },
              },
            },
            condition: {
              kind: 'condition',
              inputs: {},
              matchMode: 'first',
              cases: [
                {
                  output: 'yes',
                  groups: [{ expressions: [{ left: { kind: 'source', source: binding }, operator: '==', right: { kind: 'value', value: null } }] }],
                },
              ],
            },
            error: { kind: 'error', name: 'Errors', sourceFlowIds: ['original'] },
            trigger: {
              kind: 'integration',
              name: 'Event',
              definition,
              connectionId: 'account',
              config: {
                sourceId: value('event-source'),
                eventTypes: { kind: 'value', value: ['event'] },
                resource: value('document'),
                chatIds: value('chat'),
                other: value(null),
              },
            },
          },
        },
      },
    },
  }
}

describe('shareable workflow files', () => {
  it('clears structured resources, preserves internal identities and values, and is pure and idempotent', () => {
    const original = fixture()
    const before = structuredClone(original)
    const { file, summary } = cleanWorkflowFile(original)
    expect(original).toEqual(before)
    expect(cleanWorkflowFile(file)).toEqual({ file, summary: { changedNodeIds: [], removedBindings: 0 } })
    expect(summary.removedBindings).toBe(1)
    expect(summary.changedNodeIds).toContain('condition')
    expect(file.content.modules).toEqual(original.content.modules)
    expect(file.presentation).toEqual(original.presentation)
    expect(file.content.document.graph.edges).toEqual(original.content.document.graph.edges)
    expect(file.content.document.bindings).toEqual({})
    const nodes = file.content.document.graph.nodes
    expect(nodes.connector).toMatchObject({
      inputs: {
        token: { kind: 'unset' },
        mixed: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'out' }] },
        nullable: value(null),
        unset: { kind: 'unset' },
        literal: value('account'),
      },
      task: { executor: { kind: 'connector', action: 'mail.send' } },
    })
    expect(nodes.condition).toMatchObject({ cases: [{ groups: [{ expressions: [{ left: { kind: 'value' }, right: { kind: 'value', value: null } }] }] }] })
    expect(nodes.error).toMatchObject({ sourceFlowIds: [] })
    expect(nodes.trigger).toMatchObject({
      config: { sourceId: { kind: 'unset' }, resource: { kind: 'unset' }, eventTypes: { kind: 'unset' }, chatIds: { kind: 'unset' }, other: value(null) },
    })
    expect(JSON.stringify(nodes)).not.toContain('"connectionId"')
    expect(nodes.code).toMatchObject({ task: { moduleId: 'shared', capabilities: [{ mode: 'independent', actions: [{ action: 'mail.send' }] }] } })
    expect(nodes.shared).toMatchObject({ task: { moduleId: 'shared', capabilities: [{ mode: 'shared' }] } })
    expect(nodes.agent).toMatchObject({
      task: { executor: { model: 'model', prompt: 'secret literal stays', notification: { inputs: { message: value('secret literal stays') } } } },
    })
    expect(parseWorkflowFile(encodeWorkflowFile(original))).toEqual(file)
    expect(decodeRevision(encodeRevision(file.content))).toEqual(file.content)
  })
  it('clears Jira deployment references on export and import', () => {
    const file = fixture()
    const trigger: GraphNode = {
      kind: 'integration',
      name: 'Jira',
      definition: {
        ...definition,
        key: 'jira.on_issue_event',
        type: 'integration',
        endpoint: { methods: ['POST'], successStatus: 200, body: { formats: ['json'], allowArray: false, allowEmpty: false } },
      },
      config: { sourceId: value('source_' + 'a'.repeat(32)), eventTypes: { kind: 'value', value: ['jira:issue_created'] } },
    }
    const original = { ...file, content: { ...file.content, document: { ...file.content.document, graph: { nodes: { trigger }, edges: [] } } } }
    const exported = parseWorkflowFile(encodeWorkflowFile(original))
    expect(exported.content.document.graph.nodes.trigger).toMatchObject({ config: { sourceId: { kind: 'unset' }, eventTypes: { kind: 'unset' } } })
    expect(cleanWorkflowFile(original).file).toEqual(exported)
  })
  it('clears account-dependent Linear selections without discarding other trigger config', () => {
    const file = fixture()
    const trigger: GraphNode = {
      kind: 'poll',
      name: 'Linear',
      pollTimes: [],
      definition: { ...definition, key: 'linear.on_issue_changed', type: 'poll' },
      config: { teamId: value('team'), stateIds: value('state'), other: value(null) },
    }
    const result = cleanWorkflowFile({
      ...file,
      content: { ...file.content, document: { ...file.content.document, graph: { nodes: { trigger }, edges: [] } } },
    }).file
    expect(result.content.document.graph.nodes.trigger).toMatchObject({
      config: { teamId: { kind: 'unset' }, stateIds: { kind: 'unset' }, other: value(null) },
    })
  })
  it('accepts unnamed incomplete drafts but rejects malformed, retired and unsupported content without repair', () => {
    const { name: _, ...file } = fixture()
    expect(decodeWorkflowFile(file).name).toBeUndefined()
    expect(() => parseWorkflowFile('{')).toThrow()
    expect(() => decodeWorkflowFile({ ...file, version: 2 })).toThrow()
    expect(() => decodeWorkflowFile({ ...file, content: { ...file.content, modelVersion: 999 } })).toThrow()
    expect(() =>
      decodeWorkflowFile({
        ...file,
        content: { ...file.content, document: { ...file.content.document, graph: { nodes: { bad: { kind: 'subflow' } }, edges: [] } } },
      }),
    ).toThrow()
  })
  it('uses safe download filenames', () => expect(workflowFileName('demo/a?')).toBe('demo_a_.openflow.json'))
})

it.each([2, 4, 5, 6] as const)('round trips supported normalized Revision model %s without repair', (modelVersion) => {
  const file: WorkflowFile = {
    kind: 'open-flow-workflow',
    version: 1,
    content: {
      modelVersion,
      modules: {},
      document: { bindings: {}, graph: { nodes: { start: { kind: 'manual', name: 'Start' } }, edges: [] } },
    },
  }
  expect(parseWorkflowFile(encodeWorkflowFile(file))).toEqual(file)
})

it('keeps Action declarations found only in legacy connection hints', () => {
  const file = fixture()
  const code: GraphNode = {
    kind: 'task',
    inputs: {},
    task: { ...task, moduleId: 'shared', capabilities: [{ kind: 'connector', connectionHints: [{ action: 'mail.send', connectionId: 'account' }] }] },
  }
  const result = cleanWorkflowFile({
    ...file,
    content: { ...file.content, document: { ...file.content.document, graph: { nodes: { code }, edges: [] } } },
  }).file
  expect(result.content.document.graph.nodes.code).toMatchObject({
    task: { capabilities: [{ kind: 'connector', actionHints: ['mail.send'], connectionHints: [] }] },
  })
})

it('preserves workflow input definitions and node-only Start metadata through portable files', () => {
  const file: WorkflowFile = {
    kind: 'open-flow-workflow',
    version: 1,
    content: {
      modelVersion: 7,
      modules: {},
      document: {
        bindings: {},
        graph: {
          nodes: {
            start: {
              kind: 'start',
              name: 'Start',
              description: 'Entry',
              inputDefs: [{ handle: 'message', jsonSchema: { type: 'string', minLength: 1 }, nullable: false, description: 'Call message' }],
            },
          },
          edges: [],
        },
      },
    },
  }
  expect(parseWorkflowFile(encodeWorkflowFile(file))).toEqual(file)
  expect(decodeRevision(encodeRevision(file.content))).toEqual(file.content)
})
