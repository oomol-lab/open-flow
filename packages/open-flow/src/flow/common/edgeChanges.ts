import type { ChangeOperation, GraphEdge, RevisionContent } from './change.ts'

import { dequal } from 'dequal/lite'

export function connect(content: RevisionContent, edge: GraphEdge): readonly ChangeOperation[] {
  const selected = content.document.graph
  if (selected?.edges.some((candidate) => dequal(candidate, edge))) return []
  return [{ edge, kind: 'graph.edge.connect' }]
}

export function disconnect(content: RevisionContent, edge: GraphEdge): readonly ChangeOperation[] {
  const selected = content.document.graph
  if (!selected?.edges.some((candidate) => dequal(candidate, edge))) return []
  return [{ edge, kind: 'graph.edge.disconnect' }]
}
