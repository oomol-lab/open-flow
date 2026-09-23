import type { ReactElement } from 'react'
import type { Run } from '../api.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { CanvasTooltip } from '../../../../canvas/browser/components/tooltip.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { runLabel, statusClass } from './runPresentation.ts'

export function RunStatusIslandContainer({
  onToggle,
  open,
  panelId,
  store,
}: {
  readonly onToggle: () => void
  readonly open: boolean
  readonly panelId: string
  readonly store: WorkbenchStore
}): ReactElement {
  const run = useVal(store.runs.$.run)
  const submitting = useVal(store.runRequests.$.submitting) != null
  return <RunStatusIsland onToggle={onToggle} open={open} panelId={panelId} run={run} submitting={submitting} />
}

export function RunStatusIsland({
  onToggle,
  open,
  panelId,
  run,
  submitting,
}: {
  readonly onToggle: () => void
  readonly open: boolean
  readonly panelId: string
  readonly run?: Run
  readonly submitting: boolean
}): ReactElement {
  const t = useTranslate()
  const hasRunInfo = submitting || run != null
  const label = submitting ? t('run.statusSubmitting') : runLabel(run, t)
  const status = submitting ? 'running' : statusClass(run)
  const action = t(open ? 'run.collapse' : 'run.expand')

  return (
    <CanvasTooltip placement="top" title={action}>
      <Button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={hasRunInfo ? `${action} · ${label}` : action}
        className="workspace-run-status-button"
        data-run-status={status}
        onClick={onToggle}
        size={hasRunInfo ? 'default' : 'icon'}
        type="button"
        variant="ghost"
      >
        {hasRunInfo && (
          <>
            <i
              aria-hidden="true"
              className={
                status == 'running'
                  ? 'i-lucide-light:loader-circle animate-spin motion-reduce:animate-none'
                  : status == 'success'
                    ? 'i-lucide-light:circle-check'
                    : 'i-lucide-light:circle-x'
              }
            />
            <span className="workspace-run-status-label">{label}</span>
          </>
        )}
        <i aria-hidden="true" className={open ? 'i-lucide-light:panel-bottom-close' : 'i-lucide-light:panel-bottom-open'} />
      </Button>
    </CanvasTooltip>
  )
}
