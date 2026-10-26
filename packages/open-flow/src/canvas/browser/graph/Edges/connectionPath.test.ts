import type { ConnectionPathParams as Params } from './connectionPath.ts'

import { getBezierPath, Position } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { getConnectionPath } from './connectionPath.ts'

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
// SVG coordinates include the side lanes and rounded-corner control points.
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
  it.each(layouts)('keeps compact and self returns outside both cards for $source / $target', ({ source, target }) => {
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
        const departure = Math.max(...xs) - params.sourceX
        const arrival = params.targetX - Math.min(...xs)
        expect(departure).toBeGreaterThanOrEqual(40)
        expect(arrival).toBeCloseTo(departure)
        expect(y).toBeGreaterThanOrEqual(Math.max(output.y + output.height, input.y + input.height) + 40)
        expect(path).not.toMatch(/NaN|Infinity/)
      }
    }
  })

  it('keeps the return below the input card when it expands', () => {
    const targetBounds = { ...backward.targetBounds!, height: 1000 }
    const result = getConnectionPath({ ...backward, targetBounds })
    expect(result[2]).toBeGreaterThan(targetBounds.y + targetBounds.height)
    expect(Math.max(...xCoordinates(result[0]))).toBe(Math.max(...xCoordinates(getConnectionPath(backward)[0])))
  })

  it.each([
    { sourceX: 800, above: true },
    { sourceX: 2000, above: true },
    { sourceX: 2010, above: false },
  ])('uses the fixed turning band when the offsets fit at x=$sourceX', ({ sourceX, above }) => {
    const params = {
      ...backward,
      sourceX,
      sourceY: 80,
      targetX: 0,
      targetY: 480,
      sourceBounds: { x: sourceX - 320, y: 0, width: 320, height: 90 },
      targetBounds: { x: 0, y: 440, width: 320, height: 90 },
    }
    for (const p of [params, reversed(params)]) {
      const [, , laneY] = getConnectionPath(p)
      if (above) {
        expect(laneY).toBeGreaterThan(params.sourceBounds.y + params.sourceBounds.height)
        expect(laneY).toBeLessThan(params.targetBounds.y)
      } else {
        expect(laneY).toBeGreaterThan(params.targetBounds.y + params.targetBounds.height)
      }
    }
  })

  it('nests returns above a shared destination with nearer returns turning higher and farther left', () => {
    const connections = [200, 600, 1000].map((sourceY) => ({
      sourceX: backward.sourceX,
      targetX: backward.targetX,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      sourceY,
      targetY: 1640,
      sourceBounds: { x: 550, y: sourceY - 80, width: 320, height: 180 },
      targetBounds: { x: 0, y: 1600, width: 320, height: 180 },
    }))
    const results = connections.map((params) => {
      const result = getConnectionPath(params)
      expect(getConnectionPath(reversed(params)).slice(1)).toEqual(result.slice(1))
      expect(result[2]).toBeGreaterThan(params.sourceBounds.y + params.sourceBounds.height)
      expect(result[2]).toBeLessThan(params.targetBounds.y)
      return result
    })
    for (let i = 1; i < results.length; i++) {
      const farther = results[i - 1]!
      const nearer = results[i]!
      expect(nearer[2]).toBeLessThan(farther[2])
      expect(Math.min(...xCoordinates(nearer[0]))).toBeLessThan(Math.min(...xCoordinates(farther[0])))
      expect(Math.max(...xCoordinates(nearer[0]))).toBeLessThan(Math.max(...xCoordinates(farther[0])))
      const sourceSpacing = Math.max(...xCoordinates(farther[0])) - Math.max(...xCoordinates(nearer[0]))
      expect(farther[2] - nearer[2]).toBeCloseTo(sourceSpacing)
      expect(Math.min(...xCoordinates(farther[0])) - Math.min(...xCoordinates(nearer[0]))).toBeCloseTo(sourceSpacing)
    }
  })

  it("moves the dragged connection's own turns by equal and opposite amounts", () => {
    const base = {
      ...backward,
      targetY: 1640,
      targetBounds: { x: 0, y: 1600, width: 320, height: 180 },
    }
    const before = getConnectionPath({ ...base, sourceY: 1000, sourceBounds: { x: 550, y: 920, width: 320, height: 180 } })
    const after = getConnectionPath({ ...base, sourceY: 1100, sourceBounds: { x: 550, y: 1020, width: 320, height: 180 } })
    const movement = Math.max(...xCoordinates(before[0])) - Math.max(...xCoordinates(after[0]))
    expect(movement).toBeGreaterThan(0)
    expect(before[2] - after[2]).toBeCloseTo(movement)
    expect(Math.min(...xCoordinates(before[0])) - Math.min(...xCoordinates(after[0]))).toBeCloseTo(movement)
    expect(before[2]).toBeLessThan(base.targetBounds.y)
    expect(after[2]).toBeLessThan(base.targetBounds.y)
  })

  it("reflects each offset around the input node's fixed turning band", () => {
    const params = {
      ...backward,
      sourceY: 600,
      targetY: 1640,
      sourceBounds: { x: 550, y: 520, width: 320, height: 180 },
      targetBounds: { x: 0, y: 1600, width: 320, height: 180 },
    }
    const [path, , laneY] = getConnectionPath(params)
    const departure = Math.max(...xCoordinates(path)) - params.sourceX
    const arrival = params.targetX - Math.min(...xCoordinates(path))
    expect(departure).toBeCloseTo(231)
    expect(departure + arrival).toBeCloseTo(params.targetBounds.width)
    expect(params.targetBounds.y - laneY).toBeCloseTo(arrival)
  })

  it('responds equally to horizontal and vertical movement even across a tall gap', () => {
    const base = {
      ...backward,
      sourceY: 100,
      targetY: 1100,
      sourceBounds: { x: 550, y: 20, width: 320, height: 180 },
      targetBounds: { x: 0, y: 1060, width: 320, height: 180 },
    }
    const original = getConnectionPath(base)
    const horizontal = getConnectionPath({ ...base, sourceX: base.sourceX + 100, sourceBounds: { ...base.sourceBounds, x: 650 } })
    const vertical = getConnectionPath({ ...base, sourceY: base.sourceY - 100, sourceBounds: { ...base.sourceBounds, y: -80 } })
    const offset = (path: string, sourceX: number) => Math.max(...xCoordinates(path)) - sourceX
    expect(offset(horizontal[0], base.sourceX + 100) - offset(original[0], base.sourceX)).toBeCloseTo(10)
    expect(offset(vertical[0], base.sourceX) - offset(original[0], base.sourceX)).toBeCloseTo(10)
    expect(horizontal[2] - original[2]).toBeCloseTo(10)
    expect(vertical[2] - original[2]).toBeCloseTo(10)
  })

  it('separates returns from the same row at different horizontal distances', () => {
    const results = [700, 1100].map((sourceX) => {
      const params = {
        ...backward,
        sourceX,
        sourceY: 80,
        targetY: 155,
        sourceBounds: { x: sourceX - 320, y: 0, width: 320, height: 180 },
        targetBounds: { x: 0, y: 120, width: 320, height: 180 },
      }
      const result = getConnectionPath(params)
      expect(getConnectionPath(reversed(params)).slice(1)).toEqual(result.slice(1))
      expect(result[2]).toBeGreaterThan(300)
      return result
    })
    expect(results[1]![2]).toBeGreaterThan(results[0]![2])
    expect(Math.min(...xCoordinates(results[1]![0]))).toBeLessThan(Math.min(...xCoordinates(results[0]![0])))
  })

  it('keeps the return below both cards when the output card expands', () => {
    const before = getConnectionPath(backward)
    const sourceBounds = { ...backward.sourceBounds!, height: 400 }
    const after = getConnectionPath({ ...backward, sourceBounds })
    expect(after[2]).toBeGreaterThan(sourceBounds.y + sourceBounds.height)
    expect(after[2]).toBeGreaterThan(backward.targetBounds!.y + backward.targetBounds!.height)
    expect(Math.max(...xCoordinates(after[0]))).toBe(Math.max(...xCoordinates(before[0])))
  })

  it.each([
    { name: 'narrow vertical gap', targetTop: 200 },
    { name: 'overlapping rows', targetTop: 120 },
    { name: 'touching rows', targetTop: 180 },
  ])('avoids the input card with $name in either drag direction', ({ targetTop }) => {
    const params = {
      ...backward,
      sourceY: 80,
      targetY: targetTop + 35,
      sourceBounds: { x: 550, y: 0, width: 320, height: 180 },
      targetBounds: { x: 0, y: targetTop, width: 320, height: 180 },
    }
    for (const p of [params, reversed(params)]) {
      const [path, , laneY] = getConnectionPath(p)
      expect(laneY).toBeGreaterThan(params.sourceBounds.y + params.sourceBounds.height)
      expect(laneY).toBeGreaterThan(params.targetBounds.y + params.targetBounds.height)
      expect(path).not.toMatch(/NaN|Infinity/)
    }
    expect(getConnectionPath(reversed(params)).slice(1)).toEqual(getConnectionPath(params).slice(1))
  })

  it.each([
    { targetTop: 519, above: false },
    { targetTop: 520, above: true },
  ])('requires enough vertical space for the fixed band at y=$targetTop', ({ targetTop, above }) => {
    const params = {
      ...backward,
      sourceX: 500,
      sourceY: 100,
      targetY: targetTop + 40,
      sourceBounds: { x: 180, y: 20, width: 320, height: 180 },
      targetBounds: { x: 0, y: targetTop, width: 320, height: 180 },
    }
    for (const p of [params, reversed(params)]) {
      const [, , laneY] = getConnectionPath(p)
      if (above) expect(laneY).toBeLessThan(targetTop)
      else expect(laneY).toBeGreaterThan(targetTop + params.targetBounds.height)
    }
  })

  it('handles an unmeasured pointer exactly level with the horizontal lane', () => {
    const params: Params = {
      sourceX: 500,
      sourceY: 100,
      targetX: 0,
      targetY: 200,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }
    for (const p of [params, reversed(params)]) {
      const [path, , laneY] = getConnectionPath(p)
      expect(laneY).toBe(params.targetY)
      expect(path).not.toMatch(/NaN|Infinity/)
    }
  })
})
