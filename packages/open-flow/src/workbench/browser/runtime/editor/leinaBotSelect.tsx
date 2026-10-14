import type { LeinaBot } from '../../../../control/common/api.ts'
import type { JsonValue } from '../api.ts'

import { useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { selectionMenuContentClass, selectionMenuItemClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../ui/browser/select.tsx'

interface BotSource {
  listLeinaBots(flowId: string, signal: AbortSignal): Promise<readonly LeinaBot[]>
}

export function LeinaBotSelect({
  source,
  flowId,
  value,
  disabled,
  onChange,
}: {
  readonly source: BotSource
  readonly flowId: string
  readonly value: JsonValue | undefined
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}) {
  const t = useTranslate()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    readonly flowId: string
    readonly source: BotSource
    readonly bots?: readonly LeinaBot[]
    readonly loading: boolean
    readonly error?: string
  }>()
  useEffect(() => {
    const controller = new AbortController()
    setState((previous) => ({ flowId, source, loading: true, bots: previous?.flowId == flowId && previous.source == source ? previous.bots : undefined }))
    void source.listLeinaBots(flowId, controller.signal).then(
      (bots) => {
        if (!controller.signal.aborted) setState({ flowId, source, bots, loading: false })
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setState((previous) => ({
            flowId,
            source,
            bots: previous?.flowId == flowId && previous.source == source ? previous.bots : undefined,
            loading: false,
            error: error instanceof Error ? error.message : t('contextPanel.loadFailed'),
          }))
      },
    )
    return () => controller.abort()
  }, [source, flowId, attempt, t])
  const current = state?.flowId == flowId && state.source == source ? state : undefined
  const bots = current?.bots
  const selected = typeof value == 'string' && value.trim().length > 0 ? value : undefined
  const missing = selected != null && bots != null && !bots.some((bot) => bot.leinaId == selected)
  const error = selected == null ? t('leina.select') : missing ? t('leina.unavailable', { id: selected }) : undefined
  const selectedLabel =
    bots?.find((bot) => bot.leinaId == selected)?.name ??
    (missing ? t('leina.unavailable', { id: selected! }) : current?.error != null ? t('leina.loadFailed') : t('leina.loading'))
  const items = [
    ...(bots ?? []).map((bot) => ({ value: bot.leinaId, label: bot.name })),
    ...(selected != null && !bots?.some((bot) => bot.leinaId == selected) ? [{ value: selected, label: selectedLabel }] : []),
  ]
  return (
    <ValueEditorFeedback error={error}>
      {(errorId) => (
        <Select
          items={items}
          value={selected ?? null}
          disabled={disabled}
          onOpenChange={(open) => {
            if (open) setAttempt((previous) => previous + 1)
          }}
          onValueChange={(next) => {
            if (typeof next == 'string' && bots?.some((bot) => bot.leinaId == next)) onChange(next)
          }}
        >
          <SelectTrigger
            size="field"
            className="w-full"
            data-field-control
            aria-label={t('leina.robot')}
            aria-invalid={error != null || undefined}
            aria-describedby={errorId}
          >
            <SelectValue placeholder={t('leina.select')}>{selected == null ? undefined : selectedLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false} className={selectionMenuContentClass}>
            {(current?.loading ?? true) && (
              <span role="status" className="block px-1.5 py-1 text-xs leading-5 text-muted-foreground">
                {t('leina.loading')}
              </span>
            )}
            {bots?.map((bot) => (
              <SelectItem key={bot.leinaId} value={bot.leinaId} className={selectionMenuItemClass}>
                <span className="truncate">{bot.name}</span>
              </SelectItem>
            ))}
            {missing && selected != null && (
              <SelectItem value={selected} disabled className={`${selectionMenuItemClass} text-destructive`}>
                {t('leina.unavailable', { id: selected })}
              </SelectItem>
            )}
            {current?.error != null && (
              <span role="alert" className="block px-1.5 py-1 text-xs leading-5 whitespace-normal break-words text-destructive">
                {t('leina.loadFailed')} {current.error}
              </span>
            )}
            {bots?.length == 0 && !current?.loading && (
              <span className="block px-1.5 py-1 text-xs leading-5 whitespace-normal text-muted-foreground">{t('leina.empty')}</span>
            )}
          </SelectContent>
        </Select>
      )}
    </ValueEditorFeedback>
  )
}
