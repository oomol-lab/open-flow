import styles from './RunChips.module.scss'
import type { ReactNode } from 'react'
import type { FlowCanvasViewNodeRun } from '../../FlowCanvas/model.ts'

import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslate } from 'val-i18n-react'
import { collapseAllNested, JSONViewer } from '../../../../../ui/browser/json-viewer/index.ts'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../../../../../ui/browser/popover.tsx'
import { useGetStaticPopupContainer } from '../../ReactFlowContainer/useGetPopupContainer.ts'

function RecordChip({
  label,
  run,
  children,
  icon,
  status,
  compactHeader = false,
}: {
  readonly label: string
  readonly run: FlowCanvasViewNodeRun
  readonly children: ReactNode
  readonly icon?: string
  readonly status?: string
  readonly compactHeader?: boolean
}) {
  const t = useTranslate()
  const getContainer = useGetStaticPopupContainer()
  const runId = run.runId
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={`${styles.chip} ${status ? styles.status : ''} nodrag nopan nokey`}
            data-status={status}
            onClick={(event) => event.stopPropagation()}
          />
        }
      >
        {icon && <i className={icon} aria-hidden="true" />}
        <span>{label}</span>
      </PopoverTrigger>
      <PopoverContent
        container={getContainer()}
        side="bottom"
        align="start"
        className={`${styles.popup} ${status ? styles.statusPopup : ''} nokey`}
        data-canvas-control-scope
        onClick={(event) => event.stopPropagation()}
      >
        {!compactHeader && <PopoverTitle>{label}</PopoverTitle>}
        <p className={styles.origin}>
          {run.finishedAt && <time>{new Date(run.finishedAt).toLocaleString()}</time>}
          {runId != null && (
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
              title={runId}
              type="button"
            >
              <code>{runId}</code>
            </button>
          )}
        </p>
        <div className={`${styles.record} nowheel nodrag nopan`}>{children}</div>
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

export function RunChips({ run }: { readonly run: FlowCanvasViewNodeRun }) {
  const t = useTranslate()
  const elapsed = run.startedAt != null && run.finishedAt != null ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : undefined
  const label = t(`canvasCard.status.${run.status}`)
  const progress =
    run.status == 'running' && run.progress != null && Number.isFinite(run.progress) ? ` · ${Math.round(Math.min(100, Math.max(0, run.progress)))}%` : ''
  const status = `${label}${progress}${elapsed != null && Number.isFinite(elapsed) && elapsed >= 0 ? ` · ${(elapsed / 1000).toFixed(1)} s` : ''}`
  const state = run.status
  const icon =
    state == 'running'
      ? 'i-codicon:loading'
      : state == 'success'
        ? 'i-codicon:check'
        : state == 'error'
          ? 'i-codicon:error'
          : state == 'waiting'
            ? 'i-carbon:time'
            : 'i-codicon:circle-outline'
  return (
    <div className={styles.row}>
      <RecordChip label={status} run={run} icon={icon} status={state}>
        {run.error != null && <JSONViewer data={run.error} shouldExpandNode={collapseAllNested} />}
        {run.startedAt && (
          <p>
            {t('canvasCard.started')} · {new Date(run.startedAt).toLocaleString()}
          </p>
        )}
      </RecordChip>
      <div className={styles.links}>
        {run.outputs !== undefined && (
          <RecordChip compactHeader label={t('canvasCard.result')} run={run} icon="i-codicon:output">
            <JSONViewer data={run.outputs} shouldExpandNode={collapseAllNested} />
          </RecordChip>
        )}
        {(run.logs?.length ?? 0) > 0 && (
          <RecordChip label={t('canvasCard.logs', { count: run.logs?.length ?? 0 })} run={run} icon="i-codicon:list-unordered">
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
          <RecordChip label={t('canvasCard.files', { count: run.artifacts?.length ?? 0 })} run={run} icon="i-codicon:files">
            <p>{t('canvasCard.artifactMetadata')}</p>
            <JSONViewer data={run.artifacts} shouldExpandNode={collapseAllNested} />
          </RecordChip>
        )}
      </div>
    </div>
  )
}
