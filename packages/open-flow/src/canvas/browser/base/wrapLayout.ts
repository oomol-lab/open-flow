import type { CanvasDirection } from '../../common/direction.ts'

export interface LayoutPoint {
  readonly x: number
  readonly y: number
}

/** Normalize primary/cross coordinates without rotating cards. */
export function layoutAxes(point: LayoutPoint, direction: CanvasDirection): LayoutPoint {
  return direction === 'vertical' ? { x: point.y, y: point.x } : point
}

export interface LayoutNode extends LayoutPoint {
  readonly id: string
  readonly column: number
  readonly width: number
  readonly height: number
}

const columnsPerRow = 6
const rowGap = 160

/** Wrap whole dependency columns; unmeasured default placement keeps six columns per row. */
export function wrapLayout(nodes: readonly LayoutNode[], availableWidth?: number): Readonly<Record<string, { x: number; y: number }>> {
  const byColumn = Map.groupBy(nodes, (node) => node.column)
  const columns = [...byColumn.keys()]
    .toSorted((a, b) => a - b)
    .map((column) => {
      const columnNodes = byColumn.get(column)!
      return { nodes: columnNodes, left: Math.min(...columnNodes.map((node) => node.x)), right: Math.max(...columnNodes.map((node) => node.x + node.width)) }
    })
  const positions: Record<string, { x: number; y: number }> = {}
  let rowTop = 0
  let rowLeft = 0
  for (let start = 0; start < columns.length;) {
    let end = start + 1
    let left = columns[start]!.left
    let right = columns[start]!.right
    while (end < columns.length) {
      const nextLeft = Math.min(left, columns[end]!.left)
      const nextRight = Math.max(right, columns[end]!.right)
      if (availableWidth == null ? end - start >= columnsPerRow : nextRight - nextLeft > availableWidth) break
      left = nextLeft
      right = nextRight
      end++
    }
    const row = columns.slice(start, end).flatMap((column) => column.nodes)
    const top = Math.min(...row.map((node) => node.y))
    const bottom = Math.max(...row.map((node) => node.y + node.height))
    if (start == 0) {
      rowLeft = left
      rowTop = top
    }
    for (const node of row) positions[node.id] = { x: node.x - left + rowLeft, y: node.y - top + rowTop }
    // Leave a clear return lane between rows, including rows containing tall branches.
    rowTop += bottom - top + rowGap
    start = end
  }
  return positions
}
