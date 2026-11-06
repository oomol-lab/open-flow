import type { CanvasDirection } from '../../common/direction.ts'
import type { LayoutNode, LayoutPoint } from './wrapLayout.ts'

import { graphlib, layout } from '@dagrejs/dagre'

export interface GraphLayoutNode {
  readonly id: string
  readonly width: number
  readonly height: number
  readonly branchHandles?: readonly string[]
}

export interface GraphLayoutEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string
  readonly sourceOffset?: LayoutPoint | undefined
  readonly targetOffset?: LayoutPoint | undefined
}

export interface GraphLayout {
  readonly nodes: readonly LayoutNode[]
  readonly edges: readonly (GraphLayoutEdge & { readonly points: readonly LayoutPoint[] })[]
}

/** The measured dependency layout shared by canvas arrangement and image export. */
export function graphLayout(nodes: readonly GraphLayoutNode[], edges: readonly GraphLayoutEdge[], direction: CanvasDirection): GraphLayout {
  if (!nodes.length) return { nodes: [], edges: [] }
  const graph = new graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: direction === 'vertical' ? 'TB' : 'LR', ranksep: direction === 'vertical' ? 48 : 80 })
  const singles = new Set(nodes.map((node) => node.id))
  for (const node of nodes) graph.setNode(node.id, { width: node.width, height: node.height })
  const connections = edges.filter((edge) => graph.hasNode(edge.source) && graph.hasNode(edge.target))
  for (const edge of connections) {
    singles.delete(edge.source)
    singles.delete(edge.target)
    graph.setEdge(edge.source, edge.target)
  }
  // Keep the editor's existing placement of comments and other isolated nodes.
  const isolated = [...singles]
  for (let start = 0; start < isolated.length; start += 10) {
    for (let index = start; index < Math.min(start + 9, isolated.length - 1); index++) graph.setEdge(isolated[index]!, isolated[index + 1]!)
  }

  const constraints: { left: string; right: string }[] = []
  const ordering = new graphlib.Graph()
  for (const node of nodes) {
    const targets = [
      ...new Set(
        node.branchHandles?.flatMap((handle) =>
          connections.filter((edge) => edge.source === node.id && edge.sourceHandle === handle).map((edge) => edge.target),
        ),
      ),
    ]
    for (let index = 1; index < targets.length; index++) {
      const left = targets[index - 1]!
      const right = targets[index]!
      ordering.setEdge(left, right)
      if (graphlib.alg.isAcyclic(ordering)) constraints.push({ left, right })
      else ordering.removeEdge(left, right)
    }
  }
  layout(graph, { constraints })
  return {
    nodes: nodes.map((node) => {
      const { x, y, width, height, rank } = graph.node(node.id)
      return { id: node.id, column: rank, x: x - width / 2, y: y - height / 2, width, height }
    }),
    edges: connections.map((edge) => Object.assign({}, edge, { points: graph.edge(edge.source, edge.target).points })),
  }
}
