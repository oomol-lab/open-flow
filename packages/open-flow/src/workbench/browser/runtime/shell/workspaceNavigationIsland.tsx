import type { ReactElement } from 'react'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { CanvasTooltip } from '../../../../canvas/browser/components/tooltip.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { TooltipProvider } from '../../../../ui/browser/tooltip.tsx'
import { Icon } from '../icons.tsx'
import { followWorkbenchLink } from '../navigationLink.ts'

export function WorkspaceNavigationIsland({
  flowName,
  flowHref,
  flowsHref,
  onOpenFlow,
  onOpenFlows,
}: {
  readonly flowName: string
  readonly flowHref: string
  readonly flowsHref: string
  readonly onOpenFlow: () => void
  readonly onOpenFlows: () => void
}): ReactElement {
  const t = useTranslate()
  const [tooltipContainer, setTooltipContainer] = useState<HTMLElement | null>(null)
  return (
    <nav aria-label={t('resource.workflows')} className="workspace-navigation" ref={setTooltipContainer}>
      <div
        className="open-flow-control-island open-flow-control-island-compact open-flow-control-island-soft-shadow workspace-title-island"
        data-tooltip-toolbar
      >
        <TooltipProvider delay={300}>
          <CanvasTooltip getPopupContainer={() => tooltipContainer ?? document.body} placement="bottom" title={t('resource.workflows')}>
            <Button
              aria-label={t('resource.workflows')}
              nativeButton={false}
              onClick={(event) => followWorkbenchLink(event, onOpenFlows)}
              render={<a href={flowsHref} />}
              size="icon"
              variant="ghost"
            >
              <Icon name="chevron-left" />
            </Button>
          </CanvasTooltip>
          <CanvasTooltip getPopupContainer={() => tooltipContainer ?? document.body} placement="bottom" title={flowName}>
            <Button
              className="workspace-flow-link"
              nativeButton={false}
              onClick={(event) => followWorkbenchLink(event, onOpenFlow)}
              render={<a href={flowHref} />}
              size="default"
              variant="ghost"
            >
              <span>{flowName}</span>
            </Button>
          </CanvasTooltip>
        </TooltipProvider>
      </div>
    </nav>
  )
}
