import type { ReactElement, ReactNode, RefObject } from 'react'
import type { WorkbenchTheme } from '../contract.ts'
import type { IconName } from '../icons.tsx'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { cn } from '../../../../ui/browser/utils.ts'
import { Icon } from '../icons.tsx'
import { cycleContextPanelFocus, observeContextPanelOverlay } from './contextPanelBehavior.ts'

interface ContextPanelProps {
  readonly className?: string
  readonly resizable?: boolean
  readonly leading?: ReactNode
  readonly heading?: ReactNode
  readonly actions?: ReactNode
  readonly children: ReactNode
  readonly focusOnOpen: boolean
  readonly icon: IconName
  readonly onClose: () => void
  readonly showClose?: boolean
  readonly theme: WorkbenchTheme
  readonly title: string
}

function useOverlayPanel(panel: RefObject<HTMLElement | null>): boolean {
  const [overlay, setOverlay] = useState(false)

  useEffect(() => {
    const root = panel.current?.closest<HTMLElement>('.open-flow-workbench')
    if (root == null) return
    return observeContextPanelOverlay(root, setOverlay)
  }, [panel])

  return overlay
}

export function ContextPanel({
  className,
  children,
  focusOnOpen,
  actions,
  heading,
  leading,
  icon,
  onClose,
  showClose = true,
  theme,
  title,
  resizable = false,
}: ContextPanelProps): ReactElement {
  const t = useTranslate()
  const panel = useRef<HTMLElement>(null)
  const overlay = useOverlayPanel(panel)
  const titleId = useId()
  const [width, setWidth] = useState<number>()
  const [availableWidth, setAvailableWidth] = useState(0)
  const drag = useRef<{ x: number; width: number }>()
  const maximumWidth = Math.max(320, Math.min(960, availableWidth - 320))
  const panelWidth = Math.min(maximumWidth, Math.max(320, width ?? Math.min(520, Math.max(400, availableWidth * 0.34))))
  useEffect(() => {
    const parent = panel.current?.parentElement
    if (parent == null || !resizable) return
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width))
    observer.observe(parent)
    return () => observer.disconnect()
  }, [resizable])
  useEffect(() => {
    const parent = panel.current?.parentElement
    if (parent == null || overlay || !resizable) return
    parent.style.setProperty('--context-panel-width', `${panelWidth}px`)
    return () => {
      parent.style.removeProperty('--context-panel-width')
    }
  }, [panelWidth, overlay, resizable])

  useEffect(() => {
    if (overlay && focusOnOpen) panel.current?.focus({ preventScroll: true })
  }, [focusOnOpen, overlay])

  useEffect(() => {
    if (!overlay) return
    const close = (event: KeyboardEvent): void => {
      const target = event.target
      if (event.key != 'Escape' || event.defaultPrevented || (target instanceof Element && target.closest('.open-flow-canvas-quick-pick-panel') != null)) return
      event.preventDefault()
      onClose()
    }
    globalThis.addEventListener('keydown', close)
    return () => globalThis.removeEventListener('keydown', close)
  }, [onClose, overlay])

  const keyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return
    const current = panel.current
    if (current == null || !(event.target instanceof Node) || !current.contains(event.target)) return
    if (event.key == 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (!overlay || event.key != 'Tab') return
    const focusable = [
      ...current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => element.getClientRects().length > 0)
    if (cycleContextPanelFocus(current, focusable, current.ownerDocument.activeElement, event.shiftKey)) event.preventDefault()
  }

  useEffect(() => {
    const current = panel.current
    current?.ownerDocument.addEventListener('keydown', keyDown)
    return () => current?.ownerDocument.removeEventListener('keydown', keyDown)
  }, [onClose, overlay])

  return (
    <>
      <div aria-hidden="true" className="context-panel-backdrop" onClick={onClose} />
      <aside
        aria-labelledby={titleId}
        aria-modal={overlay || undefined}
        className={cn('context-panel', className)}
        data-theme={theme}
        data-tooltip-portal
        ref={panel}
        role={overlay ? 'dialog' : 'complementary'}
        tabIndex={-1}
      >
        {resizable && !overlay && (
          <div
            className="context-panel-resizer"
            role="separator"
            tabIndex={0}
            aria-label={t('contextPanel.resize')}
            aria-orientation="vertical"
            aria-valuemin={320}
            aria-valuemax={maximumWidth}
            aria-valuenow={Math.round(panelWidth)}
            onPointerDown={(event) => {
              if (event.button != 0 || !event.isPrimary) return
              event.preventDefault()
              event.currentTarget.focus()
              event.currentTarget.setPointerCapture(event.pointerId)
              drag.current = { x: event.clientX, width: panelWidth }
            }}
            onPointerMove={(event) => {
              if (drag.current != null) setWidth(Math.min(maximumWidth, Math.max(320, drag.current.width + drag.current.x - event.clientX)))
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
              drag.current = undefined
            }}
            onPointerCancel={() => {
              drag.current = undefined
            }}
            onLostPointerCapture={() => {
              drag.current = undefined
            }}
            onDoubleClick={() => setWidth(undefined)}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 40 : 10
              const next = { ArrowLeft: panelWidth + step, ArrowRight: panelWidth - step, Home: 320, End: maximumWidth }[event.key]
              if (next == null) return
              event.preventDefault()
              setWidth(Math.min(maximumWidth, Math.max(320, next)))
            }}
          />
        )}
        <header>
          {leading}
          {heading == null ? (
            <>
              <span className="flex size-9 shrink-0 items-center justify-center" aria-hidden="true">
                <span className={`flex items-center justify-center text-2xl [&>svg]:size-full! ${icon === 'flow' ? 'size-5' : 'size-6'}`}>
                  <Icon name={icon} />
                </span>
              </span>
              <strong id={titleId}>{title}</strong>
            </>
          ) : (
            <>
              <span className="sr-only" id={titleId}>
                {title}
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-2">{heading}</div>
            </>
          )}
          {actions}
          {(showClose || overlay) && (
            <Button aria-label={t('contextPanel.close')} onClick={onClose} size="icon-sm" type="button" variant="ghost">
              <Icon name="close" />
            </Button>
          )}
        </header>
        <div className="context-panel-content">{children}</div>
      </aside>
    </>
  )
}
