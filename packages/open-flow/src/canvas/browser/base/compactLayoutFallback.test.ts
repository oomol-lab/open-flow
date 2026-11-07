import type { GraphLayoutEdge } from './graphLayout.ts'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { compactLayout } from './compactLayout.ts'
import { graphLayout } from './graphLayout.ts'
import { hasRouteCrossings } from './routeCrossings.ts'
import * as routing from './routeLayout.ts'
import { layoutAxes } from './wrapLayout.ts'

afterEach(() => vi.restoreAllMocks())

function branchedPipeline(shortCount: number, height = 92, longCount = 10) {
  const ids = [
    'root',
    ...Array.from({ length: longCount }, (_, index) => 'long' + index),
    ...Array.from({ length: shortCount }, (_, index) => 'short' + index),
    'join',
  ]
  const edges = [
    ...Array.from({ length: longCount }, (_, index) => ({ source: index ? 'long' + (index - 1) : 'root', target: 'long' + index })),
    ...Array.from({ length: shortCount }, (_, index) => ({ source: index ? 'short' + (index - 1) : 'root', target: 'short' + index })),
    { source: 'long' + (longCount - 1), target: 'join' },
    { source: 'short' + (shortCount - 1), target: 'join' },
  ].map((edge) => Object.assign({}, edge, { id: edge.source + '-' + edge.target }))
  return graphLayout(
    ids.map((id) => ({ id, width: 336, height })),
    edges,
    'vertical',
  )
}

describe('compact layout crossing fallback', () => {
  it.each([
    { height: 78, aspectRatio: 4 / 3 },
    { height: 92, aspectRatio: 1 },
  ])('balances the runs of a ten-step branch before its shared join ($height, $aspectRatio)', ({ height, aspectRatio }) => {
    const graph = branchedPipeline(2, height)
    const result = compactLayout(graph, { width: 104, height: 136 }, aspectRatio)
    const path = Array.from({ length: 10 }, (_, index) => result.positions['long' + index]!)
    const turns = path.slice(1).flatMap((point, index) => (point.y < path[index]!.y ? [index + 1] : []))
    expect(turns).toHaveLength(1)
    expect(turns[0]).toBeGreaterThanOrEqual(4)
    expect(turns[0]).toBeLessThanOrEqual(6)
    expect(result.bounds.height).toBeLessThan(Math.max(...graph.nodes.map((node) => node.y + node.height)) * 0.75)
    expect(hasRouteCrossings(result.routes)).toBe(false)
  })

  it('routes only the best candidate when it has no crossing', () => {
    const route = vi.spyOn(routing, 'routeLayout')
    const graph = graphLayout(
      Array.from({ length: 5 }, (_, index) => ({ id: String(index), width: 336, height: 80 })),
      Array.from({ length: 4 }, (_, index) => ({ id: String(index), source: String(index), target: String(index + 1) })),
      'vertical',
    )
    const result = compactLayout(graph, { width: 104, height: 136 }, 16 / 9)
    expect(route).toHaveBeenCalledTimes(1)
    expect(hasRouteCrossings(result.routes)).toBe(false)
    expect(result.positions['2']!.y).toBeLessThan(result.positions['1']!.y)
  })

  it('balances measured run heights when cards have different sizes', () => {
    const base = branchedPipeline(2)
    const graph = graphLayout(
      base.nodes.map((node) => Object.assign({}, node, { height: node.id === 'long2' ? 240 : node.id === 'long7' ? 160 : 92 })),
      base.edges,
      'vertical',
    )
    const result = compactLayout(graph, { width: 104, height: 136 })
    const path = Array.from({ length: 10 }, (_, index) => {
      const id = 'long' + index
      return Object.assign(
        {},
        graph.nodes.find((node) => node.id === id)!,
        result.positions[id],
      )
    })
    const runs: (typeof path)[] = []
    for (const [index, node] of path.entries()) {
      if (index === 0 || node.y < path[index - 1]!.y) runs.push([])
      runs.at(-1)!.push(node)
    }
    expect(runs).toHaveLength(2)
    const heights = runs.map((run) => Math.max(...run.map((node) => node.y + node.height)) - run[0]!.y)
    expect(Math.max(...heights) / Math.min(...heights)).toBeLessThan(1.5)
    expect(hasRouteCrossings(result.routes)).toBe(false)
  })

  it('uses the next compact candidate when it clears the crossing', () => {
    const route = vi.spyOn(routing, 'routeLayout')
    const base = branchedPipeline(1)
    const graph = graphLayout(base.nodes, [...base.edges, { id: 'skip', source: 'long1', target: 'long5' }], 'vertical')
    const result = compactLayout(graph, undefined, 16 / 9)
    expect(route).toHaveBeenCalledTimes(2)
    expect(hasRouteCrossings(route.mock.results[0]!.value)).toBe(true)
    expect(hasRouteCrossings(result.routes)).toBe(false)
    expect(Array.from({ length: 9 }, (_, index) => result.positions['long' + (index + 1)]!.y < result.positions['long' + index]!.y).some(Boolean)).toBe(true)
  })

  it('uses the unfolded candidate after two compact candidates cross', () => {
    const route = vi.spyOn(routing, 'routeLayout')
    const base = branchedPipeline(1, 92, 8)
    const graph = graphLayout(base.nodes, [...base.edges, { id: 'skip', source: 'root', target: 'long7' }], 'vertical')
    const before = structuredClone(graph)
    const result = compactLayout(graph, undefined, 4 / 3)
    expect(route).toHaveBeenCalledTimes(3)
    expect(route.mock.results.slice(0, 2).every((attempt) => hasRouteCrossings(attempt.value))).toBe(true)
    expect(hasRouteCrossings(result.routes)).toBe(false)
    for (const edge of graph.edges) expect(result.positions[edge.target]!.y).toBeGreaterThan(result.positions[edge.source]!.y)
    expect(graph).toEqual(before)
  })

  it('stops after three attempts and keeps the best compact layout when unfolding also crosses', () => {
    const route = vi.spyOn(routing, 'routeLayout')
    const roots = ['a', 'b', 'c']
    const targets = ['x', 'y', 'z']
    const tail = Array.from({ length: 20 }, (_, index) => 'tail' + index)
    const edges: GraphLayoutEdge[] = [
      ...roots.flatMap((source) => targets.map((target) => ({ source, target }))),
      ...targets.map((source) => ({ source, target: tail[0]! })),
      ...tail.slice(1).map((target, index) => ({ source: tail[index]!, target })),
    ].map((edge) => Object.assign({}, edge, { id: edge.source + '-' + edge.target }))
    const graph = graphLayout(
      [...roots, ...targets, ...tail].map((id) => ({ id, width: 336, height: 92 })),
      edges,
      'vertical',
    )
    const result = compactLayout(graph)
    expect(route).toHaveBeenCalledTimes(3)
    expect(route.mock.results.every((attempt) => hasRouteCrossings(attempt.value))).toBe(true)
    expect(result.positions).toEqual(Object.fromEntries(route.mock.calls[0]![0].map((node) => [node.id, layoutAxes(node, 'vertical')])))
    const firstRoutes: ReturnType<typeof routing.routeLayout> = route.mock.results[0]!.value
    expect(result.routes).toEqual(new Map([...firstRoutes].map(([id, points]) => [id, points.map((point) => layoutAxes(point, 'vertical'))])))
  })
})
