import type { ReactNode } from 'react'

import { useId, useState } from 'react'
import { Button } from './button.tsx'
import { createTooltipHandle, Tooltip, TooltipContent, TooltipTrigger } from './tooltip.tsx'

export interface HelpButtonProps {
  label: string
  children: ReactNode
  /** Button edge length in pixels; the icon scales at 5/8 of this size. */
  size?: number
}

/** Supplementary, non-interactive help that can also be opened by click. */
export function HelpButton({ label, children, size = 24 }: HelpButtonProps) {
  const id = useId()
  const [tooltip] = useState(() => createTooltipHandle())
  return (
    <Tooltip handle={tooltip}>
      <TooltipTrigger
        id={id}
        handle={tooltip}
        closeOnClick={false}
        onClick={() => tooltip.open(id)}
        render={<Button type="button" variant="ghost" size="icon-xs" style={{ width: size, height: size }} aria-label={label} />}
      >
        <i aria-hidden="true" className="i-lucide-light:info text-muted-foreground" style={{ fontSize: (size * 5) / 8 }} />
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  )
}
