import styles from './ReactFlowContainer.module.scss'
import type { Val } from 'value-enhancer'
import type { InteractiveMode } from '../../stores/canvas/canvas.store.ts'

import { Panel } from '@xyflow/react'
import { useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '../../../../ui/browser/dropdown-menu.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../../../ui/browser/popover.tsx'
import { cn } from '../../../../ui/browser/utils.ts'
import { CanvasTooltip } from '../../components/tooltip.tsx'
import { CanvasMiniMap } from './CanvasMiniMap.tsx'
import { useGetStaticPopupContainer } from './useGetPopupContainer.ts'

export function CanvasInteractiveMode({
  interactiveMode$,
  defaultOpen = false,
}: {
  readonly interactiveMode$: Val<InteractiveMode>
  readonly defaultOpen?: boolean
}) {
  const t = useTranslate()
  const mode = useVal(interactiveMode$)
  const [open, setOpen] = useState(defaultOpen)
  const getPopupContainer = useGetStaticPopupContainer()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <CanvasTooltip placement="top" title={t('interactiveMode.title')}>
        <PopoverTrigger
          render={
            <Button aria-label={t('interactiveMode.title')} className={styles.interactiveModeTrigger} size="icon" type="button" variant="ghost">
              <i className={mode == 'mouse' ? 'i-lucide-light:mouse' : 'i-lucide-light:touchpad'} data-mode-icon />
            </Button>
          }
        />
      </CanvasTooltip>
      <PopoverContent
        align="start"
        className={styles.interactiveModePanel}
        data-canvas-control-scope
        container={typeof document == 'undefined' ? undefined : getPopupContainer()}
        side="top"
        sideOffset={14}
      >
        <div aria-label={t('interactiveMode.title')} className={styles.interactiveModeChoices} role="radiogroup">
          <Button
            aria-checked={mode == 'mouse'}
            className={styles.interactiveModeChoice}
            onClick={() => {
              interactiveMode$.set('mouse')
              setOpen(false)
            }}
            role="radio"
            type="button"
            variant="outline"
          >
            <i aria-hidden="true" className="i-lucide-light:mouse" />
            <strong>{t('interactiveMode.mouse')}</strong>
            <span>{t('interactiveMode.mouseDescription')}</span>
          </Button>
          <Button
            aria-checked={mode == 'touchpad'}
            className={styles.interactiveModeChoice}
            onClick={() => {
              interactiveMode$.set('touchpad')
              setOpen(false)
            }}
            role="radio"
            type="button"
            variant="outline"
          >
            <i aria-hidden="true" className="i-lucide-light:touchpad" />
            <strong>{t('interactiveMode.touchpad')}</strong>
            <span>{t('interactiveMode.touchpadDescription')}</span>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function CanvasInteractiveModeMenu({ interactiveMode$ }: { readonly interactiveMode$: Val<InteractiveMode> }) {
  const t = useTranslate()
  const mode = useVal(interactiveMode$)
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t('interactiveMode.title')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(value) => interactiveMode$.set(value as InteractiveMode)}>
          <DropdownMenuRadioItem value="mouse">{t('interactiveMode.mouse')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="touchpad">{t('interactiveMode.touchpad')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
    </>
  )
}

export function CanvasViewControls({
  interactiveMode$,
  miniMapExpanded$,
  maxZoomReached,
  minZoomReached,
  onFitView,
  onRelayout,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  zoom,
}: {
  readonly interactiveMode$?: Val<InteractiveMode>
  readonly miniMapExpanded$?: Val<boolean | undefined>
  readonly maxZoomReached: boolean
  readonly minZoomReached: boolean
  readonly onFitView: () => void
  readonly onRelayout?: () => void
  readonly onZoomIn: () => void
  readonly onZoomOut: () => void
  readonly onZoomReset: () => void
  readonly zoom: number
}) {
  const t = useTranslate()
  const [popupContainer, setPopupContainer] = useState<HTMLDivElement | null>(null)

  return (
    <Panel
      position="bottom-left"
      className={cn('open-flow-control-island open-flow-control-island-compact', styles.dock, styles.viewDock)}
      data-canvas-control-scope
      data-tooltip-toolbar
    >
      <div className={styles.compactViewControls} ref={setPopupContainer}>
        <DropdownMenu>
          <CanvasTooltip placement="top" title={t('view')}>
            <DropdownMenuTrigger
              render={
                <Button aria-label={`${t('view')} · ${Math.round(zoom * 100)}%`} size="default" type="button" variant="ghost">
                  {Math.round(zoom * 100)}%
                  <i aria-hidden="true" className="i-lucide-light:chevron-down" />
                </Button>
              }
            />
          </CanvasTooltip>
          <DropdownMenuContent align="start" className="min-w-48" container={popupContainer} side="top" sideOffset={8}>
            <DropdownMenuItem disabled={minZoomReached} onClick={onZoomOut}>
              <i aria-hidden="true" className="i-lucide-light:zoom-out" />
              {t('zoomOut')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={maxZoomReached} onClick={onZoomIn}>
              <i aria-hidden="true" className="i-lucide-light:zoom-in" />
              {t('zoomIn')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onZoomReset}>
              <i aria-hidden="true" className="i-lucide-light:rotate-ccw" />
              {t('zoomReset')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onFitView}>
              <i aria-hidden="true" className="i-lucide-light:scan" />
              {t('fitView')}
            </DropdownMenuItem>
            {onRelayout != null && (
              <DropdownMenuItem onClick={onRelayout}>
                <i aria-hidden="true" className="i-lucide-light:layout-grid" />
                {t('optimize')}
              </DropdownMenuItem>
            )}
            {interactiveMode$ != null && <CanvasInteractiveModeMenu interactiveMode$={interactiveMode$} />}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className={styles.expandedViewControls}>
        <CanvasTooltip placement="top" title={t('zoomOut')}>
          <Button aria-label={t('zoomOut')} disabled={minZoomReached} onClick={onZoomOut} size="icon" type="button" variant="ghost">
            <i className="i-lucide-light:zoom-out" />
          </Button>
        </CanvasTooltip>
        <CanvasTooltip placement="top" title={t('zoomReset')}>
          <Button aria-label={t('zoomReset')} className={styles.zoomValue} onClick={onZoomReset} size="default" type="button" variant="ghost">
            {Math.round(zoom * 100)}%
          </Button>
        </CanvasTooltip>
        <CanvasTooltip placement="top" title={t('zoomIn')}>
          <Button aria-label={t('zoomIn')} disabled={maxZoomReached} onClick={onZoomIn} size="icon" type="button" variant="ghost">
            <i className="i-lucide-light:zoom-in" />
          </Button>
        </CanvasTooltip>
        <CanvasTooltip placement="top" title={t('fitView')}>
          <Button aria-label={t('fitView')} onClick={onFitView} size="icon" type="button" variant="ghost">
            <i className="i-lucide-light:scan" />
          </Button>
        </CanvasTooltip>
        {onRelayout != null && (
          <CanvasTooltip placement="top" title={t('optimize')}>
            <Button aria-label={t('optimize')} onClick={onRelayout} size="icon" type="button" variant="ghost">
              <i className="i-lucide-light:layout-grid" />
            </Button>
          </CanvasTooltip>
        )}
      </div>
      {(miniMapExpanded$ != null || interactiveMode$ != null) && (
        <>
          <span aria-hidden="true" className={styles.viewSeparator} />
          {miniMapExpanded$ != null && <CanvasMiniMap miniMapExpanded$={miniMapExpanded$} />}
          {interactiveMode$ != null && (
            <div className={styles.expandedViewControls}>
              <CanvasInteractiveMode interactiveMode$={interactiveMode$} />
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

export function CanvasToolbar({ children }: { readonly children: React.ReactNode }) {
  return (
    <Panel position="bottom-center" className={cn('open-flow-control-island', styles.dock, styles.createDock)} data-canvas-control-scope data-tooltip-toolbar>
      <div className={styles.dockActions}>{children}</div>
    </Panel>
  )
}

export function CanvasBottomRightControls({ children }: { readonly children: React.ReactNode }) {
  return (
    <Panel
      position="bottom-right"
      className={cn('open-flow-control-island open-flow-control-island-compact', styles.dock)}
      data-canvas-control-scope
      data-tooltip-toolbar
    >
      {children}
    </Panel>
  )
}

export function CanvasTopLeftControls({ children }: { readonly children: React.ReactNode }) {
  return (
    <Panel position="top-left" data-canvas-control-scope>
      {children}
    </Panel>
  )
}
