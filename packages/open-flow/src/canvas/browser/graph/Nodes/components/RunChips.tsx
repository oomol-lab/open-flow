import styles from './RunChips.module.scss'
import type { ReactNode } from 'react'
import type { TFunction } from 'val-i18n'
import type { FlowCanvasViewNodeRun } from '../../FlowCanvas/model.ts'

import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslate } from 'val-i18n-react'
import { formatDuration } from '../../../../../base/common/formatDuration.ts'
import { collapseAllNested, JSONViewer } from '../../../../../ui/browser/json-viewer/index.ts'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../../../../../ui/browser/popover.tsx'
import { NativeScrollArea } from '../../../../../ui/browser/scroll-area.tsx'
import { CanvasTooltip } from '../../../components/tooltip.tsx'
import { useGetStaticPopupContainer } from '../../ReactFlowContainer/useGetPopupContainer.ts'

function RecordChip({
  label,
  run,
  children,
  icon,
  status,
  compact = false,
}: {
  readonly label: string
  readonly run: FlowCanvasViewNodeRun
  readonly children?: ReactNode
  readonly icon?: string
  readonly status?: string
  readonly compact?: boolean
}) {
  const t = useTranslate()
  const getContainer = useGetStaticPopupContainer()
  const popupContainer = getContainer()
  const runId = run.runId
  const trigger = (
    <PopoverTrigger
      render={
        <button
          type="button"
          aria-label={compact ? label : undefined}
          className={`${styles.chip} ${status ? styles.status : ''} ${compact ? styles.compactChip : ''} nodrag nopan nokey`}
          data-status={status}
          onClick={(event) => event.stopPropagation()}
        />
      }
    >
      {icon && <i className={icon} aria-hidden="true" />}
      {!compact && <span>{label}</span>}
    </PopoverTrigger>
  )
  return (
    <Popover>
      {compact ? <CanvasTooltip title={label}>{trigger}</CanvasTooltip> : trigger}
      <PopoverContent
        container={popupContainer}
        side="bottom"
        align="start"
        className={`${styles.popup} ${status ? styles.statusPopup : ''} nokey`}
        data-canvas-control-scope
        onClick={(event) => event.stopPropagation()}
      >
        <PopoverTitle className={styles.heading}>{label}</PopoverTitle>
        {(run.startedAt || run.finishedAt || runId != null) && (
          <dl className={styles.metadata}>
            {run.startedAt && (
              <div>
                <dt>{t('canvasCard.started')}</dt>
                <dd>
                  <time dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleString()}</time>
                </dd>
              </div>
            )}
            {run.finishedAt && (
              <div>
                <dt>{t('canvasCard.finished')}</dt>
                <dd>
                  <time dateTime={run.finishedAt}>{new Date(run.finishedAt).toLocaleString()}</time>
                </dd>
              </div>
            )}
            {runId != null && (
              <div>
                <dt>{t('canvasCard.runId')}</dt>
                <dd>
                  <CanvasTooltip getPopupContainer={() => popupContainer} title={t('copy')}>
                    <button
                      aria-label={`${t('copy')} ${runId}`}
                      className={styles.runId}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(runId)
                        } catch {
                          return
                        }
                        toast.success(t('copied'))
                      }}
                      type="button"
                    >
                      <code>{runId}</code>
                    </button>
                  </CanvasTooltip>
                </dd>
              </div>
            )}
          </dl>
        )}
        {children && (
          <>
            <div className={styles.separator} />
            <NativeScrollArea className={`${styles.record} nowheel nodrag nopan`}>{children}</NativeScrollArea>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function ImagePreview({ images, run, title }: { readonly images: readonly string[]; readonly run: FlowCanvasViewNodeRun; readonly title: string }) {
  const t = useTranslate()
  const [failed, setFailed] = useState<string>()
  const first = images[0]
  if (first == null) return null
  return (
    <div className={styles.preview}>
      {failed == first ? (
        <span>{t('canvasCard.previewUnavailable')}</span>
      ) : (
        <img src={first} alt={title} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(first)} />
      )}
      <div className={styles.previewAction}>
        <RecordChip label={t('canvasCard.images', { count: images.length })} run={run}>
          <div className={styles.gallery}>
            {images.map((src) => (
              <a href={src} target="_blank" rel="noreferrer" key={src}>
                <img src={src} alt={title} loading="lazy" referrerPolicy="no-referrer" />
              </a>
            ))}
          </div>
        </RecordChip>
      </div>
    </div>
  )
}

function runStatusLabel(run: FlowCanvasViewNodeRun, t: TFunction): string {
  const elapsed = run.startedAt != null && run.finishedAt != null ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : undefined
  const label = t(`canvasCard.status.${run.status}`)
  const progress =
    run.status == 'running' && run.progress != null && Number.isFinite(run.progress) ? ` · ${Math.round(Math.min(100, Math.max(0, run.progress)))}%` : ''
  return `${label}${progress}${elapsed != null && Number.isFinite(elapsed) && elapsed >= 0 ? ` · ${formatDuration(elapsed)}` : ''}`
}

function runStatusIcon(state: FlowCanvasViewNodeRun['status']): string {
  return state == 'handled'
    ? 'i-lucide-light:triangle-alert'
    : state == 'running'
      ? 'i-codicon:loading'
      : state == 'success'
        ? 'i-codicon:check'
        : state == 'error'
          ? 'i-codicon:error'
          : state == 'waiting'
            ? 'i-carbon:time'
            : 'i-codicon:circle-outline'
}

export function RunStatusIndicator({ run }: { readonly run: FlowCanvasViewNodeRun }) {
  const t = useTranslate()
  const label = runStatusLabel(run, t)
  return (
    <CanvasTooltip title={label} placement="top">
      <span className={styles.statusIndicator} data-status={run.status} role="img" aria-label={label} tabIndex={0}>
        <i className={runStatusIcon(run.status)} aria-hidden="true" />
      </span>
    </CanvasTooltip>
  )
}

export function hasRunRecords(run: FlowCanvasViewNodeRun | undefined): run is FlowCanvasViewNodeRun {
  return run != null && (run.status !== 'idle' || run.outputs !== undefined || (run.logs?.length ?? 0) > 0 || (run.artifacts?.length ?? 0) > 0)
}

export function RunChips({ run }: { readonly run: FlowCanvasViewNodeRun }) {
  const t = useTranslate()
  if (!hasRunRecords(run)) return null
  return (
    <div className={styles.row}>
      {run.status !== 'idle' && (
        <RecordChip label={runStatusLabel(run, t)} run={run} icon={runStatusIcon(run.status)} status={run.status} compact>
          {run.error != null && <JSONViewer data={run.error} shouldExpandNode={collapseAllNested} />}
        </RecordChip>
      )}
      <div className={styles.links}>
        {run.outputs !== undefined && (
          <RecordChip label={t('canvasCard.result')} run={run} icon="i-codicon:output" compact>
            <JSONViewer data={run.outputs} shouldExpandNode={collapseAllNested} />
          </RecordChip>
        )}
        {(run.logs?.length ?? 0) > 0 && (
          <RecordChip label={t('canvasCard.logs', { count: run.logs?.length ?? 0 })} run={run} icon="i-codicon:list-unordered" compact>
            {run.logs?.map((log, index) => (
              <div className={styles.log} key={`${log.time}-${index}`}>
                <small>
                  {log.level} · {new Date(log.time).toLocaleTimeString()}
                </small>
                <pre>{log.message}</pre>
              </div>
            ))}
          </RecordChip>
        )}
        {(run.artifacts?.length ?? 0) > 0 && (
          <RecordChip label={t('canvasCard.files', { count: run.artifacts?.length ?? 0 })} run={run} icon="i-codicon:files" compact>
            <p>{t('canvasCard.artifactMetadata')}</p>
            <JSONViewer data={run.artifacts} shouldExpandNode={collapseAllNested} />
          </RecordChip>
        )}
      </div>
    </div>
  )
}
