import type { ReactElement, ReactNode } from 'react'

import { useId, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../../../../ui/browser/dropdown-menu.tsx'
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
  readonly triggers: readonly { readonly id: string; readonly title: string }[]
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
          className="run-control-main"
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
            <DropdownMenuContent align="end" className="w-64 max-w-(--available-width)" container={popupContainer} side="top">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t('runInput.triggerCount', { count: triggers.length })}</DropdownMenuLabel>
                {triggers.map((trigger) => (
                  <DropdownMenuItem key={trigger.id} onClick={() => onSelectTrigger(trigger.id)}>
                    <Icon className={trigger.id == selected.id ? '' : 'invisible'} name="check" />
                    <span className="min-w-0 flex-1 truncate" title={trigger.title}>
                      {trigger.title}
                    </span>
                    {triggers.some((other) => other.id != trigger.id && other.title == trigger.title) && (
                      <code className="truncate text-xs text-muted-foreground">{trigger.id}</code>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
