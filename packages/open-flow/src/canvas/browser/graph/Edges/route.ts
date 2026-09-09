import type { EdgeProps, Rect } from '@xyflow/react'

import { Position } from '@xyflow/react'

export const EDGE_GAP = 32

export function getTurnY(
  edge: Pick<EdgeProps, 'sourceX' | 'sourceY' | 'sourcePosition' | 'targetX' | 'targetY' | 'targetPosition'>,
  source: Rect | undefined,
  target: Rect | undefined,
): number | undefined {
  if (edge.sourcePosition != Position.Right || edge.targetPosition != Position.Left || edge.sourceX <= edge.targetX || source == null || target == null) {
    return
  }

  const sourceBottom = source.y + source.height
  const targetBottom = target.y + target.height

  const lowerSpace = target.y - sourceBottom
  if (lowerSpace > 0) {
    const scale = Math.min(1, lowerSpace / (EDGE_GAP * 2))
    return target.y - EDGE_GAP * scale
  }

  const upperSpace = source.y - targetBottom
  if (upperSpace > 0) {
    const scale = Math.min(1, upperSpace / (EDGE_GAP * 2))
    return targetBottom + EDGE_GAP * scale
  }
}
