import type { XYPosition } from '@xyflow/react'
import type { CanvasDirection } from '../../common/direction.ts'

export const CANVAS_CLASSNAME = 'open-flow-canvas'

export const CANVAS_CARD_WIDTH = 320
export const CANVAS_BRANCH_GAP = 6
export const CANVAS_BRANCH_INLINE_PADDING = 8
export function minimumCanvasCardWidth(direction: CanvasDirection, branchCount: number): number {
  // A standard three-branch card gives each column approximately 96px.
  return direction === 'vertical' && branchCount > 0
    ? Math.max(CANVAS_CARD_WIDTH, branchCount * 96 + (branchCount - 1) * CANVAS_BRANCH_GAP + 2 * CANVAS_BRANCH_INLINE_PADDING + 2)
    : CANVAS_CARD_WIDTH
}
export function canvasCardWidth(direction: CanvasDirection, branchCount: number, preferredWidth?: number): number {
  const minimum = minimumCanvasCardWidth(direction, branchCount)
  return direction === 'vertical' && preferredWidth != null && Number.isFinite(preferredWidth) ? Math.max(minimum, preferredWidth) : minimum
}

export const CANVAS_NODE_PADDING = 8
export const CANVAS_HEADER_HANDLE_Y = 38
/** Initial placement estimate before a newly chosen card has been measured. */
export const DEFAULT_CANVAS_NODE_HEIGHT = 92

/** Marks an area that React Flow can drag. */
export const NODE_HANDLE_CLASSNAME = 'open-flow-canvas-node-handle'

/** Marks one handle row. */
export const HANDLE_ROW_CLASSNAME = 'open-flow-canvas-handle-row'
export const HANDLE_ROW_EXPANDED_CLASSNAME = 'open-flow-canvas-handle-row-expanded'

export const DEFAULT_POSITION: XYPosition = /* @__PURE__ */ Object.freeze({ x: 0, y: 0 })
