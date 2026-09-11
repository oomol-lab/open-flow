import type { ReactElement, ReactNode } from 'react'

import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { CanvasTooltip } from '../../../../canvas/browser/components/tooltip.tsx'
import { defaultTriggerIcon } from '../../../../canvas/browser/graph/Nodes/components/constants.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../../../ui/browser/dropdown-menu.tsx'
import { ContentIcon } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../../../ui/browser/popover.tsx'
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { Icon } from '../icons.tsx'

export function RunControl({
  disabled,
  inputContent,
  inputOpen,
  inputStatus,
  onInputOpenChange,
  onRun,
  onSelectTrigger,
  selectedTriggerId,
  starting,
  title,
  triggers,
}: {
  readonly disabled: boolean
  readonly inputContent?: ReactNode
  readonly inputOpen: boolean
  readonly inputStatus: 'missing' | 'none' | 'ready'
  readonly onInputOpenChange: (open: boolean) => void
  readonly onRun: () => void
  readonly onSelectTrigger: (triggerId: string) => void
  readonly selectedTriggerId: string
  readonly starting: boolean
  readonly title?: string
  readonly triggers: readonly { readonly id: string; readonly title: string; readonly icon?: string }[]
}): ReactElement {
  const t = useTranslate()
  const inputTriggerId = useId()
  const labelRef = useRef<HTMLSpanElement>(null)
  const [labelWidth, setLabelWidth] = useState<number>()
  const [popupContainer, setPopupContainer] = useState<HTMLDivElement | null>(null)
  const selected = triggers.find((trigger) => trigger.id == selectedTriggerId) ?? triggers[0]!
  const inputLabel = t(inputStatus == 'ready' ? 'runInput.editReady' : 'runInput.editMissing')
  const triggerLabel = t('runInput.testTrigger', { name: selected.title })
  const label = starting ? t('workspace.starting') : triggerLabel

  useLayoutEffect(() => {
    const element = labelRef.current
    if (!element) return
    const measure = () => setLabelWidth(element.offsetWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [label])

  return (
    <div className="run-control-shell" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} ref={setPopupContainer}>
      <div aria-label={triggerLabel} className="run-control-group" role="group">
        <CanvasTooltip placement="top" title={title ?? triggerLabel} getPopupContainer={() => popupContainer || document.body}>
          <Button
            aria-controls={inputStatus == 'none' ? undefined : 'run-input-popover'}
            aria-expanded={inputStatus == 'none' ? undefined : inputOpen}
            className="run-control-main text-[13px]"
            data-standalone={inputStatus == 'none' && triggers.length <= 1}
            disabled={disabled || starting}
            onClick={onRun}
            size="default"
            type="button"
          >
            {starting ? <Spinner data-icon="inline-start" /> : <Icon data-icon="inline-start" name="play" />}
            <span className="run-control-label" style={{ width: labelWidth }}>
              <span className="block w-max max-w-40 truncate" ref={labelRef}>
                {label}
              </span>
            </span>
          </Button>
        </CanvasTooltip>
        <div aria-hidden={inputStatus == 'none' || undefined} className="run-control-segment-slot" data-visible={inputStatus != 'none'}>
          <Popover
            onOpenChange={(open) => onInputOpenChange(open)}
            open={inputStatus != 'none' && inputOpen}
            triggerId={inputStatus != 'none' && inputOpen ? inputTriggerId : null}
          >
            <CanvasTooltip placement="top" title={inputLabel} getPopupContainer={() => popupContainer || document.body}>
              <PopoverTrigger
                id={inputTriggerId}
                render={
                  <Button
                    aria-label={inputLabel}
                    className="run-control-segment relative"
                    disabled={disabled || starting || inputStatus == 'none'}
                    size="icon"
                    tabIndex={inputStatus == 'none' ? -1 : undefined}
                    type="button"
                  >
                    <Icon name="task" />
                    <span aria-hidden="true" className={`run-input-state status-dot ${inputStatus == 'ready' ? 'success' : 'running'}`} />
                  </Button>
                }
              />
            </CanvasTooltip>
            {inputContent != null && (
              <PopoverContent
                align="end"
                className="run-input-popover w-[min(440px,calc(100cqw-32px))] max-w-none gap-0 overflow-hidden p-0"
                container={popupContainer}
                id="run-input-popover"
                initialFocus
                side="top"
                sideOffset={10}
              >
                {inputContent}
              </PopoverContent>
            )}
          </Popover>
        </div>
        <div aria-hidden={triggers.length <= 1 || undefined} className="run-control-segment-slot" data-visible={triggers.length > 1}>
          <DropdownMenu>
            <CanvasTooltip placement="top" title={t('runInput.selectTrigger')} getPopupContainer={() => popupContainer || document.body}>
              <DropdownMenuTrigger
                render={
                  <Button
                    aria-label={t('runInput.selectTrigger')}
                    className="run-control-segment"
                    disabled={disabled || starting || triggers.length <= 1}
                    size="icon"
                    tabIndex={triggers.length <= 1 ? -1 : undefined}
                    type="button"
                  >
                    <Icon name="chevron-down" />
                  </Button>
                }
              />
            </CanvasTooltip>
            <DropdownMenuContent align="end" className="w-64 max-w-(--available-width) p-1.5" container={popupContainer} side="top" sideOffset={10}>
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-2 pt-1 pb-1.5 font-normal">{t('runInput.trigger')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup className="space-y-0.5" onValueChange={onSelectTrigger} value={selected.id}>
                  {triggers.map((trigger) => (
                    <DropdownMenuRadioItem
                      className="min-h-8 gap-2 py-1.5 pr-8 pl-2 focus:bg-muted data-checked:bg-accent/60"
                      closeOnClick
                      key={trigger.id}
                      value={trigger.id}
                    >
                      <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center text-base text-muted-foreground">
                        <ContentIcon src={trigger.icon} fallback={<i className={defaultTriggerIcon} />} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span
                          className={`line-clamp-2 text-[13px] whitespace-normal wrap-anywhere ${trigger.id == selected.id ? 'font-medium' : 'font-normal'}`}
                          title={trigger.title}
                        >
                          {trigger.title}
                        </span>
                        {triggers.some((other) => other.id != trigger.id && other.title == trigger.title) && (
                          <code className="truncate text-xs text-muted-foreground" title={trigger.id}>
                            {trigger.id}
                          </code>
                        )}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
