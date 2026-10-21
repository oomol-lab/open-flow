import type { InputPort } from '../api.ts'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { portsAssignable } from '../../../../flow/common/schema.ts'
import { webhookStatusCodePort } from '../../../../flow/common/webhookResponse.ts'
import { selectionMenuContentClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../../../ui/browser/dropdown-menu.tsx'
import { ContentIcon } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { MenuHeader } from '../../../../ui/browser/menu-header.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { Icon } from '../icons.tsx'
import { SourceMenuOption, sourceMenuItemClass } from './sourceMenuOption.tsx'

export interface WorkflowResponseOutputs {
  readonly name?: string
  readonly icon?: string
  readonly outputDefs: readonly InputPort[]
}

export function WebhookStatusSource({
  outputs,
  value,
  disabled,
  onChange,
}: {
  readonly outputs?: WorkflowResponseOutputs
  readonly value?: string
  readonly disabled: boolean
  readonly onChange: (output: string | undefined) => void
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const portal = container?.closest<HTMLElement>('.editor-context-panel') ?? container
  const missing = value != null && !outputs?.outputDefs.some((port) => port.handle === value)
  const nodeName = outputs?.name ?? t('addNode.outputs')
  return (
    <div ref={setContainer} className="flex items-center">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <Tooltip disabled={open}>
          <TooltipTrigger
            render={
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="aria-pressed:bg-[var(--ui-control-hover-background,var(--ui-muted))] aria-pressed:text-foreground"
                    aria-label={t('webhookEditor.webhookStatusSource')}
                    aria-pressed={value != null}
                    disabled={disabled}
                  >
                    <i aria-hidden="true" className="i-lucide-light:link" />
                  </Button>
                }
              />
            }
          />
          <TooltipContent container={portal}>{t('webhookEditor.webhookStatusSource')}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" sideOffset={6} className={`w-44 min-w-44 ${selectionMenuContentClass}`} container={portal}>
          <MenuHeader>{t('webhookEditor.webhookStatusSource')}</MenuHeader>
          <DropdownMenuRadioGroup value={value == null ? 'fixed' : ''} onValueChange={() => onChange(undefined)}>
            <DropdownMenuRadioItem className={sourceMenuItemClass} value="fixed" closeOnClick>
              <i aria-hidden="true" className="i-lucide-light:pen-line size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{t('nodeInput.literal')}</span>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator className="mx-2 bg-border/50" />
          {outputs != null && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={`${sourceMenuItemClass} ${value != null ? 'bg-accent' : ''}`}>
                <ContentIcon
                  src={outputs.icon}
                  className="size-3.5 shrink-0 data-[icon-kind=initials]:text-[16px]"
                  fallback={<Icon name="outputs" size={14} />}
                />
                <span className="min-w-0 flex-1 truncate" title={nodeName}>
                  {nodeName}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className={`w-56 min-w-56 ${selectionMenuContentClass}`} container={portal}>
                <DropdownMenuRadioGroup value={value == null ? '' : `field:${value}`} onValueChange={(next) => onChange(next.slice(6))}>
                  {outputs.outputDefs.length === 0 && !missing && (
                    <DropdownMenuItem className={`${sourceMenuItemClass} font-normal text-muted-foreground data-disabled:opacity-100`} disabled>
                      {t('inspector.ports.noOutputs')}
                    </DropdownMenuItem>
                  )}
                  {outputs.outputDefs.map((port) => {
                    const compatible = portsAssignable(port, webhookStatusCodePort)
                    return (
                      <SourceMenuOption
                        key={port.handle}
                        value={`field:${port.handle}`}
                        label={port.handle}
                        selected={port.handle === value}
                        compatibility={compatible ? 'available' : 'incompatible'}
                        disabled={!compatible}
                        container={portal}
                        description={port.description}
                      />
                    )
                  })}
                  {missing && (
                    <SourceMenuOption
                      value={`field:${value}`}
                      label={t('webhookEditor.webhookMissingOutput', { output: value })}
                      selected
                      disabled
                      container={portal}
                    />
                  )}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
