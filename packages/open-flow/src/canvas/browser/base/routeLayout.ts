import type { GraphLayoutEdge } from './graphLayout.ts'
import type { LayoutNode, LayoutPoint } from './wrapLayout.ts'

import { graphlib } from '@dagrejs/dagre'

const clearance = 16
const portOffset = 24

function componentIndex(sets: string[][]): Map<string, number> {
  return new Map(sets.flatMap((ids, index) => ids.map((id) => [id, index] as const)))
}

/** Orthogonal channels around the measured cards, in primary/cross coordinates. */
export function routeLayout(
  nodes: readonly LayoutNode[],
  edges: readonly GraphLayoutEdge[],
  options: { readonly allowBlockedPorts?: boolean } = {},
): ReadonlyMap<string, readonly LayoutPoint[]> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const graph = new graphlib.Graph()
  for (const node of nodes) graph.setNode(node.id)
  for (const edge of edges) graph.setEdge(edge.source, edge.target)
  const components = componentIndex(graphlib.alg.components(graph))
  const cycles = componentIndex(graphlib.alg.tarjan(graph))
  const obstacles = nodes.map((node) => ({
    component: components.get(node.id),
    left: node.x - clearance,
    right: node.x + node.width + clearance,
    top: node.y - clearance,
    bottom: node.y + node.height + clearance,
  }))
  const connections = edges.map((edge) => {
    const source = byId.get(edge.source)!
    const target = byId.get(edge.target)!
    const output = { x: source.x + (edge.sourceOffset?.x ?? source.width), y: source.y + (edge.sourceOffset?.y ?? source.height / 2) }
    const input = { x: target.x + (edge.targetOffset?.x ?? 0), y: target.y + (edge.targetOffset?.y ?? target.height / 2) }
    const offset = output.x < input.x ? Math.min(portOffset, (input.x - output.x) / 2) : portOffset
    const feedback = input.x <= output.x && cycles.get(edge.source) === cycles.get(edge.target)
    return {
      id: edge.id,
      component: components.get(edge.source),
      source: output,
      target: input,
      returnSide: input.x <= output.x ? Math.sign(input.y - output.y) : 0,
      feedback,
      returnLane: undefined as number | undefined,
      start: { x: output.x + offset, y: output.y },
      end: { x: input.x - offset, y: input.y },
    }
  })
  // Shorter loops use the inner lanes so nested returns do not cross.
  const feedback = connections.filter((edge) => edge.feedback).toSorted((a, b) => a.source.x - a.target.x - (b.source.x - b.target.x))
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
  const routes = new Map<string, readonly LayoutPoint[]>()
  // Most connections only cross the empty gap between consecutive levels.
  // Reserve the obstacle grid for returns and genuinely obstructed connections.
  const pending = connections.filter((edge) => {
    if (edge.start.x > edge.end.x) return true
    const middle = (edge.start.x + edge.end.x) / 2
    const points = [edge.start, { x: middle, y: edge.start.y }, { x: middle, y: edge.end.y }, edge.end]
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1]!
      const b = points[index]!
      if (
        obstacles.some((rect) =>
          a.x === b.x
            ? a.x > rect.left && a.x < rect.right && Math.max(a.y, b.y) > rect.top && Math.min(a.y, b.y) < rect.bottom
            : a.y > rect.top && a.y < rect.bottom && Math.max(a.x, b.x) > rect.left && Math.min(a.x, b.x) < rect.right,
        )
      )
        return true
    }
    // Extra collinear stubs would artificially shorten the rendered corner radius.
    routes.set(edge.id, [edge.source, points[1]!, points[2]!, edge.target])
    return false
  })
  if (!pending.length) return routes
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
        const length = Math.abs(xs[next % columns]! - xs[x]!) + Math.abs(ys[Math.floor(next / columns)]! - ys[y]!)
        const distance = distances[entry.state]! + length + (entry.state % 2 === axis ? 0 : 8)
        if (visited[state] === generation && distance >= distances[state]!) continue
        visited[state] = generation
        distances[state] = distance
        previous[state] = entry.state
        enqueue(queue, { state, score: distance + heuristic(next) })
      }
    }
    if (finish < 0) {
      // Overlapping cards can block a port while dragging; keep export failures explicit.
      if (options.allowBlockedPorts) continue
      throw new Error('Could not route the compact workflow connection.')
    }
    const points: LayoutPoint[] = []
    for (let state = finish; state >= 0; state = previous[state]!) {
      const vertex = Math.floor(state / 2)
      points.push({ x: xs[vertex % columns]!, y: ys[Math.floor(vertex / columns)]! })
    }
    points.reverse()
    const turns = points.filter((point, index) => {
      const before = points[index - 1]
      const after = points[index + 1]
      return !before || !after || !((before.x === point.x && point.x === after.x) || (before.y === point.y && point.y === after.y))
    })
    routes.set(edge.id, [edge.source, ...turns, edge.target])
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
