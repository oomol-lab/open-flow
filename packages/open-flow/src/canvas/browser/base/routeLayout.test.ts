import type { LayoutNode } from './wrapLayout.ts'

import { expect, it } from 'vitest'
import { coffeeGroupsWorkflow } from '../../../../dev/designer/fixtures/coffeeGroupsWorkflow.ts'
import { graphLayout } from './graphLayout.ts'
import { hasRouteCrossings } from './routeCrossings.ts'
import { routeLayout } from './routeLayout.ts'
import { layoutAxes } from './wrapLayout.ts'

it.each([-1, 1])('turns a return toward its destination around intervening cards (side=%s)', (side) => {
  const cross = (near: number, size: number) => (side === -1 ? near : -near - size)
  const nodes: LayoutNode[] = [
    { id: 'source', column: 2, x: 800, y: cross(400, 336), width: 92, height: 336 },
    { id: 'target', column: 0, x: 100, y: cross(100, 336), width: 92, height: 336 },
    { id: 'obstacle', column: 1, x: 220, y: cross(-100, 700), width: 92, height: 700 },
  ]
  const routes = routeLayout(nodes, [
    { id: 'return', source: 'source', target: 'target' },
    { id: 'same-ports', source: 'source', target: 'target' },
  ])
  const route = routes.get('return')!
  expect(routes.get('same-ports')).toEqual(route)
  const source = route[0]!
  const target = route.at(-1)!
  const turn = route.find((point) => point.y !== source.y)!
  expect((turn.y - source.y) * side).toBeGreaterThan(0)
  expect(route.every((point) => (point.y - source.y) * side >= 0)).toBe(true)
  expect(route[1]!.x).toBeGreaterThan(source.x)
  expect(target.x).toBeGreaterThan(route.at(-2)!.x)

  // A fixed port stub must not immediately retrace itself before turning.
  for (let index = 1; index < route.length - 1; index++) {
    const before = route[index - 1]!
    const point = route[index]!
    const after = route[index + 1]!
    expect((point.x - before.x) * (after.x - point.x) + (point.y - before.y) * (after.y - point.y)).toBeGreaterThanOrEqual(0)
  }
})

it('connects measured forward ports through the empty gap between levels', () => {
  const nodes: LayoutNode[] = [
    { id: 'source', column: 0, x: 0, y: 0, width: 100, height: 300 },
    { id: 'target', column: 1, x: 148, y: 400, width: 100, height: 300 },
  ]
  const route = routeLayout(nodes, [
    { id: 'forward', source: 'source', target: 'target', sourceOffset: { x: 102, y: 40 }, targetOffset: { x: -2, y: 100 } },
  ]).get('forward')!
  expect(route[0]).toEqual({ x: 102, y: 40 })
  expect(route.at(-1)).toEqual({ x: 146, y: 500 })
  expect(route.slice(1, -1).every((point) => point.x >= 116 && point.x <= 132)).toBe(true)
})

