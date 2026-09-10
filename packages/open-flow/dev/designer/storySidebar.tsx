import type { CSSProperties, ReactNode } from 'react'

import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const SidebarTargetContext = createContext<HTMLElement | null>(null)

export function StorySidebarLayout({ children }: { readonly children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const layout = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [width, setWidth] = useState<number | null>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const sidebarId = useId()
  const maxWidth = Math.max(0, Math.floor((availableWidth - 8) * 0.6))
  const minWidth = Math.min(240, maxWidth)
  const defaultWidth = availableWidth < 680 ? 304 : 344
  const clampWidth = (value: number) => Math.min(maxWidth, Math.max(minWidth, value))
  const sidebarWidth = clampWidth(width ?? defaultWidth)

  useEffect(() => {
    const element = layout.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <SidebarTargetContext.Provider value={target}>
      <div
        className="lab-story-layout"
        ref={layout}
        style={{ '--lab-story-sidebar-width': `${sidebarWidth}px` } as CSSProperties}
        data-resizing={dragging || undefined}
      >
        {children}
        <div
          className="lab-story-resizer"
          role="separator"
          tabIndex={0}
          aria-label="Resize Story sidebar"
          aria-orientation="vertical"
          aria-controls={sidebarId}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={sidebarWidth}
          aria-valuetext={`${sidebarWidth} pixels`}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return
            event.preventDefault()
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { x: event.clientX, width: sidebarWidth }
            setDragging(true)
          }}
          onPointerMove={(event) => {
            if (drag.current) setWidth(clampWidth(drag.current.width + drag.current.x - event.clientX))
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            drag.current = null
            setDragging(false)
          }}
          onPointerCancel={() => {
            drag.current = null
            setDragging(false)
          }}
          onLostPointerCapture={() => {
            drag.current = null
            setDragging(false)
          }}
          onDoubleClick={() => setWidth(null)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 32 : 8
            const next = { ArrowLeft: sidebarWidth + step, ArrowRight: sidebarWidth - step, Home: minWidth, End: maxWidth }[event.key]
            if (next === undefined) return
            event.preventDefault()
            setWidth(clampWidth(next))
          }}
        >
          <span aria-hidden="true" />
        </div>
        <aside id={sidebarId} className="lab-story-sidebar" aria-label="Story properties" ref={setTarget} />
      </div>
    </SidebarTargetContext.Provider>
  )
}

// Render the returned portal in the Story so its providers and component lifetime are preserved.
// Pass null when the Story has no sidebar content.
export function useStorySidebar(content: ReactNode) {
  const target = useContext(SidebarTargetContext)
  return target && content != null ? createPortal(content, target) : null
}
