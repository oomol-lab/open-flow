import type { ChangeOperation, RevisionContent } from './change.ts'

import { describe, expect, it } from 'vitest'
import { applyFlowChanges } from './change.ts'
import { inverseFlowChanges } from './inverseChanges.ts'
import { createCodeTask, createValue, deleteNodes } from './nodeChanges.ts'

const target = { kind: 'flow' } as const
const empty: RevisionContent = { modelVersion: 1, modules: {}, document: { bindings: {}, graph: { nodes: {}, edges: [] }, tasks: {}, subflows: {} } }
function roundTrip(before: RevisionContent, operations: readonly ChangeOperation[]) {
  const after = applyFlowChanges(before, operations)
  const restored = applyFlowChanges(after, inverseFlowChanges(before, operations))
  expect(restored).toEqual(before)
  expect(applyFlowChanges(restored, operations)).toEqual(after)
}

describe('inverse canvas changes', () => {
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
        before: { kind: 'value', value: null },
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

  it('replays creation using the same node and module identities', () => {
    roundTrip(empty, [
      ...createValue(target, 'a', 'A'),
      ...createCodeTask(target, { nodeId: 'b', moduleId: 'module' }, 'B'),
      { kind: 'graph.edge.connect', target, edge: { source: 'a', target: 'b' } },
    ])
  })
})
