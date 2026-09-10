import type { ChangeOperation, RevisionContent } from './change.ts'

import { dequal } from 'dequal/lite'
import { applyFlowChanges } from './change.ts'

/** Invert canvas authoring operations, including the reducer's cascading deletions. */
export function inverseFlowChanges(content: RevisionContent, operations: readonly ChangeOperation[]): readonly ChangeOperation[] {
  let current = content
  const groups: ChangeOperation[][] = []
  for (const operation of operations) {
    const after = applyFlowChanges(current, [operation])
    const restore: ChangeOperation[] = []
    switch (operation.kind) {
      case 'graph.node.create':
        restore.push({ kind: 'graph.node.delete', nodeId: operation.nodeId, target: operation.target })
        break
      case 'graph.node.delete': {
        const { target, nodeId } = operation
        const graph = target.kind == 'flow' ? current.document.graph : current.document.subflows[target.id]!.graph
        const nextGraph = target.kind == 'flow' ? after.document.graph : after.document.subflows[target.id]!.graph
        restore.push({ kind: 'graph.node.create', nodeId, target, node: graph.nodes[nodeId]! })
        for (const [id, node] of Object.entries(nextGraph.nodes)) {
          const previous = graph.nodes[id]!
          if (!('inputs' in node) || !('inputs' in previous)) continue
          for (const handle of new Set([...Object.keys(previous.inputs), ...Object.keys(node.inputs)])) {
            if (!dequal(node.inputs[handle], previous.inputs[handle])) {
              restore.push({ kind: 'graph.node.input.set', target, nodeId: id, handle, before: node.inputs[handle], value: previous.inputs[handle] })
            }
          }
        }
        // Reconnect in the original order; edge order is part of the saved document.
        for (const edge of nextGraph.edges) restore.push({ kind: 'graph.edge.disconnect', target, edge })
        for (const edge of graph.edges) restore.push({ kind: 'graph.edge.connect', target, edge })
        if (target.kind == 'subflow') {
          const { graph: _beforeGraph, ...definition } = current.document.subflows[target.id]!
          const { graph: _afterGraph, ...before } = after.document.subflows[target.id]!
          if (!dequal(before, definition)) restore.push({ kind: 'subflow.definition.set', subflowId: target.id, before, definition })
        }
        break
      }
      case 'graph.edge.connect':
        restore.push({ ...operation, kind: 'graph.edge.disconnect' })
        break
      case 'graph.edge.disconnect': {
        const { target } = operation
        const graph = target.kind == 'flow' ? current.document.graph : current.document.subflows[target.id]!.graph
        const next = target.kind == 'flow' ? after.document.graph : after.document.subflows[target.id]!.graph
        restore.push(...next.edges.map((edge): ChangeOperation => ({ kind: 'graph.edge.disconnect', target, edge })))
        restore.push(...graph.edges.map((edge): ChangeOperation => ({ kind: 'graph.edge.connect', target, edge })))
        break
      }
      case 'module.create':
        restore.push({ kind: 'module.delete', moduleId: operation.moduleId })
        break
      case 'module.delete':
        restore.push({ kind: 'module.create', moduleId: operation.moduleId, module: current.modules[operation.moduleId]! })
        break
      case 'binding.create':
        restore.push({ kind: 'binding.delete', bindingId: operation.bindingId })
        break
      case 'binding.delete':
        restore.push({ kind: 'binding.create', bindingId: operation.bindingId, binding: current.document.bindings[operation.bindingId]! })
        break
      case 'task.create':
        restore.push({ kind: 'task.delete', taskId: operation.taskId })
        break
      case 'task.delete':
        restore.push({ kind: 'task.create', taskId: operation.taskId, task: current.document.tasks[operation.taskId]! })
        break
      case 'graph.node.input.set':
        restore.push({ ...operation, before: operation.value, value: operation.before })
        break
      default:
        throw new Error(`Unsupported canvas history operation: ${operation.kind}`)
    }
    groups.push(restore)
    current = after
  }
  return groups.toReversed().flat()
}
