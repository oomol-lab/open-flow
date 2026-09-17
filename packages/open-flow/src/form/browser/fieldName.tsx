import type { ReactNode } from 'react'

import { useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/browser/tooltip.tsx'

export function FieldName({ name, description, className, children }: { name: string; description?: string; className?: string; children: ReactNode }) {
  const hasDescription = !!description?.trim()
  const [container, setContainer] = useState<HTMLSpanElement | null>(null)
  return (
    <Tooltip>
      <TooltipTrigger render={<span ref={setContainer} data-field-name className={className} />}>{children}</TooltipTrigger>
      <TooltipContent
        container={container}
        side={hasDescription ? 'left' : 'top'}
        positionMethod="fixed"
        collisionBoundary={[]}
        className="whitespace-pre-wrap"
      >
        {hasDescription ? description : name}
      </TooltipContent>
    </Tooltip>
  )
}
