import type { GetBezierPathParams, InternalNode, Rect } from '@xyflow/react'
import type { LayoutPoint } from '../../base/wrapLayout.ts'

import { getBezierPath, getSmoothStepPath, Position } from '@xyflow/react'

export type ConnectionPathParams = GetBezierPathParams & { sourceBounds?: Rect; targetBounds?: Rect; waypoints?: readonly LayoutPoint[] }

export function connectionNodeBounds(node: InternalNode | undefined | null): Rect | undefined {
  if (!node?.measured.width || !node.measured.height) return undefined
  return { ...node.internals.positionAbsolute, width: node.measured.width, height: node.measured.height }
}

/** Align arrows with their ports and route returns outside both cards. */
export function getConnectionPath({ sourceBounds, targetBounds, waypoints, ...params }: ConnectionPathParams): [string, number, number] {
  const { sourcePosition = Position.Bottom, targetPosition = Position.Top } = params
  const vertical =
    (sourcePosition === Position.Bottom && targetPosition === Position.Top) || (sourcePosition === Position.Top && targetPosition === Position.Bottom)
  const reverse =
    (sourcePosition === Position.Left && targetPosition === Position.Right) || (sourcePosition === Position.Top && targetPosition === Position.Bottom)
  const horizontal =
    (sourcePosition === Position.Right && targetPosition === Position.Left) || (sourcePosition === Position.Left && targetPosition === Position.Right)
  if (waypoints && waypoints.length > 2) {
    const interior = waypoints.slice(1, -1)
    const first = interior[0]!
    const last = interior.at(-1)!
    const points = [
      { x: params.sourceX, y: params.sourceY },
      vertical ? { x: params.sourceX, y: first.y } : { x: first.x, y: params.sourceY },
      ...interior,
      vertical ? { x: params.targetX, y: last.y } : { x: last.x, y: params.targetY },
      { x: params.targetX, y: params.targetY },
    ]
    const label = interior[Math.floor(interior.length / 2)]!
    return [roundedConnectionPath(points), label.x, label.y]
  }
  const primary = (x: number, y: number) => (vertical ? y : x)
  const cross = (x: number, y: number) => (vertical ? x : y)
  const sourceX = primary(params.sourceX, params.sourceY)
  const sourceY = cross(params.sourceX, params.sourceY)
  const targetX = primary(params.targetX, params.targetY)
  const targetY = cross(params.targetX, params.targetY)
  const outputX = reverse ? targetX : sourceX
  const inputX = reverse ? sourceX : targetX
  if (!horizontal && !vertical) {
    const [path, x, y] = getBezierPath(params)
    return [path, x, y]
  }
  if (outputX < inputX) {
    // Vertical turns finish before the arrow; horizontal connections retain their Bézier curves.
    const [path, x, y] = vertical ? getSmoothStepPath({ ...params, borderRadius: 16, offset: Math.min(16, (inputX - outputX) / 4) }) : getBezierPath(params)
    return [path, x, y]
  }

  // Input-origin drags use the same output-to-input geometry as completed edges.
  const axes = (bounds: Rect | undefined): Rect | undefined =>
    bounds && (vertical ? { x: bounds.y, y: bounds.x, width: bounds.height, height: bounds.width } : bounds)
  const outputBounds = axes(reverse ? targetBounds : sourceBounds)
  const inputBounds = axes(reverse ? sourceBounds : targetBounds)
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
  ]
    .filter((point, index, all) => index === 0 || point.x !== all[index - 1]!.x || point.y !== all[index - 1]!.y)
    .map((point) => (vertical ? { x: point.y, y: point.x } : point))
  if (reverse) points.reverse()
  const middle = (left + right) / 2
  return [roundedConnectionPath(points), vertical ? laneY : middle, vertical ? middle : laneY]
}

function roundedConnectionPath(input: readonly LayoutPoint[]): string {
  const points = input.filter((point, index) => index === 0 || point.x !== input[index - 1]!.x || point.y !== input[index - 1]!.y)
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
  return `${path} L ${end.x} ${end.y}`
}
