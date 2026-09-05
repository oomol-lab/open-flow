import type { ChangeOperation, GraphEdge, GraphTarget, RevisionContent } from './change.ts'

import { dequal } from 'dequal/lite'

export function connect(content: RevisionContent, target: GraphTarget, edge: GraphEdge): readonly ChangeOperation[] {
  const selected = graph(content, target)
  if (selected?.edges.some((candidate) => dequal(candidate, edge))) return []
  return [{ edge, kind: 'graph.edge.connect', target }]
}

export function disconnect(content: RevisionContent, target: GraphTarget, edge: GraphEdge): readonly ChangeOperation[] {
  const selected = graph(content, target)
  if (!selected?.edges.some((candidate) => dequal(candidate, edge))) return []
  return [{ edge, kind: 'graph.edge.disconnect', target }]
}

function graph(content: RevisionContent, target: GraphTarget) {
  return target.kind == 'flow' ? content.document.graph : content.document.subflows[target.id]?.graph
}
