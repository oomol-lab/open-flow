import type { ReactElement, ReactNode } from 'react'

import { useState } from 'react'
import { Button } from './button.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.tsx'

export function IdTooltip({
  copyLabel,
  copiedLabel,
  value,
  label,
  trigger,
  container,
  alignOffset = 0,
  children,
}: {
  readonly copyLabel: string
  readonly copiedLabel: string
  readonly value: string
  readonly label: ReactNode
  readonly trigger: ReactElement
  readonly container: HTMLElement | null
  readonly alignOffset?: number
  readonly children?: ReactNode
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  return (
    <Tooltip
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        setCopied(false)
      }}
    >
      <TooltipTrigger className="cursor-help" closeOnClick={false} onClick={() => setOpen(true)} render={trigger}>
        {label}
      </TooltipTrigger>
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
            aria-label={copied ? copiedLabel : copyLabel}
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
