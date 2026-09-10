import type { ComponentProps } from 'react'
import type { CanvasHistoryControlsProps } from './canvasHistoryControls.tsx'

import { useEffect, useRef } from 'react'
import { isMac } from '../../../../canvas/browser/base/dom.ts'

const isolated = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], [role="alertdialog"], .nokey'

/** Owns history shortcuts for an editor, including its inspector and portaled controls. */
export function CanvasHistoryScope({
  history,
  disabled,
  ...props
}: Omit<ComponentProps<'div'>, 'onFocusCapture' | 'onPointerDownCapture'> & {
  readonly history: CanvasHistoryControlsProps
  readonly disabled?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const active = useRef(false)
  const latest = useRef({ history, disabled })
  latest.current = { history, disabled }

  useEffect(() => {
    const element = root.current!
    const document = element.ownerDocument
    // Capture runs before React's scope handlers, which also cover React portals.
    const pointerDown = () => {
      active.current = false
    }
    const focusIn = (event: FocusEvent) => {
      // Removed controls can leave focus on body without leaving the editor.
      if (event.target != document.body && event.target != document.documentElement) active.current = false
    }
    const keyDown = (event: KeyboardEvent) => {
      if (!active.current || event.defaultPrevented || event.isComposing || event.altKey) return
      if (isMac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return
      const key = event.key.toLowerCase()
      if (key != 'z' && (isMac || key != 'y')) return
      if (event.composedPath().some((target) => target instanceof Element && target.matches(isolated))) return
      // A modal may be portaled outside the editor, or temporarily have no focus.
      if (
        [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]')].some(
          (dialog) => dialog.getClientRects().length > 0 && getComputedStyle(dialog).visibility != 'hidden',
        )
      )
        return
      const current = latest.current
      if (current.disabled || current.history.disabled) return
      const redo = event.shiftKey || key == 'y'
      if (redo ? !current.history.state.canRedo : !current.history.state.canUndo) return
      event.preventDefault()
      if (redo) current.history.onRedo()
      else current.history.onUndo()
    }
    active.current = element.contains(document.activeElement)
    document.addEventListener('pointerdown', pointerDown, true)
    document.addEventListener('focusin', focusIn, true)
    document.addEventListener('keydown', keyDown)
    return () => {
      active.current = false
      document.removeEventListener('pointerdown', pointerDown, true)
      document.removeEventListener('focusin', focusIn, true)
      document.removeEventListener('keydown', keyDown)
    }
  }, [])

  return (
    <div
      {...props}
      ref={root}
      onFocusCapture={() => {
        active.current = true
      }}
      onPointerDownCapture={() => {
        active.current = true
      }}
    />
  )
}
