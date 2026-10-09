import type { ChangeOperation, GraphEdge, GraphTarget, RevisionContent } from './change.ts'

import { dequal } from 'dequal/lite'

export function connect(content: RevisionContent, target: GraphTarget, edge: GraphEdge): readonly ChangeOperation[] {
  const selected = content.document.graph
  if (selected?.edges.some((candidate) => dequal(candidate, edge))) return []
  return [{ edge, kind: 'graph.edge.connect', target }]
}

export function disconnect(content: RevisionContent, target: GraphTarget, edge: GraphEdge): readonly ChangeOperation[] {
  const selected = content.document.graph
  if (!selected?.edges.some((candidate) => dequal(candidate, edge))) return []
  return [{ edge, kind: 'graph.edge.disconnect', target }]
}
