import type { GraphLayout } from './graphLayout.ts'
import type { LayoutNode, LayoutPoint } from './wrapLayout.ts'

import { graphlib } from '@dagrejs/dagre'
import { routeLayout } from './routeLayout.ts'
import { layoutAxes } from './wrapLayout.ts'

export interface CompactLayout {
  readonly positions: Readonly<Record<string, LayoutPoint>>
  readonly routes: ReadonlyMap<string, readonly LayoutPoint[]>
  readonly bounds: LayoutPoint & { readonly width: number; readonly height: number }
}

function bounds(nodes: readonly LayoutNode[], routes: ReadonlyMap<string, readonly LayoutPoint[]> = new Map()) {
  const points = [...routes.values()].flat()
  for (const node of nodes) points.push(node, { x: node.x + node.width, y: node.y + node.height })
  const x = Math.min(...points.map((point) => point.x))
  const y = Math.min(...points.map((point) => point.y))
  return { x, y, width: Math.max(...points.map((point) => point.x)) - x, height: Math.max(...points.map((point) => point.y)) - y }
}

/** Place branches at their earliest dependency level, rather than delaying short
 * branches until the longest sibling reaches a shared join. Cycles remain one
 * component whose internal order follows the measured base layout. */
function dependencyLevels(nodes: LayoutNode[], edges: GraphLayout['edges'], gap: number): void {
  const graph = new graphlib.Graph()
  for (const node of nodes) graph.setNode(node.id)
  for (const edge of edges) graph.setEdge(edge.source, edge.target)
  const components = graphlib.alg.tarjan(graph)
  const componentOf = new Map(components.flatMap((members, index) => members.map((id) => [id, String(index)] as const)))
  const dependencies = new graphlib.Graph()
  for (let index = 0; index < components.length; index++) dependencies.setNode(String(index))
  for (const edge of edges) {
    const source = componentOf.get(edge.source)!
    const target = componentOf.get(edge.target)!
    if (source !== target) dependencies.setEdge(source, target)
  }
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const levels = new Map<string, number>()
  const ends = new Map<string, number>()
  for (const id of graphlib.alg.topsort(dependencies)) {
    const start = Math.max(0, ...(dependencies.predecessors(id) ?? []).map((parent) => ends.get(parent)! + 1))
    const members = components[Number(id)]!.map((member) => byId.get(member)!).toSorted((a, b) => a.column - b.column || a.y - b.y)
    for (const [index, member] of members.entries()) levels.set(member.id, start + index)
    ends.set(id, start + members.length - 1)
  }
  // Preserve the base layout's small groups of independent comments and nodes.
  const isolated = nodes.filter((node) => graph.nodeEdges(node.id)?.length === 0)
  const isolatedColumns = [...new Set(isolated.map((node) => node.column))].toSorted((a, b) => a - b)
  for (const node of isolated) levels.set(node.id, isolatedColumns.indexOf(node.column))
  let primary = 0
  const groups = [...Map.groupBy(nodes, (node) => levels.get(node.id)!).entries()].toSorted(([a], [b]) => a - b)
  for (const [level, members] of groups) {
    const size = Math.max(...members.map((node) => node.width))
    for (const node of members) Object.assign(node, { column: level, x: primary + (size - node.width) / 2 })
    primary += size + gap
  }
}

