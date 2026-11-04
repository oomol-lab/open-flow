import type { ReactNode } from 'react'
import type { TFunction } from 'val-i18n'
import type { ControlClient } from '../../../../control/common/api.ts'
import type { FlowStateSummary, StateScope } from '../../../../state/common/state.ts'
import type { SetNotice } from '../stores/workbenchNotice.ts'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLang, useTranslate } from 'val-i18n-react'
import { controlErrorCode } from '../../../../control/common/errors.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../../../ui/browser/dialog.tsx'
import { HelpButton } from '../../../../ui/browser/helpButton.tsx'
import { ContentIcon } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { NativeScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../ui/browser/tabs.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { ApiError } from '../api.ts'
import { errorNotice } from '../stores/workbenchNotice.ts'

export type FlowStateClient = Pick<ControlClient, 'getFlowStateSummary' | 'clearFlowState' | 'clearFlowDedupe' | 'clearAllFlowDedupe'>
export type FlowStateNodes = readonly { readonly id: string; readonly title: string; readonly icon?: string; readonly fallbackIcon?: string }[]

function sourceName(space: string, nodes: FlowStateNodes, t: TFunction): string {
  return space === 'flow' ? t('flowState.shared') : (nodes.find((node) => `node:${node.id}` === space)?.title ?? space)
}

function UpdatedTime({ value, container }: { value: number; container?: HTMLElement | null }) {
  const language = useLang()
  const delta = value - Date.now()
  const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 86400000],
    ['month', 30 * 86400000],
    ['day', 86400000],
    ['hour', 3600000],
    ['minute', 60000],
    ['second', 1000],
  ]
  const [unit, duration] = units.find(([, size]) => Math.abs(delta) >= size) ?? units[units.length - 1]!
  const date = new Date(value)
  return (
    <Tooltip>
      <TooltipTrigger render={<time dateTime={date.toISOString()} />}>
        {new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(Math.round(delta / duration), unit)}
      </TooltipTrigger>
      <TooltipContent container={container}>{date.toLocaleString(language)}</TooltipContent>
    </Tooltip>
  )
}

function Usage({ count, limit }: { count?: number; limit?: number }) {
  const language = useLang()
  const t = useTranslate()
  return (
    <span className="inline-flex flex-col items-end whitespace-nowrap tabular-nums sm:inline">
      <span className="font-medium text-foreground">{count?.toLocaleString(language) ?? '—'}</span>
      {limit != null && <span className="text-xs text-muted-foreground">{t('flowState.limit', { limit: limit.toLocaleString(language) })}</span>}
    </span>
  )
}

function StateClearButton({
  name,
  disabled,
  reason,
  onClear,
  container,
}: {
  name: string
  disabled: boolean
  reason?: string
  onClear: (trigger: HTMLElement) => void
  container?: HTMLElement | null
}) {
  const t = useTranslate()
  const label = t('flowState.clearSource', { name })
  const button = (
    <Button variant="ghost" size="sm" aria-label={label} disabled={disabled || reason != null} onClick={(event) => onClear(event.currentTarget)}>
      {t('flowState.clear')}
    </Button>
  )
  return reason == null ? (
    button
  ) : (
    <Tooltip>
      <TooltipTrigger render={<span role="group" aria-label={label} tabIndex={0} className="inline-flex" />}>{button}</TooltipTrigger>
      <TooltipContent container={container}>{reason}</TooltipContent>
    </Tooltip>
  )
}

