import type { PortDefinition } from '../../../../flow/common/change.ts'
import type { InputPort } from '../api.ts'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { portsAssignable } from '../../../../flow/common/schema.ts'
import { webhookStatusCodePort, workflowOutputsPort } from '../../../../flow/common/webhookResponse.ts'
import { selectionMenuContentClass } from '../../../../form/browser/selectionMenuStyles.ts'
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
} from '../../../../ui/browser/dropdown-menu.tsx'
import { ContentIcon } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { MenuHeader } from '../../../../ui/browser/menu-header.tsx'
import { Icon } from '../icons.tsx'
import { SourceMenuOption, sourceMenuItemClass } from './sourceMenuOption.tsx'
import { SourceSelectorTrigger } from './sourceSelectorTrigger.tsx'

export interface WorkflowResponseOutputs {
  readonly name?: string
  readonly icon?: string
  readonly outputDefs: readonly InputPort[]
}

export function WebhookResponseSource({
  outputs,
  label,
  port: targetPort,
  wholeObject = false,
  value,
  disabled,
  onChange,
}: {
  readonly outputs?: WorkflowResponseOutputs
  readonly label: string
  readonly port: PortDefinition
  readonly wholeObject?: boolean
  readonly value?: { readonly output?: string }
  readonly disabled: boolean
  readonly onChange: (source: { readonly output?: string } | undefined) => void
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const portal = container?.closest<HTMLElement>('.editor-context-panel') ?? container
  const missing = value?.output != null && !outputs?.outputDefs.some((port) => port.handle === value.output)
  const nodeName = outputs?.name ?? t('addNode.outputs')
  const wholeCompatible = wholeObject && outputs != null && portsAssignable(workflowOutputsPort(outputs.outputDefs), targetPort)
  return (
    <div ref={setContainer} className="flex items-center">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <SourceSelectorTrigger label={label} open={open} pressed={value != null} disabled={disabled} container={portal} />
        <DropdownMenuContent align="start" sideOffset={6} className={`w-44 min-w-44 ${selectionMenuContentClass}`} container={portal}>
          <MenuHeader>{label}</MenuHeader>
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
                <DropdownMenuRadioGroup
                  value={value == null ? '' : value.output == null ? 'all' : `field:${value.output}`}
                  onValueChange={(next) => onChange(next === 'all' ? {} : { output: next.slice(6) })}
                >
                  {wholeObject && (
                    <>
                      <SourceMenuOption
                        value="all"
                        label={t('inspector.sources.wholeObject')}
                        icon="i-lucide-light:braces"
                        selected={value != null && value.output == null}
                        compatibility={wholeCompatible ? 'available' : 'incompatible'}
                        disabled={!wholeCompatible}
                        container={portal}
                      />
                      <DropdownMenuSeparator className="mx-2 bg-border/50" />
                    </>
                  )}
                  {!wholeObject && outputs.outputDefs.length === 0 && !missing && (
                    <DropdownMenuItem className={`${sourceMenuItemClass} font-normal text-muted-foreground data-disabled:opacity-100`} disabled>
                      {t('inspector.ports.noOutputs')}
                    </DropdownMenuItem>
                  )}
                  {outputs.outputDefs.map((port) => {
                    const compatible = portsAssignable(port, targetPort)
                    return (
                      <SourceMenuOption
                        key={port.handle}
                        value={`field:${port.handle}`}
                        label={port.handle}
                        selected={port.handle === value?.output}
                        compatibility={compatible ? 'available' : 'incompatible'}
                        disabled={!compatible}
                        container={portal}
                        description={port.description}
                      />
                    )
                  })}
                  {missing && (
                    <SourceMenuOption
                      value={`field:${value?.output}`}
                      label={t('webhookEditor.webhookMissingOutput', { output: value?.output })}
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

export function WebhookStatusSource(props: {
  readonly outputs?: WorkflowResponseOutputs
  readonly value?: string
  readonly disabled: boolean
  readonly onChange: (output: string | undefined) => void
}) {
  const t = useTranslate()
  return (
    <WebhookResponseSource
      {...props}
      label={t('webhookEditor.webhookStatusSource')}
      port={webhookStatusCodePort}
      value={props.value == null ? undefined : { output: props.value }}
      onChange={(source) => props.onChange(source?.output)}
    />
  )
}
