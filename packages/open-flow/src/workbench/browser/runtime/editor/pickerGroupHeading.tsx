import type { MouseEventHandler } from 'react'

import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/browser/tooltip.tsx'
import { PickerGroupButton } from './pickerGroupButton.tsx'

export function PickerGroupHeading({
  title,
  help,
  container,
  onClick,
}: {
  readonly title: string
  readonly help?: string
  readonly container?: HTMLElement | null
  readonly onClick: MouseEventHandler<HTMLButtonElement>
}) {
  return (
    <div className="flex items-center gap-1 bg-popover px-2.5 pb-1 pt-2 text-muted-foreground">
      <h3 className="m-0 text-xs font-medium">
        <PickerGroupButton onClick={onClick}>{title}</PickerGroupButton>
      </h3>
      {help && (
        <Tooltip>
          <TooltipTrigger
            aria-label={title}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <i aria-hidden="true" className="i-codicon:question text-[13px]" />
          </TooltipTrigger>
          <TooltipContent container={container} side="top" align="start">
            {help}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
