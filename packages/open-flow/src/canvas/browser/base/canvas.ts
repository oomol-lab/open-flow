import type { XYPosition } from '@xyflow/react'

export const CANVAS_CLASSNAME = 'open-flow-canvas'

/** Marks an area that React Flow can drag. */
export const NODE_HANDLE_CLASSNAME = 'open-flow-canvas-node-handle'

/** Marks one handle row. */
export const HANDLE_ROW_CLASSNAME = 'open-flow-canvas-handle-row'
export const HANDLE_ROW_EXPANDED_CLASSNAME = 'open-flow-canvas-handle-row-expanded'

export const DEFAULT_POSITION: XYPosition = /* @__PURE__ */ Object.freeze({ x: 0, y: 0 })