it('keeps the coffee workflow feedback outside its branches without crossing cards or unrelated connections', () => {
  const graph = graphLayout(
    coffeeGroupsWorkflow.nodes.map((node) => ({
      id: node.id,
      width: 336,
      height: node.kind === 'condition' ? 158 : 92,
      branchHandles: node.kind === 'condition' ? node.outputs.flatMap((port) => ('handle' in port ? ['$branch:' + port.handle] : [])) : undefined,
    })),
    coffeeGroupsWorkflow.edges,
    'vertical',
  )
  const nodes = graph.nodes.map((node) => Object.assign({}, node, layoutAxes(node, 'vertical'), { width: node.height, height: node.width }))
  const edges = graph.edges.map((edge) => {
    const source = nodes.find((node) => node.id === edge.source)!
    const target = nodes.find((node) => node.id === edge.target)!
    const content = coffeeGroupsWorkflow.nodes.find((node) => node.id === edge.source)!
    const branch = content.kind === 'condition' ? content.outputs.findIndex((port) => 'handle' in port && '$branch:' + port.handle === edge.sourceHandle) : -1
    return Object.assign({}, edge, {
      sourceOffset: { x: source.width - 6, y: branch < 0 ? source.height / 2 : source.height * (branch === 0 ? 0.25 : 0.75) },
      targetOffset: { x: 6, y: target.height / 2 },
    })
  })
  const routes = routeLayout(nodes, edges)
  expect(routes.size).toBe(edges.length)
  expect(hasRouteCrossings(routes)).toBe(false)
  for (const path of routes.values()) {
    for (let index = 1; index < path.length; index++) {
      const a = path[index - 1]!
      const b = path[index]!
      expect(a.x === b.x || a.y === b.y).toBe(true)
      for (const node of nodes) {
        // The measured wrapper has 8px of transparent padding around the card.
        const crosses =
          Math.max(Math.min(a.x, b.x), node.x + 8) <= Math.min(Math.max(a.x, b.x), node.x + node.width - 8) &&
          Math.max(Math.min(a.y, b.y), node.y + 8) <= Math.min(Math.max(a.y, b.y), node.y + node.height - 8)
        expect(crosses, `route crosses ${node.id}`).toBe(false)
      }
    }
  }
})

it('gives nested feedback loops separate lanes with the longer loop outside', () => {
  const nodes: LayoutNode[] = Array.from({ length: 6 }, (_, index) => ({ id: String(index), column: index, x: index * 148, y: 0, width: 100, height: 336 }))
  const routes = routeLayout(nodes, [
    ...nodes.slice(1).map((node, index) => ({ id: 'forward-' + index, source: String(index), target: node.id })),
    { id: 'outer', source: '5', target: '0' },
    { id: 'inner', source: '4', target: '1' },
  ])
  expect(routes.size).toBe(7)
  const outer = Math.min(...routes.get('outer')!.map((point) => point.y))
  const inner = Math.min(...routes.get('inner')!.map((point) => point.y))
  expect(inner).toBeLessThan(0)
  expect(outer).toBeLessThan(inner)
  expect(hasRouteCrossings(routes)).toBe(false)
})

it('keeps independent feedback loops beside their own subgraphs', () => {
  const nodes: LayoutNode[] = [0, 700].flatMap((y, group) =>
    Array.from({ length: 3 }, (_, column) => ({
      id: `${group}-${column}`,
      column,
      x: column * 148,
      y,
      width: 100,
      height: 336,
    })),
  )
  const edges = [0, 1].flatMap((group) => [
    { id: `${group}-first`, source: `${group}-0`, target: `${group}-1` },
    { id: `${group}-second`, source: `${group}-1`, target: `${group}-2` },
    { id: `${group}-return`, source: `${group}-2`, target: `${group}-0` },
  ])
  const routes = routeLayout(nodes, edges)
  expect(routes.size).toBe(edges.length)
  expect(routes.get('0-return')!.every((point) => point.y < 336)).toBe(true)
  expect(routes.get('1-return')!.every((point) => point.y > 336)).toBe(true)
  expect(hasRouteCrossings(routes)).toBe(false)

  const obstacle: LayoutNode = { id: 'comment', column: 1, x: 130, y: -200, width: 200, height: 250 }
  const obstructed = routeLayout([...nodes, obstacle], edges)
  expect(obstructed.size).toBe(edges.length)
  expect(Math.min(...obstructed.get('0-return')!.map((point) => point.y))).toBeLessThan(obstacle.y)
  expect(hasRouteCrossings(obstructed)).toBe(false)
})

it('allows interactive fallback for blocked ports while keeping strict export routing', () => {
  const nodes: LayoutNode[] = [
    { id: 'source', column: 0, x: 0, y: 0, width: 100, height: 300 },
    { id: 'target', column: 1, x: 50, y: 0, width: 100, height: 300 },
  ]
  const edges = [{ id: 'overlap', source: 'source', target: 'target' }]
  expect(() => routeLayout(nodes, edges)).toThrow('Could not route')
  expect(routeLayout(nodes, edges, { allowBlockedPorts: true }).has('overlap')).toBe(false)
})
