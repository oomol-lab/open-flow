import type { ControlClient, VariableReferences } from '@oomol-lab/open-flow/control-api'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HostTooltip,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@oomol-lab/open-flow/ui'
import { useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { routePath } from './route.ts'

export function useVariableReferences(client: ControlClient, name: string) {
  const [result, setResult] = useState<VariableReferences>()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    setResult(undefined)
    void client
      .getVariableReferences(name, controller.signal)
      .then(
        (value) => {
          if (!controller.signal.aborted) setResult(value)
        },
        () => {
          if (!controller.signal.aborted) setFailed(true)
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [client, name, attempt])
  return {
    result,
    loading,
    failed,
    retry: () => {
      setLoading(true)
      setAttempt((value) => value + 1)
    },
  }
}

export function VariableReferenceResults({
  state,
  showEmpty = true,
}: {
  readonly state: ReturnType<typeof useVariableReferences>
  readonly showEmpty?: boolean
}) {
  const t = useTranslate()
  if (state.loading)
    return (
      <p className="m-0 text-muted-foreground" role="status">
        {t('variables.referencesLoading')}
      </p>
    )
  if (state.failed)
    return (
      <div className="flex flex-col gap-2" role="alert">
        <p className="m-0">{t('variables.referencesFailed')}</p>
        <Button variant="outline" size="sm" onClick={state.retry}>
          {t('variables.retry')}
        </Button>
      </div>
    )
  const result = state.result
  if (result == null || (!showEmpty && result.references.length == 0 && result.unknown.length == 0)) return null
  return (
    <div className="variable-reference-results">
      {showEmpty && result.references.length == 0 && result.unknown.length == 0 && (
        <p className="m-0 text-muted-foreground">{t('variables.referencesEmpty')}</p>
      )}
      {result.references.length > 0 && (
        <ul>
          {result.references.map((item) => (
            <li key={item.flowId}>
              <a className="variable-reference-name" href={routePath({ flowId: item.flowId, view: item.draft ? 'design' : 'publications' })}>
                <i aria-hidden="true" className="i-lucide-light:workflow size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">{item.flowName}</span>
              </a>
              <div className="variable-reference-scopes">
                {item.draft && <a href={routePath({ flowId: item.flowId, view: 'design' })}>{t('variables.referenceDraft')}</a>}
                {item.live != null && (
                  <a href={routePath({ flowId: item.flowId, view: 'publications' })}>
                    {t('variables.referenceLive')}
                    {!item.live.enabled && ` · ${t('variables.referenceDisabled')}`}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {result.unknown.length > 0 && (
        <div role="status">
          <p className="m-0 text-muted-foreground">{t('variables.referencesIncomplete')}</p>
          <ul>
            {result.unknown.map((item) => (
              <li key={`${item.flowId}/${item.scope}`}>
                <a className="variable-reference-name" href={routePath({ flowId: item.flowId, view: item.scope == 'draft' ? 'design' : 'publications' })}>
                  <i aria-hidden="true" className="i-lucide-light:workflow size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">{item.flowName}</span>
                </a>
                <div className="variable-reference-scopes">
                  <span>{t(item.scope == 'draft' ? 'variables.referenceDraft' : 'variables.referenceLive')}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ReferenceQuery({ client, name }: { readonly client: ControlClient; readonly name: string }) {
  return <VariableReferenceResults state={useVariableReferences(client, name)} />
}

export function VariableReferencesButton({
  client,
  name,
  container,
  disabled,
}: {
  readonly client: ControlClient
  readonly name: string
  readonly container: HTMLElement | null
  readonly disabled: boolean
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <HostTooltip label={t('variables.viewReferences')}>
        <PopoverTrigger render={<Button aria-label={t('variables.viewReferences')} variant="ghost" size="icon-sm" disabled={disabled} />}>
          <i aria-hidden="true" className="i-lucide-light:link" />
        </PopoverTrigger>
      </HostTooltip>
      <PopoverContent container={container} align="end" className="variable-references-popover p-4">
        <PopoverTitle className="text-base font-semibold">{t('variables.referencesTitle', { name })}</PopoverTitle>
        {open && <ReferenceQuery client={client} name={name} />}
      </PopoverContent>
    </Popover>
  )
}

export function VariableDeletionDialog({
  client,
  name,
  container,
  pending,
  onClose,
  onDelete,
  finalFocus,
}: {
  readonly client: ControlClient
  readonly name: string
  readonly container: HTMLElement | null
  readonly finalFocus: () => HTMLButtonElement | null
  readonly pending: boolean
  readonly onClose: () => void
  readonly onDelete: () => void
}) {
  const t = useTranslate()
  const state = useVariableReferences(client, name)
  const cancel = useRef<HTMLButtonElement>(null)
  const description =
    state.loading || state.failed || state.result == null
      ? undefined
      : state.result.references.length > 0
        ? 'variables.deleteReferencesImpact'
        : state.result.unknown.length == 0
          ? 'variables.deleteUnreferenced'
          : undefined
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent container={container} closeLabel={t('variables.cancel')} initialFocus={cancel} finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{t('variables.deleteConfirm', { name })}</DialogTitle>
          {description != null && <DialogDescription>{t(description)}</DialogDescription>}
        </DialogHeader>
        <VariableReferenceResults state={state} showEmpty={false} />
        <DialogFooter>
          <Button ref={cancel} variant="outline" disabled={pending} onClick={onClose}>
            {t('variables.cancel')}
          </Button>
          <Button variant="destructive" disabled={pending || state.loading} onClick={onDelete}>
            {t('variables.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
