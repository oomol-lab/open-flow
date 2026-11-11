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

it('applies direction and layout together and restores both while preserving viewport and other graphs', () => {
  const viewport = { x: 14, y: 28, zoom: 0.6 }
  const initial = { flow: { viewport, positions: { comment: { x: 50, y: 60 } } }, other: { direction: 'vertical' as const } }
  const positions = { a: { x: 40, y: 80 }, b: { x: 40, y: 200 } }
  const changed = changeRevisionCanvasSession(initial, 'flow', { kind: 'direction', direction: 'vertical', positions })
  expect(changed.flow).toEqual({ direction: 'vertical', positions: { comment: { x: 50, y: 60 }, ...positions }, viewport })

  const moved = changeRevisionCanvasSession(changed, 'flow', { kind: 'move', positions: { a: { x: 60, y: 80 } } })
  expect(moved.flow?.direction).toBe('vertical')
  const restored = changeRevisionCanvasSession(moved, 'flow', { kind: 'restore' })
  expect(restored.flow?.direction).toBeUndefined()
  expect(restored.flow?.positions).toBeUndefined()
  expect(restored.flow?.viewport).toEqual(viewport)
  expect(restored.other).toBe(initial.other)
  expect(initial.flow.positions).toEqual({ comment: { x: 50, y: 60 } })
})

it('retains the first measured layout as the restore baseline without saved coordinates', () => {
  const viewport = { x: 14, y: 28, zoom: 0.6 }
  const positions = { a: { x: 40, y: 80 }, b: { x: 40, y: 200 } }
  const initialized = changeRevisionCanvasSession({ flow: { viewport } }, 'flow', { kind: 'initialize', direction: 'vertical', positions })
  const repeated = changeRevisionCanvasSession(initialized, 'flow', { kind: 'initialize', direction: 'horizontal', positions: {} })
  expect(repeated.flow?.initialLayout).toEqual({ direction: 'vertical', positions })
  const moved = changeRevisionCanvasSession(repeated, 'flow', { kind: 'direction', direction: 'horizontal', positions: { b: { x: 200, y: 80 } } })
  const restored = changeRevisionCanvasSession(moved, 'flow', { kind: 'restore' })
  expect(restored.flow?.initialLayout).toBe(initialized.flow?.initialLayout)
  expect(restored.flow?.positions).toBeUndefined()
  expect(restored.flow?.direction).toBeUndefined()
  expect(restored.flow?.viewport).toBe(viewport)
})
