import type { ReactNode } from 'react'
import type { Size } from '../../../base/compare.ts'

import { useStoreApi } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import { CanvasTooltip } from '../../../components/tooltip.tsx'

export interface NodeResizeChange extends Size {
  /** Movement of the left edge, relative to the beginning of this resize. */
  readonly offsetX: number
}

interface Props {
  readonly children?: ReactNode
  readonly className: string
  readonly disabled?: boolean
  readonly label: string
  readonly minimum: Size
  readonly position: 'left' | 'right' | 'bottom-right'
  readonly showTooltip?: boolean
  readonly size: Size
  readonly onStart?: () => void
  readonly onResize: (change: NodeResizeChange) => void
  readonly onCommit?: (change: NodeResizeChange) => void
  readonly onCancel?: () => void
  readonly onReset?: () => void
}

/** Shared canvas-space dragging and keyboard resizing for node controls. */
export function NodeResizeHandle({
  children,
  className,
  disabled,
  label,
  minimum,
  position,
  showTooltip = true,
  size,
  onStart,
  onResize,
  onCommit,
  onCancel,
  onReset,
}: Props) {
  const reactFlow = useStoreApi()
  const drag = useRef<{ x: number; y: number; size: Size; zoom: number; last: NodeResizeChange }>()
  const cancel = useRef(onCancel)
  cancel.current = onCancel
  useEffect(
    () => () => {
      if (drag.current) {
        drag.current = undefined
        cancel.current?.()
      }
    },
    [],
  )

  const resized = (initial: Size, dx: number, dy: number): NodeResizeChange => {
    const width = Math.max(minimum.width, initial.width + (position === 'left' ? -dx : dx))
    return {
      width,
      height: position === 'bottom-right' ? Math.max(minimum.height, initial.height + dy) : initial.height,
      offsetX: position === 'left' ? initial.width - width : 0,
    }
  }
  const finish = () => {
    const start = drag.current
    drag.current = undefined
    if (!start) return
    if (start.last.width === start.size.width && start.last.height === start.size.height) onCancel?.()
    else onCommit?.(start.last)
  }

  const handle = (
    <button
      type="button"
      className={`${className} nodrag nopan`}
      aria-label={label}
      disabled={disabled}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onReset?.()
      }}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return
        event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        onStart?.()
        drag.current = { x: event.clientX, y: event.clientY, size, zoom: reactFlow.getState().transform[2], last: { ...size, offsetX: 0 } }
      }}
      onPointerMove={(event) => {
        const start = drag.current
        if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return
        start.last = resized(start.size, (event.clientX - start.x) / start.zoom, (event.clientY - start.y) / start.zoom)
        onResize(start.last)
      }}
      onPointerUp={(event) => {
        finish()
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onLostPointerCapture={() => {
        if (!drag.current) return
        drag.current = undefined
        onCancel?.()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && drag.current) {
          event.preventDefault()
          event.stopPropagation()
          drag.current = undefined
          onCancel?.()
          return
        }
        const step = event.shiftKey ? 40 : 10
        const delta = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as const)[event.key]
        if (!delta || (position !== 'bottom-right' && delta[1] !== 0)) return
        event.preventDefault()
        event.stopPropagation()
        const change = resized(size, delta[0], delta[1])
        if (change.width === size.width && change.height === size.height) return
        onStart?.()
        onResize(change)
        onCommit?.(change)
      }}
    >
      {children}
    </button>
  )
  return showTooltip ? (
    <CanvasTooltip title={label} placement="bottom">
      {handle}
    </CanvasTooltip>
  ) : (
    handle
  )
}
