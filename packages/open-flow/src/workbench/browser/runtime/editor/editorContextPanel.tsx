import type { ComponentProps } from 'react'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { ContextPanel } from './contextPanel.tsx'
import { NodeHeading } from './nodeHeading.tsx'

// Workbench and Lab use the same panel header and container.
export function EditorContextPanel({
  className,
  nodeId,
  nodeHeading,
  onBack,
  showClose = false,
  ...props
}: Omit<ComponentProps<typeof ContextPanel>, 'heading' | 'actions'> & {
  readonly onBack?: () => void
  readonly nodeId?: string
  readonly nodeHeading?: ComponentProps<typeof NodeHeading>
}) {
  const t = useTranslate()
  const [tooltipContainer, setTooltipContainer] = useState<HTMLDivElement | null>(null)
  return (
    <ContextPanel
      {...props}
      showClose={showClose}
      actions={
        onBack && (
          <div className="inline-flex" ref={setTooltipContainer}>
            <Tooltip>
              <TooltipTrigger
                render={<Button className="text-muted-foreground" aria-label={t('inspector.backToOutline')} onClick={onBack} size="icon" variant="ghost" />}
              >
                <i aria-hidden="true" className="i-lucide-light:menu text-xl" />
              </TooltipTrigger>
              <TooltipContent container={tooltipContainer} side="bottom" align="end">
                {t('inspector.backToOutline')}
              </TooltipContent>
            </Tooltip>
          </div>
        )
      }
      className={['editor-context-panel open-flow-property-panel', className].filter(Boolean).join(' ')}
      heading={nodeHeading && <NodeHeading key={nodeId} {...nodeHeading} />}
    />
  )
}
