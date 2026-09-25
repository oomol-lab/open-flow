import type { ReactElement, ReactNode } from 'react'
import type { ConnectorConnection } from '../api.ts'
import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../../../ui/browser/dialog.tsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '../../../../ui/browser/empty.tsx'
import { ScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/browser/tooltip.tsx'
import { connectionCatalog } from '../connectionCatalog.ts'
import { providerIcon } from '../providerIcon.ts'
import { ActionPicker } from './actionPicker.tsx'
import { AccountControlButton, AccountSelect } from './connectionSettings.tsx'
import { ProviderAppIcon } from './providerAppIcon.tsx'

export interface SelectedAction {
  readonly id?: string
  readonly action: string
  readonly connectionId?: string
}
export type PreparedAction = { readonly action: ConnectorActionView; readonly connections: readonly ConnectorConnection[] }
export type PrepareAction = (action: ConnectorActionView) => Promise<PreparedAction | undefined>

export interface ActionDetailsProps<T> {
  readonly entry: T
  readonly onChange: (entry: T) => void
  readonly disabled: boolean
  readonly portalRoot: HTMLElement | null
  readonly onValidChange: (key: string, valid: boolean) => void
}

export function ActionSelectionDialog<T extends SelectedAction>({
  title,
  entries,
  connectors,
  prepareAction,
  disabled,
  createEntry,
  onSave,
  renderDetails,
  trigger,
  triggerHint,
}: {
  readonly triggerHint?: string
  readonly trigger?: ReactElement<{ children?: ReactNode }>
  readonly title: string
  readonly entries: readonly T[]
  readonly connectors: ConnectorStore
  readonly prepareAction?: PrepareAction
  readonly disabled: boolean
  readonly createEntry: (action: ConnectorActionView) => T
  readonly onSave: (entries: readonly T[]) => Promise<boolean>
  readonly renderDetails?: (props: ActionDetailsProps<T>) => ReactNode
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [pending, setPending] = useState(false)
  const portal = useCallback(
    (element: HTMLSpanElement | null) =>
      setRoot(element?.closest<HTMLElement>('.open-flow-workbench') ?? element?.closest<HTMLElement>('.open-flow-theme') ?? null),
    [],
  )
  return (
    <span className={trigger == null ? 'flex flex-col' : 'inline-flex min-w-0 shrink-0 flex-col'} ref={portal}>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next)
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <DialogTrigger
                render={trigger ?? <Button type="button" variant="outline" size="xs" />}
                disabled={disabled}
                aria-label={`${title} · ${entries.length}`}
              >
                {trigger?.props.children ?? `${title} · ${entries.length}`}
              </DialogTrigger>
            }
          />
          <TooltipContent container={root}>{triggerHint ?? `${title} · ${entries.length}`}</TooltipContent>
        </Tooltip>
        <DialogContent
          container={root}
          closeLabel={t('common.close')}
          className="flex h-[min(640px,85dvh)] flex-col gap-0 overflow-hidden p-0 text-[13px] leading-5 font-normal sm:max-w-[min(46rem,calc(100%-2rem))]"
          showCloseButton={!pending}
        >
          <DialogTitle className="px-4 py-3 text-[13px] leading-5 font-medium">{title}</DialogTitle>
          <div className="mx-4 h-px shrink-0 bg-border/50" />
          <DialogDescription className="m-0 shrink-0 px-4 pt-3 text-[13px] leading-5">{t('actionPicker.description')}</DialogDescription>
          <ActionSelectionEditor
            entries={entries}
            connectors={connectors}
            prepareAction={prepareAction}
            disabled={disabled || pending}
            createEntry={createEntry}
            renderDetails={renderDetails}
            onCancel={() => setOpen(false)}
            onSave={async (next) => {
              setPending(true)
              try {
                const saved = await onSave(next)
                if (saved) setOpen(false)
                return saved
              } finally {
                setPending(false)
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </span>
  )
}

function ActionSelectionEditor<T extends SelectedAction>({
  entries,
  connectors,
  prepareAction,
  disabled,
  createEntry,
  onSave,
  onCancel,
  renderDetails,
}: {
  readonly entries: readonly T[]
  readonly connectors: ConnectorStore
  readonly prepareAction?: PrepareAction
  readonly disabled: boolean
  readonly createEntry: (action: ConnectorActionView) => T
  readonly onSave: (entries: readonly T[]) => Promise<boolean>
  readonly onCancel: () => void
  readonly renderDetails?: (props: ActionDetailsProps<T>) => ReactNode
}) {
  const t = useTranslate()
  const [draft, setDraft] = useState(entries)
  const [initialEntries] = useState(entries)
  // Presentation only: saving always uses draft in its original selection order.
  const [displayOrder, setDisplayOrder] = useState<readonly string[] | null>(entries.length === 0 ? [] : null)
  const [prepared, setPrepared] = useState<Readonly<Record<string, PreparedAction | undefined>>>({})
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const [preparationErrors, setPreparationErrors] = useState<Readonly<Record<string, string | undefined>>>({})
  const discovered = useRef(new Map<string, ConnectorActionView>())
  const newEntries = useRef(new Set<string>())
  const requests = useRef(new Map<string, Promise<PreparedAction | undefined>>())
  const createRef = useRef(createEntry)
  createRef.current = createEntry
  const [refreshing, setRefreshing] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const selectedHeading = useRef<HTMLHeadingElement>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const preparedRef = useRef(prepared)
  preparedRef.current = prepared
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set())
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const prepareRef = useRef(prepareAction)
  prepareRef.current = prepareAction
  const actionIds = JSON.stringify([...new Set(draft.map((entry) => entry.action))])
  useEffect(() => {
    const controller = new AbortController()
    for (const id of JSON.parse(actionIds) as string[]) {
      if (preparedRef.current[id] != null) continue
      setPreparationErrors((current) => ({ ...current, [id]: undefined }))
      let request = requests.current.get(id)
      if (request == null) {
        request = (async () => {
          let action = discovered.current.get(id)
          if (prepareRef.current == null) return connectors.resolveAction(id)
          if (action == null) {
            await connectors.loadCodeAction(id, new AbortController().signal)
            action = connectors.$.actions.value[id]
          }
          if (action == null) throw new Error(t('actionPicker.failed'))
          discovered.current.set(id, action)
          return prepareRef.current(action)
        })()
        requests.current.set(id, request)
      }
      void request
        .then((result) => {
          if (controller.signal.aborted) return
          if (result == null) throw new Error(t('actionPicker.failed'))
          setPrepared((current) => ({ ...current, [id]: result }))
          if (newEntries.current.delete(id)) {
            const entry = createRef.current(result.action)
            const preferred = result.action.authenticated ? connectionCatalog(result.connections).preferred : undefined
            setDraft((current) =>
              current.map((item) => (item.action === id ? (preferred == null ? entry : { ...entry, connectionId: preferred.connectionId }) : item)),
            )
          }
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return
          requests.current.delete(id)
          setPreparationErrors((current) => ({ ...current, [id]: cause instanceof Error ? cause.message : String(cause) }))
        })
    }
    return () => controller.abort()
  }, [connectors, actionIds, attempt, t])
  const preparing = draft.some((entry) => prepared[entry.action] == null)
  const replace = (index: number, entry: T) => setDraft((current) => current.map((item, i) => (i == index ? entry : item)))
  const valid = invalid.size == 0
  useLayoutEffect(() => {
    if (displayOrder != null) return
    // If editing starts before initial loading settles, keep the visible order.
    if (draft !== initialEntries) {
      setDisplayOrder(initialEntries.map((entry) => entry.action))
      return
    }
    if (initialEntries.some((entry) => prepared[entry.action] == null && preparationErrors[entry.action] == null)) return
    const priority = (entry: T) => {
      if (preparationErrors[entry.action] != null) return 0
      const resolved = prepared[entry.action]
      if (!resolved?.action.authenticated) return 2
      if (entry.connectionId == null) return 1
      return resolved.connections.some((account) => account.connectionId === entry.connectionId && account.status === 'active') ? 2 : 0
    }
    setDisplayOrder(initialEntries.toSorted((a, b) => priority(a) - priority(b)).map((entry) => entry.action))
  }, [displayOrder, draft, initialEntries, prepared, preparationErrors])
  const ranks = new Map(displayOrder?.map((id, index) => [id, index]))
  const sortedEntries = draft
    .map((entry, index) => ({ entry, index }))
    .toSorted((a, b) => (ranks.get(a.entry.action) ?? Infinity) - (ranks.get(b.entry.action) ?? Infinity))
  const remove = (index: number) => setDraft((current) => current.filter((_, i) => i != index))
  const refresh = async () => {
    setDisplayOrder((current) => current ?? draft.map((entry) => entry.action))
    setRefreshing(true)
    setError(undefined)
    const controller = new AbortController()
    try {
      const services = new Set(
        draft.flatMap((entry) => {
          const action = prepared[entry.action]?.action
          return action?.authenticated ? [action.serviceId] : []
        }),
      )
      await Promise.all([...services].map((service) => connectors.loadCodeConnections(service, controller.signal, true)))
      if (!mounted.current) return
      requests.current.clear()
      preparedRef.current = {}
      setPrepared({})
      setAttempt((value) => value + 1)
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setRefreshing(false)
      controller.abort()
    }
  }
  return (
    <>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-y-4 py-4 sm:grid-cols-2">
        <ActionPicker
          connectors={connectors}
          portalRoot={portalRoot}
          disabled={disabled}
          selected={draft.map((entry) => entry.action)}
          onToggle={(action) => {
            const index = draft.findIndex((entry) => entry.action == action.actionId)
            if (index >= 0) {
              remove(index)
              return
            }
            discovered.current.set(action.actionId, action)
            newEntries.current.add(action.actionId)
            // Selection is immediate; each row prepares independently in the effect above.
            setDraft((current) => [...current, createEntry(action)])
            // A cached result still needs to initialize a newly selected entry.
            setPrepared((current) => ({ ...current, [action.actionId]: undefined }))
          }}
        />
        <div ref={setPortalRoot} className="flex min-h-0 min-w-0 flex-col gap-2 sm:border-l sm:border-border/50">
          <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-4">
            <h3 ref={selectedHeading} tabIndex={-1} className="m-0 text-[13px] font-normal text-muted-foreground outline-none">
              {t('actionPicker.selected', { count: draft.length })}
            </h3>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={disabled || refreshing || !draft.some((entry) => prepared[entry.action]?.action.authenticated)}
                    aria-label={t('actionPicker.refresh')}
                    onClick={() => void refresh()}
                  >
                    {refreshing ? <Spinner /> : <i aria-hidden="true" className="i-lucide-light:rotate-cw size-4 text-muted-foreground" />}
                  </Button>
                }
              />
              <TooltipContent container={portalRoot}>{t('actionPicker.refresh')}</TooltipContent>
            </Tooltip>
          </div>
          {draft.length == 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <i aria-hidden="true" className="i-lucide-light:list-checks size-4" />
                </EmptyMedia>
                <EmptyDescription className="text-[13px]">{t('actionPicker.empty')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col divide-y divide-border/50 px-4">
                {sortedEntries.map(({ entry, index }) => {
                  const resolved = prepared[entry.action]
                  const action = resolved?.action ?? discovered.current.get(entry.action) ?? connectors.$.actions.value[entry.action]
                  const accounts = resolved?.connections ?? []
                  const selected = accounts.find((account) => account.connectionId == entry.connectionId)
                  const accountInvalid = action?.authenticated && entry.connectionId != null && selected?.status != 'active'
                  return (
                    <section
                      key={entry.id ?? entry.action}
                      className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1 py-4 first:pt-1 last:pb-1"
                    >
                      <div className="contents">
                        <ProviderAppIcon src={action == null ? undefined : providerIcon(action)} />
                        <div className="col-start-2 min-h-10 min-w-0">
                          <h4 className="m-0 truncate text-[13px] font-medium" title={action?.name ?? entry.action}>
                            {action?.name ?? entry.action}
                          </h4>
                          {action != null && <div className="truncate text-xs leading-5 text-muted-foreground">{action.serviceName}</div>}
                        </div>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                disabled={disabled}
                                aria-label={t('actionPicker.remove', { action: action?.name ?? entry.action })}
                                onClick={() => {
                                  remove(index)
                                  selectedHeading.current?.focus()
                                }}
                              >
                                <i aria-hidden="true" className="i-lucide-light:trash-2 size-4 text-muted-foreground" />
                              </Button>
                            }
                          />
                          <TooltipContent container={portalRoot}>{t('actionPicker.remove', { action: action?.name ?? entry.action })}</TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="open-flow-property-panel col-start-2 flex min-h-[30px] min-w-0 items-center [&>*]:w-full">
                        {resolved == null ? (
                          preparationErrors[entry.action] != null ? (
                            <AccountControlButton
                              status="danger"
                              disabled={disabled}
                              label={t('inspector.account.retry')}
                              hint={preparationErrors[entry.action]}
                              onClick={() => setAttempt((value) => value + 1)}
                            />
                          ) : (
                            <AccountSelect loading connections={[]} disabled={disabled} onChange={() => {}} onManage={undefined} />
                          )
                        ) : !resolved.action.authenticated ? (
                          <div className="text-muted-foreground">{t('actionPicker.noAccount')}</div>
                        ) : (
                          <AccountSelect
                            connections={accounts.filter((account) => account.status == 'active')}
                            selectedConnection={selected}
                            selectedId={entry.connectionId}
                            invalid={accountInvalid === true}
                            warning={entry.connectionId == null}
                            addWhenEmpty
                            label={t('actionPicker.accountFor', { action: resolved.action.name })}
                            disabled={disabled}
                            onChange={(connectionId) => {
                              const { connectionId: _previous, ...rest } = entry
                              replace(index, (connectionId == null ? rest : { ...rest, connectionId }) as T)
                            }}
                            onManage={() => void connectors.connect(resolved.action.serviceId).catch((cause: unknown) => setError(String(cause)))}
                          />
                        )}
                      </div>
                      {renderDetails != null && resolved == null && <div aria-hidden="true" className="col-span-3 h-7" />}
                      {renderDetails != null && resolved != null && (
                        <details className="group/action-details col-span-3">
                          <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md py-1 text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                            <i aria-hidden="true" className="i-lucide-light:chevron-right size-3.5 group-open/action-details:rotate-90" />
                            {t('actionPicker.details')}
                          </summary>
                          <div className="pt-2">
                            {renderDetails({
                              entry,
                              onChange: (next) => replace(index, next),
                              disabled,
                              portalRoot,
                              onValidChange: (key, value) =>
                                setInvalid((current) => {
                                  const next = new Set(current)
                                  if (value) next.delete(key)
                                  else next.add(key)
                                  return next
                                }),
                            })}
                          </div>
                        </details>
                      )}
                    </section>
                  )
                })}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
      {(error != null || (attempted && !valid)) && (
        <div role="alert" className="flex items-center gap-2 px-4 pb-3 text-destructive">
          <span>{error ?? t('agent.invalidValues')}</span>
        </div>
      )}
      <div className="mx-4 h-px shrink-0 bg-border/50" />
      <div className="flex shrink-0 items-center justify-end gap-2 px-4 py-3">
        <Button type="button" size="sm" variant="ghost" className="text-[13px] font-normal" disabled={disabled} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          className="text-[13px] font-normal"
          disabled={disabled || preparing || refreshing}
          onClick={async () => {
            setAttempted(true)
            if (!valid) return
            setError(undefined)
            try {
              if (!(await onSave(draft))) setError(t('inspector.task.permissionSaveFailed'))
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause))
            }
          }}
        >
          {t('common.save')}
        </Button>
      </div>
    </>
  )
}
