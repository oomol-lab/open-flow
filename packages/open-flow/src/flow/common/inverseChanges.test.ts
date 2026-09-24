import type { ChangeOperation, RevisionContent } from './change.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { describe, expect, it } from 'vitest'
import { applyFlowChanges } from './change.ts'
import { inverseFlowChanges } from './inverseChanges.ts'
import { createCodeTask, createValue, deleteNodes, setTriggerConnection } from './nodeChanges.ts'

const target = { kind: 'flow' } as const
const empty: RevisionContent = {
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: { bindings: {}, graph: { nodes: {}, edges: [] }, tasks: {}, subflows: {} },
}
function roundTrip(before: RevisionContent, operations: readonly ChangeOperation[]) {
  const after = applyFlowChanges(before, operations)
  const restored = applyFlowChanges(after, inverseFlowChanges(before, operations))
  expect(restored).toEqual(before)
  expect(applyFlowChanges(restored, operations)).toEqual(after)
}

describe('inverse canvas changes', () => {
  it('restores direct Trigger selections after changing, clearing and deleting a node', () => {
    const content: RevisionContent = {
      ...empty,
      document: {
        ...empty.document,
        graph: {
          edges: [],
          nodes: {
            trigger: {
              kind: 'poll',
              name: 'Inbox',
              connectionId: 'work',
              config: {},
              pollTimes: [],
              definition: {
                type: 'poll',
                provider: 'mail',
                key: 'mail.received',
                name: 'received',
                displayName: 'Inbox',
                description: '',
                definitionVersion: 2,
                configInputs: [],
                outputs: [],
              },
            },
          },
        },
      },
    }
    for (const connection of ['personal', undefined]) {
      const changes = setTriggerConnection(content, target, 'trigger', connection)!
      expect(applyFlowChanges(content, changes).document.graph.nodes.trigger).toMatchObject({ kind: 'poll' })
      expect(Reflect.get(applyFlowChanges(content, changes).document.graph.nodes.trigger!, 'connectionId')).toBe(connection)
      roundTrip(content, changes)
    }
    roundTrip(content, deleteNodes(content, target, ['trigger']))
    expect(() =>
      applyFlowChanges(content, [{ kind: 'graph.node.field.set', target, nodeId: 'trigger', field: 'connectionId', before: 'stale', value: 'personal' }]),
    ).toThrow()
  })
  it('removes only tasks losing their last reference and restores them on undo', () => {
    const task = { name: 'Mail', inputs: [], outputs: [], executor: { kind: 'connector' as const, action: 'netease_mail.list_folders' } }
    const content: RevisionContent = {
      ...empty,
      document: {
        ...empty.document,
        tasks: { mail: task, orphan: task },
        graph: { edges: [], nodes: { a: { kind: 'task', name: 'A', taskId: 'mail', inputs: {} }, b: { kind: 'task', name: 'B', taskId: 'mail', inputs: {} } } },
      },
    }
    expect(applyFlowChanges(content, deleteNodes(content, target, ['a'])).document.tasks.mail).toEqual(task)
    const operations = deleteNodes(content, target, ['a', 'b'])
    expect(applyFlowChanges(content, operations).document.tasks).toEqual({ orphan: task })
    roundTrip(content, operations)
    const shared: RevisionContent = {
      ...content,
      document: {
        ...content.document,
        subflows: {
          sub: { name: 'Sub', inputs: [], outputs: [], graph: { edges: [], nodes: { c: { kind: 'task', name: 'C', taskId: 'mail', inputs: {} } } } },
        },
      },
    }
    const remaining = applyFlowChanges(shared, deleteNodes(shared, target, ['a', 'b']))
    expect(remaining.document.tasks.mail).toEqual(task)
    const removeLast = deleteNodes(remaining, { kind: 'subflow', id: 'sub' }, ['c'])
    expect(applyFlowChanges(remaining, removeLast).document.tasks.mail).toBeUndefined()
    roundTrip(remaining, removeLast)
  })

  it('preserves Agent notification tasks until the Agent is removed', () => {
    const content: RevisionContent = {
      ...empty,
      document: {
        ...empty.document,
        tasks: {
          mail: { name: 'Mail', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.send' } },
          agent: {
            name: 'Agent',
            inputs: [],
            outputs: [],
            executor: {
              kind: 'agent',
              model: 'test',
              prompt: { kind: 'value', value: '' },
              system: '',
              maxRounds: 10,
              tools: [],
              notification: { taskId: 'mail', messageHandle: 'message', inputs: {} },
            },
          },
        },
        graph: {
          edges: [],
          nodes: { mail: { kind: 'task', name: 'Mail', taskId: 'mail', inputs: {} }, agent: { kind: 'task', name: 'Agent', taskId: 'agent', inputs: {} } },
        },
      },
    }
    const remaining = applyFlowChanges(content, deleteNodes(content, target, ['mail']))
    expect(remaining.document.tasks.mail).toBeDefined()
    const operations = deleteNodes(remaining, target, ['agent'])
    expect(applyFlowChanges(remaining, operations).document.tasks).toEqual({})
    roundTrip(remaining, operations)
  })

  it('restores batch deletion, code, bindings, input references and edge order', () => {
    const content = applyFlowChanges(empty, [
      ...createCodeTask(target, { nodeId: 'code', moduleId: 'module' }, 'Code'),
      ...createValue(target, 'a', 'A'),
      ...createValue(target, 'b', 'B'),
      ...createValue(target, 'c', 'C'),
      { kind: 'binding.create', bindingId: 'variable', binding: { kind: 'variable', target: 'TOKEN' } },
      {
        kind: 'graph.node.input.set',
        target,
        nodeId: 'code',
        handle: 'value',
        before: { kind: 'value', value: 'foo' },
        value: { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'variable' }] },
      },
      {
        kind: 'graph.node.input.set',
        target,
        nodeId: 'b',
        handle: 'value',
        value: {
          kind: 'sources',
          sources: [
            { kind: 'node', nodeId: 'a', output: 'value' },
            { kind: 'node', nodeId: 'code', output: 'result' },
          ],
        },
      },
      ...[
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'code', target: 'b' },
      ].map((edge): ChangeOperation => ({ kind: 'graph.edge.connect', target, edge })),
    ])
    roundTrip(content, deleteNodes(content, target, ['code', 'a']))
    roundTrip(content, [{ kind: 'graph.edge.disconnect', target, edge: { source: 'a', target: 'b' } }])
  })

  it('restores subflow output sources after deletion', () => {
    const subTarget = { kind: 'subflow', id: 'sub' } as const
    let content = applyFlowChanges(empty, [
      { kind: 'subflow.create', subflowId: 'sub', subflow: { name: 'Sub', inputs: [], outputs: [], graph: { nodes: {}, edges: [] } } },
      ...createValue(subTarget, 'a', 'A'),
    ])
    const subflow = content.document.subflows.sub!
    const { graph: _graph, ...before } = subflow
    content = applyFlowChanges(content, [
      {
        kind: 'subflow.definition.set',
        subflowId: 'sub',
        before,
        definition: { ...before, outputs: [{ handle: 'value', jsonSchema: {}, nullable: true, sources: [{ kind: 'node', nodeId: 'a', output: 'value' }] }] },
      },
    ])
    roundTrip(content, deleteNodes(content, subTarget, ['a']))
  })

  it('restores optional fields, input values and code port definitions across a batch', () => {
    const content = applyFlowChanges(empty, createCodeTask(target, { nodeId: 'code', moduleId: 'module' }, 'Code'))
    const node = content.document.graph.nodes.code!
    if (node.kind != 'task' || node.task == null) throw new Error('Expected inline task')
    roundTrip(content, [
      { kind: 'graph.node.field.set', target, nodeId: 'code', field: 'description', value: 'Description' },
      { kind: 'graph.node.field.set', target, nodeId: 'code', field: 'description', before: 'Description' },
      { kind: 'graph.node.field.set', target, nodeId: 'code', field: 'timeoutMs', value: 2000 },
      { kind: 'graph.node.field.set', target, nodeId: 'code', field: 'maxExecutions', value: 25 },
      { kind: 'graph.node.task.name.set', target, nodeId: 'code', before: 'Code', value: 'Renamed' },
      { kind: 'graph.node.task.capabilities.set', target, nodeId: 'code', before: node.task.capabilities, value: [] },
      { kind: 'graph.node.additional-inputs.set', target, nodeId: 'code', value: [{ handle: 'extra', jsonSchema: {}, nullable: false }] },
      {
        kind: 'graph.node.task.ports.set',
        target,
        nodeId: 'code',
        before: { inputs: node.task.inputs, outputs: node.task.outputs },
        value: { inputs: [], outputs: [] },
      },
      { kind: 'graph.node.input.set', target, nodeId: 'code', handle: 'value', before: node.inputs.value, value: { kind: 'value', value: '' } },
    ])
  })

  it('restores binding targets and subflow definitions', () => {
    const definition = { name: 'Sub', inputs: [], outputs: [] }
    const content = applyFlowChanges(empty, [
      { kind: 'binding.create', bindingId: 'connection', binding: { kind: 'variable', target: 'old' } },
      { kind: 'subflow.create', subflowId: 'sub', subflow: { ...definition, graph: { nodes: {}, edges: [] } } },
    ])
    roundTrip(content, [
      { kind: 'binding.target.set', bindingId: 'connection', before: 'old', value: 'new' },
      { kind: 'subflow.definition.set', subflowId: 'sub', before: definition, definition: { ...definition, name: 'Renamed' } },
    ])
  })

  it('replays creation using the same node and module identities', () => {
    roundTrip(empty, [
      ...createValue(target, 'a', 'A'),
      ...createCodeTask(target, { nodeId: 'b', moduleId: 'module' }, 'B'),
      { kind: 'graph.edge.connect', target, edge: { source: 'a', target: 'b' } },
    ])
  })
})
