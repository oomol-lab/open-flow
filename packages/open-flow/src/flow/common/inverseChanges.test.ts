import type { ChangeOperation, RevisionContent } from './change.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { describe, expect, it } from 'vitest'
import { applyFlowChanges } from './change.ts'
import { inverseFlowChanges } from './inverseChanges.ts'
import { createCodeTask, createValue, deleteNodes, setTriggerConnection } from './nodeChanges.ts'

const empty: RevisionContent = {
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: { bindings: {}, graph: { nodes: {}, edges: [] } },
}
function roundTrip(before: RevisionContent, operations: readonly ChangeOperation[]) {
  const after = applyFlowChanges(before, operations)
  const restored = applyFlowChanges(after, inverseFlowChanges(before, operations))
  expect(restored).toEqual(before)
  expect(applyFlowChanges(restored, operations)).toEqual(after)
}

describe('inverse canvas changes', () => {
  it('restores a replacement whose name was normalized when applied', () => {
    const content = applyFlowChanges(empty, createValue('value', 'Original'))
    const before = content.document.graph.nodes.value!
    roundTrip(content, [{ kind: 'graph.node.replace', nodeId: 'value', before, node: { ...before, name: '  Cafe\u0301  ' } }])
  })

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
      const changes = setTriggerConnection(content, 'trigger', connection)!
      expect(applyFlowChanges(content, changes).document.graph.nodes.trigger).toMatchObject({ kind: 'poll' })
      expect(Reflect.get(applyFlowChanges(content, changes).document.graph.nodes.trigger!, 'connectionId')).toBe(connection)
      roundTrip(content, changes)
    }
    roundTrip(content, deleteNodes(content, ['trigger']))
    expect(() =>
      applyFlowChanges(content, [{ kind: 'graph.node.field.set', nodeId: 'trigger', field: 'connectionId', before: 'stale', value: 'personal' }]),
    ).toThrow()
  })
  it('deletes node-owned task configurations independently and restores them on undo', () => {
    const task = { name: 'Mail', inputs: [], outputs: [], executor: { kind: 'connector' as const, action: 'netease_mail.list_folders' } }
    const content: RevisionContent = {
      ...empty,
      document: {
        ...empty.document,

        graph: { edges: [], nodes: { a: { kind: 'task', name: 'A', task: task, inputs: {} }, b: { kind: 'task', name: 'B', task: task, inputs: {} } } },
      },
    }
    const remaining = applyFlowChanges(content, deleteNodes(content, ['a']))
    expect(remaining.document.graph.nodes.a).toBeUndefined()
    expect(remaining.document.graph.nodes.b).toEqual(content.document.graph.nodes.b)
    const operations = deleteNodes(content, ['a', 'b'])
    expect(applyFlowChanges(content, operations).document.graph.nodes).toEqual({})
    roundTrip(content, operations)
  })

  it('keeps Agent notification configuration independent of other nodes', () => {
    const content: RevisionContent = {
      ...empty,
      document: {
        ...empty.document,

        graph: {
          edges: [],
          nodes: {
            mail: {
              kind: 'task',
              name: 'Mail',
              task: { name: 'Mail', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.send' } },
              inputs: {},
            },
            agent: {
              kind: 'task',
              name: 'Agent',
              task: {
                name: 'Agent',
                inputs: [],
                outputs: [],
                executor: {
                  kind: 'agent',
                  model: 'test',
                  prompt: '',
                  maxRounds: 10,
                  tools: [],
                  notification: { action: 'mail.send', inputDefinitions: [], messageHandle: 'message', inputs: {} },
                },
              },
              inputs: {},
            },
          },
        },
      },
    }
    const remaining = applyFlowChanges(content, deleteNodes(content, ['mail']))
    expect(remaining.document.graph.nodes.agent).toEqual(content.document.graph.nodes.agent)
    const operations = deleteNodes(remaining, ['agent'])
    expect(applyFlowChanges(remaining, operations).document.graph.nodes).toEqual({})
    roundTrip(remaining, operations)
  })

  it('restores batch deletion, code, bindings, input references and edge order', () => {
    const content = applyFlowChanges(empty, [
      ...createCodeTask({ nodeId: 'code', moduleId: 'module' }, 'Code'),
      ...createValue('a', 'A'),
      ...createValue('b', 'B'),
      ...createValue('c', 'C'),
      { kind: 'binding.create', bindingId: 'variable', binding: { kind: 'variable', target: 'TOKEN' } },
      {
        kind: 'graph.node.input.set',
        nodeId: 'code',
        handle: 'value',
        before: { kind: 'value', value: 'foo' },
        value: { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'variable' }] },
      },
      {
        kind: 'graph.node.input.set',
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
      ].map((edge): ChangeOperation => ({ kind: 'graph.edge.connect', edge })),
    ])
    roundTrip(content, deleteNodes(content, ['code', 'a']))
    roundTrip(content, [{ kind: 'graph.edge.disconnect', edge: { source: 'a', target: 'b' } }])
  })

  it('restores optional fields, input values and code port definitions across a batch', () => {
    const content = applyFlowChanges(empty, createCodeTask({ nodeId: 'code', moduleId: 'module' }, 'Code'))
    const node = content.document.graph.nodes.code!
    if (node.kind != 'task' || !('moduleId' in node.task)) throw new Error('Expected inline task')
    roundTrip(content, [
      { kind: 'graph.node.field.set', nodeId: 'code', field: 'description', value: 'Description' },
      { kind: 'graph.node.field.set', nodeId: 'code', field: 'description', before: 'Description' },
      { kind: 'graph.node.field.set', nodeId: 'code', field: 'timeoutMs', value: 2000 },
      { kind: 'graph.node.field.set', nodeId: 'code', field: 'maxExecutions', value: 25 },
      { kind: 'graph.node.task.name.set', nodeId: 'code', before: 'Code', value: 'Renamed' },
      { kind: 'graph.node.task.capabilities.set', nodeId: 'code', before: node.task.capabilities, value: [] },
      { kind: 'graph.node.additional-inputs.set', nodeId: 'code', value: [{ handle: 'extra', jsonSchema: {}, nullable: false }] },
      {
        kind: 'graph.node.task.ports.set',
        nodeId: 'code',
        before: { inputs: node.task.inputs, outputs: node.task.outputs },
        value: { inputs: [], outputs: [] },
      },
      { kind: 'graph.node.input.set', nodeId: 'code', handle: 'value', before: node.inputs.value, value: { kind: 'value', value: '' } },
    ])
  })

  it('restores binding targets', () => {
    const content = applyFlowChanges(empty, [{ kind: 'binding.create', bindingId: 'connection', binding: { kind: 'variable', target: 'old' } }])
    roundTrip(content, [{ kind: 'binding.target.set', bindingId: 'connection', before: 'old', value: 'new' }])
  })

  it('replays creation using the same node and module identities', () => {
    roundTrip(empty, [
      ...createValue('a', 'A'),
      ...createCodeTask({ nodeId: 'b', moduleId: 'module' }, 'B'),
      { kind: 'graph.edge.connect', edge: { source: 'a', target: 'b' } },
    ])
  })
})
