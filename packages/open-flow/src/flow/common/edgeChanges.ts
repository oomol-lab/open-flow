import type { ChangeOperation, GraphEdge, RevisionContent } from './change.ts'

import { dequal } from 'dequal/lite'

export function connect(content: RevisionContent, edge: GraphEdge): readonly ChangeOperation[] {
  const selected = content.document.graph
  if (selected?.edges.some((candidate) => dequal(candidate, edge))) return []
  const changes: ChangeOperation[] = [{ edge, kind: 'graph.edge.connect' }]
  const source = selected.nodes[edge.source]
  const target = selected.nodes[edge.target]
  if (
    edge.sourceHandle == 'pending' &&
    (source?.kind == 'approval' || source?.kind == 'wait') &&
    target?.kind == 'task' &&
    'executor' in target.task &&
    target.task.executor.kind == 'connector' &&
    target.task.executor.action == 'leina.send_notification' &&
    (target.inputs.message == null || target.inputs.message.kind == 'unset')
  ) {
    changes.push({
      kind: 'graph.node.input.set',
      nodeId: edge.target,
      handle: 'message',
      before: target.inputs.message,
      value: { kind: 'sources', sources: [{ kind: 'node', nodeId: edge.source, output: 'pending', field: 'message' }] },
    })
  }
  return changes
}

export function disconnect(content: RevisionContent, edge: GraphEdge): readonly ChangeOperation[] {
  const selected = content.document.graph
  if (!selected?.edges.some((candidate) => dequal(candidate, edge))) return []
  return [{ edge, kind: 'graph.edge.disconnect' }]
}
