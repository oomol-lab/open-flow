import type { Draft, ProjectDocument } from './api.ts'

import { describe, expect, it, vi } from 'vitest'
import { connect, disconnect } from '../../../project/common/edgeChanges.ts'
import { updateTrigger, updateTriggerConfig, updateTriggerSchedule } from '../../../project/common/nodeChanges.ts'
import {
  addNode,
  copyNodes,
  createResource,
  deleteSelection,
  pasteNodes,
  updateCondition,
  updateCodeTaskPorts,
  updateNodeDescription,
  updateTask,
  updateWebhook,
} from './designer/projectChanges.ts'
import { revisionView } from './revisionView.ts'

const target = { id: 'main', kind: 'flow' as const }

function revision(document: ProjectDocument, modules: Draft['content']['modules'] = {}) {
  return revisionView({
    actorId: 'actor',
    content: { document, modelVersion: 1, modules },
    createdAt: '2026-01-01T00:00:00.000Z',
    digest: 'digest',
    modelVersion: 1,
    parentRevisionId: null,
    projectId: 'project',
    revisionId: crypto.randomUUID(),
    version: 1,
  } satisfies Draft)
}

const emptyDocument: ProjectDocument = {
  bindings: {},
  flows: { main: { graph: { nodes: {} }, name: 'Main' } },
  subflows: {},
  tasks: {},
}

const integrationDefinition = {
  configSchema: {},
  definitionVersion: 1,
  description: 'Created',
  displayName: 'Created',
  endpoint: { body: { allowArray: false, allowEmpty: false, formats: ['json'] as const }, methods: ['POST'] as const, successStatus: 202 },
  key: 'created',
  name: 'created',
  payloadSchema: {},
  provider: 'github',
  type: 'integration' as const,
}

