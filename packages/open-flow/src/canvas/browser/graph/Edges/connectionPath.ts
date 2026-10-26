import type { GetBezierPathParams, InternalNode, Rect } from '@xyflow/react'

import { getBezierPath, Position } from '@xyflow/react'

export type ConnectionPathParams = GetBezierPathParams & { sourceBounds?: Rect; targetBounds?: Rect }

export function connectionNodeBounds(node: InternalNode | undefined | null): Rect | undefined {
  if (!node?.measured.width || !node.measured.height) return undefined
  return { ...node.internals.positionAbsolute, width: node.measured.width, height: node.measured.height }
}

/** Return connections offset both side turns and horizontal lanes by their endpoint distance. */
export function getConnectionPath({ sourceBounds, targetBounds, ...params }: ConnectionPathParams): [string, number, number] {
  const { sourceX, sourceY, targetX, targetY, sourcePosition = Position.Bottom, targetPosition = Position.Top } = params
  const reverse = sourcePosition === Position.Left && targetPosition === Position.Right
  const horizontal = (sourcePosition === Position.Right && targetPosition === Position.Left) || reverse
  const outputX = reverse ? targetX : sourceX
  const inputX = reverse ? sourceX : targetX
  if (!horizontal || outputX < inputX) {
    const [path, x, y] = getBezierPath(params)
    return [path, x, y]
  }

  // Normalize input-origin drags to the output-to-input direction.
  const outputBounds = reverse ? targetBounds : sourceBounds
  const inputBounds = reverse ? sourceBounds : targetBounds
  const outputY = reverse ? targetY : sourceY
  const inputY = reverse ? sourceY : targetY
  const minimumOffset = 40
  const departureOffset = minimumOffset + (Math.abs(inputX - outputX) + Math.abs(inputY - outputY)) * 0.1
  const outputBottom = Math.max(outputY, outputBounds ? outputBounds.y + outputBounds.height : outputY)
  const inputBottom = inputBounds ? inputBounds.y + inputBounds.height : outputBottom

  // Below both cards, the two side turns use the same offset.
  let arrivalOffset = departureOffset
  let laneY = Math.max(outputBottom, inputBottom) + departureOffset
  if (inputBounds) {
    // The input width anchors the upper turning band. Reflecting within this fixed band
    // preserves spacing and nesting without depending on any other connection.
    const reflectedOffset = inputBounds.width - departureOffset
    const upperLane = inputBounds.y - reflectedOffset
    if (reflectedOffset >= minimumOffset && upperLane >= outputBottom + departureOffset) {
      arrivalOffset = reflectedOffset
      laneY = upperLane
    }
  }
  const right = outputX + departureOffset
  const left = inputX - arrivalOffset
  const points = [
    { x: outputX, y: outputY },
    { x: right, y: outputY },
    { x: right, y: laneY },
    { x: left, y: laneY },
    { x: left, y: inputY },
    { x: inputX, y: inputY },
  ].filter((point, index, all) => index === 0 || point.x !== all[index - 1]!.x || point.y !== all[index - 1]!.y)
  if (reverse) points.reverse()
  const radius = 16
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
