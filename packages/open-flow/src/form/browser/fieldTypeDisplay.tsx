import type { ReactNode } from 'react'

import { useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/browser/tooltip.tsx'

export interface FieldDisclosure {
  readonly controls: string
  readonly expanded: boolean
  readonly onToggle: () => void
}

/** Presents a fixed type, optionally using its read-only surface as a disclosure control. */
export function FieldTypeDisplay({
  id,
  label,
  accessibleLabel,
  icon,
  compact = true,
  addon = false,
  surface = false,
  disclosure,
}: {
  id?: string
  label: ReactNode
  accessibleLabel: string
  icon: ReactNode
  compact?: boolean
  addon?: boolean
  surface?: boolean
  disclosure?: FieldDisclosure
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const className = `flex ${addon ? 'size-6 px-1' : 'h-[30px] w-full px-2'} min-w-0 items-center gap-1.5 text-xs font-normal text-muted-foreground ${compact ? 'justify-center' : ''} ${
    surface
      ? 'rounded-[var(--ui-control-radius,var(--ui-radius))] border border-input bg-[var(--ui-control-background,var(--ui-muted))] dark:bg-[var(--ui-control-background,var(--ui-muted))]'
      : ''
  }`
  return (
    <div ref={setContainer} className="min-w-0">
      <Tooltip>
        <TooltipTrigger
          render={
            disclosure == null ? (
              <span id={id} role="img" aria-label={accessibleLabel} data-field-control={surface || undefined} data-readonly={surface || undefined} />
            ) : (
              <button
                id={id}
                type="button"
                aria-label={accessibleLabel}
                aria-expanded={disclosure.expanded}
                aria-controls={disclosure.controls}
                data-field-control
                data-readonly
                onClick={disclosure.onToggle}
              />
            )
          }
          className={`${className} ${
            disclosure == null
              ? 'cursor-default'
              : 'cursor-pointer text-left outline-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-ring'
          }`}
        >
          {icon}
          {!compact && <span className="min-w-0 truncate">{label}</span>}
        </TooltipTrigger>
        <TooltipContent container={container}>{label}</TooltipContent>
      </Tooltip>
    </div>
  )
}
