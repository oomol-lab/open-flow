import { expect, it } from 'vitest'
import { changeRevisionCanvasSession } from './revisionCanvasSession.ts'

it('keeps temporary graph positions independent and restores without resetting the viewport', () => {
  const viewport = { x: 14, y: 28, zoom: 0.6 }
  const first = changeRevisionCanvasSession({}, 'flow', { kind: 'move', positions: { a: { x: 40, y: 80 }, b: { x: 180, y: 80 } } })
  const second = changeRevisionCanvasSession(first, 'subflow:one', { kind: 'move', positions: { a: { x: 100, y: 200 } } })
  const panned = changeRevisionCanvasSession(second, 'flow', { kind: 'viewport', viewport })
  const moved = changeRevisionCanvasSession(panned, 'flow', { kind: 'move', positions: { b: { x: 250, y: 100 } } })
  expect(moved.flow?.positions).toEqual({ a: { x: 40, y: 80 }, b: { x: 250, y: 100 } })
  const restored = changeRevisionCanvasSession(moved, 'flow', { kind: 'restore' })
  expect(restored.flow).toEqual({ positions: undefined, viewport })
  expect(restored['subflow:one']).toBe(second['subflow:one'])
  expect(first.flow?.positions?.b).toEqual({ x: 180, y: 80 })
})
