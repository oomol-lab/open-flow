import type { ControlClient } from '../../../../control/common/api.ts'
import type { FlowStateView, StateScope } from '../../../../state/common/state.ts'

import { useCallback, useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../../../../ui/browser/dialog.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { NativeSelect, NativeSelectOption } from '../../../../ui/browser/native-select.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'

export type FlowStateClient = Pick<ControlClient, 'getFlowState' | 'clearFlowState' | 'clearFlowDedupe'>

export function FlowStatePanel({
  value,
  nodeIds,
  busy,
  onClearValues,
  onClearSpace,
  space,
}: {
  value: FlowStateView
  nodeIds: readonly string[]
  busy: boolean
  space?: string
  onClearValues: (key?: string) => void
  onClearSpace: (space: string) => void
}) {
  const t = useTranslate()
  const count = value.spaces.reduce((total, item) => total + item.count, 0)
  const spaces = space == null ? value.spaces : value.spaces.filter((item) => item.space === space)
  return (
    <div className="flex flex-col gap-4">
      {space == null && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="m-0 min-w-0 flex-1 text-sm font-medium">{t('flowState.values')}</h3>
            <span className="text-xs text-muted-foreground">
              {t('flowState.entries', { count: value.values.length.toLocaleString(), limit: value.limits.maxValues.toLocaleString() })}
            </span>
            {value.values.length > 0 && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => onClearValues()}>
                {t('flowState.clearAll')}
              </Button>
            )}
          </div>
          {!value.values.length && <p className="m-0 text-sm text-muted-foreground">{t('flowState.emptyValues')}</p>}
          {value.values.map((item) => (
            <div key={item.key} className="flex items-start justify-between gap-3 border-b border-border/60 py-2">
              <div className="min-w-0">
                <p className="m-0 break-all font-medium">{item.key}</p>
                {item.value !== undefined && (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(item.value, null, 2)}</pre>
                )}
              </div>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => onClearValues(item.key)}>
                {t('flowState.delete')}
              </Button>
            </div>
          ))}
        </section>
      )}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="m-0 text-sm font-medium">{t('flowState.spaces')}</h3>
          <span className="text-xs text-muted-foreground">
            {t('flowState.entries', { count: count.toLocaleString(), limit: value.limits.maxIdentities.toLocaleString() })}
          </span>
        </div>
        {count >= value.limits.maxIdentities * 0.8 && (
          <p role="status" className="m-0 text-destructive text-xs">
            {t('flowState.nearLimit')}
          </p>
        )}
        {!spaces.length && <p className="m-0 text-sm text-muted-foreground">{t('flowState.emptySpaces')}</p>}
        {spaces.map((item) => (
          <div key={item.space} className="flex items-start justify-between gap-3 border-b border-border/60 py-2">
            <div className="min-w-0">
              <p className="m-0 break-all font-medium">
                {item.space}{' '}
                {item.space.startsWith('node:') && !nodeIds.includes(item.space.slice(5)) && (
                  <span className="text-muted-foreground">({t('flowState.orphaned')})</span>
                )}
              </p>
              <p className="m-0 text-xs">
                {item.mode === 'new' ? t('flowState.records', { count: item.count.toLocaleString() }) : `${t('flowState.watermark')}: ${item.watermark ?? '-'}`}
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onClearSpace(item.space)}>
              {t('flowState.clear')}
            </Button>
          </div>
        ))}
      </section>
    </div>
  )
}

