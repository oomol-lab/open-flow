import type { GetBezierPathParams, Rect } from '@xyflow/react'

import { getBezierPath, Position } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { getConnectionPath } from './connectionPath.ts'

type Params = GetBezierPathParams & { sourceBounds?: Rect; targetBounds?: Rect }
const backward: Params = {
  sourceX: 870,
  sourceY: 380,
  targetX: 0,
  targetY: 460,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  sourceBounds: { x: 550, y: 300, width: 320, height: 180 },
  targetBounds: { x: 0, y: 420, width: 320, height: 220 },
}
function reversed(p: Params): Params {
  return {
    sourceX: p.targetX,
    sourceY: p.targetY,
    targetX: p.sourceX,
    targetY: p.sourceY,
    sourcePosition: Position.Left,
    targetPosition: Position.Right,
    sourceBounds: p.targetBounds,
    targetBounds: p.sourceBounds,
  }
}
// SVG coordinates, including control points, must stay within the fixed side lanes.
function xCoordinates(path: string): number[] {
  return path
    .match(/-?\d+(?:\.\d+)?/g)!
    .map(Number)
    .filter((_, i) => i % 2 === 0)
}

describe('connection routing', () => {
  it('preserves forward Bézier geometry', () => {
    const params = { ...backward, sourceX: 320, targetX: 550 }
    expect(getConnectionPath(params)).toEqual(getBezierPath(params).slice(0, 3))
  })

  const layouts = [
    { source: { x: 0, y: 0, width: 320, height: 180 }, target: { x: 180, y: 220, width: 320, height: 180 } },
    { source: { x: 180, y: 0, width: 320, height: 180 }, target: { x: 0, y: 260, width: 320, height: 180 } },
    { source: { x: 180, y: 0, width: 320, height: 180 }, target: { x: 0, y: 80, width: 320, height: 240 } },
    { source: { x: 0, y: 0, width: 320, height: 180 }, target: { x: 0, y: 0, width: 320, height: 180 } },
  ]
  it.each(layouts)('keeps both side turns fixed for $source / $target', ({ source, target }) => {
    for (const [output, input] of [
      [source, target],
      [target, source],
    ] as const) {
      const params = {
        ...backward,
        sourceX: output.x + output.width,
        sourceY: output.y + 80,
        targetX: input.x,
        targetY: input.y + 35,
        sourceBounds: output,
        targetBounds: input,
      }
      for (const p of [params, reversed(params)]) {
        const [path, , y] = getConnectionPath(p)
        const xs = xCoordinates(path)
        expect(Math.max(...xs)).toBe(params.sourceX + 40)
        expect(Math.min(...xs)).toBe(params.targetX - 40)
        expect(y).toBe(output.y + output.height + 40)
        expect(path).not.toMatch(/NaN|Infinity/)
      }
    }
  })

  it('does not reroute when only the target dimensions change', () => {
    expect(getConnectionPath({ ...backward, targetBounds: { x: 0, y: 420, width: 1200, height: 1000 } })).toEqual(getConnectionPath(backward))
  })

  it('moves only the bottom lane when the output card expands', () => {
    const before = getConnectionPath(backward)
    const after = getConnectionPath({ ...backward, sourceBounds: { ...backward.sourceBounds!, height: 400 } })
    expect(after[2] - before[2]).toBe(220)
    expect(Math.max(...xCoordinates(after[0]))).toBe(Math.max(...xCoordinates(before[0])))
  })

  it('uses the larger port offset at both ends, including input-origin drags', () => {
    for (let index = 0; index < 3; index++) {
      const clearance = 40 + Math.max(index, 1) * 12
      const params = { ...backward, sourcePortIndex: index, targetPortIndex: 1 }
      const result = getConnectionPath(params)
      const xs = xCoordinates(result[0])
      expect(Math.max(...xs)).toBe(backward.sourceX + clearance)
      expect(Math.min(...xs)).toBe(backward.targetX - clearance)
      expect(result[2]).toBe(480 + clearance)
      const reverse = getConnectionPath({ ...reversed(backward), sourcePortIndex: 1, targetPortIndex: index })
      expect(reverse.slice(1)).toEqual(result.slice(1))
      expect(xCoordinates(reverse[0]).toSorted((a, b) => a - b)).toEqual(xs.toSorted((a, b) => a - b))
    }
  })

  it('handles a target level with the bottom lane and an unmeasured pointer', () => {
    for (const params of [
      { ...backward, targetY: 520 },
      { ...backward, sourceBounds: undefined, targetBounds: undefined },
    ]) {
      for (const p of [params, reversed(params)]) expect(getConnectionPath(p)[0]).not.toMatch(/NaN|Infinity/)
    }
  })
})