function StateDataRow({
  name,
  quantity,
  updatedAt,
  status,
  source,
  icon,
  disabled,
  clearReason,
  onClear,
  container,
}: {
  name: string
  quantity: ReactNode
  updatedAt: number | null
  status?: string
  source?: string
  icon?: ReactNode
  disabled: boolean
  clearReason?: string
  onClear?: (trigger: HTMLElement) => void
  container?: HTMLElement | null
}) {
  return (
    <tr className="border-b border-border/60 last:border-b-0">
      <th scope="row" className="py-3 text-left align-middle font-normal [overflow-wrap:anywhere]">
        <div className="flex gap-2">
          {icon != null && (
            <span aria-hidden="true" className="flex h-5 w-4 shrink-0 items-center justify-center text-base text-muted-foreground">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            {source == null ? (
              name
            ) : (
              <Tooltip>
                <TooltipTrigger render={<span />}>{name}</TooltipTrigger>
                <TooltipContent container={container}>{source}</TooltipContent>
              </Tooltip>
            )}
            {(status != null || updatedAt != null) && (
              <div className="mt-1 text-xs font-normal text-muted-foreground">
                {status ?? (updatedAt != null && <UpdatedTime value={updatedAt} container={container} />)}
              </div>
            )}
          </div>
        </div>
      </th>
      <td className="w-px py-3 pl-3 text-right align-middle whitespace-nowrap tabular-nums">{quantity}</td>
      <td className="w-px py-3 pl-3 text-right align-middle whitespace-nowrap">
        {onClear != null && <StateClearButton name={name} disabled={disabled} reason={clearReason} onClear={onClear} container={container} />}
      </td>
    </tr>
  )
}

export function FlowStatePanel({
  value,
  nodes,
  busy,
  loading = false,
  onClearValues,
  onClearHistory,
  onClearSpace,
  space,
  container,
}: {
  value?: FlowStateSummary
  nodes: FlowStateNodes
  busy: boolean
  loading?: boolean
  space?: string
  container?: HTMLElement | null
  onClearValues: (trigger: HTMLElement) => void
  onClearHistory: (trigger: HTMLElement) => void
  onClearSpace: (space: string, trigger: HTMLElement) => void
}) {
  const t = useTranslate()
  const language = useLang()
  const allSpaces = value?.spaces ?? []
  const count = value == null ? undefined : allSpaces.reduce((total, item) => total + item.reservedCount, 0)
  const spaces = allSpaces
    .filter((item) => space == null || item.space === space)
    .toSorted((a, b) => b.reservedCount - a.reservedCount || (a.space < b.space ? -1 : a.space > b.space ? 1 : 0))
  const readStatus = loading ? t('flowState.loading') : value == null ? t('flowState.loadFailed') : undefined
  const valuesDetail =
    readStatus ??
    (value?.values.count === 0 ? (
      t('flowState.emptyValues')
    ) : value?.values.updatedAt != null ? (
      <UpdatedTime value={value.values.updatedAt} container={container} />
    ) : undefined)
  const historyDetail = readStatus ?? (spaces.length === 0 ? t('flowState.emptySpaces') : undefined)
  return (
    <div className="flex flex-col gap-4">
      {space == null && (
        <section aria-label={t('flowState.values')} className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="m-0 text-sm font-medium">{t('flowState.values')}</h3>
              {valuesDetail != null && <p className="mt-1 mb-0 text-xs text-muted-foreground">{valuesDetail}</p>}
            </div>
            <Usage count={value?.values.count} limit={value?.limits.maxValues} />
            {value != null && value.values.count > 0 && (
              <StateClearButton name={t('flowState.values')} disabled={busy} onClear={onClearValues} container={container} />
            )}
          </div>
          {value != null && value.values.count >= value.limits.maxValues * 0.8 && (
            <p role="status" className="m-0 text-xs text-destructive">
              {t('flowState.valuesNearLimit')}
            </p>
          )}
        </section>
      )}
      <section aria-label={t('flowState.spaces')} className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
        {(space == null || spaces.length === 0) && (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="m-0 text-sm font-medium">{space == null ? t('flowState.spaces') : sourceName(space, nodes, t)}</h3>
              {historyDetail != null && <p className="mt-1 mb-0 text-xs text-muted-foreground">{historyDetail}</p>}
            </div>
            {space == null ? (
              <Usage count={count} limit={value?.limits.maxIdentities} />
            ) : (
              <span className="text-sm tabular-nums">{value == null ? '—' : t('flowState.records', { count: '0' })}</span>
            )}
            {space == null && allSpaces.length > 0 && (
              <StateClearButton
                name={t('flowState.spaces')}
                disabled={busy}
                reason={allSpaces.some((item) => item.pendingCount === 0) ? undefined : t('flowState.clearBlocked')}
                onClear={onClearHistory}
                container={container}
              />
            )}
          </div>
        )}
        {value != null && count != null && count >= value.limits.maxIdentities * 0.8 && (
          <p role="status" className="m-0 text-xs text-destructive">
            {t('flowState.nearLimit')}
          </p>
        )}
        {spaces.length > 0 && (
          <table aria-label={t('flowState.source')} className="w-full border-collapse text-sm">
            <thead className="sr-only">
              <tr className="text-xs text-muted-foreground">
                <th scope="col" className="pb-2 text-left font-normal">
                  {t('flowState.source')}
                </th>
                <th scope="col" className="pb-2 pl-4 text-right font-normal">
                  {t('flowState.count')}
                </th>
                <th scope="col" className="pl-4">
                  <span className="sr-only">{t('flowState.clear')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {spaces.map((item) => {
                const node = nodes.find((entry) => `node:${entry.id}` === item.space)
                const fallback = <i aria-hidden="true" className="i-lucide-light:workflow" />
                return (
                  <StateDataRow
                    key={item.space}
                    name={sourceName(item.space, nodes, t)}
                    source={item.space.startsWith('node:') && node == null ? `${item.space} · ${t('flowState.orphaned')}` : item.space}
                    icon={
                      item.space === 'flow' ? (
                        <i aria-hidden="true" className="i-lucide-light:database" />
                      ) : (
                        <ContentIcon
                          src={node?.icon}
                          className="size-4"
                          fallback={<ContentIcon src={node?.fallbackIcon} className="size-4" fallback={fallback} />}
                        />
                      )
                    }
                    quantity={item.reservedCount.toLocaleString(language)}
                    updatedAt={item.updatedAt}
                    status={space != null ? readStatus : undefined}
                    disabled={busy}
                    clearReason={item.pendingCount > 0 ? t('flowState.pendingClear', { count: item.pendingCount.toLocaleString(language) }) : undefined}
                    onClear={(trigger) => onClearSpace(item.space, trigger)}
                    container={container}
                  />
                )
              })}
            </tbody>
          </table>
        )}
        {space != null && (
          <p className="m-0 flex flex-wrap items-baseline justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
            <span>{t('flowState.globalUsage')}</span>
            <Usage count={count} limit={value?.limits.maxIdentities} />
          </p>
        )}
      </section>
    </div>
  )
}

type ClearTarget = { kind: 'values' | 'dedupe'; space?: string; name: string; count: number; pendingCount: number; scope: StateScope }
type ReadState = { scope: StateScope; data?: FlowStateSummary; error?: string; loading: boolean }

export function FlowStateButton({
  client,
  flowId,
  nodes,
  history,
  notify,
  onClose,
}: {
  client: FlowStateClient
  flowId: string
  nodes: FlowStateNodes
  history?: { nodeId: string }
  notify: SetNotice
  onClose?: () => void
}) {
  const t = useTranslate()
  const language = useLang()
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const portal = useCallback(
    (element: HTMLSpanElement | null) => setContainer(element?.closest<HTMLElement>('.open-flow-workbench, .open-flow-theme') ?? null),
    [],
  )
  const [open, setOpen] = useState(onClose != null)
  const [scope, setScope] = useState<StateScope>('draft')
  const space = history == null ? undefined : `node:${history.nodeId}`
  const [read, setRead] = useState<ReadState>({ scope: 'draft', loading: true })
  const data = read.scope === scope ? read.data : undefined
  const loading = read.scope !== scope || read.loading
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [refresh, setRefresh] = useState(0)
  const [confirm, setConfirm] = useState<ClearTarget>()
  const cancelButton = useRef<HTMLButtonElement>(null)
  const dialogRoot = useRef<HTMLDivElement>(null)
  const confirmTrigger = useRef<HTMLElement>()
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setRead((previous) => ({ scope, data: previous.scope === scope ? previous.data : undefined, loading: true }))
    void client.getFlowStateSummary(flowId, scope, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setRead({ scope, data: result, loading: false })
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) setRead((previous) => ({ ...previous, loading: false, error: errorNotice(reason, t).message }))
      },
    )
    return () => controller.abort()
  }, [client, flowId, scope, refresh, open, t])
  const clear = async (target: ClearTarget) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      if (target.kind === 'values') await client.clearFlowState(flowId, target.scope)
      else if (target.space != null) await client.clearFlowDedupe(flowId, target.scope, target.space)
      else await client.clearAllFlowDedupe(flowId, target.scope)
      confirmTrigger.current = dialogRoot.current ?? undefined
      setConfirm(undefined)
      setRefresh((value) => value + 1)
      dialogRoot.current?.focus()
    } catch (reason) {
      const conflict = target.kind === 'dedupe' && reason instanceof ApiError && reason.code === controlErrorCode.flowConflict
      notify(conflict ? { kind: 'error', message: t('flowState.clearBlocked') } : errorNotice(reason, t))
      if (conflict) {
        confirmTrigger.current = dialogRoot.current ?? undefined
        setConfirm(undefined)
        setRefresh((value) => value + 1)
      }
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const request = (kind: ClearTarget['kind'], targetSpace: string | undefined, trigger: HTMLElement) => {
    if (pending.current || data == null) return
    const targets = data.spaces.filter((item) => targetSpace == null || item.space === targetSpace)
    if (kind === 'dedupe' && !targets.some((item) => item.pendingCount === 0)) return
    const target: ClearTarget = {
      kind,
      scope,
      space: targetSpace,
      name: kind === 'values' ? t('flowState.values') : targetSpace == null ? t('flowState.spaces') : sourceName(targetSpace, nodes, t),
      count: kind === 'values' ? data.values.count : targets.filter((item) => item.pendingCount === 0).reduce((total, item) => total + item.count, 0),
      pendingCount: kind === 'values' ? 0 : targets.reduce((total, item) => total + item.pendingCount, 0),
    }
    confirmTrigger.current = trigger
    if (scope === 'live') setConfirm(target)
    else void clear(target)
  }
  return (
    <span className="contents" ref={portal}>
      <Dialog
        open={open}
        onOpenChange={(next, details) => {
          if (pending.current) {
            details.cancel()
            return
          }
          setOpen(next)
          setConfirm(undefined)
          if (next) {
            setScope('draft')
            setRead({ scope: 'draft', loading: true })
          } else onClose?.()
        }}
      >
        {onClose == null && (
          <DialogTrigger render={<Button variant="ghost" size="sm" />}>
            <i aria-hidden="true" className="i-lucide-light:database" />
            {t(space == null ? 'flowState.title' : 'flowState.history')}
          </DialogTrigger>
        )}
        <DialogContent
          ref={dialogRoot}
          container={container}
          className="flex h-[min(32rem,80dvh)] flex-col overflow-hidden sm:max-w-2xl"
          closeLabel={t('common.close')}
        >
          <DialogTitle className="break-words pr-8">
            {space == null ? t('flowState.title') : t('flowState.sourceHistory', { name: sourceName(space, nodes, t) })}
          </DialogTitle>
          <Tabs
            value={scope}
            onValueChange={(value) => {
              if (!pending.current) {
                setScope(value as StateScope)
                setConfirm(undefined)
              }
            }}
            className="min-h-0 flex-1 gap-4"
          >
            <div className="flex shrink-0 items-center justify-between gap-2">
              <TabsList aria-label={t('flowState.scope')}>
                <TabsTrigger value="draft" disabled={busy}>
                  {t('flowState.draft')}
                </TabsTrigger>
                <TabsTrigger value="live" disabled={busy}>
                  {t('flowState.live')}
                </TabsTrigger>
              </TabsList>
              <div className="flex shrink-0 items-center gap-2">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label={t('flowState.refresh')}
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy || loading}
                        onClick={() => setRefresh((value) => value + 1)}
                      />
                    }
                  >
                    <i aria-hidden="true" className="i-lucide-light:refresh-cw" />
                  </TooltipTrigger>
                  <TooltipContent container={container}>{t('flowState.refresh')}</TooltipContent>
                </Tooltip>
                <HelpButton label={t('flowState.rules')} container={container} size={28}>
                  <div className="flex flex-col gap-2">
                    <p className="m-0">{t('flowState.valuesHelp', { name: t('flowState.values') })}</p>
                    <p className="m-0">{t('flowState.historyHelp', { name: t('flowState.spaces') })}</p>
                    <p className="m-0">{t('flowState.isolation')}</p>
                  </div>
                </HelpButton>
              </div>
            </div>
            <NativeScrollArea className="min-h-0 flex-1 overflow-y-auto">
              <TabsContent value={scope} aria-busy={busy || loading}>
                {read.scope === scope && read.error != null && (
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <p role="alert" className="m-0 min-w-0 flex-1 text-sm text-destructive">
                      {read.error}
                    </p>
                    <Button variant="outline" size="sm" disabled={loading || busy} onClick={() => setRefresh((value) => value + 1)}>
                      {t('flowState.retry')}
                    </Button>
                  </div>
                )}
                <FlowStatePanel
                  value={data}
                  loading={loading}
                  space={space}
                  nodes={nodes}
                  container={container}
                  busy={busy || loading}
                  onClearValues={(trigger) => request('values', undefined, trigger)}
                  onClearHistory={(trigger) => request('dedupe', undefined, trigger)}
                  onClearSpace={(sourceSpace, trigger) => request('dedupe', sourceSpace, trigger)}
                />
              </TabsContent>
            </NativeScrollArea>
          </Tabs>
          <Dialog
            open={confirm != null}
            onOpenChange={(next, details) => {
              if (pending.current) details.cancel()
              else if (!next) setConfirm(undefined)
            }}
          >
            <DialogContent
              container={container}
              initialFocus={cancelButton}
              finalFocus={() => (confirmTrigger.current?.isConnected ? confirmTrigger.current : dialogRoot.current)}
              showCloseButton={false}
            >
              <DialogTitle>{t('flowState.confirmTitle', { name: confirm?.name ?? '' })}</DialogTitle>
              <DialogDescription>
                {confirm &&
                  t(confirm.kind === 'values' ? 'flowState.confirmValues' : 'flowState.confirmHistory', {
                    count: confirm.count.toLocaleString(language),
                    scope: t(confirm.scope === 'draft' ? 'flowState.draft' : 'flowState.live'),
                  })}
              </DialogDescription>
              {confirm != null && confirm.pendingCount > 0 && (
                <p className="m-0 text-sm text-muted-foreground">{t('flowState.retainedHistory', { count: confirm.pendingCount.toLocaleString(language) })}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button ref={cancelButton} disabled={busy} variant="outline" onClick={() => setConfirm(undefined)}>
                  {t('flowState.cancel')}
                </Button>
                <Button
                  disabled={busy}
                  variant="destructive"
                  onClick={() => {
                    if (confirm != null) void clear(confirm)
                  }}
                >
                  {t('flowState.confirmClear')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>
    </span>
  )
}
