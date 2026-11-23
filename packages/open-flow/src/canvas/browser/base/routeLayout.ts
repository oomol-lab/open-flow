import type { GraphLayoutEdge } from './graphLayout.ts'
import type { LayoutNode, LayoutPoint } from './wrapLayout.ts'

import { graphlib } from '@dagrejs/dagre'

const clearance = 16
const cardMargin = 8
const portOffset = 24
const laneSpacing = 10
const congestionPenalty = 240

interface ObstacleRect {
  readonly component: number | undefined
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

interface ConnectionCandidate {
  readonly id: string
  readonly index: number
  readonly component: number | undefined
  readonly source: LayoutPoint
  readonly target: LayoutPoint
  readonly returnSide: number
  readonly feedback: boolean
  returnLane: number | undefined
  readonly start: LayoutPoint
  readonly end: LayoutPoint
}

function componentIndex(sets: string[][]): Map<string, number> {
  return new Map(sets.flatMap((ids, index) => ids.map((id) => [id, index] as const)))
}

function samePoint(a: LayoutPoint, b: LayoutPoint): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
}

function endpointKey(edge: ConnectionCandidate): string {
  return `${edge.source.x},${edge.source.y}->${edge.target.x},${edge.target.y}`
}

function clearsObstacles(points: readonly LayoutPoint[], obstacles: readonly ObstacleRect[]): boolean {
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!
    const b = points[index]!
    const crosses = obstacles.some((rect) =>
      Math.abs(a.x - b.x) < 1e-6
        ? a.x > rect.left && a.x < rect.right && Math.max(a.y, b.y) > rect.top && Math.min(a.y, b.y) < rect.bottom
        : a.y > rect.top && a.y < rect.bottom && Math.max(a.x, b.x) > rect.left && Math.min(a.x, b.x) < rect.right,
    )
    if (crosses) return false
  }
  return true
}

function tieKey(edge: ConnectionCandidate): number {
  return Math.min(edge.start.y, edge.end.y)
}

