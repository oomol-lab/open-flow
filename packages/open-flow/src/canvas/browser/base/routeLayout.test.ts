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

it('clears inset ports when folded runs have a narrow primary gap', () => {
  const nodes: LayoutNode[] = [
    { id: 'source', column: 6, x: 0, y: 600, width: 158, height: 336 },
    { id: 'target', column: 1, x: 172, y: 0, width: 92, height: 336 },
  ]
  const route = routeLayout(nodes, [
    { id: 'return', source: 'source', target: 'target', sourceOffset: { x: 152, y: 245 }, targetOffset: { x: 6, y: 168 } },
  ]).get('return')!
  expect(route[0]).toEqual({ x: 152, y: 845 })
  expect(route.at(-1)).toEqual({ x: 178, y: 168 })
  expect(route[1]!.x).toBeGreaterThanOrEqual(174)
  expect(route.at(-2)!.x).toBeLessThanOrEqual(156)
  for (let index = 1; index < route.length; index++) {
    const a = route[index - 1]!
    const b = route[index]!
    expect(a.x === b.x || a.y === b.y).toBe(true)
    for (const node of nodes) {
      const crosses =
        Math.max(Math.min(a.x, b.x), node.x + 8) <= Math.min(Math.max(a.x, b.x), node.x + node.width - 8) &&
        Math.max(Math.min(a.y, b.y), node.y + 8) <= Math.min(Math.max(a.y, b.y), node.y + node.height - 8)
      expect(crosses, `route crosses ${node.id}`).toBe(false)
    }
  }
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

it('leaves blocked ports to standard edge rendering without losing clear routes', () => {
  const nodes: LayoutNode[] = [
    { id: 'source', column: 0, x: 0, y: 0, width: 100, height: 300 },
    { id: 'target', column: 1, x: 50, y: 0, width: 100, height: 300 },
    { id: 'clear-source', column: 0, x: 0, y: 500, width: 100, height: 300 },
    { id: 'clear-target', column: 1, x: 148, y: 500, width: 100, height: 300 },
  ]
  const routes = routeLayout(nodes, [
    { id: 'overlap', source: 'source', target: 'target' },
    { id: 'clear', source: 'clear-source', target: 'clear-target' },
  ])
  expect(routes.has('overlap')).toBe(false)
  expect(routes.get('clear')![0]).toEqual({ x: 100, y: 650 })
  expect(routes.get('clear')!.at(-1)).toEqual({ x: 148, y: 650 })
})

it('separates shifted parallel forward edges across the same rank gap into distinct lanes', () => {
  const nodes: LayoutNode[] = [
    { id: 'a', column: 0, x: 0, y: 0, width: 100, height: 120 },
    { id: 'b', column: 0, x: 0, y: 130, width: 100, height: 100 },
    { id: 'c', column: 1, x: 180, y: 180, width: 100, height: 120 },
    { id: 'd', column: 1, x: 180, y: 320, width: 100, height: 120 },
  ]
  const routes = routeLayout(nodes, [
    { id: 'a-c', source: 'a', target: 'c' },
    { id: 'b-d', source: 'b', target: 'd' },
  ])
  expect(routes.size).toBe(2)
  expect(hasRouteCrossings(routes)).toBe(false)
  const trunkA = routes.get('a-c')![1]!.x
  const trunkB = routes.get('b-d')![1]!.x
  expect(Math.abs(trunkA - trunkB)).toBeGreaterThanOrEqual(8)
})

it('assigns distinct trunks to crossing forward edges in the same rank gap', () => {
  const nodes: LayoutNode[] = [
    { id: 'a', column: 0, x: 0, y: 0, width: 100, height: 120 },
    { id: 'b', column: 0, x: 0, y: 180, width: 100, height: 120 },
    { id: 'c', column: 1, x: 180, y: 0, width: 100, height: 120 },
    { id: 'd', column: 1, x: 180, y: 180, width: 100, height: 120 },
  ]
  const routes = routeLayout(nodes, [
    { id: 'a-d', source: 'a', target: 'd' },
    { id: 'b-c', source: 'b', target: 'c' },
  ])
  expect(routes.size).toBe(2)
  const trunkAD = routes.get('a-d')![1]!.x
  const trunkBC = routes.get('b-c')![1]!.x
  expect(Math.abs(trunkAD - trunkBC)).toBeGreaterThanOrEqual(8)
})

it('separates multiple obstructed skip edges routing through the same corridor without crossing cards', () => {
  const nodes: LayoutNode[] = [
    { id: 's1', column: 0, x: 0, y: 0, width: 100, height: 120 },
    { id: 's2', column: 0, x: 0, y: 200, width: 100, height: 120 },
    { id: 'obs', column: 1, x: 180, y: -40, width: 100, height: 420 },
    { id: 't1', column: 2, x: 360, y: 0, width: 100, height: 120 },
    { id: 't2', column: 2, x: 360, y: 200, width: 100, height: 120 },
  ]
  const routes = routeLayout(nodes, [
    { id: 'skip-1', source: 's1', target: 't1' },
    { id: 'skip-2', source: 's2', target: 't2' },
  ])
  expect(routes.size).toBe(2)
  expect(hasRouteCrossings(routes)).toBe(false)
  for (const path of routes.values()) {
    for (let index = 1; index < path.length; index++) {
      const a = path[index - 1]!
      const b = path[index]!
      expect(a.x === b.x || a.y === b.y).toBe(true)
      for (const node of nodes) {
        const crosses =
          Math.max(Math.min(a.x, b.x), node.x + 8) <= Math.min(Math.max(a.x, b.x), node.x + node.width - 8) &&
          Math.max(Math.min(a.y, b.y), node.y + 8) <= Math.min(Math.max(a.y, b.y), node.y + node.height - 8)
        expect(crosses, `route crosses ${node.id}`).toBe(false)
      }
    }
  }
})

it('routes a feedback edge around the shorter exterior side even when source.y <= target.y', () => {
  const nodes: LayoutNode[] = [
    { id: 'choose', column: 0, x: 0, y: 400, width: 92, height: 336 },
    { id: 'meeting', column: 1, x: 140, y: 200, width: 158, height: 336 },
    { id: 'checkEmail', column: 2, x: 340, y: 40, width: 92, height: 336 },
    { id: 'checkLater', column: 3, x: 480, y: 40, width: 92, height: 336 },
    { id: 'noLaterEmail', column: 4, x: 620, y: 280, width: 158, height: 336 },
    { id: 'findCalendar', column: 5, x: 820, y: 280, width: 92, height: 336 },
  ]
  const routes = routeLayout(nodes, [
    { id: 'f1', source: 'choose', target: 'meeting' },
    { id: 'f2', source: 'meeting', target: 'checkEmail' },
    { id: 'f3', source: 'checkEmail', target: 'checkLater' },
    { id: 'f4', source: 'checkLater', target: 'noLaterEmail' },
    { id: 'yes', source: 'noLaterEmail', target: 'findCalendar', sourceOffset: { x: 158, y: 84 }, targetOffset: { x: 0, y: 168 } },
    // Right-hand default port (y = 280 + 252 = 532) is still <= choose center (y = 400 + 168 = 568).
    { id: 'feedback', source: 'noLaterEmail', target: 'choose', sourceOffset: { x: 158, y: 252 }, targetOffset: { x: 0, y: 168 } },
  ])
  const route = routes.get('feedback')!
  const choose = nodes[0]!
  const noLaterEmail = nodes[4]!
  expect(Math.max(...route.map((point) => point.y))).toBeGreaterThan(choose.y + choose.height)
  expect(Math.min(...route.map((point) => point.y))).toBeGreaterThanOrEqual(noLaterEmail.y)
  expect(hasRouteCrossings(routes)).toBe(false)
  for (const point of route.slice(1, -1)) {
    for (const node of nodes) {
      const inside = point.x > node.x && point.x < node.x + node.width && point.y > node.y && point.y < node.y + node.height
      expect(inside, `waypoint inside ${node.id}`).toBe(false)
    }
  }
})

it('avoids crossing forward edges when choosing the feedback exterior side', () => {
  const nodes: LayoutNode[] = [
    // Tall target card makes the right bound (200 + 600 + 16 = 816) much farther than the left bound (184),
    // so raw distance favors left, while going left from the right port (452) crosses branch-next (288).
    { id: 'top', column: 0, x: 0, y: 200, width: 92, height: 600 },
    { id: 'branch', column: 1, x: 140, y: 200, width: 158, height: 336 },
    { id: 'next', column: 2, x: 340, y: 120, width: 92, height: 336 },
  ]
  const routes = routeLayout(nodes, [
    { id: 'top-branch', source: 'top', target: 'branch', sourceOffset: { x: 92, y: 168 }, targetOffset: { x: 0, y: 168 } },
    { id: 'branch-next', source: 'branch', target: 'next', sourceOffset: { x: 158, y: 84 }, targetOffset: { x: 0, y: 168 } },
    { id: 'feedback', source: 'branch', target: 'top', sourceOffset: { x: 158, y: 252 }, targetOffset: { x: 0, y: 168 } },
  ])
  const route = routes.get('feedback')!
  const top = nodes[0]!
  expect(Math.max(...route.map((point) => point.y))).toBeGreaterThan(top.y + top.height)
  expect(hasRouteCrossings(routes)).toBe(false)
})
