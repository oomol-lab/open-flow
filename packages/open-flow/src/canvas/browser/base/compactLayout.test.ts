import type { CanvasDirection } from '../../common/direction.ts'
import type { GraphLayoutEdge, GraphLayoutNode } from './graphLayout.ts'
import type { LayoutNode, LayoutPoint } from './wrapLayout.ts'

import { describe, expect, it } from 'vitest'
import { compactLayout } from './compactLayout.ts'
import { graphLayout } from './graphLayout.ts'
import { hasRouteCrossings } from './routeCrossings.ts'
import { layoutAxes } from './wrapLayout.ts'

function intersects(a: LayoutPoint, b: LayoutPoint, rect: LayoutNode): boolean {
  let enter = 0
  let leave = 1
  for (const [start, end, near, far] of [
    [a.x, b.x, rect.x + 0.01, rect.x + rect.width - 0.01],
    [a.y, b.y, rect.y + 0.01, rect.y + rect.height - 0.01],
  ]) {
    if (start === end) {
      if (start! < near! || start! > far!) return false
    } else {
      const first = (near! - start!) / (end! - start!)
      const last = (far! - start!) / (end! - start!)
      enter = Math.max(enter, Math.min(first, last))
      leave = Math.min(leave, Math.max(first, last))
    }
  }
  return enter < leave
}

function branched(direction: CanvasDirection, feedback = false, rightCount = 20) {
  const nodes: GraphLayoutNode[] = []
  const edges: GraphLayoutEdge[] = []
  const add = (id: string, index = 0) => nodes.push({ id, width: 280 + (index % 3) * 60, height: 100 + (index % 4) * 40 })
  const connect = (source: string, target: string, sourceHandle?: string) => edges.push({ id: source + '-' + target, source, target, sourceHandle })
  nodes.push({ id: 'root', width: 520, height: 260, branchHandles: ['$branch:left', '$branch:right'] })
  for (const side of ['left', 'right']) {
    for (let index = 0; index < (side === 'right' ? rightCount : 20); index++) {
      add(side + index, index)
      if (index) connect(side + (index - 1), side + index)
      else connect('root', side + index, '$branch:' + side)
    }
  }
  add('join')
  connect('left19', 'join')
  connect('right' + (rightCount - 1), 'join')
  add('nested')
  connect('left5', 'nested')
  connect('nested', 'left10')
  if (rightCount > 12) connect('root', 'right12', '$branch:right')
  for (const id of ['second-root', 'second-leaf', 'note']) add(id)
  connect('second-root', 'second-leaf')
  if (feedback) connect('join', 'left3')
  return graphLayout(nodes, edges, direction)
}