/** Bend dependency paths continuously; the ports retain their original orientation. */
export function compactLayout(
  graph: GraphLayout,
  insets: { readonly width: number; readonly height: number } = { width: 0, height: 0 },
  aspectRatio = 1,
): CompactLayout {
  if (!graph.nodes.length) return { positions: {}, routes: new Map(), bounds: { x: 0, y: 0, width: 320, height: 120 } }
  const normalized = graph.nodes.map((node) => ({
    ...node,
    ...layoutAxes(node, 'vertical'),
    width: node.height,
    height: node.width,
  }))
  dependencyLevels(normalized, graph.edges, 48)
  const incoming = new Set(graph.edges.map((edge) => edge.target))
  const outgoing = new Set(graph.edges.map((edge) => edge.source))
  const roots = normalized.filter((node) => !incoming.has(node.id) && outgoing.has(node.id))
  const centers = (roots.length ? roots : normalized).map((node) => node.y + node.height / 2)
  const center = centers.reduce((sum, value) => sum + value, 0) / centers.length
  const gap = 48
  const pathNodes = normalized.filter((node) => incoming.has(node.id) || outgoing.has(node.id))
  const crossSize = Math.max(...(pathNodes.length ? pathNodes : normalized).map((node) => node.height))
  const bow = crossSize * 0.75
  const separation = crossSize + 48
  const bucketSize = Math.max(...normalized.map((node) => node.width)) + gap
  const byId = new Map(normalized.map((node) => [node.id, node]))
  // A feedback edge is routed, but does not move an already placed ancestor.
  const forwardEdges = graph.edges.filter((edge) => byId.get(edge.source)!.column < byId.get(edge.target)!.column)
  const parents = Map.groupBy(forwardEdges, (edge) => edge.target)
  const children = Map.groupBy(forwardEdges, (edge) => edge.source)
  const ordered = normalized.toSorted((a, b) => a.column - b.column || a.y - b.y)
  const remaining = new Map<string, number>()
  for (const node of ordered.toReversed()) {
    remaining.set(
      node.id,
      1 + Math.max(0, ...(children.get(node.id) ?? []).filter((edge) => parents.get(edge.target)?.length === 1).map((edge) => remaining.get(edge.target)!)),
    )
  }
  const rankEnds = new Map(
    [...Map.groupBy(normalized, (node) => node.column)].map(([rank, nodes]) => [rank, Math.max(...nodes.map((node) => node.x + node.width))]),
  )
  const spans = new Set([Infinity, ...rankEnds.values()])
  interface Placement {
    node: LayoutNode
    order: number
    shift: number
    start: number
    extent: number
  }
  let best: { nodes: LayoutNode[]; score: number; area: number; turns: number } | undefined
  for (const span of spans) {
    const placed = new Map<string, Placement>()
    const buckets = new Map<number, Placement[]>()
    let turns = 0
    for (const original of ordered) {
      const upstream = parents.get(original.id)?.map((edge) => placed.get(edge.source)!) ?? []
      const parent = upstream[0]
      const side = original.y + original.height / 2 < center - 1e-6 ? -1 : 1
      let primary = upstream.length
        ? Math.max(
            ...upstream.map(({ node }) => {
              const source = byId.get(node.id)!
              return node.x + rankEnds.get(source.column)! - source.x
            }),
          ) + gap
        : original.x
      let shift = 0
      let start = 0
      if (upstream.length > 1) {
        // A shared join follows the entire folded branch, including earlier runs.
        primary = Math.max(...upstream.map((entry) => entry.extent)) + gap
        shift = upstream.reduce((sum, { node }) => sum + node.y + node.height / 2, 0) / upstream.length - original.y - original.height / 2
        start = primary
      } else if (parent) {
        shift = parent.shift
        start = parent.start
        if ((children.get(parent.node.id)?.length ?? 0) > 1) {
          shift = parent.node.y - byId.get(parent.node.id)!.y
          start = primary
        } else if (primary + original.width > span && remaining.get(original.id)! > 2) {
          // Each run keeps the normal port direction. Only the edge between runs
          // returns through a U, rather than reversing every node in a run.
          primary = Math.max(0, start - span / 3)
          shift = parent.shift + side * separation
          start = primary
          turns++
        }
      }
      const progress = Number.isFinite(span) && span > start ? Math.min(1, Math.max(0, (primary - start) / (span - start))) : 0
      const drift = side * bow * Math.sin(progress * Math.PI)
      const node = { ...original, x: primary, y: original.y + shift + drift }
      const firstBucket = Math.floor(node.x / bucketSize)
      const lastBucket = Math.floor((node.x + node.width + gap) / bucketSize)
      const nearby = new Set<Placement>()
      for (let bucket = firstBucket; bucket <= lastBucket; bucket++) for (const entry of buckets.get(bucket) ?? []) nearby.add(entry)
      // Keep placement order identical while checking only overlapping levels.
      const candidates = [...nearby].toSorted((a, b) => a.order - b.order)
      // Displace an occupied branch outward, carrying its shift into descendants.
      while (true) {
        const collision = candidates.find(
          ({ node: other }) =>
            node.x < other.x + other.width + 48 - 1e-6 &&
            other.x < node.x + node.width + 48 - 1e-6 &&
            node.y < other.y + other.height + 48 - 1e-6 &&
            other.y < node.y + node.height + 48 - 1e-6,
        )
        if (!collision) break
        node.y = side < 0 ? collision.node.y - node.height - 48 : collision.node.y + collision.node.height + 48
      }
      const placement: Placement = {
        node,
        order: placed.size,
        shift: node.y - original.y - drift,
        start,
        extent: Math.max(node.x + node.width, ...upstream.map((entry) => entry.extent)),
      }
      placed.set(node.id, placement)
      for (let bucket = firstBucket; bucket <= lastBucket; bucket++) {
        const entries = buckets.get(bucket)
        if (entries) entries.push(placement)
        else buckets.set(bucket, [placement])
      }
    }
    const nodes = [...placed.values()].map((entry) => entry.node)
    // Routing channels fit inside the measured cards plus their port stubs.
    const extent = bounds(nodes)
    const width = extent.height + insets.width + 48
    const height = extent.width + insets.height + 48
    const area = width * height
    const score = Math.max(width / aspectRatio, height)
    if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) < 1e-9 && (area < best.area || (area === best.area && turns < best.turns)))) {
      best = { nodes, score, area, turns }
    }
  }
  const routes = routeLayout(
    best!.nodes,
    graph.edges.map((edge) =>
      Object.assign({}, edge, {
        sourceOffset: edge.sourceOffset && layoutAxes(edge.sourceOffset, 'vertical'),
        targetOffset: edge.targetOffset && layoutAxes(edge.targetOffset, 'vertical'),
      }),
    ),
  )
  const physicalNodes = best!.nodes.map((node) =>
    Object.assign({}, node, layoutAxes(node, 'vertical'), {
      width: node.height,
      height: node.width,
    }),
  )
  const physicalRoutes = new Map([...routes].map(([id, points]) => [id, points.map((point) => layoutAxes(point, 'vertical'))]))
  return {
    positions: Object.fromEntries(physicalNodes.map(({ id, x, y }) => [id, { x, y }])),
    routes: physicalRoutes,
    bounds: bounds(physicalNodes, physicalRoutes),
  }
}
