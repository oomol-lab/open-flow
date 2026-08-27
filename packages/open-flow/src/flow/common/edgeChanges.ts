import type { ChangeOperation, GraphEdge, GraphTarget, RevisionContent } from './change.ts'

import { cleanVariableBindings } from './nodeChanges.ts'

export function connect(content: RevisionContent, target: GraphTarget, edge: GraphEdge): readonly ChangeOperation[] {
  const exact = { source: edge.source, sourceHandle: edge.sourceHandle, target: edge.target, targetHandle: edge.targetHandle }
  const node = graph(content, target)?.nodes[edge.target]
  const mapping = node != null && 'inputs' in node ? node.inputs[edge.targetHandle] : undefined
  if (
    mapping?.kind == 'sources' &&
    mapping.sources.some((source) => source.kind == 'node' && source.nodeId == edge.source && source.output == edge.sourceHandle)
  ) {
    return []
  }
  return cleanVariableBindings(content, [{ edge: exact, kind: 'graph.edge.connect', target }])
}

export function disconnect(content: RevisionContent, target: GraphTarget, edge: GraphEdge): readonly ChangeOperation[] {
  const exact = { source: edge.source, sourceHandle: edge.sourceHandle, target: edge.target, targetHandle: edge.targetHandle }
  const node = graph(content, target)?.nodes[edge.target]
  const mapping = node != null && 'inputs' in node ? node.inputs[edge.targetHandle] : undefined
  if (
    mapping?.kind != 'sources' ||
    !mapping.sources.some((source) => source.kind == 'node' && source.nodeId == edge.source && source.output == edge.sourceHandle)
  ) {
    return []
  }
  return [{ edge: exact, kind: 'graph.edge.disconnect', target }]
}

function graph(content: RevisionContent, target: GraphTarget) {
  return target.kind == 'flow' ? content.document.graph : content.document.subflows[target.id]?.graph
}
