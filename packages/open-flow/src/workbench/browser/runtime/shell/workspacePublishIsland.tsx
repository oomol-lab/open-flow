import type { ReactElement } from 'react'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { CanvasTooltip } from '../../../../canvas/browser/components/tooltip.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../../ui/browser/dropdown-menu.tsx'

export type PublishState = 'ready' | 'current' | 'issues' | 'subflow' | 'busy' | 'publishing'

const blockedReasonKey = {
  issues: 'workspace.publishIssuesReason',
  subflow: 'workspace.subflowPublishHelp',
  busy: 'workspace.publishActionInProgress',
  publishing: 'workspace.publishInProgress',
} as const

export function WorkspacePublishIsland({
  onOpenPublications,
  onOpenRuns,
  onPublish,
  state,
}: {
  readonly onOpenPublications: () => void
  readonly onOpenRuns: () => void
  readonly onPublish: () => void
  readonly state: PublishState
}): ReactElement {
  const t = useTranslate()
  const [popupContainer, setPopupContainer] = useState<HTMLDivElement | null>(null)
  const publishLabel = t(state == 'publishing' ? 'workspace.publishing' : 'publication.publishDraft')
  const historyLabel = t('workspace.publications')
  const runsLabel = t('workspace.runs')
  const menuLabel = t('sidebar.moreActions')
  const statusTooltip =
    state == 'ready'
      ? t('workspace.publishReady')
      : state == 'current'
        ? t('workspace.publishCurrent')
        : t('workspace.publishBlocked', { reason: t(blockedReasonKey[state]) })
  const status = state == 'ready' || state == 'current' ? state : 'unavailable'
  const dotClass = status == 'current' ? 'success' : status == 'ready' ? 'warning' : 'neutral'

  return (
    <div
      aria-label={publishLabel}
      className="open-flow-control-island open-flow-control-island-compact open-flow-control-island-soft-shadow workspace-publish-island"
      data-tooltip-toolbar
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      ref={setPopupContainer}
      role="group"
    >
      <CanvasTooltip getPopupContainer={() => popupContainer ?? document.body} placement="bottom" title={statusTooltip}>
        <Button
          aria-description={statusTooltip}
          aria-disabled={status != 'ready' || undefined}
          className="workspace-publish-button"
          data-publish-status={status}
          onClick={status == 'ready' ? onPublish : undefined}
          size="default"
          type="button"
          variant="ghost"
        >
          <span aria-hidden="true" className={`status-dot ${dotClass}`} />
          <span>{publishLabel}</span>
        </Button>
      </CanvasTooltip>
      <DropdownMenu>
        <CanvasTooltip getPopupContainer={() => popupContainer ?? document.body} placement="bottom" title={menuLabel}>
          <DropdownMenuTrigger
            render={
              <Button aria-label={menuLabel} size="icon" type="button" variant="ghost">
                <i aria-hidden="true" className="i-lucide-light:chevron-down" />
              </Button>
            }
          />
        </CanvasTooltip>
        <DropdownMenuContent align="end" container={popupContainer} side="bottom" sideOffset={8}>
          <DropdownMenuItem className="gap-2 px-2 py-[5px]" onClick={onOpenPublications}>
            <i aria-hidden="true" className="i-lucide-light:cloud-upload size-4 shrink-0 text-foreground/70" />
            {historyLabel}
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2 px-2 py-[5px]" onClick={onOpenRuns}>
            <i aria-hidden="true" className="i-lucide-light:history size-4 shrink-0 text-foreground/70" />
            {runsLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
