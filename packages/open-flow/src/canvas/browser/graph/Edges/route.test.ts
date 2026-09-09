import type { EdgeProps, Rect } from '@xyflow/react'

import { Position } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { EDGE_GAP, getTurnY } from './route.ts'

const edge = {
  sourceX: 970,
  sourceY: 44,
  sourcePosition: Position.Right,
  targetX: 277,
  targetY: 706,
  targetPosition: Position.Left,
} satisfies Pick<EdgeProps, 'sourceX' | 'sourceY' | 'sourcePosition' | 'targetX' | 'targetY' | 'targetPosition'>

const source: Rect = { x: 280, y: 0, width: 690, height: 296 }
const target: Rect = { x: 277, y: 624, width: 695, height: 168 }

describe('edge routing', () => {
  it('keeps a backward edge a fixed distance above the lower target node', () => {
    expect(getTurnY(edge, source, target)).toBe(target.y - EDGE_GAP)
  })

  it('keeps a backward edge a fixed distance below the upper target node', () => {
    const upperTarget = { ...target, y: -240 }
    const lowerSource = { ...source, y: 120 }
    const upperEdge = { ...edge, sourceY: 164, targetY: -158 }

    expect(getTurnY(upperEdge, lowerSource, upperTarget)).toBe(upperTarget.y + upperTarget.height + EDGE_GAP)
  })

  it('compresses both clearances continuously when the nodes get close', () => {
    const sourceBottom = source.y + source.height

    expect(getTurnY(edge, source, { ...target, y: sourceBottom + 65 })).toBe(sourceBottom + 33)
    expect(getTurnY(edge, source, { ...target, y: sourceBottom + 64 })).toBe(sourceBottom + 32)
    expect(getTurnY(edge, source, { ...target, y: sourceBottom + 63 })).toBe(sourceBottom + 31.5)

    const upperTarget = { ...target, y: 0 }
    const targetBottom = upperTarget.y + upperTarget.height
    expect(getTurnY(edge, { ...source, y: targetBottom + 63 }, upperTarget)).toBe(targetBottom + 31.5)
  })

  it('leaves forward edges and overlapping nodes on the default route', () => {
    expect(getTurnY({ ...edge, sourceX: 100, targetX: 500 }, source, target)).toBeUndefined()
    expect(getTurnY(edge, source, { ...target, y: source.y + source.height })).toBeUndefined()
  })
})
