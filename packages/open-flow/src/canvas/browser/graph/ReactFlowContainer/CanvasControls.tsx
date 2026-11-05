import styles from './ReactFlowContainer.module.scss'
import type { ReactNode } from 'react'
import type { Val } from 'value-enhancer'
import type { CanvasDirection } from '../../../common/direction.ts'
import type { InteractiveMode } from '../../stores/canvas/canvas.store.ts'

import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
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
import { CanvasMiniMap, CanvasMiniMapMenuItem, CanvasMiniMapButton } from './CanvasMiniMap.tsx'
import { useGetStaticPopupContainer } from './useGetPopupContainer.ts'

function CanvasOptionPicker<Value extends string>({
  label,
  value,
  options,
  onValueChange,
  disabled = false,
  defaultOpen = false,
}: {
  readonly label: string
  readonly value: Value
  readonly options: readonly { readonly value: Value; readonly icon: ReactNode; readonly label: string; readonly description: string }[]
  readonly onValueChange: (value: Value) => void
  readonly disabled?: boolean
  readonly defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const getPopupContainer = useGetStaticPopupContainer()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <CanvasTooltip placement="top" title={label}>
        <PopoverTrigger
          render={
            <Button aria-label={label} className={styles.viewChoiceTrigger} disabled={disabled} size="icon" type="button" variant="ghost">
              {options.find((option) => option.value === value)?.icon}
            </Button>
          }
        />
      </CanvasTooltip>
      <PopoverContent
        align="start"
        aria-label={label}
        className={styles.viewChoicePanel}
        data-canvas-control-scope
        container={typeof document == 'undefined' ? undefined : getPopupContainer()}
        side="top"
        sideOffset={14}
      >
        <RadioGroup
          aria-label={label}
          className={styles.viewChoices}
          disabled={disabled}
          onValueChange={(next) => {
            onValueChange(next)
            setOpen(false)
          }}
          value={value}
        >
          {options.map((option) => (
            <Radio.Root
              key={option.value}
              nativeButton
              value={option.value}
              render={<Button className={styles.viewChoice} onClick={() => setOpen(false)} type="button" variant="outline" />}
            >
              {option.icon}
              <strong>{option.label}</strong>
              <span>{option.description}</span>
            </Radio.Root>
          ))}
        </RadioGroup>
      </PopoverContent>
    </Popover>
  )
}

export function CanvasInteractiveMode({
  interactiveMode$,
  defaultOpen = false,
}: {
  readonly interactiveMode$: Val<InteractiveMode>
  readonly defaultOpen?: boolean
}) {
  const t = useTranslate()
  const mode = useVal(interactiveMode$)
  return (
    <CanvasOptionPicker
      defaultOpen={defaultOpen}
      label={t('interactiveMode.title')}
      onValueChange={(next) => interactiveMode$.set(next)}
      options={[
        {
          value: 'mouse',
          icon: <i aria-hidden="true" className="i-lucide-light:mouse" />,
          label: t('interactiveMode.mouse'),
          description: t('interactiveMode.mouseDescription'),
        },
        {
          value: 'touchpad',
          icon: <i aria-hidden="true" className="i-lucide-light:touchpad" />,
          label: t('interactiveMode.touchpad'),
          description: t('interactiveMode.touchpadDescription'),
        },
      ]}
      value={mode}
    />
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
          <DropdownMenuRadioItem value="mouse">
            <i aria-hidden="true" className="i-lucide-light:mouse" />
            {t('interactiveMode.mouse')}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="touchpad">
            <i aria-hidden="true" className="i-lucide-light:touchpad" />
            {t('interactiveMode.touchpad')}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
    </>
  )
}

interface DirectionControlProps {
  readonly direction?: CanvasDirection
  readonly changingDirection?: boolean
  readonly onChangeDirection?: (direction: CanvasDirection) => void
}

function CanvasDirectionIcon({ direction }: { readonly direction: CanvasDirection }) {
  return <i aria-hidden="true" className={direction === 'vertical' ? 'i-tabler-light:arrow-autofit-down' : 'i-tabler-light:arrow-autofit-right'} />
}

function CanvasDirectionButton({ direction = 'horizontal', changingDirection, onChangeDirection }: DirectionControlProps) {
  const t = useTranslate()
  return (
    <CanvasOptionPicker
      disabled={changingDirection}
      label={t('layoutDirection.title')}
      onValueChange={(next) => onChangeDirection?.(next)}
      options={[
        {
          value: 'vertical',
          icon: <CanvasDirectionIcon direction="vertical" />,
          label: t('layoutDirection.vertical'),
          description: t('layoutDirection.verticalDescription'),
        },
        {
          value: 'horizontal',
          icon: <CanvasDirectionIcon direction="horizontal" />,
          label: t('layoutDirection.horizontal'),
          description: t('layoutDirection.horizontalDescription'),
        },
      ]}
      value={direction}
    />
  )
}

