import type { ReactFlowState } from '@xyflow/react'

import { useStore } from '@xyflow/react'
import { useEffect, useRef } from 'react'

const canvasStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  position: 'absolute',
  zIndex: 10,
  pointerEvents: 'none',
}

const storeSelector = (state: ReactFlowState) => ({
  width: state.width,
  height: state.height,
  transform: state.transform,
})

export interface HelperLinesProps {
  horizontal?: number
  vertical?: number
  strokeStyle?: string | CanvasGradient | CanvasPattern
}

// Render helper lines on a canvas above the React Flow pane.
export function HelperLines({ horizontal, vertical, strokeStyle = '#7d7fe9' }: HelperLinesProps): React.ReactElement {
  const { width, height, transform } = useStore(storeSelector)

  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const dpi = window.devicePixelRatio
    canvas.width = width * dpi
    canvas.height = height * dpi

    ctx.scale(dpi, dpi)
    ctx.clearRect(0, 0, width, height)
    ctx.strokeStyle = strokeStyle

    if (typeof vertical === 'number') {
      ctx.moveTo(vertical * transform[2] + transform[0], 0)
      ctx.lineTo(vertical * transform[2] + transform[0], height)
      ctx.stroke()
    }

    if (typeof horizontal === 'number') {
      ctx.moveTo(0, horizontal * transform[2] + transform[1])
      ctx.lineTo(width, horizontal * transform[2] + transform[1])
      ctx.stroke()
    }
  }, [width, height, transform, horizontal, vertical])

  return <canvas ref={canvasRef} style={canvasStyle} />
}