describe('vertical compact layout', () => {
  const direction = 'vertical' as const
  it.each([5, 12, 50])('keeps the connections of a folded %s-step pipeline from crossing', (count) => {
    const graph = graphLayout(
      Array.from({ length: count }, (_, index) => ({ id: String(index), width: 336, height: 80 })),
      Array.from({ length: count - 1 }, (_, index) => ({ id: String(index), source: String(index), target: String(index + 1) })),
      direction,
    )
    const result = compactLayout(graph, { width: 104, height: 136 }, 16 / 9)
    const positions = graph.nodes.map((node) => result.positions[node.id]!)
    expect(positions.slice(1).some((position, index) => position.y < positions[index]!.y)).toBe(true)
    const paths = [...result.routes.values()]
    for (const [index, path] of paths.entries()) {
      for (const other of paths.slice(index + 1)) {
        for (let a = 1; a < path.length; a++)
          for (let b = 1; b < other.length; b++) {
            const crosses = (['x', 'y'] as const).every(
              (axis) =>
                Math.max(Math.min(path[a - 1]![axis], path[a]![axis]), Math.min(other[b - 1]![axis], other[b]![axis])) <=
                Math.min(Math.max(path[a - 1]![axis], path[a]![axis]), Math.max(other[b - 1]![axis], other[b]![axis])),
            )
            expect(crosses, `connections ${index} and ${paths.indexOf(other)} cross`).toBe(false)
          }
      }
    }
  })

  it('balances whole cards around a taller trigger', () => {
    const graph = graphLayout(
      Array.from({ length: 6 }, (_, index) => ({ id: String(index), width: 336, height: index === 0 ? 128 : 92 })),
      Array.from({ length: 5 }, (_, index) => ({ id: String(index), source: String(index), target: String(index + 1) })),
      direction,
    )
    const result = compactLayout(graph, { width: 104, height: 136 }, 16 / 9)
    const path = graph.nodes.map((node) => result.positions[node.id]!)
    expect(path.slice(1).flatMap((point, index) => (point.y < path[index]!.y ? [index + 1] : []))).toEqual([3])
    expect(hasRouteCrossings(result.routes)).toBe(false)
  })

  it('automatically balances long chains without changing node sizes or the graph', () => {
    const graph = graphLayout(
      Array.from({ length: 50 }, (_, index) => ({ id: String(index), width: 320, height: 120 })),
      Array.from({ length: 49 }, (_, index) => ({ id: String(index), source: String(index), target: String(index + 1) })),
      direction,
    )
    const before = structuredClone(graph)
    const result = compactLayout(graph, { width: 104, height: 136 })
    expect(Math.max(result.bounds.width / result.bounds.height, result.bounds.height / result.bounds.width)).toBeLessThan(1.5)
    expect(result.routes.size).toBeGreaterThan(0)
    expect(Object.keys(result.positions)).toHaveLength(50)
    expect(graph).toEqual(before)
    expect(compactLayout(graph, { width: 104, height: 136 })).toEqual(result)
    const first = layoutAxes(result.positions['0']!, direction)
    const last = layoutAxes(result.positions['49']!, direction)
    expect(last.y).toBeGreaterThan(first.y)
    const sequence = graph.nodes.map((node) => layoutAxes(result.positions[node.id]!, direction))
    const steps = sequence.slice(1).map((point, index) => point.x - sequence[index]!.x)
    const returns = steps.filter((step) => step < 0)
    expect(returns.length).toBeGreaterThan(0)
    expect(returns.length).toBeLessThan(sequence.length / 3)
    expect(steps.filter((step) => step > 0).length).toBeGreaterThan((sequence.length * 2) / 3)
    expect(new Set(sequence.map((point) => point.y)).size).toBeGreaterThan(10)
    for (const points of result.routes.values()) {
      const normalized = points.map((point) => layoutAxes(point, direction))
      expect(normalized[1]!.x).toBeGreaterThan(normalized[0]!.x)
      expect(normalized[1]!.y).toBe(normalized[0]!.y)
      expect(normalized.at(-1)!.x).toBeGreaterThan(normalized.at(-2)!.x)
      expect(normalized.at(-1)!.y).toBe(normalized.at(-2)!.y)
    }
  })

  it.each([false, true])('preserves nested branches, multiple roots and one shared join (feedback=%s)', (feedback) => {
    const graph = branched(direction, feedback)
    const result = compactLayout(graph)
    const nodes = graph.nodes.map((node) => ({ ...node, ...result.positions[node.id]! }))
    expect(nodes.filter((node) => node.id === 'join')).toHaveLength(1)
    expect(Object.keys(result.positions)).toHaveLength(graph.nodes.length)
    for (const [index, node] of nodes.entries()) {
      for (const other of nodes.slice(index + 1)) {
        expect(node.x + node.width <= other.x || other.x + other.width <= node.x || node.y + node.height <= other.y || other.y + other.height <= node.y).toBe(
          true,
        )
      }
    }
    for (const points of result.routes.values()) {
      for (let index = 1; index < points.length; index++) {
        for (const node of nodes) expect(intersects(points[index - 1]!, points[index]!, node), 'route crosses ' + node.id).toBe(false)
      }
    }
  })

  it('keeps named branch targets in their authored order', () => {
    const result = compactLayout(branched(direction))
    expect(layoutAxes(result.positions.left0!, direction).y).toBeLessThan(layoutAxes(result.positions.right0!, direction).y)
  })

  it('keeps short branches near their fork and the join after all incoming runs', () => {
    const forest = branched(direction, false, 2)
    // Measure this connected tree's folding independently of forest row packing.
    const independent = new Set(['second-root', 'second-leaf', 'note'])
    const graph = { nodes: forest.nodes.filter((node) => !independent.has(node.id)), edges: forest.edges.filter((edge) => !independent.has(edge.source)) }
    const result = compactLayout(graph)
    const fork = layoutAxes(result.positions.root!, direction)
    const maximumSize = Math.max(...graph.nodes.map((node) => (direction === 'vertical' ? node.height : node.width)))
    for (const id of ['left0', 'right0']) {
      expect(Math.abs(layoutAxes(result.positions[id]!, direction).x - fork.x)).toBeLessThanOrEqual(maximumSize + 128)
    }
    const path = Array.from({ length: 20 }, (_, index) => layoutAxes(result.positions['left' + index]!, direction))
    const returns = path.slice(1).filter((point, index) => point.x < path[index]!.x)
    expect(returns.length).toBeLessThan(path.length / 2)
    const join = layoutAxes(result.positions.join!, direction)
    expect(join.x).toBeGreaterThan(
      Math.max(
        ...path.map(
          (point, index) =>
            point.x +
            (direction === 'vertical'
              ? graph.nodes.find((node) => node.id === 'left' + index)!.height
              : graph.nodes.find((node) => node.id === 'left' + index)!.width),
        ),
      ),
    )
    expect(hasRouteCrossings(result.routes)).toBe(false)
  })

  it('keeps the trunk together beside a large annotation and avoids folding a short tail', () => {
    const nodes: GraphLayoutNode[] = [
      { id: 'note', width: 366, height: 276 },
      { id: 'start', width: 336, height: 92 },
      { id: 'score', width: 336, height: 127 },
      { id: 'fork', width: 336, height: 158, branchHandles: ['long', 'short'] },
      { id: 'short', width: 336, height: 215 },
      ...Array.from({ length: 18 }, (_, index) => ({ id: 'step' + index, width: 336, height: 92 })),
      { id: 'join', width: 336, height: 127 },
      { id: 'end', width: 336, height: 92 },
    ].map((node) => (direction === 'vertical' ? node : Object.assign({}, node, { width: node.height, height: node.width })))
    const edges = [
      { source: 'start', target: 'score' },
      { source: 'score', target: 'fork' },
      { source: 'fork', target: 'step0', sourceHandle: 'long' },
      { source: 'fork', target: 'short', sourceHandle: 'short' },
      ...Array.from({ length: 17 }, (_, index) => ({ source: 'step' + index, target: 'step' + (index + 1) })),
      { source: 'step17', target: 'join' },
      { source: 'short', target: 'join' },
      { source: 'join', target: 'end' },
    ].map((edge) => Object.assign({}, edge, { id: edge.source + '-' + edge.target }))
    const graph = graphLayout(nodes, edges, direction)
    const result = compactLayout(graph)
    const point = (id: string) => layoutAxes(result.positions[id]!, direction)
    expect(Math.abs(point('score').y - point('start').y)).toBeLessThan(168)
    expect(point('step17').x).toBeGreaterThan(point('step16').x)
    expect(point('step16').x).toBeGreaterThan(point('step15').x)
    expect(point('end').x).toBeGreaterThan(point('join').x)
    const path = Array.from({ length: 18 }, (_, index) => point('step' + index))
    const returns = path.slice(1).filter((position, index) => position.x <= path[index]!.x)
    for (const [index, position] of returns.entries()) expect(position.x).toBeLessThanOrEqual((returns[index - 1] ?? path[0])!.x)
    expect(hasRouteCrossings(result.routes)).toBe(false)
  })

  it('handles empty, single-node and unjoined workflows', () => {
    expect(compactLayout({ nodes: [], edges: [] }).positions).toEqual({})
    const single = graphLayout([{ id: 'only', width: 1200, height: 700 }], [], direction)
    expect(compactLayout(single).bounds).toMatchObject({ width: 1200, height: 700 })
    const forest = graphLayout(
      [
        { id: 'root', width: 320, height: 120 },
        { id: 'a', width: 320, height: 120 },
        { id: 'b', width: 320, height: 120 },
      ],
      [
        { id: 'a', source: 'root', target: 'a' },
        { id: 'b', source: 'root', target: 'b' },
      ],
      direction,
    )
    expect(Object.keys(compactLayout(forest).positions)).toHaveLength(3)
  })
})

