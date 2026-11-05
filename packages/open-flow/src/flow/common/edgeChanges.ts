import type { ChangeOperation, GraphEdge, RevisionContent } from './change.ts'

import { dequal } from 'dequal/lite'
import { connectorActionContracts } from '../../connector/common/actionContract.ts'

export function connect(content: RevisionContent, edge: GraphEdge): readonly ChangeOperation[] {
  const selected = content.document.graph
  if (selected?.edges.some((candidate) => dequal(candidate, edge))) return []
  const changes: ChangeOperation[] = [{ edge, kind: 'graph.edge.connect' }]
  const source = selected.nodes[edge.source]
  const target = selected.nodes[edge.target]
  const messageInput =
    target?.kind == 'task' && 'executor' in target.task && target.task.executor.kind == 'connector'
      ? connectorActionContracts[target.task.executor.action]?.pendingMessageInput
      : undefined
  if (
    edge.sourceHandle == 'pending' &&
    (source?.kind == 'approval' || source?.kind == 'wait') &&
    target?.kind == 'task' &&
    messageInput != null &&
    (target.inputs[messageInput] == null || target.inputs[messageInput]?.kind == 'unset')
  ) {
    changes.push({
      kind: 'graph.node.input.set',
      nodeId: edge.target,
      handle: messageInput,
      before: target.inputs[messageInput],
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
