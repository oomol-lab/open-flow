import type { Draft } from '../api.ts'

import { expect, it } from 'vitest'
import { decisionTask } from '../../../../decision/common/decision.ts'
import { currentFlowModelVersion } from '../../../../flow/common/change.ts'
import { inverseFlowChanges } from '../../../../flow/common/inverseChanges.ts'
import { revisionView } from '../revisionView.ts'
import { applyFlowChanges, updateTask } from './flowChanges.ts'
import { copyNodes, pasteNodes } from './nodeClipboard.ts'
import { TaskExecutorChanges } from './taskExecutorChanges.ts'

it('keeps queued deletions distinct from additions and associates undo feedback with the correct write', async () => {
  let current = draft()
  let finish!: (saved: boolean) => void
  const firstWrite = new Promise<boolean>((resolve) => {
    finish = resolve
  })
  const feedback: (string | undefined)[] = []
  const queue = new TaskExecutorChanges<string>(current.content.document.tasks.decision!.executor, async (before, value, removed) => {
    if (!feedback.length) await firstWrite
    if (before.kind !== 'decision' || value.kind !== 'decision') throw new Error('Expected Decision')
    const task = decisionTask(value.questions)
    const operations = updateTask(revisionView(current), { kind: 'flow' }, 'decision', {
      kind: 'decision',
      name: task.name,
      before: decisionTask(before.questions),
      task,
    })!
    current = applyFlowChanges(current, operations)
    feedback.push(removed)
    return true
  })
  queue.value = decisionTask([{ name: 'result', type: 'noul', instructions: 'Updated requirements' }]).executor
  const saved = queue.save()
  queue.value = decisionTask([]).executor
  void queue.save('result')
  queue.value = decisionTask([{ name: 'decision1', type: 'noul', instructions: 'Another decision' }]).executor
  void queue.save()
  finish(true)
  expect(await saved).toBe(true)
  expect(feedback).toEqual([undefined, 'result', undefined])
  expect(current.content.document.tasks.decision!.executor).toEqual(queue.value)
  expect(current.content.document.graph.nodes.route).toMatchObject({
    cases: [{ groups: [{ expressions: [{ left: { source: { output: 'result' } } }] }] }],
  })
})

it.each(['conflict', 'network'])('retries queued structural edits in order after a %s failure', async (failure) => {
  const initial = decisionTask([{ name: 'result', type: 'noul', instructions: 'Evaluate' }]).executor
  const deleted = decisionTask([]).executor
  const added = decisionTask([{ name: 'decision1', type: 'noul', instructions: 'Another decision' }]).executor
  let finish!: (saved: boolean) => void
  const blocked = new Promise<boolean>((resolve) => {
    finish = resolve
  })
  const writes: unknown[] = []
  const queue = new TaskExecutorChanges<string>(initial, async (before, value, metadata) => {
    writes.push([before, value, metadata])
    if (writes.length === 1) {
      await blocked
      if (failure === 'network') throw new Error('offline')
      return false
    }
    return true
  })
  queue.value = deleted
  const saved = queue.save('result')
  queue.value = added
  void queue.save()
  finish(false)
  if (failure === 'network') await expect(saved).rejects.toThrow('offline')
  else expect(await saved).toBe(false)
  expect(await queue.save()).toBe(true)
  expect(writes).toEqual([
    [initial, deleted, 'result'],
    [initial, deleted, 'result'],
    [deleted, added, undefined],
  ])
})

