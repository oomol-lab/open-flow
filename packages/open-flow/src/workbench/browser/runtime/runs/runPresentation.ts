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

export function duration(run: Pick<Run, 'startedAt' | 'finishedAt'> | undefined): string {
  if (run?.startedAt == null) return '—'
  const end = run.finishedAt == null ? Date.now() : Date.parse(run.finishedAt)
  let milliseconds = Math.max(0, end - Date.parse(run.startedAt))
  const parts: string[] = []
  for (const [unit, size] of [
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1000],
    ['ms', 1],
  ] as const) {
    const amount = Math.floor(milliseconds / size)
    if (amount > 0) parts.push(`${amount}${unit}`)
    milliseconds %= size
    if (parts.length === 2) break
  }
  return parts.join(' ') || '0ms'
}
