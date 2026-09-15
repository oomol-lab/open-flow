import type { ReactNode } from 'react'

import { useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/browser/tooltip.tsx'

/** Fixed types reserve only the icon and its horizontal padding. */
export function FieldTypeDisplay({
  id,
  label,
  accessibleLabel,
  icon,
  compact = true,
}: {
  id?: string
  label: ReactNode
  accessibleLabel: string
  icon: ReactNode
  compact?: boolean
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <div ref={setContainer} className="min-w-0">
      <Tooltip>
        <TooltipTrigger
          render={<span id={id} role="img" aria-label={accessibleLabel} />}
          className="flex h-[30px] w-full min-w-0 items-center gap-1.5 px-2 text-xs font-normal text-muted-foreground"
        >
          {icon}
          {!compact && <span>{label}</span>}
        </TooltipTrigger>
        <TooltipContent container={container}>{label}</TooltipContent>
      </Tooltip>
    </div>
  )
}