function forwardChannelLanes(candidates: readonly ConnectionCandidate[], obstacles: readonly ObstacleRect[]): Map<string, number> {
  const lanes = new Map<string, number>()
  const jogged = candidates.filter((edge) => Math.abs(edge.start.y - edge.end.y) > 1e-6)
  if (jogged.length < 2) return lanes

  const parents = Array.from({ length: jogged.length }, (_, index) => index)
  const find = (index: number): number => (parents[index] === index ? index : (parents[index] = find(parents[index]!)))
  const unite = (a: number, b: number) => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parents[rootB] = rootA
  }

  for (let i = 0; i < jogged.length; i++) {
    const a = jogged[i]!
    const aMid = (a.start.x + a.end.x) / 2
    const aMinY = Math.min(a.start.y, a.end.y)
    const aMaxY = Math.max(a.start.y, a.end.y)
    const aDirY = a.end.y - a.start.y
    for (let j = i + 1; j < jogged.length; j++) {
      const b = jogged[j]!
      if (Math.max(a.start.x, b.start.x) > Math.min(a.end.x, b.end.x) + 1e-6) continue
      const bMid = (b.start.x + b.end.x) / 2
      const closeMid = Math.abs(aMid - bMid) <= laneSpacing || (aMid >= b.start.x && aMid <= b.end.x) || (bMid >= a.start.x && bMid <= a.end.x)
      if (!closeMid) continue
      const bMinY = Math.min(b.start.y, b.end.y)
      const bMaxY = Math.max(b.start.y, b.end.y)
      if (Math.max(aMinY, bMinY) > Math.min(aMaxY, bMaxY) + 1e-6) continue
      const bDirY = b.end.y - b.start.y
      if (samePoint(a.source, b.source) && aDirY * bDirY < 0) continue
      if (samePoint(a.target, b.target) && aDirY * bDirY < 0) continue
      unite(i, j)
    }
  }

  const groups = new Map<number, ConnectionCandidate[]>()
  for (let i = 0; i < jogged.length; i++) {
    const root = find(i)
    const list = groups.get(root) ?? []
    list.push(jogged[i]!)
    groups.set(root, list)
  }

  for (const cluster of groups.values()) {
    if (cluster.length < 2) continue
    const k = cluster.length
    const outgoing = Array.from({ length: k }, () => new Set<number>())
    const indegree = new Int32Array(k)
    for (let i = 0; i < k; i++) {
      const a = cluster[i]!
      const aMinY = Math.min(a.start.y, a.end.y)
      const aMaxY = Math.max(a.start.y, a.end.y)
      for (let j = 0; j < k; j++) {
        if (i === j) continue
        const b = cluster[j]!
        if (b.start.y > aMinY + 1e-6 && b.start.y < aMaxY - 1e-6 && !outgoing[j]!.has(i) && !outgoing[i]!.has(j)) {
          outgoing[j]!.add(i)
          indegree[i]++
        }
        if (b.end.y > aMinY + 1e-6 && b.end.y < aMaxY - 1e-6 && !outgoing[i]!.has(j) && !outgoing[j]!.has(i)) {
          outgoing[i]!.add(j)
          indegree[j]++
        }
      }
    }

    const ordered: ConnectionCandidate[] = []
    const placed = new Uint8Array(k)
    while (ordered.length < k) {
      let best = -1
      for (let i = 0; i < k; i++) {
        if (placed[i] || indegree[i]! > 0) continue
        if (
          best < 0 ||
          tieKey(cluster[i]!) < tieKey(cluster[best]!) ||
          (tieKey(cluster[i]!) === tieKey(cluster[best]!) && cluster[i]!.index < cluster[best]!.index)
        ) {
          best = i
        }
      }
      if (best < 0) {
        for (let i = 0; i < k; i++) {
          if (placed[i]) continue
          if (
            best < 0 ||
            tieKey(cluster[i]!) < tieKey(cluster[best]!) ||
            (tieKey(cluster[i]!) === tieKey(cluster[best]!) && cluster[i]!.index < cluster[best]!.index)
          ) {
            best = i
          }
        }
      }
      placed[best] = 1
      ordered.push(cluster[best]!)
      for (const next of outgoing[best]!) indegree[next]--
    }

    const gapLeft = Math.max(...ordered.map((edge) => edge.start.x))
    const gapRight = Math.min(...ordered.map((edge) => edge.end.x))
    const center = gapLeft <= gapRight ? (gapLeft + gapRight) / 2 : ordered.reduce((sum, edge) => sum + (edge.start.x + edge.end.x) / 2, 0) / k
    const spacing = gapLeft <= gapRight ? Math.min(laneSpacing, (gapRight - gapLeft) / Math.max(1, k - 1)) : laneSpacing

    for (const [rank, edge] of ordered.entries()) {
      const candidateX = Math.min(Math.max(center + (rank - (k - 1) / 2) * spacing, edge.start.x), edge.end.x)
      const path = [edge.start, { x: candidateX, y: edge.start.y }, { x: candidateX, y: edge.end.y }, edge.end]
      if (clearsObstacles(path, obstacles)) lanes.set(edge.id, candidateX)
    }
  }
  return lanes
}

interface InteriorSegment {
  readonly routeId: string
  readonly points: LayoutPoint[]
  readonly segIndex: number
  readonly axis: 'h' | 'v'
  readonly coord: number
  readonly minSpan: number
  readonly maxSpan: number
  readonly neighborAvg: number
  readonly samePortKey?: string
}

