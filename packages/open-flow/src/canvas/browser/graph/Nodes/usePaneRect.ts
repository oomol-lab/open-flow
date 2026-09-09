import type { Rect, Viewport } from '@xyflow/react'
import type { ReadonlyVal } from 'value-enhancer'
import type { Size } from '../../base/compare.ts'

import { createContext, useContext } from 'react'

export const PaneRectContext: React.Context<ReadonlyVal<Rect>> = /*#__PURE__*/ createContext<ReadonlyVal<Rect>>(null!)

export function usePaneRect$(): ReadonlyVal<Rect> {
  return useContext(PaneRectContext)
}

const paddingX = 200
const paddingY = 100

export function getPaneRect(viewport: Viewport | undefined, paneSize: Size): Rect {
  if (viewport) {
    return {
      x: -viewport.x / viewport.zoom - paddingX,
      y: -viewport.y / viewport.zoom - paddingY,
      width: paneSize.width / viewport.zoom + paddingX * 2,
      height: paneSize.height / viewport.zoom + paddingY * 2,
    }
  }

  return { x: -paddingX, y: -paddingY, width: 1, height: 1 }
}