describe('Project changes', () => {
  it('creates a node-owned Code Task with a default-export Module', () => {
    const changes = addNode(revision(emptyDocument), target, 'code', { kind: 'code', name: 'Code' }, () => 'module')!

    expect(changes.map((change) => change.kind)).toEqual(['module.create', 'graph.node.create'])
    expect(changes).toMatchObject([
      { module: { source: expect.stringContaining('export default function run') }, moduleId: 'module' },
      { node: { kind: 'task', task: { moduleId: 'module', name: 'Code' } }, nodeId: 'code' },
    ])
  })

  it('creates a Value node through one typed operation', () => {
    expect(addNode(revision(emptyDocument), target, 'value', { kind: 'value', name: 'Value' }, () => 'unused')).toEqual([
      {
        kind: 'graph.node.create',
        node: {
          concurrency: 1,
          inputs: {},
          kind: 'value',
          name: 'Value',
          values: { value: { jsonSchema: {}, nullable: true, value: null } },
        },
        nodeId: 'value',
        target,
      },
    ])
  })

  it('updates and clears descriptions for Designer nodes and Triggers', () => {
    const current = revision({
      ...emptyDocument,
      flows: {
        main: {
          graph: {
            nodes: {
              trigger: { inputsDef: [], kind: 'webhook', name: 'Webhook' },
              value: { concurrency: 1, description: 'Old description', inputs: {}, kind: 'value', values: {} },
            },
          },
          name: 'Main',
        },
      },
    })

    expect(updateNodeDescription(current, target, 'value', 'New description')?.[0]).toMatchObject({
      kind: 'graph.node.replace',
      node: { description: 'New description' },
      nodeId: 'value',
    })
    const cleared = updateNodeDescription(current, target, 'value', undefined)?.[0]
    expect(cleared).toMatchObject({ kind: 'graph.node.replace', nodeId: 'value' })
    expect(cleared).not.toHaveProperty('node.description')
    expect(updateNodeDescription(current, target, 'trigger', 'Receives events')?.[0]).toMatchObject({
      kind: 'graph.node.replace',
      node: { description: 'Receives events' },
      nodeId: 'trigger',
    })
  })

  it('connects semantic nodes through an exact graph edge intent', () => {
    const current = revision({
      ...emptyDocument,
      flows: {
        main: {
          ...emptyDocument.flows.main!,
          graph: {
            nodes: {
              first: { concurrency: 1, inputs: {}, kind: 'value', values: { true: { jsonSchema: {}, nullable: false } } },
              second: {
                cases: [],
                concurrency: 1,
                input: { handle: 'value', jsonSchema: {}, nullable: true },
                inputs: {},
                kind: 'condition',
              },
            },
          },
        },
      },
    })
    const edge = { id: 'designer-edge', source: 'first', sourceHandle: 'true', target: 'second', targetHandle: 'value' }
    const expected = { source: 'first', sourceHandle: 'true', target: 'second', targetHandle: 'value' }

    expect(connect(current.revision.content, target, edge)).toEqual([{ edge: expected, kind: 'graph.edge.connect', target }])
    const connected = revision({
      ...emptyDocument,
      flows: {
        main: {
          ...emptyDocument.flows.main!,
          graph: {
            nodes: {
              first: { concurrency: 1, inputs: {}, kind: 'value', values: { true: { jsonSchema: {}, nullable: false } } },
              second: {
                cases: [],
                concurrency: 1,
                input: { handle: 'value', jsonSchema: {}, nullable: true },
                inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'first', output: 'true' }] } },
                kind: 'condition',
              },
            },
          },
        },
      },
    })
    expect(disconnect(connected.revision.content, target, edge)).toEqual([{ edge: expected, kind: 'graph.edge.disconnect', target }])
  })

  it('remaps internal sources when copying and removes external sources', () => {
    const current = revision({
      ...emptyDocument,
      flows: {
        main: {
          ...emptyDocument.flows.main!,
          graph: {
            nodes: {
              first: { concurrency: 1, inputs: {}, kind: 'value', values: {} },
              second: {
                cases: [],
                concurrency: 1,
                input: { handle: 'value', jsonSchema: {}, nullable: true },
                inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'first', output: 'value' }] } },
                kind: 'condition',
              },
            },
          },
        },
      },
    })
    const clipboard = copyNodes(current, target, ['second'])
    const pasted = pasteNodes(current, target, clipboard, () => 'second-copy')

    expect(pasted.nodeIds).toEqual(['second-copy'])
    expect(pasted.changes).toMatchObject([{ node: { inputs: {} }, nodeId: 'second-copy' }])
  })

  it('copies and deletes an inline Task together with its owned Module', () => {
    const node = {
      concurrency: 1,
      inputs: {},
      kind: 'task' as const,
      name: 'Code',
      task: { inputs: {}, moduleId: 'module', name: 'Code', outputs: {} },
    }
    const current = revision(
      {
        ...emptyDocument,
        flows: { main: { ...emptyDocument.flows.main!, graph: { nodes: { code: node } } } },
      },
      { module: { imports: [], name: 'Code', source: 'export default function run() {}' } },
    )
    const identities = ['code-copy', 'module-copy'][Symbol.iterator]()
    const pasted = pasteNodes(current, target, copyNodes(current, target, ['code']), () => identities.next().value!)

    expect(pasted.changes).toMatchObject([
      { kind: 'module.create', moduleId: 'module-copy' },
      { kind: 'graph.node.create', node: { task: { moduleId: 'module-copy' } }, nodeId: 'code-copy' },
    ])
    expect(deleteSelection(current, target, ['code'])).toEqual([
      { kind: 'graph.node.delete', nodeId: 'code', target },
      { kind: 'module.delete', moduleId: 'module' },
    ])
  })

  it('skips an inline Task whose owned Module is missing from the clipboard', () => {
    const node = {
      concurrency: 1,
      inputs: {},
      kind: 'task' as const,
      task: { inputs: {}, moduleId: 'missing', name: 'Missing code', outputs: {} },
    }
    const current = revision({
      ...emptyDocument,
      flows: { main: { ...emptyDocument.flows.main!, graph: { nodes: { code: node } } } },
    })
    const identity = vi.fn(() => 'copy')
    const clipboard = copyNodes(current, target, ['code'])

    expect(clipboard.modules).toEqual({})
    expect(pasteNodes(current, target, clipboard, identity)).toEqual({ changes: [], nodeIds: [], sourceIds: [] })
    expect(identity).not.toHaveBeenCalled()
  })

  it('deletes orphaned Trigger and Binding resources with the attachment', () => {
    const current = revision({
      ...emptyDocument,
      bindings: { account: { kind: 'connection', target: 'connection' } },
      flows: {
        main: {
          graph: {
            nodes: {
              trigger: { bindingId: 'account', config: {}, definition: integrationDefinition, kind: 'integration', name: 'Created' },
            },
          },
          name: 'Main',
        },
      },
    })

    expect(deleteSelection(current, target, ['trigger'])).toEqual([
      { kind: 'graph.node.delete', nodeId: 'trigger', target },
      { bindingId: 'account', kind: 'binding.delete' },
    ])
  })

  it('updates editable Trigger fields without exposing or replacing its stable Gateway identity', () => {
    const current = revision({
      ...emptyDocument,
      bindings: { account: { kind: 'connection', target: 'connection' } },
      flows: {
        main: {
          graph: {
            nodes: {
              trigger: {
                bindingId: 'account',
                config: { repository: 'old' },
                definition: integrationDefinition,
                kind: 'integration',
                name: 'Created',
              },
            },
          },
          name: 'Main',
        },
      },
    })

    expect(
      updateTrigger(current.revision.content, target, 'trigger', {
        config: { repository: 'new' },
        description: 'Updated description',
        kind: 'integration',
        name: 'Updated',
      }),
    ).toMatchObject([
      {
        kind: 'graph.node.replace',
        node: {
          bindingId: 'account',
          config: { repository: 'new' },
          definition: { key: 'created', provider: 'github', type: 'integration' },
          kind: 'integration',
          name: 'Updated',
        },
        nodeId: 'trigger',
      },
    ])
  })

  it('updates only the schedule owned by a scheduled Trigger', () => {
    const current = revision({
      ...emptyDocument,
      flows: {
        main: {
          graph: {
            nodes: {
              trigger: {
                cronTimes: [{ type: 'every', unit: 'hour', value: 1 }],
                description: 'Runs periodically.',
                kind: 'cron',
                name: 'Scheduled',
              },
            },
          },
          name: 'Main',
        },
      },
    })

    expect(updateTriggerSchedule(current.revision.content, target, 'trigger', [{ expression: '0 9 * * *', timezone: 'Asia/Shanghai', type: 'cron' }])).toEqual([
      {
        kind: 'graph.node.replace',
        node: {
          cronTimes: [{ expression: '0 9 * * *', timezone: 'Asia/Shanghai', type: 'cron' }],
          description: 'Runs periodically.',
          kind: 'cron',
          name: 'Scheduled',
        },
        nodeId: 'trigger',
        target,
      },
    ])
  })

  it('updates one Provider Trigger config field without replacing its definition or binding', () => {
    const current = revision({
      ...emptyDocument,
      flows: {
        main: {
          graph: {
            nodes: {
              trigger: {
                bindingId: 'account',
                config: { owner: 'oomol', repository: 'old' },
                definition: integrationDefinition,
                kind: 'integration',
                name: 'Created',
              },
            },
          },
          name: 'Main',
        },
      },
    })

    expect(updateTriggerConfig(current.revision.content, target, 'trigger', 'repository', 'new')).toMatchObject([
      {
        kind: 'graph.node.replace',
        node: {
          bindingId: 'account',
          config: { owner: 'oomol', repository: 'new' },
          definition: { key: 'created' },
          kind: 'integration',
        },
        nodeId: 'trigger',
      },
    ])
    expect(updateTriggerConfig(current.revision.content, target, 'trigger', 'repository', undefined)?.[0]).toMatchObject({
      node: { config: { owner: 'oomol' } },
    })
  })

  it('updates Webhook inputs and options independently', () => {
    const current = revision({
      ...emptyDocument,
      flows: {
        main: {
          graph: {
            nodes: {
              trigger: {
                inputsDef: [],
                kind: 'webhook',
                name: 'Incoming webhook',
                options: { allowedMethods: ['POST'] },
              },
            },
          },
          name: 'Main',
        },
      },
    })

    expect(
      updateWebhook(current, target, 'trigger', {
        inputs: [{ handle: 'event', jsonSchema: { type: 'object' }, nullable: false }],
        options: { noResponseBody: true },
      })?.[0],
    ).toMatchObject({
      node: {
        inputsDef: [{ handle: 'event', jsonSchema: { type: 'object' }, nullable: false }],
        options: { noResponseBody: true },
      },
    })
    expect(updateWebhook(current, target, 'trigger', { inputs: [], options: {} })?.[0]).toEqual({
      kind: 'graph.node.replace',
      node: { inputsDef: [], kind: 'webhook', name: 'Incoming webhook' },
      nodeId: 'trigger',
      target,
    })
  })

  it('updates a Connector task name without changing its action, Connection, or ports', () => {
    const current = revision({
      ...emptyDocument,
      flows: {
        main: {
          ...emptyDocument.flows.main!,
          graph: { nodes: { connector: { concurrency: 1, inputs: {}, kind: 'task', taskId: 'task' } } },
        },
      },
      tasks: {
        task: {
          executor: { action: 'issues.create', connectionId: 'connection', kind: 'connector' },
          inputs: {},
          name: 'Create issue',
          outputs: {},
        },
      },
    })

    expect(updateTask(current, target, 'connector', { kind: 'connector', name: 'Create GitHub issue' })).toEqual([
      {
        kind: 'task.replace',
        task: {
          executor: { action: 'issues.create', connectionId: 'connection', kind: 'connector' },
          inputs: {},
          name: 'Create GitHub issue',
          outputs: {},
        },
        taskId: 'task',
      },
    ])
  })

  it('renames inline Code Task handles without dropping input values or downstream connections', () => {
    const current = revision({
      ...emptyDocument,
      flows: {
        main: {
          ...emptyDocument.flows.main!,
          graph: {
            nodes: {
              code: {
                concurrency: 1,
                inputs: { prompt: { kind: 'value', value: 'hello' } },
                kind: 'task',
                task: {
                  inputs: { prompt: { jsonSchema: { type: 'string' }, nullable: false } },
                  moduleId: 'module',
                  name: 'Code',
                  outputs: { result: { jsonSchema: { type: 'string' }, nullable: false } },
                },
              },
              sink: {
                concurrency: 1,
                inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'code', output: 'result' }] } },
                kind: 'task',
                taskId: 'sink-task',
              },
            },
          },
        },
      },
      tasks: {
        'sink-task': {
          executor: { kind: 'llm', mode: 'chat' },
          inputs: { value: { jsonSchema: { type: 'string' }, nullable: false } },
          name: 'Sink',
          outputs: {},
        },
      },
    })

    expect(
      updateCodeTaskPorts(current, target, 'code', {
        inputs: { message: { jsonSchema: { type: 'string' }, nullable: false } },
        outputs: { text: { jsonSchema: { type: 'string' }, nullable: false } },
      }),
    ).toEqual([
      {
        kind: 'graph.node.replace',
        node: {
          concurrency: 1,
          inputs: { message: { kind: 'value', value: 'hello' } },
          kind: 'task',
          task: {
            inputs: { message: { jsonSchema: { type: 'string' }, nullable: false } },
            moduleId: 'module',
            name: 'Code',
            outputs: { text: { jsonSchema: { type: 'string' }, nullable: false } },
          },
        },
        nodeId: 'code',
        target,
      },
      {
        kind: 'graph.node.replace',
        node: {
          concurrency: 1,
          inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'code', output: 'text' }] } },
          kind: 'task',
          taskId: 'sink-task',
        },
        nodeId: 'sink',
        target,
      },
    ])
  })

  it('removes mappings that reference deleted inline Code Task handles', () => {
    const current = revision({
      ...emptyDocument,
      flows: {
        main: {
          ...emptyDocument.flows.main!,
          graph: {
            nodes: {
              code: {
                concurrency: 1,
                inputs: { prompt: { kind: 'value', value: 'hello' } },
                kind: 'task',
                task: {
                  inputs: { prompt: { jsonSchema: {}, nullable: false } },
                  moduleId: 'module',
                  name: 'Code',
                  outputs: { result: { jsonSchema: {}, nullable: false } },
                },
              },
              sink: {
                concurrency: 1,
                inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'code', output: 'result' }] } },
                kind: 'task',
                taskId: 'sink-task',
              },
            },
          },
        },
      },
      tasks: {
        'sink-task': { executor: { kind: 'llm', mode: 'chat' }, inputs: {}, name: 'Sink', outputs: {} },
      },
    })

    const changes = updateCodeTaskPorts(current, target, 'code', { inputs: {}, outputs: {} })!

    expect(changes).toHaveLength(2)
    expect(changes[0]).toMatchObject({ node: { inputs: {}, task: { inputs: {}, outputs: {} } }, nodeId: 'code' })
    expect(changes[1]).toMatchObject({ node: { inputs: {} }, nodeId: 'sink' })
  })

  it('renames Condition handles without dropping its input value or downstream connections', () => {
    const current = revision({
      ...emptyDocument,
      flows: {
        main: {
          ...emptyDocument.flows.main!,
          graph: {
            nodes: {
              condition: {
                cases: [{ expressions: [{ input: 'value', operator: 'isTrue' }], output: 'matched', relation: 'all' }],
                concurrency: 1,
                defaultOutput: 'fallback',
                input: { handle: 'value', jsonSchema: { type: 'boolean' }, nullable: false },
                inputs: { value: { kind: 'value', value: true } },
                kind: 'condition',
              },
              sink: {
                concurrency: 1,
                inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'condition', output: 'matched' }] } },
                kind: 'task',
                taskId: 'sink-task',
              },
            },
          },
        },
      },
      tasks: {
        'sink-task': { executor: { kind: 'llm', mode: 'chat' }, inputs: {}, name: 'Sink', outputs: {} },
      },
    })

    expect(
      updateCondition(current, target, 'condition', {
        cases: [{ expressions: [{ input: 'message', operator: 'isTrue' }], output: 'accepted', relation: 'all' }],
        defaultOutput: 'fallback',
        input: { handle: 'message', jsonSchema: { type: 'boolean' }, nullable: false },
      }),
    ).toEqual([
      {
        kind: 'graph.node.replace',
        node: {
          cases: [{ expressions: [{ input: 'message', operator: 'isTrue' }], output: 'accepted', relation: 'all' }],
          concurrency: 1,
          defaultOutput: 'fallback',
          input: { handle: 'message', jsonSchema: { type: 'boolean' }, nullable: false },
          inputs: { message: { kind: 'value', value: true } },
          kind: 'condition',
        },
        nodeId: 'condition',
        target,
      },
      {
        kind: 'graph.node.replace',
        node: {
          concurrency: 1,
          inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'condition', output: 'accepted' }] } },
          kind: 'task',
          taskId: 'sink-task',
        },
        nodeId: 'sink',
        target,
      },
    ])
  })

  it('creates a reusable Subflow with explicit boundary ports', () => {
    expect(createResource('subflow', 'normalize', 'Normalize')).toMatchObject([
      {
        kind: 'subflow.create',
        subflow: {
          graph: { nodes: {} },
          inputs: { value: { jsonSchema: {}, nullable: true, value: null } },
          name: 'Normalize',
          outputs: { result: { jsonSchema: {}, nullable: true, sources: [{ input: 'value', kind: 'flow' }] } },
        },
        subflowId: 'normalize',
      },
    ])
  })
})