function separateOverlappingSegments(routes: Map<string, LayoutPoint[]>, nodes: readonly LayoutNode[]): void {
  const buckets = new Map<string, InteriorSegment[]>()
  for (const [routeId, points] of routes) {
    if (points.length < 4) continue
    for (let segIndex = 1; segIndex <= points.length - 3; segIndex++) {
      const a = points[segIndex]!
      const b = points[segIndex + 1]!
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue
      const vertical = Math.abs(a.x - b.x) < 1e-6
      const axis = vertical ? 'v' : 'h'
      const coord = vertical ? a.x : a.y
      const minSpan = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x)
      const maxSpan = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x)
      const prev = points[segIndex - 1]!
      const next = points[segIndex + 2]!
      const neighborAvg = vertical ? (prev.x + next.x) / 2 : (prev.y + next.y) / 2
      let samePortKey: string | undefined
      if (segIndex === 1) samePortKey = `s:${points[0]!.x},${points[0]!.y}`
      else if (segIndex === points.length - 3) samePortKey = `t:${points.at(-1)!.x},${points.at(-1)!.y}`
      const key = `${axis}:${Math.round(coord * 1000)}`
      const list = buckets.get(key) ?? []
      list.push({ routeId, points, segIndex, axis, coord, minSpan, maxSpan, neighborAvg, samePortKey })
      buckets.set(key, list)
    }
  }

  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue
    const parents = Array.from({ length: bucket.length }, (_, index) => index)
    const find = (index: number): number => (parents[index] === index ? index : (parents[index] = find(parents[index]!)))
    const unite = (a: number, b: number) => {
      const rootA = find(a)
      const rootB = find(b)
      if (rootA !== rootB) parents[rootB] = rootA
    }
    for (let i = 0; i < bucket.length; i++) {
      const a = bucket[i]!
      for (let j = i + 1; j < bucket.length; j++) {
        const b = bucket[j]!
        if (Math.min(a.maxSpan, b.maxSpan) - Math.max(a.minSpan, b.minSpan) <= 1e-3) continue
        if (a.samePortKey && a.samePortKey === b.samePortKey) continue
        unite(i, j)
      }
    }

    const clusters = new Map<number, InteriorSegment[]>()
    for (let i = 0; i < bucket.length; i++) {
      const root = find(i)
      const list = clusters.get(root) ?? []
      list.push(bucket[i]!)
      clusters.set(root, list)
    }

    for (const cluster of clusters.values()) {
      if (cluster.length < 2) continue
      const axis = cluster[0]!.axis
      const coord = cluster[0]!.coord
      const minSpan = Math.min(...cluster.map((seg) => seg.minSpan))
      const maxSpan = Math.max(...cluster.map((seg) => seg.maxSpan))
      let lowBound = coord - 48
      let highBound = coord + 48

      for (const node of nodes) {
        const nodeMinSpan = axis === 'v' ? node.y : node.x
        const nodeMaxSpan = axis === 'v' ? node.y + node.height : node.x + node.width
        if (Math.min(maxSpan, nodeMaxSpan) - Math.max(minSpan, nodeMinSpan) <= -cardMargin) continue
        const nodeLow = (axis === 'v' ? node.x : node.y) - cardMargin
        const nodeHigh = (axis === 'v' ? node.x + node.width : node.y + node.height) + cardMargin
        if (nodeHigh <= coord + 1e-3) lowBound = Math.max(lowBound, nodeHigh)
        if (nodeLow >= coord - 1e-3) highBound = Math.min(highBound, nodeLow)
      }

      for (const seg of cluster) {
        if (axis !== 'v') continue
        if (seg.segIndex === 1) lowBound = Math.max(lowBound, seg.points[0]!.x + cardMargin)
        if (seg.segIndex === seg.points.length - 3) highBound = Math.min(highBound, seg.points.at(-1)!.x - cardMargin)
      }
      if (highBound - lowBound <= 2) continue

      const ordered = [...cluster].toSorted(
        (a, b) => a.neighborAvg - b.neighborAvg || a.maxSpan - a.minSpan - (b.maxSpan - b.minSpan) || a.routeId.localeCompare(b.routeId),
      )
      const spacing = Math.min(laneSpacing, (highBound - lowBound) / Math.max(1, ordered.length - 1))
      const totalWidth = (ordered.length - 1) * spacing
      const startCoord = Math.min(Math.max(coord - totalWidth / 2, lowBound), highBound - totalWidth)
      for (const [index, seg] of ordered.entries()) {
        const nextCoord = startCoord + index * spacing
        const a = seg.points[seg.segIndex]!
        const b = seg.points[seg.segIndex + 1]!
        seg.points[seg.segIndex] = axis === 'v' ? { x: nextCoord, y: a.y } : { x: a.x, y: nextCoord }
        seg.points[seg.segIndex + 1] = axis === 'v' ? { x: nextCoord, y: b.y } : { x: b.x, y: nextCoord }
      }
    }
  }
}

