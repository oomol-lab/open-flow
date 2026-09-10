import type { ReactElement, ReactNode } from 'react'

import { useId, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
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
  const [popupContainer, setPopupContainer] = useState<HTMLDivElement | null>(null)
  const selected = triggers.find((trigger) => trigger.id == selectedTriggerId) ?? triggers[0]!
  const inputLabel = t(inputStatus == 'ready' ? 'runInput.editReady' : 'runInput.editMissing')
  const triggerLabel = t('runInput.testTrigger', { name: selected.title })

  return (
    <div className="run-control-shell" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} ref={setPopupContainer}>
      <div aria-label={triggerLabel} className="run-control-group" role="group">
        <Button
          aria-controls={inputStatus == 'none' ? undefined : 'run-input-popover'}
          aria-expanded={inputStatus == 'none' ? undefined : inputOpen}
          className="run-control-main text-[13px]"
          disabled={disabled || starting}
          onClick={onRun}
          size="default"
          title={title ?? triggerLabel}
          type="button"
        >
          {starting ? <Spinner data-icon="inline-start" /> : <Icon data-icon="inline-start" name="play" />}
          <span className="max-w-40 truncate">{starting ? t('workspace.starting') : triggerLabel}</span>
        </Button>
        {inputStatus != 'none' && (
          <Popover onOpenChange={(open) => onInputOpenChange(open)} open={inputOpen} triggerId={inputOpen ? inputTriggerId : null}>
            <PopoverTrigger
              id={inputTriggerId}
              render={
                <Button
                  aria-label={inputLabel}
                  className="run-control-segment relative"
                  disabled={disabled || starting}
                  size="icon"
                  title={inputLabel}
                  type="button"
                >
                  <Icon name="task" />
                  <span aria-hidden="true" className={`run-input-state status-dot ${inputStatus == 'ready' ? 'success' : 'running'}`} />
                </Button>
              }
            />
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
        )}
        {triggers.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  aria-label={t('runInput.selectTrigger')}
                  className="run-control-segment"
                  disabled={disabled || starting}
                  size="icon"
                  title={t('runInput.selectTrigger')}
                  type="button"
                >
                  <Icon name="chevron-down" />
                </Button>
              }
            />
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
        )}
      </div>
    </div>
  )
}
