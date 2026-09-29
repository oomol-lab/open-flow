import type { ReactElement } from 'react'

import { useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.tsx'

export interface HostTooltipProps {
  readonly children: ReactElement
  readonly label: string
  readonly side?: 'top' | 'bottom' | 'left' | 'right'
}

/** Compose a host control with the shared tooltip while preserving its theme and semantics. */
export function HostTooltip({ children, label, side = 'top' }: HostTooltipProps): ReactElement {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  return (
    <Tooltip>
      <TooltipTrigger ref={setAnchor} render={children} />
      <TooltipContent container={anchor?.closest<HTMLElement>('.open-flow-theme')} side={side}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
