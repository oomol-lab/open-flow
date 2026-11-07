import type { LayoutPoint } from './wrapLayout.ts'

const epsilon = 1e-6

function samePoint(a: LayoutPoint, b: LayoutPoint): boolean {
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon
}

interface Segment {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

function segment(a: LayoutPoint, b: LayoutPoint): Segment {
  return { left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) }
}

/** Allow only the common prefix/suffix, not later crossings between the same edges. */
function sharedEnd(a: readonly LayoutPoint[], b: readonly LayoutPoint[], overlap: Segment, reverse: boolean): boolean {
  const step = reverse ? -1 : 1
  let i = reverse ? a.length - 1 : 0
  let j = reverse ? b.length - 1 : 0
  let start = a[i]!
  if (!samePoint(start, b[j]!)) return false
  if (
    Math.abs(overlap.left - start.x) < epsilon &&
    Math.abs(overlap.right - start.x) < epsilon &&
    Math.abs(overlap.top - start.y) < epsilon &&
    Math.abs(overlap.bottom - start.y) < epsilon
  )
    return true
  while (a[i + step] && b[j + step]) {
    const endA = a[i + step]!
    const endB = b[j + step]!
    const vertical = Math.abs(endA.x - start.x) < epsilon
    const otherVertical = Math.abs(endB.x - start.x) < epsilon
    const directionA = vertical ? endA.y - start.y : endA.x - start.x
    const directionB = vertical ? endB.y - start.y : endB.x - start.x
    if (vertical !== otherVertical || directionA * directionB < 0) return false
    const end = Math.abs(directionA) <= Math.abs(directionB) ? endA : endB
    const common = segment(start, end)
    if (
      overlap.left >= common.left - epsilon &&
      overlap.right <= common.right + epsilon &&
      overlap.top >= common.top - epsilon &&
      overlap.bottom <= common.bottom + epsilon
    )
      return true
    if (samePoint(end, endA)) i += step
    if (samePoint(end, endB)) j += step
    start = end
  }
  return false
}

/** Check orthogonal routes once after layout; stop at the first unrelated contact or overlap. */
export function hasRouteCrossings(routes: ReadonlyMap<string, readonly LayoutPoint[]>): boolean {
  const paths = [...routes.values()].map((points) => {
    const path = points.filter((point, index) => index === 0 || !samePoint(point, points[index - 1]!))
    return { path, segments: path.slice(1).map((point, index) => segment(path[index]!, point)) }
  })
  for (let i = 0; i < paths.length; i++) {
    const a = paths[i]!
    for (let j = i + 1; j < paths.length; j++) {
      const b = paths[j]!
      for (const first of a.segments) {
        for (const second of b.segments) {
          const left = Math.max(first.left, second.left)
          const right = Math.min(first.right, second.right)
          const top = Math.max(first.top, second.top)
          const bottom = Math.min(first.bottom, second.bottom)
          if (left > right + epsilon || top > bottom + epsilon) continue
          const overlap = { left, right, top, bottom }
          if (!sharedEnd(a.path, b.path, overlap, false) && !sharedEnd(a.path, b.path, overlap, true)) return true
        }
      }
    }
  }
  return false
}