it('routes three branch outlets from their measured ports without crossing at the fork', () => {
  const nodes = [
    { id: 'fork', width: 336, height: 158, branchHandles: ['priority', 'qualified', 'default'] },
    ...['priority', 'qualified', 'default'].map((id) => ({ id, width: 336, height: 120 })),
  ]
  const edges = ['priority', 'qualified', 'default'].map((id, index) => ({
    id,
    source: 'fork',
    target: id,
    sourceHandle: id,
    sourceOffset: { x: 56 + index * 112, y: 160 },
    targetOffset: { x: 168, y: -2 },
  }))
  const result = compactLayout(graphLayout(nodes, edges, 'vertical'))
  const fork = result.positions.fork!
  const paths = edges.map((edge) => {
    const path = result.routes.get(edge.id)!
    expect(path[0]).toEqual({ x: fork.x + edge.sourceOffset.x, y: fork.y + edge.sourceOffset.y })
    expect(path.at(-1)).toEqual({ x: result.positions[edge.target]!.x + 168, y: result.positions[edge.target]!.y - 2 })
    return path
  })
  for (const [index, path] of paths.entries()) {
    for (const other of paths.slice(index + 1)) {
      for (let a = 1; a < path.length; a++)
        for (let b = 1; b < other.length; b++) {
          const crosses = ['x', 'y'].every((axis) => {
            const key = axis as keyof LayoutPoint
            return (
              Math.max(Math.min(path[a - 1]![key], path[a]![key]), Math.min(other[b - 1]![key], other[b]![key])) <=
              Math.min(Math.max(path[a - 1]![key], path[a]![key]), Math.max(other[b - 1]![key], other[b]![key]))
            )
          })
          expect(crosses).toBe(false)
        }
    }
  }
})

