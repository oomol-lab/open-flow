import type { LayoutNode } from './wrapLayout.ts'

import { expect, it } from 'vitest'
import { routeLayout } from './routeLayout.ts'

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
