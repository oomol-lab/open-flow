import type { ReactElement } from 'react'
import type { WorkspaceStatus } from '../stores/workspaceModel.ts'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { CanvasTooltip } from '../../../../canvas/browser/components/tooltip.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { TooltipProvider } from '../../../../ui/browser/tooltip.tsx'
import { Icon } from '../icons.tsx'
import { followWorkbenchLink } from '../navigationLink.ts'

export function WorkspaceNavigationIsland({
  flowName,
  flowsHref,
  ghost = false,
  onOpenFlows,
  saveStatus,
}: {
  readonly flowName: string
  readonly flowsHref: string
  readonly ghost?: boolean
  readonly onOpenFlows: () => void
  readonly saveStatus?: WorkspaceStatus | undefined
}): ReactElement {
  const t = useTranslate()
  const [tooltipContainer, setTooltipContainer] = useState<HTMLElement | null>(null)
  const draftStatus = saveStatus == 'saved' || saveStatus == 'saving' || saveStatus == 'failed' ? saveStatus : undefined
  const draftStatusLabel = draftStatus == null ? undefined : t(draftStatus == 'saved' ? 'designer.draftSaved' : `workspace.status.${draftStatus}`)
  return (
    <nav aria-label={t('resource.workflows')} className="workspace-navigation" ref={setTooltipContainer}>
      <div
        className={
          ghost
            ? 'workspace-title-island workspace-title-ghost'
            : 'open-flow-control-island open-flow-control-island-compact open-flow-control-island-soft-shadow workspace-title-island'
        }
        data-tooltip-toolbar
      >
        <TooltipProvider delay={300}>
          <CanvasTooltip getPopupContainer={() => tooltipContainer ?? document.body} placement="bottom" title={t('resource.workflows')}>
            <Button
              aria-label={t('resource.workflows')}
              nativeButton={false}
              onClick={(event) => followWorkbenchLink(event, onOpenFlows)}
              render={<a href={flowsHref} />}
              size={ghost ? 'icon-sm' : 'icon'}
              variant="ghost"
            >
              <Icon name="chevron-left" />
            </Button>
          </CanvasTooltip>
          <CanvasTooltip getPopupContainer={() => tooltipContainer ?? document.body} placement="bottom" title={flowName}>
            <span className="workspace-flow-name" tabIndex={0}>
              {flowName}
            </span>
          </CanvasTooltip>
          {draftStatus != null && (
            <CanvasTooltip
              className="whitespace-nowrap"
              getPopupContainer={() => tooltipContainer ?? document.body}
              placement="bottom"
              title={draftStatusLabel}
            >
              <span aria-label={draftStatusLabel} className="workspace-draft-indicator" data-save-status={draftStatus} role="status" tabIndex={0} />
            </CanvasTooltip>
          )}
        </TooltipProvider>
      </div>
    </nav>
  )
}
