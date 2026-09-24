import type { ReactElement, ReactNode } from 'react'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'

export function IdTooltip({
  value,
  label,
  trigger,
  container,
  alignOffset = 0,
  children,
}: {
  readonly value: string
  readonly label: ReactNode
  readonly trigger: ReactElement
  readonly container: HTMLElement | null
  readonly alignOffset?: number
  readonly children?: ReactNode
}): ReactElement {
  const t = useTranslate()
  const [copied, setCopied] = useState(false)
  return (
    <Tooltip onOpenChange={() => setCopied(false)}>
      <TooltipTrigger render={trigger}>{label}</TooltipTrigger>
      <TooltipContent
        align="start"
        alignOffset={alignOffset}
        className="max-w-[min(440px,calc(100vw-32px))] flex-col items-stretch gap-2 p-1 pr-2"
        collisionBoundary={[]}
        container={container}
        positionMethod="fixed"
        side="top"
        sideOffset={6}
      >
        <div className="flex min-w-0 items-center gap-1">
          <Button
            aria-label={t(copied ? 'resource.flowIdCopied' : 'resource.copyFlowId')}
            className="text-inherit hover:text-inherit hover:bg-[color-mix(in_srgb,currentColor_14%,transparent)]"
            onClick={() => {
              void navigator.clipboard.writeText(value).then(() => setCopied(true))
            }}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <i aria-hidden="true" className="i-lucide-light:copy" />
          </Button>
          <code className="min-w-0 select-text break-all pl-0.5 text-inherit" translate="no">
            {value}
          </code>
        </div>
        {children}
      </TooltipContent>
    </Tooltip>
  )
}