it('adapts folded runs to wide and tall canvas ratios', () => {
  const graph = graphLayout(
    Array.from({ length: 60 }, (_, index) => ({ id: String(index), width: 320, height: 120 })),
    Array.from({ length: 59 }, (_, index) => ({ id: String(index), source: String(index), target: String(index + 1) })),
    'vertical',
  )
  const before = structuredClone(graph)
  const wide = compactLayout(graph, { width: 104, height: 136 }, 16 / 9)
  const tall = compactLayout(graph, { width: 104, height: 136 }, 9 / 16)
  expect(wide.bounds.width / wide.bounds.height).toBeGreaterThan(tall.bounds.width / tall.bounds.height)
  expect(Object.keys(wide.positions)).toHaveLength(60)
  expect(Object.keys(tall.positions)).toHaveLength(60)
  expect(graph).toEqual(before)
})

describe('compact forest layout', () => {
  it('keeps roots with a shared descendant in one tree', () => {
    const graph = graphLayout(
      ['first-root', 'second-root', 'join', 'end', 'isolated'].map((id) => ({ id, width: 320, height: 120 })),
      [
        { id: 'first', source: 'first-root', target: 'join' },
        { id: 'second', source: 'second-root', target: 'join' },
        { id: 'end', source: 'join', target: 'end' },
      ],
      'vertical',
    )
    const result = compactLayout(graph)
    expect(Object.keys(result.positions)).toHaveLength(5)
    expect(result.routes.size).toBe(3)
    expect(result.positions['first-root']!.y).toBe(result.positions['second-root']!.y)
    expect(result.positions.join!.y).toBeGreaterThan(result.positions['first-root']!.y + 120)
    expect(result.positions.end!.y).toBeGreaterThan(result.positions.join!.y + 120)
    expect(result.routes.get('first')!.at(-1)).toEqual(result.routes.get('second')!.at(-1))
  })

  it('wraps complete trees in reading order and adapts row capacity to the canvas ratio', () => {
    const nodes = Array.from({ length: 12 }, (_value, tree) => Array.from({ length: 3 }, (_, step) => ({ id: `${tree}-${step}`, width: 320, height: 120 })))
    const graph = graphLayout(
      nodes.flat(),
      nodes.flatMap((tree) => tree.slice(1).map((node, index) => ({ id: node.id, source: tree[index]!.id, target: node.id }))),
      'vertical',
    )
    const before = structuredClone(graph)
    const result = compactLayout(graph)
    const roots = nodes.map((tree) => result.positions[tree[0]!.id]!)
    expect(new Set(roots.map((point) => point.y)).size).toBeGreaterThan(1)
    for (let index = 1; index < roots.length; index++) {
      const previous = roots[index - 1]!
      const point = roots[index]!
      expect(point.y === previous.y ? point.x > previous.x : point.y > previous.y).toBe(true)
    }
    expect(result.bounds.width).toBeLessThan(Math.max(...graph.nodes.map((node) => node.x + node.width)) * 0.75)
    const wide = compactLayout(graph, { width: 104, height: 136 }, 16 / 9)
    const tall = compactLayout(graph, { width: 104, height: 136 }, 9 / 16)
    expect(wide.bounds.width / wide.bounds.height).toBeGreaterThan(tall.bounds.width / tall.bounds.height)
    expect(Object.keys(result.positions)).toHaveLength(nodes.flat().length)
    expect(compactLayout(graph)).toEqual(result)
    expect(graph).toEqual(before)
  })

  it('packs isolated cards and a large annotation without overlap or splitting a card', () => {
    const graph = graphLayout(
      [
        { id: 'annotation', width: 700, height: 480 },
        ...Array.from({ length: 24 }, (_, index) => ({ id: String(index), width: 280 + (index % 3) * 80, height: 90 + (index % 4) * 30 })),
      ],
      [],
      'vertical',
    )
    const before = structuredClone(graph)
    const result = compactLayout(graph)
    const nodes = graph.nodes.map((node) => ({ ...node, ...result.positions[node.id]! }))
    expect(nodes).toHaveLength(25)
    expect(result.routes.size).toBe(0)
    expect(result.bounds.width * result.bounds.height).toBeLessThan(nodes.reduce((area, node) => area + node.width * node.height, 0) * 4)
    for (const [index, node] of nodes.entries()) {
      expect(node.x).toBeGreaterThanOrEqual(result.bounds.x)
      expect(node.y).toBeGreaterThanOrEqual(result.bounds.y)
      expect(node.x + node.width).toBeLessThanOrEqual(result.bounds.x + result.bounds.width)
      expect(node.y + node.height).toBeLessThanOrEqual(result.bounds.y + result.bounds.height)
      for (const other of nodes.slice(index + 1)) {
        expect(node.x + node.width <= other.x || other.x + other.width <= node.x || node.y + node.height <= other.y || other.y + other.height <= node.y).toBe(
          true,
        )
      }
    }
    expect(graph).toEqual(before)
  })

  it('moves routes with their tree, preserving measured ports, shared joins and feedback connections', () => {
    const base = branched('vertical', true)
    const graph = {
      nodes: base.nodes,
      edges: base.edges.map((edge) =>
        Object.assign({}, edge, {
          sourceOffset: {
            x: base.nodes.find((node) => node.id === edge.source)!.width / 2 - 10,
            y: base.nodes.find((node) => node.id === edge.source)!.height + 2,
          },
          targetOffset: { x: base.nodes.find((node) => node.id === edge.target)!.width / 2 + 6, y: -2 },
        }),
      ),
    }
    const result = compactLayout(graph)
    const nodes = graph.nodes.map((node) => ({ ...node, ...result.positions[node.id]! }))
    expect(Object.keys(result.positions)).toHaveLength(graph.nodes.length)
    expect(result.routes.size).toBe(graph.edges.length)
    expect(result.positions.left0!.x).toBeLessThan(result.positions.right0!.x)
    for (const edge of graph.edges) {
      const route = result.routes.get(edge.id)!
      const start = result.positions[edge.source]!
      const end = result.positions[edge.target]!
      expect(route[0]!.x).toBeCloseTo(start.x + edge.sourceOffset.x)
      expect(route[0]!.y).toBeCloseTo(start.y + edge.sourceOffset.y)
      expect(route.at(-1)!.x).toBeCloseTo(end.x + edge.targetOffset.x)
      expect(route.at(-1)!.y).toBeCloseTo(end.y + edge.targetOffset.y)
      for (const point of route) {
        expect(point.x).toBeGreaterThanOrEqual(result.bounds.x - 1e-6)
        expect(point.y).toBeGreaterThanOrEqual(result.bounds.y - 1e-6)
        expect(point.x).toBeLessThanOrEqual(result.bounds.x + result.bounds.width + 1e-6)
        expect(point.y).toBeLessThanOrEqual(result.bounds.y + result.bounds.height + 1e-6)
      }
      for (let index = 1; index < route.length; index++) {
        for (const node of nodes) expect(intersects(route[index - 1]!, route[index]!, node), 'route crosses ' + node.id).toBe(false)
      }
    }
    const ids = new Set(graph.nodes.filter((node) => !['second-root', 'second-leaf', 'note'].includes(node.id)).map((node) => node.id))
    const tree = compactLayout({ nodes: graph.nodes.filter((node) => ids.has(node.id)), edges: graph.edges.filter((edge) => ids.has(edge.source)) })
    const shift = { x: result.positions.root!.x - tree.positions.root!.x, y: result.positions.root!.y - tree.positions.root!.y }
    for (const id of ids) {
      expect(result.positions[id]!.x).toBeCloseTo(tree.positions[id]!.x + shift.x)
      expect(result.positions[id]!.y).toBeCloseTo(tree.positions[id]!.y + shift.y)
    }
  })
})