export function FlowStateButton({
  client,
  flowId,
  nodeIds,
  space,
  onClose,
}: {
  client: FlowStateClient
  flowId: string
  nodeIds: readonly string[]
  space?: string
  onClose?: () => void
}) {
  const t = useTranslate()
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const portal = useCallback((element: HTMLSpanElement | null) => {
    setContainer(element?.closest<HTMLElement>('.open-flow-workbench') ?? element?.closest<HTMLElement>('.open-flow-theme') ?? null)
  }, [])
  const [open, setOpen] = useState(onClose != null)
  const [scope, setScope] = useState<StateScope>('draft')
  const [values, setValues] = useState(false)
  const [data, setData] = useState<FlowStateView>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [confirm, setConfirm] = useState<{ key?: string; space?: string }>()
  useEffect(() => {
    if (!open && space == null) return
    let active = true
    setData(undefined)
    setError(undefined)
    void client.getFlowState(flowId, scope, values).then(
      (result) => {
        if (active) setData(result)
      },
      (reason: unknown) => {
        if (active) setError(String(reason))
      },
    )
    return () => {
      active = false
    }
  }, [client, flowId, scope, values, refresh, open, space])
  const clear = async (target: { key?: string; space?: string }) => {
    setBusy(true)
    setError(undefined)
    try {
      if (target.space != null) await client.clearFlowDedupe(flowId, scope, target.space)
      else await client.clearFlowState(flowId, scope, target.key)
      setConfirm(undefined)
      setRefresh((value) => value + 1)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }
  const request = (target: { key?: string; space?: string }) => (scope === 'live' ? setConfirm(target) : void clear(target))
  return (
    <span className="contents" ref={portal}>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) {
            setOpen(next)
            if (!next) onClose?.()
            setConfirm(undefined)
          }
        }}
      >
        {onClose == null && (
          <DialogTrigger
            render={
              <Button
                variant={
                  space != null && data != null && data.spaces.reduce((total, item) => total + item.count, 0) >= data.limits.maxIdentities * 0.8
                    ? 'destructive'
                    : 'ghost'
                }
                size="sm"
              />
            }
          >
            <i aria-hidden="true" className="i-lucide-light:database" />
            {t(space == null ? 'flowState.title' : 'flowState.history')}
          </DialogTrigger>
        )}
        <DialogContent container={container} className="max-h-[80vh] overflow-auto" closeLabel={t('common.close')}>
          <DialogTitle>{t('flowState.title')}</DialogTitle>
          <div className="flex flex-wrap items-center gap-3">
            <NativeSelect
              aria-label={t('flowState.scope')}
              value={scope}
              disabled={busy}
              onChange={(event) => {
                setScope(event.target.value as StateScope)
                setConfirm(undefined)
              }}
            >
              <NativeSelectOption value="draft">{t('flowState.draft')}</NativeSelectOption>
              <NativeSelectOption value="live">{t('flowState.live')}</NativeSelectOption>
            </NativeSelect>
            {space == null && (values || (data?.values.length ?? 0) > 0) && (
              <Label className="flex items-center gap-2 text-sm">
                <Checkbox checked={values} onCheckedChange={setValues} />
                {t('flowState.showValues')}
              </Label>
            )}
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
              {t('flowState.refresh')}
            </Button>
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" />}>{t('flowState.rules')}</TooltipTrigger>
              <TooltipContent container={container} className="max-w-xs">
                <div className="flex flex-col gap-2">
                  <p className="m-0">{t('flowState.isolation')}</p>
                  <p className="m-0">{t('flowState.retention')}</p>
                  {data != null && (
                    <>
                      <p className="m-0">{t('flowState.valueLimit', { size: data.limits.maxValueBytes.toLocaleString() })}</p>
                      <p className="m-0">{t('flowState.sharedLimit', { count: data.spaces.length, limit: data.limits.maxSpaces })}</p>
                    </>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </div>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {confirm && (
            <div role="alert" className="flex flex-col gap-2 rounded border border-border p-3">
              <p>{t('flowState.confirmLive')}</p>
              <p className="break-all">{confirm.space ?? confirm.key ?? t('flowState.values')}</p>
              <div className="flex gap-2">
                <Button disabled={busy} variant="destructive" onClick={() => void clear(confirm)}>
                  {t('flowState.clear')}
                </Button>
                <Button disabled={busy} variant="outline" onClick={() => setConfirm(undefined)}>
                  {t('flowState.cancel')}
                </Button>
              </div>
            </div>
          )}
          {data == null ? (
            <p role="status">{error == null ? t('flowState.loading') : ''}</p>
          ) : (
            <FlowStatePanel
              value={data}
              space={space}
              nodeIds={nodeIds}
              busy={busy}
              onClearValues={(key) => request({ key })}
              onClearSpace={(targetSpace) => request({ space: targetSpace })}
            />
          )}
        </DialogContent>
      </Dialog>
    </span>
  )
}
