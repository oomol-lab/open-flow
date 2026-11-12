// @vitest-environment happy-dom
import type { InternalNode, ReactFlowState } from '@xyflow/react'
import type { CanvasDirection } from '../../../common/direction.ts'
import type { LayoutPoint } from '../../base/wrapLayout.ts'
import type { ConnectionRoutesProviderProps } from './ConnectionRoutes.tsx'

import { Position, ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { act, useContext } from 'react'
import { val } from 'value-enhancer'
import { expect, it } from 'vitest'
import { render } from '../../../../../test/support/render.tsx'
import { ConnectionRoutesContext, ConnectionRoutesProvider } from './ConnectionRoutes.tsx'

function measuredNode(id: string, x: number, y: number): InternalNode {
  const userNode = { id, position: { x, y }, data: {} }
  return {
    ...userNode,
    measured: { width: 336, height: 92 },
    internals: {
      userNode,
      positionAbsolute: { x, y },
      z: 0,
      handleBounds: {
        source: [
          { id: 'first', nodeId: id, type: 'source', position: Position.Bottom, x: 78, y: 92, width: 12, height: 6 },
          { id: 'second', nodeId: id, type: 'source', position: Position.Bottom, x: 246, y: 92, width: 12, height: 6 },
        ],
        target: [{ id: 'input', nodeId: id, type: 'target', position: Position.Top, x: 162, y: -6, width: 12, height: 6 }],
      },
    },
  }
}

function setup(direction: CanvasDirection = 'vertical', routes$?: ConnectionRoutesProviderProps['routes$']) {
  let state!: ReturnType<typeof useStoreApi>
  let routes!: ReadonlyMap<string, readonly LayoutPoint[]>
  function ReadRoutes() {
    state = useStoreApi()
    routes = useContext(ConnectionRoutesContext)
    return null
  }
  render(
    <ReactFlowProvider>
      <ConnectionRoutesProvider direction={direction} routes$={routes$}>
        <ReadRoutes />
      </ConnectionRoutesProvider>
    </ReactFlowProvider>,
  )
  return { update: (value: Partial<ReactFlowState>) => act(() => state.setState(value)), routes: () => routes }
}

const edges = [{ id: 'edge', source: 'source', sourceHandle: 'second', target: 'target', targetHandle: 'input' }]

it('routes from the measured branch port and follows in-place position and handle updates', () => {
  const canvas = setup()
  const source = measuredNode('source', 0, 0)
  const target = measuredNode('target', 400, 300)
  canvas.update({
    nodeLookup: new Map([
      [source.id, source],
      [target.id, target],
    ]),
    edges,
  })
  const before = canvas.routes().get('edge')!
  expect(before[0]).toEqual({ x: 252, y: 98 })
  expect(before.at(-1)).toEqual({ x: 568, y: 294 })

  target.internals.positionAbsolute.x += 100
  target.internals.handleBounds = {
    ...target.internals.handleBounds!,
    target: [{ id: 'input', nodeId: target.id, type: 'target', position: Position.Top, x: 242, y: -6, width: 12, height: 6 }],
  }
  target.measured = { width: 496, height: 92 }
  canvas.update({})
  const after = canvas.routes().get('edge')!
  expect(after.at(-1)).toEqual({ x: 748, y: 294 })
  expect(after).not.toEqual(before)
})

it('reroutes around an unconnected card when it moves between the ports', () => {
  const canvas = setup()
  const source = measuredNode('source', 0, 0)
  const target = measuredNode('target', 0, 500)
  const obstacle = measuredNode('obstacle', 600, 200)
  canvas.update({ nodeLookup: new Map([source, target, obstacle].map((node) => [node.id, node])), edges })
  const before = canvas.routes().get('edge')!
  obstacle.internals.positionAbsolute.x = 0
  canvas.update({})
  const after = canvas.routes().get('edge')!
  expect(after).not.toEqual(before)
  expect(after.some((point) => point.x < 0 || point.x > 336)).toBe(true)
})

it('retains horizontal routing and waits for measurable ports', () => {
  const canvas = setup('horizontal')
  const source = measuredNode('source', 0, 0)
  const target = measuredNode('target', 400, 300)
  canvas.update({ nodeLookup: new Map([source, target].map((node) => [node.id, node])), edges })
  expect(canvas.routes().size).toBe(0)

  const vertical = setup()
  target.measured = {}
  vertical.update({ nodeLookup: new Map([source, target].map((node) => [node.id, node])), edges })
  expect(vertical.routes().size).toBe(0)
})

it('falls back for overlapping ports without dropping clear connections', () => {
  const canvas = setup()
  const nodes = [measuredNode('source', 0, 0), measuredNode('target', 0, 50), measuredNode('clear-source', 500, 0), measuredNode('clear-target', 500, 400)]
  canvas.update({
    nodeLookup: new Map(nodes.map((node) => [node.id, node])),
    edges: [...edges, { ...edges[0]!, id: 'clear', source: 'clear-source', target: 'clear-target' }],
  })
  expect(canvas.routes().has('edge')).toBe(false)
  expect(canvas.routes().has('clear')).toBe(true)
})

it('uses an explicit arrangement until it is cleared, then resumes routing the current measured geometry', () => {
  const planned = val<ReadonlyMap<string, readonly LayoutPoint[]>>(new Map())
  const canvas = setup('vertical', planned)
  const source = measuredNode('source', 0, 0)
  const target = measuredNode('target', 400, 300)
  canvas.update({ nodeLookup: new Map([source, target].map((node) => [node.id, node])), edges })
  expect(canvas.routes().get('edge')!.at(-1)).toEqual({ x: 568, y: 294 })

  const arrangement = new Map([
    [
      'edge',
      [
        { x: 252, y: 98 },
        { x: 252, y: 200 },
        { x: 568, y: 200 },
        { x: 568, y: 294 },
      ],
    ],
  ])
  act(() => planned.set(arrangement))
  expect(canvas.routes()).toBe(arrangement)
  target.internals.positionAbsolute.x += 100
  canvas.update({})
  expect(canvas.routes()).toBe(arrangement)

  act(() => planned.set(new Map()))
  expect(canvas.routes().get('edge')!.at(-1)).toEqual({ x: 668, y: 294 })
})