function draft(): Draft {
  return {
    version: 1,
    actorId: 'test',
    createdAt: '2026-10-08T00:00:00Z',
    digest: 'draft',
    flowId: 'flow',
    revisionId: 'revision',
    parentRevisionId: null,
    modelVersion: currentFlowModelVersion,
    content: {
      modelVersion: currentFlowModelVersion,
      modules: {},
      document: {
        bindings: {},
        subflows: {},
        tasks: { decision: decisionTask([{ name: 'result', type: 'noul', instructions: 'Needs support?' }]) },
        graph: {
          nodes: {
            decision: { kind: 'task', name: 'AI Decision', taskId: 'decision', inputs: { target: { kind: 'value', value: 'Help' } } },
            route: {
              kind: 'condition',
              name: 'Route',
              inputs: {},
              matchMode: 'first',
              cases: [
                {
                  output: 'support',
                  groups: [
                    {
                      expressions: [
                        {
                          left: { kind: 'source', source: { kind: 'node', nodeId: 'decision', output: 'result', field: 'noul' } },
                          operator: '>=',
                          right: { kind: 'value', value: 0.8 },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
          edges: [{ source: 'decision', target: 'route' }],
        },
      },
    },
  }
}
it('renames answer references in Condition and restores the entire edit with undo', () => {
  const before = draft()
  const task = decisionTask([{ name: 'needs_support', type: 'noul', instructions: 'Needs support?' }])
  const operations = updateTask(revisionView(before), { kind: 'flow' }, 'decision', {
    kind: 'decision',
    name: task.name,
    before: before.content.document.tasks.decision!,
    task,
  })!
  const after = applyFlowChanges(before, operations)
  expect(after.content.document.graph.nodes.route).toMatchObject({
    cases: [{ groups: [{ expressions: [{ left: { source: { output: 'needs_support', field: 'noul' } } }] }] }],
  })
  expect(applyFlowChanges(after, inverseFlowChanges(before.content, operations)).content).toEqual(before.content)
})
it('preserves missing references after deletion and copies node references using the existing shared Managed Task contract', () => {
  const before = draft()
  const task = decisionTask([])
  const removed = applyFlowChanges(
    before,
    updateTask(revisionView(before), { kind: 'flow' }, 'decision', {
      kind: 'decision',
      name: task.name,
      before: before.content.document.tasks.decision!,
      task,
    })!,
  )
  expect(removed.content.document.graph.nodes.route).toMatchObject({ cases: [{ groups: [{ expressions: [{ left: { source: { output: 'result' } } }] }] }] })
  const view = revisionView(before)
  let sequence = 0
  const pasted = pasteNodes(view, { kind: 'flow' }, copyNodes(view, { kind: 'flow' }, ['decision', 'route']), () => `copy-${++sequence}`)
  const after = applyFlowChanges(before, pasted.changes)
  expect(Object.values(after.content.document.tasks).filter((item) => item.executor.kind === 'decision')).toHaveLength(1)
  expect(after.content.document.graph.nodes[pasted.nodeIds[0]!]).toMatchObject({ taskId: 'decision' })
  expect(after.content.document.graph.nodes[pasted.nodeIds[1]!]).toMatchObject({
    cases: [{ groups: [{ expressions: [{ left: { source: { nodeId: pasted.nodeIds[0], output: 'result', field: 'noul' } } }] }] }],
  })
  expect(pasted.nodeIds).toHaveLength(2)
})

it('renames references to every shared task instance, including subflow exports', () => {
  const initial = draft()
  const view = revisionView(initial)
  let sequence = 0
  const pasted = pasteNodes(view, { kind: 'flow' }, copyNodes(view, { kind: 'flow' }, ['decision', 'route']), () => `copy-${++sequence}`)
  const copied = applyFlowChanges(initial, pasted.changes)
  const before: Draft = {
    ...copied,
    content: {
      ...copied.content,
      document: {
        ...copied.content.document,
        subflows: {
          child: {
            name: 'Child',
            inputs: [],
            outputs: [{ handle: 'answer', jsonSchema: { type: 'object' }, nullable: false, sources: [{ kind: 'node', nodeId: 'decision', output: 'result' }] }],
            graph: initial.content.document.graph,
          },
        },
      },
    },
  }
  const task = decisionTask([{ name: 'support', type: 'noul', instructions: 'Needs support?' }])
  const operations = updateTask(revisionView(before), { kind: 'flow' }, 'decision', {
    kind: 'decision',
    name: task.name,
    before: before.content.document.tasks.decision!,
    task,
  })!
  const after = applyFlowChanges(before, operations)
  for (const graph of [after.content.document.graph, after.content.document.subflows.child!.graph]) {
    for (const node of Object.values(graph.nodes)) {
      if (node.kind === 'condition')
        expect(node).toMatchObject({ cases: [{ groups: [{ expressions: [{ left: { source: { output: 'support', field: 'noul' } } }] }] }] })
    }
  }
  expect(after.content.document.subflows.child!.outputs[0]!.sources[0]).toMatchObject({ output: 'support' })
  expect(applyFlowChanges(after, inverseFlowChanges(before.content, operations)).content).toEqual(before.content)
})
