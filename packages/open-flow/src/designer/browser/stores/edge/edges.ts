import type { ReadonlyVal } from 'value-enhancer'
import type { ReadonlyReactiveMap } from 'value-enhancer/collections'
import type { NodeId } from '../../../../schema/index.ts'
import type { FlowDesignerViewEdge } from '../../graph/FlowDesigner/model.ts'
import type { NodeStore } from '../node/node.store.ts'

import { compute } from 'value-enhancer'
import { EdgeStore, getRFEdgeId } from './edge.store.ts'

export function deriveEdges(
  connections: ReadonlyVal<readonly FlowDesignerViewEdge[]>,
  nodes: ReadonlyReactiveMap<NodeId, NodeStore>,
): ReadonlyVal<EdgeStore[]> {
  let previous = new Map<string, EdgeStore>()
  const edges = compute((get) => {
    const next = new Map<string, EdgeStore>()
    for (const connection of get(connections)) {
      if (!get(nodes.$).has(connection.source as NodeId) || !get(nodes.$).has(connection.target as NodeId)) continue
      const id = getRFEdgeId(connection)
      next.set(id, previous.get(id) ?? new EdgeStore(id, { nodes, connection }))
    }
    for (const [id, edge] of previous) if (!next.has(id)) edge.dispose()
    previous = next
    return [...next.values()]
  })
  const dispose = edges.dispose.bind(edges)
  edges.dispose = () => {
    dispose()
    for (const edge of previous.values()) edge.dispose()
  }
  return edges
}
