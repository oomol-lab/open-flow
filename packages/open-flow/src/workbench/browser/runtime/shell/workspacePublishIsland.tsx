import type { ReactElement } from 'react'

import { useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { CanvasTooltip } from '../../../../canvas/browser/components/tooltip.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../../ui/browser/dialog.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../../ui/browser/dropdown-menu.tsx'
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '../../../../ui/browser/popover.tsx'
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { WorkflowExportMenuItem } from './workflowExportMenuItem.tsx'

export type PublishState = 'ready' | 'current' | 'issues' | 'busy' | 'publishing'

const blockedReasonKey = {
  issues: 'workspace.publishIssuesReason',
  busy: 'workspace.publishActionInProgress',
  publishing: 'workspace.publishInProgress',
} as const

export function WorkspacePublishIsland({
  hasPublications,
  onOpenPublications,
  onExport,
  onExportSvg,
  onOpenRuns,
  onOpenState,
  onPublish,
  state,
}: {
  readonly hasPublications: boolean | undefined
  readonly onExport?: (() => void) | undefined
  readonly onExportSvg?: (() => Promise<void>) | undefined
  readonly onOpenPublications: () => void
  readonly onOpenRuns: () => void
  readonly onOpenState?: () => void
  readonly onPublish: () => void
  readonly state: PublishState
}): ReactElement {
  const t = useTranslate()
  const [popupContainer, setPopupContainer] = useState<HTMLDivElement | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [exporting, setExporting] = useState(false)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const publishLabel = t(state == 'publishing' ? 'workspace.publishing' : 'publication.publishDraft')
  const historyLabel = t(hasPublications === true ? 'workspace.publications' : hasPublications === false ? 'publication.historyEmpty' : 'publication.loading')
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
      <Popover open={confirming} onOpenChange={(open) => setConfirming(open && state == 'ready')}>
        <CanvasTooltip getPopupContainer={() => popupContainer ?? document.body} placement="bottom" title={statusTooltip}>
          <PopoverTrigger
            render={
              <Button
                aria-description={statusTooltip}
                aria-disabled={status != 'ready' || undefined}
                className="workspace-publish-button"
                data-publish-status={status}
                size="default"
                type="button"
                variant="ghost"
              />
            }
          >
            <span aria-hidden="true" className={`status-dot ${dotClass}`} />
            <span>{publishLabel}</span>
          </PopoverTrigger>
        </CanvasTooltip>
        <PopoverContent align="end" className="gap-4 p-0" container={popupContainer} initialFocus={cancelButton} side="bottom" sideOffset={8}>
          <PopoverHeader className="gap-2 px-4 pt-4">
            <PopoverTitle className="m-0 text-sm">{t('publication.publishConfirm')}</PopoverTitle>
            <PopoverDescription className="m-0">{t('publication.publishConfirmDescription')}</PopoverDescription>
          </PopoverHeader>
          <div className="flex justify-end gap-2 px-3 pb-3">
            <Button ref={cancelButton} onClick={() => setConfirming(false)} size="sm" type="button" variant="outline">
              {t('common.cancel')}
            </Button>
            <Button
              disabled={state != 'ready'}
              onClick={() => {
                if (state != 'ready') return
                setConfirming(false)
                onPublish()
              }}
              size="sm"
              type="button"
            >
              {t('publication.confirmPublish')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
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
        <DropdownMenuContent align="end" className="w-max min-w-44 max-w-(--available-width)" container={popupContainer} side="bottom" sideOffset={8}>
          {onExport != null && (
            <WorkflowExportMenuItem className="gap-2 px-2 py-[5px]" disabled={state == 'busy' || state == 'publishing'} onClick={onExport} />
          )}
          {onExportSvg != null && (
            <DropdownMenuItem
              className="gap-2 px-2 py-[5px]"
              disabled={exporting}
              onClick={async () => {
                setExporting(true)
                try {
                  await onExportSvg()
                } finally {
                  setExporting(false)
                }
              }}
            >
              <i aria-hidden="true" className="i-lucide-light:download size-4 shrink-0" />
              {t('resource.exportSvg')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="gap-2 px-2 py-[5px]" disabled={hasPublications !== true} onClick={onOpenPublications}>
            <i aria-hidden="true" className="i-lucide-light:cloud-upload size-4 shrink-0 text-foreground/70" />
            <span className="whitespace-nowrap">{historyLabel}</span>
          </DropdownMenuItem>
          {onOpenState != null && (
            <DropdownMenuItem className="gap-2 px-2 py-[5px]" onClick={onOpenState}>
              <i aria-hidden="true" className="i-lucide-light:database size-4 shrink-0 text-foreground/70" />
              {t('flowState.title')}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="gap-2 px-2 py-[5px]" onClick={onOpenRuns}>
            <i aria-hidden="true" className="i-lucide-light:history size-4 shrink-0 text-foreground/70" />
            {runsLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={exporting} onOpenChange={(_open, details) => details.cancel()}>
        <DialogContent container={popupContainer?.closest<HTMLElement>('.open-flow-workbench') ?? popupContainer} showCloseButton={false} aria-busy="true">
          <div className="flex items-center gap-3">
            <Spinner aria-hidden="true" className="shrink-0" />
            <DialogTitle>{t('resource.exportSvgPending')}</DialogTitle>
          </div>
          <DialogDescription>{t('resource.exportSvgPendingDescription')}</DialogDescription>
        </DialogContent>
      </Dialog>
    </div>
  )
}