function CanvasOptionsMenu({
  onRelayout,
  miniMapExpanded$,
  interactiveMode$,
  direction = 'horizontal',
  changingDirection,
  onChangeDirection,
}: DirectionControlProps & {
  readonly onRelayout?: () => void
  readonly miniMapExpanded$?: Val<boolean | undefined>
  readonly interactiveMode$?: Val<InteractiveMode>
}) {
  const t = useTranslate()
  return (
    <>
      {onRelayout != null && (
        <DropdownMenuItem disabled={changingDirection} onClick={onRelayout}>
          <i aria-hidden="true" className="i-lucide-light:layout-template" />
          {t('optimize')}
        </DropdownMenuItem>
      )}
      {onChangeDirection && (
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('layoutDirection.title')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={direction} onValueChange={(value) => onChangeDirection(value as CanvasDirection)}>
            <DropdownMenuRadioItem disabled={changingDirection} value="vertical">
              <CanvasDirectionIcon direction="vertical" />
              {t('layoutDirection.vertical')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem disabled={changingDirection} value="horizontal">
              <CanvasDirectionIcon direction="horizontal" />
              {t('layoutDirection.horizontal')}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      )}
      {miniMapExpanded$ != null && <CanvasMiniMapMenuItem miniMapExpanded$={miniMapExpanded$} />}
      {interactiveMode$ != null && <CanvasInteractiveModeMenu interactiveMode$={interactiveMode$} />}
    </>
  )
}

export function CanvasViewControls({
  direction,
  changingDirection,
  onChangeDirection,
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
}: DirectionControlProps & {
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
  const [optionsExpanded, setOptionsExpanded] = useState(false)
  const [popupContainer, setPopupContainer] = useState<HTMLDivElement | null>(null)

  return (
    <Panel
      position="bottom-left"
      className={cn('open-flow-control-island open-flow-control-island-compact', styles.dock, styles.viewDock)}
      data-canvas-control-scope
      data-tooltip-toolbar
      ref={setPopupContainer}
    >
      <div className={styles.compactViewControls}>
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
            <DropdownMenuSeparator />
            <CanvasOptionsMenu
              direction={direction}
              changingDirection={changingDirection}
              onChangeDirection={onChangeDirection}
              onRelayout={onRelayout}
              miniMapExpanded$={miniMapExpanded$}
              interactiveMode$={interactiveMode$}
            />
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
        {(onChangeDirection != null || onRelayout != null || miniMapExpanded$ != null || interactiveMode$ != null) && (
          <>
            <div className={styles.viewOptions} data-expanded={optionsExpanded} aria-hidden={!optionsExpanded}>
              <div className={styles.viewOptionsClip}>
                <div className={styles.viewOptionButtons}>
                  <span aria-hidden="true" className={styles.viewSeparator} />
                  {onRelayout != null && (
                    <CanvasTooltip placement="top" title={t('optimize')}>
                      <Button aria-label={t('optimize')} disabled={changingDirection} onClick={onRelayout} size="icon" type="button" variant="ghost">
                        <i aria-hidden="true" className="i-lucide-light:layout-template" />
                      </Button>
                    </CanvasTooltip>
                  )}
                  {onChangeDirection != null && (
                    <CanvasDirectionButton direction={direction} changingDirection={changingDirection} onChangeDirection={onChangeDirection} />
                  )}
                  {miniMapExpanded$ != null && <CanvasMiniMapButton miniMapExpanded$={miniMapExpanded$} />}
                  {interactiveMode$ != null && <CanvasInteractiveMode interactiveMode$={interactiveMode$} />}
                </div>
              </div>
            </div>
            <CanvasTooltip placement="top" title={t('view')}>
              <Button
                aria-label={t('view')}
                aria-expanded={optionsExpanded}
                onClick={() => setOptionsExpanded((expanded) => !expanded)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <i aria-hidden="true" className={optionsExpanded ? 'i-lucide-light:chevron-left' : 'i-lucide-light:chevron-right'} />
              </Button>
            </CanvasTooltip>
          </>
        )}
      </div>
      {miniMapExpanded$ != null && <CanvasMiniMap miniMapExpanded$={miniMapExpanded$} />}
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
