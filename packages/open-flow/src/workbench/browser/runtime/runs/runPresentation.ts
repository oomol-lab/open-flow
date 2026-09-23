import type { TFunction } from 'val-i18n'
import type { Run } from '../api.ts'

export function runLabel(run: Run | undefined, t: TFunction): string {
  if (run == null) return t('run.statusNone')
  switch (run.status) {
    case 'queued':
      return t('run.statusQueued')
    case 'starting':
      return t('run.statusStarting')
    case 'running':
      return t('run.statusRunning')
    case 'waiting':
      return t('run.statusWaiting')
    case 'completed':
      return t('run.statusSucceeded')
    case 'failed':
      return t('run.statusFailed')
    case 'canceled':
      return t('run.statusCanceled')
    case 'indeterminate':
      return t('run.statusIndeterminate')
  }
}

export function statusClass(run: Run | undefined): 'danger' | 'neutral' | 'running' | 'success' {
  if (run == null) return 'neutral'
  if (run.status == 'completed') return 'success'
  if (run.status == 'failed' || run.status == 'indeterminate') return 'danger'
  if (run.status == 'canceled') return 'neutral'
  return 'running'
}

export function duration(run: Run | undefined): string {
  if (run?.startedAt == null) return '—'
  const end = run.finishedAt == null ? Date.now() : Date.parse(run.finishedAt)
  const milliseconds = Math.max(0, end - Date.parse(run.startedAt))
  return milliseconds < 1000 ? `${milliseconds}ms` : `${(milliseconds / 1000).toFixed(1)}s`
}
