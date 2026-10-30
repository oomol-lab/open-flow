import type { ControlClient } from '../../../../control/common/api.ts'
import type { FlowStateView, StateScope } from '../../../../state/common/state.ts'

import { useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../../../ui/browser/dialog.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { NativeSelect, NativeSelectOption } from '../../../../ui/browser/native-select.tsx'

export type FlowStateClient = Pick<ControlClient, 'getFlowState' | 'clearFlowState' | 'clearFlowDedupe'>

export function FlowStatePanel({
  value,
  nodeIds,
  busy,
  onClearValues,
  onClearSpace,
  historyOnly = false,
}: {
  value: FlowStateView
  nodeIds: readonly string[]
  busy: boolean
  historyOnly?: boolean
  onClearValues: (key?: string) => void
  onClearSpace: (space: string) => void
}) {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-4">
      <p>
        {t('flowState.usage')}: {value.bytes.toLocaleString()} / {value.limits.maxBytes.toLocaleString()} B
      </p>
      {!historyOnly && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h3>{t('flowState.values')}</h3>
            <Button variant="outline" size="sm" disabled={busy || !value.values.length} onClick={() => onClearValues()}>
              {t('flowState.clearAll')}
            </Button>
          </div>
          {!value.values.length && <p className="text-muted-foreground">{t('flowState.empty')}</p>}
          {value.values.map((item) => (
            <div key={item.key} className="flex items-start justify-between gap-3 border-b border-border/60 py-2">
              <div className="min-w-0">
                <p className="break-all font-medium">{item.key}</p>
                <p className="text-muted-foreground text-xs">
                  {item.size} B · {new Date(item.updatedAt).toLocaleString()}
                </p>
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
        <h3>{t('flowState.spaces')}</h3>
        {!value.spaces.length && <p className="text-muted-foreground">{t('flowState.empty')}</p>}
        {value.spaces.map((item) => (
          <div key={item.space} className="flex items-start justify-between gap-3 border-b border-border/60 py-2">
            <div className="min-w-0">
              <p className="break-all font-medium">
                {item.space}{' '}
                {item.space.startsWith('node:') && !nodeIds.includes(item.space.slice(5)) && (
                  <span className="text-muted-foreground">({t('flowState.orphaned')})</span>
                )}
              </p>
              <p className="text-xs">
                {item.mode === 'new'
                  ? `${item.count.toLocaleString()} / ${value.limits.maxIdentities.toLocaleString()}`
                  : `${t('flowState.watermark')}: ${item.watermark ?? '-'}`}
              </p>
              {item.mode === 'new' && item.count >= value.limits.maxIdentities * 0.8 && (
                <p role="status" className="text-destructive text-xs">
                  {t('flowState.nearLimit')}
                </p>
              )}
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
        <DialogTrigger render={<Button variant="ghost" size="sm" />}>
          <i aria-hidden="true" className="i-lucide-light:database" />
          {t(space == null ? 'flowState.title' : 'flowState.history')}
        </DialogTrigger>
      )}
      {space != null && data?.spaces.some((item) => item.space === space && item.mode === 'new' && item.count >= data.limits.maxIdentities * 0.8) && (
        <p role="status" className="text-destructive text-xs">
          {t('flowState.nearLimit')}
        </p>
      )}
      <DialogContent className="max-h-[80vh] overflow-auto">
        <DialogTitle>{t('flowState.title')}</DialogTitle>
        <DialogDescription>{t('flowState.description')}</DialogDescription>
        <div className="flex items-center gap-3">
          <NativeSelect
            aria-label={t('flowState.scope')}
            value={scope}
            disabled={busy}
            onChange={(event) => {
              setScope(event.target.value as StateScope)
              setConfirm(undefined)
            }}
          >
            <NativeSelectOption value="draft">Draft</NativeSelectOption>
            <NativeSelectOption value="live">Live</NativeSelectOption>
          </NativeSelect>
          <Label className="flex items-center gap-2 text-sm">
            <Checkbox checked={values} onCheckedChange={setValues} />
            {t('flowState.showValues')}
          </Label>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>
            {t('flowState.refresh')}
          </Button>
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
            value={space == null ? data : { ...data, values: [], spaces: data.spaces.filter((item) => item.space === space) }}
            historyOnly={space != null}
            nodeIds={nodeIds}
            busy={busy}
            onClearValues={(key) => request({ key })}
            onClearSpace={(targetSpace) => request({ space: targetSpace })}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
