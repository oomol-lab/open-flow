import { describe, expect, it } from 'vitest'
import { canvasCardWidth, minimumCanvasCardWidth } from './canvas.ts'

describe('canvas card widths', () => {
  it('ignores saved vertical widths in horizontal layouts', () => {
    expect(canvasCardWidth('horizontal', 7, 900)).toBe(320)
    expect(canvasCardWidth('vertical', 7, 900)).toBe(900)
  })

  it('keeps the branch minimum after additions and restores preferred width after removals', () => {
    expect(canvasCardWidth('vertical', 3, 500)).toBe(500)
    expect(canvasCardWidth('vertical', 7, 500)).toBe(minimumCanvasCardWidth('vertical', 7))
    expect(canvasCardWidth('vertical', 3, 500)).toBe(500)
    expect(canvasCardWidth('vertical', 7, undefined)).toBe(726)
    expect(canvasCardWidth('vertical', 3, Number.NaN)).toBe(320)
  })
})
