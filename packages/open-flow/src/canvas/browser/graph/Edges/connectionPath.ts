import type { GetBezierPathParams, InternalNode, Rect } from '@xyflow/react'

import { getBezierPath, Position } from '@xyflow/react'

export function connectionNodeBounds(node: InternalNode | undefined | null): Rect | undefined {
  if (!node?.measured.width || !node.measured.height) return undefined
  return { ...node.internals.positionAbsolute, width: node.measured.width, height: node.measured.height }
}

/** Stable visual order, independent of which ports currently have connections. */
export function connectionPortIndex(node: InternalNode | undefined | null, handleId: string | null | undefined): number {
  const handles = [...(node?.internals.handleBounds?.source ?? []), ...(node?.internals.handleBounds?.target ?? [])]
  const handle = handles.find((item) => item.id === handleId)
  if (!handle) return 0
  return handles.filter((item) => item.position === handle.position && item.y < handle.y).length
}

/** A return loop belongs to its output: fixed side offsets and a lane below that card. */
export function getConnectionPath({
  sourceBounds,
  targetBounds,
  sourcePortIndex = 0,
  targetPortIndex = 0,
  ...params
}: GetBezierPathParams & { sourceBounds?: Rect; targetBounds?: Rect; sourcePortIndex?: number; targetPortIndex?: number }): [string, number, number] {
  const { sourceX, sourceY, targetX, targetY, sourcePosition = Position.Bottom, targetPosition = Position.Top } = params
  const reverse = sourcePosition === Position.Left && targetPosition === Position.Right
  const horizontal = (sourcePosition === Position.Right && targetPosition === Position.Left) || reverse
  const rightX = reverse ? targetX : sourceX
  const leftX = reverse ? sourceX : targetX
  if (!horizontal || rightX < leftX) {
    const [path, x, y] = getBezierPath(params)
    return [path, x, y]
  }

  // One clearance for the entire edge, regardless of which end starts the drag.
  const clearance = 40 + Math.max(sourcePortIndex, targetPortIndex) * 12
  const radius = 16
  // Normalize input-origin drags to the output-to-input direction.
  const outputBounds = reverse ? targetBounds : sourceBounds
  const rightY = reverse ? targetY : sourceY
  const leftY = reverse ? sourceY : targetY
  const right = rightX + clearance
  const left = leftX - clearance
  const laneY = Math.max(rightY, outputBounds ? outputBounds.y + outputBounds.height : rightY) + clearance
  const points = [
    { x: rightX, y: rightY },
    { x: right, y: rightY },
    { x: right, y: laneY },
    { x: left, y: laneY },
    { x: left, y: leftY },
    { x: leftX, y: leftY },
  ].filter((point, index, all) => index === 0 || point.x !== all[index - 1]!.x || point.y !== all[index - 1]!.y)
  if (reverse) points.reverse()
  let path = `M ${points[0]!.x} ${points[0]!.y}`
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1]!
    const corner = points[i]!
    const next = points[i + 1]!
    const before = Math.hypot(corner.x - previous.x, corner.y - previous.y)
    const after = Math.hypot(next.x - corner.x, next.y - corner.y)
    const r = Math.min(radius, before / 2, after / 2)
    path += ` L ${corner.x + ((previous.x - corner.x) * r) / before} ${corner.y + ((previous.y - corner.y) * r) / before}`
    path += ` Q ${corner.x} ${corner.y} ${corner.x + ((next.x - corner.x) * r) / after} ${corner.y + ((next.y - corner.y) * r) / after}`
  }
  const end = points.at(-1)!
  return [`${path} L ${end.x} ${end.y}`, (left + right) / 2, laneY]
}
