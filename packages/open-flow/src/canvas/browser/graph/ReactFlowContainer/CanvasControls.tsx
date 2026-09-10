import styles from './ReactFlowContainer.module.scss'
import type { Val } from 'value-enhancer'
import type { InteractiveMode } from '../../stores/canvas/canvas.store.ts'

import { Panel } from '@xyflow/react'
import { useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../../../ui/browser/popover.tsx'
import { cn } from '../../../../ui/browser/utils.ts'
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
      <PopoverTrigger
        render={
          <Button
            aria-label={t('interactiveMode.title')}
            className={styles.interactiveModeTrigger}
            size="default"
            title={t('interactiveMode.title')}
            type="button"
            variant="ghost"
          >
            <i className={mode == 'mouse' ? 'i-custom:mouse' : 'i-custom:touchpad'} data-mode-icon />
            <i className="i-codicon:chevron-down" data-icon="inline-end" data-mode-chevron />
          </Button>
        }
      />
      <PopoverContent
        align="end"
        className={styles.interactiveModePanel}
        data-canvas-control-scope
        container={typeof document == 'undefined' ? undefined : getPopupContainer()}
        side="bottom"
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
            <i className="i-custom:mouse" />
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
            <i className="i-custom:touchpad" />
            <strong>{t('interactiveMode.touchpad')}</strong>
            <span>{t('interactiveMode.touchpadDescription')}</span>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function CanvasViewControls({
  maxZoomReached,
  minZoomReached,
  onFitView,
  onRelayout,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  zoom,
}: {
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

  return (
    <Panel position="bottom-left" className={cn(styles.island, styles.dock, styles.viewDock)} data-canvas-control-scope>
      <Button aria-label={t('zoomOut')} disabled={minZoomReached} onClick={onZoomOut} size="icon" title={t('zoomOut')} type="button" variant="ghost">
        <i className="i-codicon:zoom-out" />
      </Button>
      <Button className={styles.zoomValue} onClick={onZoomReset} size="default" title={t('zoomReset')} type="button" variant="ghost">
        {Math.round(zoom * 100)}%
      </Button>
      <Button aria-label={t('zoomIn')} disabled={maxZoomReached} onClick={onZoomIn} size="icon" title={t('zoomIn')} type="button" variant="ghost">
        <i className="i-codicon:zoom-in" />
      </Button>
      <Button aria-label={t('fitView')} onClick={onFitView} size="icon" title={t('fitView')} type="button" variant="ghost">
        <i className="i-custom:screen" />
      </Button>
      {onRelayout != null && (
        <Button aria-label={t('optimize')} onClick={onRelayout} size="icon" title={t('optimize')} type="button" variant="ghost">
          <i className="i-custom:layout" />
        </Button>
      )}
    </Panel>
  )
}

export function CanvasToolbar({ children }: { readonly children: React.ReactNode }) {
  return (
    <Panel position="bottom-center" className={cn(styles.island, styles.dock, styles.createDock)} data-canvas-control-scope>
      <div className={styles.dockActions}>{children}</div>
    </Panel>
  )
}