/** Orthogonal channels around the measured cards, in primary/cross coordinates.
 * Connections without a clear route use the edge renderer's standard path. */
export function routeLayout(nodes: readonly LayoutNode[], edges: readonly GraphLayoutEdge[]): ReadonlyMap<string, readonly LayoutPoint[]> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const graph = new graphlib.Graph()
  for (const node of nodes) graph.setNode(node.id)
  for (const edge of edges) graph.setEdge(edge.source, edge.target)
  const components = componentIndex(graphlib.alg.components(graph))
  const cycles = componentIndex(graphlib.alg.tarjan(graph))
  const obstacles: ObstacleRect[] = nodes.map((node) => ({
    component: components.get(node.id),
    left: node.x - clearance,
    right: node.x + node.width + clearance,
    top: node.y - clearance,
    bottom: node.y + node.height + clearance,
  }))
  const connections: ConnectionCandidate[] = edges.map((edge, index) => {
    const source = byId.get(edge.source)!
    const target = byId.get(edge.target)!
    const output = { x: source.x + (edge.sourceOffset?.x ?? source.width), y: source.y + (edge.sourceOffset?.y ?? source.height / 2) }
    const input = { x: target.x + (edge.targetOffset?.x ?? 0), y: target.y + (edge.targetOffset?.y ?? target.height / 2) }
    // Folded runs can have nearby primary coordinates while remaining far apart
    // on the cross axis. Each stub must still clear its own measured card.
    const offset = Math.max(
      output.x < input.x ? Math.min(portOffset, (input.x - output.x) / 2) : portOffset,
      source.x + source.width + clearance - output.x,
      input.x - target.x + clearance,
    )
    const feedback = input.x <= output.x && cycles.get(edge.source) === cycles.get(edge.target)
    return {
      id: edge.id,
      index,
      component: components.get(edge.source),
      source: output,
      target: input,
      returnSide: input.x <= output.x ? Math.sign(input.y - output.y) : 0,
      feedback,
      returnLane: undefined,
      start: { x: output.x + offset, y: output.y },
      end: { x: input.x - offset, y: input.y },
    }
  })

  // Route each identical endpoint pair once and fan out the final path to duplicates.
  const duplicatesByKey = new Map<string, ConnectionCandidate[]>()
  const uniqueConnections: ConnectionCandidate[] = []
  for (const edge of connections) {
    const key = endpointKey(edge)
    const group = duplicatesByKey.get(key)
    if (group) {
      group.push(edge)
    } else {
      duplicatesByKey.set(key, [edge])
      uniqueConnections.push(edge)
    }
  }

  // Shorter loops use the inner lanes so nested returns do not cross.
  const feedback = uniqueConnections.filter((edge) => edge.feedback).toSorted((a, b) => a.source.x - a.target.x - (b.source.x - b.target.x))
  for (const [index, edge] of feedback.entries()) {
    const side = edge.source.y <= edge.target.y ? -1 : 1
    const span = obstacles.filter((rect) => rect.component === edge.component && rect.right >= edge.end.x && rect.left <= edge.start.x)
    let lane = side < 0 ? Math.min(...span.map((rect) => rect.top)) : Math.max(...span.map((rect) => rect.bottom))
    let previousLane: number
    do {
      previousLane = lane
      // A dragged card or comment from another subgraph can still obstruct this lane.
      for (const rect of obstacles) {
        if (rect.right >= edge.end.x && rect.left <= edge.start.x && lane > rect.top && lane < rect.bottom) lane = side < 0 ? rect.top : rect.bottom
      }
      for (const other of feedback.slice(0, index)) {
        if (other.component !== edge.component || other.start.x < edge.end.x || other.end.x > edge.start.x) continue
        if (side < 0 && other.returnLane! <= lane) lane = other.returnLane! - clearance
        if (side > 0 && other.returnLane! >= lane) lane = other.returnLane! + clearance
      }
    } while (lane !== previousLane)
    edge.returnLane = lane
  }

  const uniqueRoutes = new Map<string, LayoutPoint[]>()
  const clearForward: ConnectionCandidate[] = []
  const pending: ConnectionCandidate[] = []
  // Most connections only cross the empty gap between consecutive levels.
  // Reserve the obstacle grid for returns and genuinely obstructed connections.
  for (const edge of uniqueConnections) {
    if (edge.start.x > edge.end.x) {
      pending.push(edge)
      continue
    }
    const middle = (edge.start.x + edge.end.x) / 2
    const points = [edge.start, { x: middle, y: edge.start.y }, { x: middle, y: edge.end.y }, edge.end]
    if (clearsObstacles(points, obstacles)) clearForward.push(edge)
    else pending.push(edge)
  }

  const assignedLanes = forwardChannelLanes(clearForward, obstacles)
  for (const edge of clearForward) {
    const middle = assignedLanes.get(edge.id) ?? (edge.start.x + edge.end.x) / 2
    // Extra collinear stubs would artificially shorten the rendered corner radius.
    uniqueRoutes.set(edge.id, [edge.source, { x: middle, y: edge.start.y }, { x: middle, y: edge.end.y }, edge.target])
  }

  if (pending.length) {
    const xs = [...new Set([...obstacles.flatMap((rect) => [rect.left, rect.right]), ...pending.flatMap((edge) => [edge.start.x, edge.end.x])])].toSorted(
      (a, b) => a - b,
    )
    const ys = [
      ...new Set([
        ...obstacles.flatMap((rect) => [rect.top, rect.bottom]),
        ...pending.flatMap((edge) => (edge.returnLane == null ? [edge.start.y, edge.end.y] : [edge.start.y, edge.end.y, edge.returnLane])),
      ]),
    ].toSorted((a, b) => a - b)
    const xIndex = new Map(xs.map((value, index) => [value, index]))
    const yIndex = new Map(ys.map((value, index) => [value, index]))
    const columns = xs.length
    const size = columns * ys.length
    const horizontal = new Uint8Array(size)
    const vertical = new Uint8Array(size)
    const usedHorizontal = new Uint16Array(size)
    const usedVertical = new Uint16Array(size)
    for (const rect of obstacles) {
      const left = xIndex.get(rect.left)!
      const right = xIndex.get(rect.right)!
      const top = yIndex.get(rect.top)!
      const bottom = yIndex.get(rect.bottom)!
      for (let y = top + 1; y < bottom; y++) for (let x = left; x < right; x++) horizontal[y * columns + x] = 1
      for (let x = left + 1; x < right; x++) for (let y = top; y < bottom; y++) vertical[y * columns + x] = 1
    }
    const distances = new Float64Array(size * 2)
    const previous = new Int32Array(size * 2)
    const visited = new Uint32Array(size * 2)
    for (const [routeIndex, edge] of pending.entries()) {
      const generation = routeIndex + 1
      const start = yIndex.get(edge.start.y)! * columns + xIndex.get(edge.start.x)!
      const end = yIndex.get(edge.end.y)! * columns + xIndex.get(edge.end.x)!
      const queue: { state: number; score: number }[] = []
      const heuristic = (vertex: number) => Math.abs(xs[vertex % columns]! - edge.end.x) + Math.abs(ys[Math.floor(vertex / columns)]! - edge.end.y)
      distances[start * 2] = 0
      previous[start * 2] = -1
      visited[start * 2] = generation
      enqueue(queue, { state: start * 2, score: heuristic(start) })
      let finish = -1
      while (queue.length) {
        const entry = dequeue(queue)!
        const vertex = Math.floor(entry.state / 2)
        if (entry.score > distances[entry.state]! + heuristic(vertex) + 1e-6) continue
        if (vertex === end) {
          finish = entry.state
          break
        }
        const x = vertex % columns
        const y = Math.floor(vertex / columns)
        const moves = [
          x > 0 && !horizontal[vertex - 1] ? vertex - 1 : -1,
          x + 1 < columns && !horizontal[vertex] ? vertex + 1 : -1,
          y > 0 && !vertical[vertex - columns] ? vertex - columns : -1,
          y + 1 < ys.length && !vertical[vertex] ? vertex + columns : -1,
        ]
        for (const [index, next] of moves.entries()) {
          // Keep fixed port stubs forward. Feedback travels upstream in its own
          // exterior lane; folded forward runs turn toward their next column.
          if (next < 0 || (vertex === start && index === 0) || (next === end && index === 0)) continue
          if (edge.returnLane != null) {
            if (index === 0 && ys[y] !== edge.returnLane) continue
          } else if (edge.returnSide * (ys[Math.floor(next / columns)]! - edge.start.y) < -1e-6) continue
          const axis = index < 2 ? 0 : 1
          const state = next * 2 + axis
          const segmentIndex = index === 0 ? vertex - 1 : index === 1 ? vertex : index === 2 ? vertex - columns : vertex
          const used = axis === 0 ? usedHorizontal[segmentIndex]! : usedVertical[segmentIndex]!
          const length = Math.abs(xs[next % columns]! - xs[x]!) + Math.abs(ys[Math.floor(next / columns)]! - ys[y]!)
          const distance = distances[entry.state]! + length + (entry.state % 2 === axis ? 0 : 8) + used * congestionPenalty
          if (visited[state] === generation && distance >= distances[state]!) continue
          visited[state] = generation
          distances[state] = distance
          previous[state] = entry.state
          enqueue(queue, { state, score: distance + heuristic(next) })
        }
      }
      if (finish < 0) continue
      const points: LayoutPoint[] = []
      const vertices: number[] = []
      for (let state = finish; state >= 0; state = previous[state]!) {
        const vertex = Math.floor(state / 2)
        vertices.push(vertex)
        points.push({ x: xs[vertex % columns]!, y: ys[Math.floor(vertex / columns)]! })
      }
      for (let i = 1; i < vertices.length; i++) {
        const a = vertices[i - 1]!
        const b = vertices[i]!
        if (Math.floor(a / columns) === Math.floor(b / columns)) usedHorizontal[Math.min(a, b)]! += 1
        else usedVertical[Math.min(a, b)]! += 1
      }
      points.reverse()
      const turns = points.filter((point, index) => {
        const before = points[index - 1]
        const after = points[index + 1]
        return !before || !after || !((before.x === point.x && point.x === after.x) || (before.y === point.y && point.y === after.y))
      })
      uniqueRoutes.set(edge.id, [edge.source, ...turns, edge.target])
    }
  }

  separateOverlappingSegments(uniqueRoutes, nodes)

  const routes = new Map<string, readonly LayoutPoint[]>()
  for (const edge of uniqueConnections) {
    const route = uniqueRoutes.get(edge.id)
    if (!route) continue
    for (const member of duplicatesByKey.get(endpointKey(edge))!) {
      routes.set(member.id, route)
    }
  }
  return routes
}

function enqueue(queue: { state: number; score: number }[], entry: { state: number; score: number }) {
  let index = queue.length
  queue.push(entry)
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2)
    if (queue[parent]!.score <= entry.score) break
    queue[index] = queue[parent]!
    index = parent
  }
  queue[index] = entry
}

function dequeue(queue: { state: number; score: number }[]) {
  const first = queue[0]
  const last = queue.pop()!
  if (!queue.length) return first
  let index = 0
  while (index * 2 + 1 < queue.length) {
    let child = index * 2 + 1
    if (child + 1 < queue.length && queue[child + 1]!.score < queue[child]!.score) child++
    if (last.score <= queue[child]!.score) break
    queue[index] = queue[child]!
    index = child
  }
  queue[index] = last
  return first
}
