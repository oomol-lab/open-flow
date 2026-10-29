import type { ReactElement, ReactNode } from 'react'
import type { WorkflowCapability } from '../../../../flow/common/change.ts'
import type { ConnectorConnection } from '../api.ts'
import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { SetNotice } from '../stores/workbenchNotice.ts'
import type { WorkflowToolSelection } from './workflowToolSelection.tsx'

import { dequal } from 'dequal/lite'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../../../../ui/browser/dialog.tsx'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '../../../../ui/browser/empty.tsx'
import { Popover, PopoverTrigger, PopoverPanelContent } from '../../../../ui/browser/popover.tsx'
import { ScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/browser/tooltip.tsx'
import { connectionCatalog } from '../connectionCatalog.ts'
import { providerIcon } from '../providerIcon.ts'
import { errorNotice } from '../stores/workbenchNotice.ts'
import { ActionPicker } from './actionPicker.tsx'
import { AccountControlButton, AccountSelect } from './connectionSettings.tsx'
import { ProviderAppIcon } from './providerAppIcon.tsx'
import { SelectedToolRow } from './selectedToolRow.tsx'
import { WorkflowToolPicker, SelectedWorkflowTool } from './workflowToolSelection.tsx'

export interface SelectedAction {
  readonly kind?: 'connector'
  readonly id?: string
  readonly action: string
  readonly connectionId?: string
}
export type SelectedTool = SelectedAction | (WorkflowCapability & { readonly id?: string; readonly action?: never; readonly connectionId?: never })
function entryKey(entry: SelectedTool): string {
  return entry.kind == 'workflow' ? `workflow:${entry.flowId}` : entry.action
}

export type PreparedAction = { readonly action: ConnectorActionView; readonly connections: readonly ConnectorConnection[] }
export type PrepareAction = (action: ConnectorActionView) => Promise<PreparedAction | undefined>

export interface ActionSettingsProps<T> {
  readonly entry: T
  readonly onChange: (entry: T) => void
  readonly disabled: boolean
  readonly onValidChange: (key: string, valid: boolean) => void
}

interface ActionSettings<T> {
  readonly title: string
  readonly render: (props: ActionSettingsProps<T>) => ReactNode
}

export function ActionSelectionDialog<T extends SelectedTool>({
  title,
  entries,
  connectors,
  prepareAction,
  workflows,
  disabled,
  createEntry,
  onSave,
  notify,
  settings,
  trigger,
  triggerHint,
}: {
  readonly triggerHint?: string
  readonly trigger?: ReactElement<{ children?: ReactNode }>
  readonly title: string
  readonly entries: readonly T[]
  readonly connectors: ConnectorStore
  readonly prepareAction?: PrepareAction
  readonly workflows?: WorkflowToolSelection<T>
  readonly disabled: boolean
  readonly createEntry: (action: ConnectorActionView) => T
  readonly notify: SetNotice
  readonly onSave: (entries: readonly T[]) => Promise<boolean>
  readonly settings?: ActionSettings<T>
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [pending, setPending] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const requestClose = () => {
    if (pending) return
    if (dirty) setConfirmDiscard(true)
    else setOpen(false)
  }
  useEffect(() => {
    if (!open || (!dirty && !pending)) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [open, dirty, pending])
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
          if (!next) requestClose()
          else {
            setDirty(false)
            setConfirmDiscard(false)
            setOpen(true)
          }
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
          className="flex h-[min(640px,85dvh)] flex-col gap-0 p-0 text-[13px] leading-5 font-normal sm:max-w-[min(46rem,calc(100%-2rem))]"
          showCloseButton={!pending}
        >
          <DialogTitle className="px-4 py-3 text-[13px] leading-5 font-medium">{title}</DialogTitle>
          <div className="mx-4 h-px shrink-0 bg-border/50" />
          <DialogDescription className="m-0 shrink-0 px-4 pt-3 text-[13px] leading-5">{t('actionPicker.description')}</DialogDescription>
          <ActionSelectionEditor
            notify={notify}
            entries={entries}
            connectors={connectors}
            prepareAction={prepareAction}
            workflows={workflows}
            disabled={disabled || pending}
            createEntry={createEntry}
            settings={settings}
            onDirtyChange={setDirty}
            onCancel={requestClose}
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
          <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
            <DialogContent container={root} className="gap-6 p-6" showCloseButton={false}>
              <DialogHeader className="gap-2">
                <DialogTitle className="leading-6">{t('actionPicker.discardTitle')}</DialogTitle>
                <DialogDescription className="leading-6">{t('actionPicker.discardDescription')}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => setConfirmDiscard(false)}>
                  {t('actionPicker.continueEditing')}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setConfirmDiscard(false)
                    setOpen(false)
                  }}
                >
                  {t('actionPicker.discardChanges')}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>
    </span>
  )
}

function ActionSelectionEditor<T extends SelectedTool>({
  entries,
  connectors,
  prepareAction,
  workflows,
  disabled,
  createEntry,
  onSave,
  notify,
  onCancel,
  onDirtyChange,
  settings,
}: {
  readonly entries: readonly T[]
  readonly connectors: ConnectorStore
  readonly prepareAction?: PrepareAction
  readonly workflows?: WorkflowToolSelection<T>
  readonly disabled: boolean
  readonly createEntry: (action: ConnectorActionView) => T
  readonly notify: SetNotice
  readonly onSave: (entries: readonly T[]) => Promise<boolean>
  readonly onCancel: () => void
  readonly onDirtyChange: (dirty: boolean) => void
  readonly settings?: ActionSettings<T>
}) {
  const t = useTranslate()
  const [draft, setDraft] = useState(entries)
  const [category, setCategory] = useState<'connectors' | 'workflows'>('connectors')
  const [workflowPending, setWorkflowPending] = useState(false)
  const actions = useVal(connectors.$.actions)
  const connections = useVal(connectors.$.connections)
  const [initialEntries] = useState(entries)
  // Presentation only: saving always uses draft in its original selection order.
  const [displayOrder, setDisplayOrder] = useState<readonly string[] | null>(entries.length === 0 ? [] : null)
  const [prepared, setPrepared] = useState<Readonly<Record<string, PreparedAction | undefined>>>({})
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
  const dirty = workflowPending || invalid.size > 0 || !dequal(draft, initialEntries)
  useLayoutEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const prepareRef = useRef(prepareAction)
  prepareRef.current = prepareAction
  const actionIds = JSON.stringify([...new Set(draft.filter((entry) => entry.kind != 'workflow').map(entryKey))])
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
  const preparing = workflowPending || draft.some((entry) => entry.kind != 'workflow' && prepared[entry.action] == null)
  const replace = (index: number, entry: T) => setDraft((current) => current.map((item, i) => (i == index ? entry : item)))
  const valid = invalid.size == 0
  useLayoutEffect(() => {
    if (displayOrder != null) return
    // If editing starts before initial loading settles, keep the visible order.
    if (draft !== initialEntries) {
      setDisplayOrder(initialEntries.map(entryKey))
      return
    }
    if (initialEntries.some((entry) => entry.kind != 'workflow' && prepared[entry.action] == null && preparationErrors[entry.action] == null)) return
    const priority = (entry: T) => {
      if (entry.kind == 'workflow') return 2
      if (preparationErrors[entry.action] != null) return 0
      const resolved = prepared[entry.action]
      if (!resolved?.action.authenticated) return 2
      if (entry.connectionId === '') return 2
      if (entry.connectionId == null) return 1
      return resolved.connections.some((account) => account.connectionId === entry.connectionId && account.status === 'active') ? 2 : 0
    }
    setDisplayOrder(initialEntries.toSorted((a, b) => priority(a) - priority(b)).map(entryKey))
  }, [displayOrder, draft, initialEntries, prepared, preparationErrors])
  const ranks = new Map(displayOrder?.map((id, index) => [id, index]))
  const sortedEntries = draft
    .map((entry, index) => ({ entry, index }))
    .toSorted((a, b) => (ranks.get(entryKey(a.entry)) ?? Infinity) - (ranks.get(entryKey(b.entry)) ?? Infinity))
  const remove = (index: number) => {
    const entry = draft[index]!
    const prefix = `${entry.id ?? entryKey(entry)}:`
    setInvalid((current) => new Set([...current].filter((key) => !key.startsWith(prefix))))
    setDraft((current) => current.filter((_, i) => i != index))
    selectedHeading.current?.focus()
  }
  const refresh = async () => {
    setDisplayOrder((current) => current ?? draft.filter((entry) => entry.kind != 'workflow').map(entryKey))
    setRefreshing(true)
    const controller = new AbortController()
    try {
      const services = new Set(
        draft.flatMap((entry) => {
          if (entry.kind == 'workflow') return []
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
      if (mounted.current) notify(errorNotice(cause, t))
    } finally {
      if (mounted.current) setRefreshing(false)
      controller.abort()
    }
  }
  const renderSettings = (entry: T, index: number, name: string, ready = true) =>
    settings == null ? undefined : (
      <Popover>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger render={<Button type="button" size="icon-sm" variant="ghost" disabled={disabled} aria-label={`${settings.title} · ${name}`} />} />
            }
          >
            <i aria-hidden="true" className="i-lucide-light:settings size-4 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent container={portalRoot}>{settings.title}</TooltipContent>
        </Tooltip>
        <PopoverPanelContent
          keepMounted
          container={portalRoot}
          title={settings.title}
          closeLabel={t('common.close')}
          className="open-flow-property-panel w-96"
          footer={
            <Button type="button" size="field" variant="destructive" className="ml-auto" disabled={disabled} onClick={() => remove(index)}>
              {t('valueEditor.remove')}
            </Button>
          }
        >
          {settings.render({
            entry,
            onChange: (next) => replace(index, next),
            disabled: disabled || !ready,
            onValidChange: (key, value) =>
              setInvalid((current) => {
                const identity = `${entry.id ?? entryKey(entry)}:${key}`
                if (current.has(identity) === !value) return current
                const next = new Set(current)
                if (value) next.delete(identity)
                else next.add(identity)
                return next
              }),
          })}
        </PopoverPanelContent>
      </Popover>
    )
  return (
    <>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-y-4 py-4 sm:grid-cols-2">
        <div className="flex min-h-0 flex-col gap-3">
          {workflows && (
            <div className="flex gap-1 px-4" role="group" aria-label={t('toolPicker.type')}>
              {(['connectors', 'workflows'] as const).map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  variant={category == kind ? 'secondary' : 'ghost'}
                  aria-pressed={category == kind}
                  onClick={() => setCategory(kind)}
                >
                  {t(`toolPicker.${kind}`)}
                </Button>
              ))}
            </div>
          )}
          {category == 'workflows' && workflows ? (
            <WorkflowToolPicker
              list={workflows.list}
              disabled={disabled || workflowPending}
              selected={draft.flatMap((entry) => (entry.kind == 'workflow' ? [entry.flowId] : []))}
              onToggle={async (candidate) => {
                const index = draft.findIndex((entry) => entry.kind == 'workflow' && entry.flowId == candidate.flowId)
                if (index >= 0) {
                  remove(index)
                  return
                }
                setWorkflowPending(true)
                try {
                  let target = candidate as Parameters<typeof workflows.create>[0]
                  if (candidate.problem == null) {
                    try {
                      target = await workflows.load(candidate.flowId)
                    } catch (cause) {
                      if (mounted.current) notify(errorNotice(cause, t))
                    }
                  }
                  if (mounted.current) setDraft((current) => [...current, workflows.create(target, current)])
                } finally {
                  if (mounted.current) setWorkflowPending(false)
                }
              }}
            />
          ) : (
            <ActionPicker
              connectors={connectors}
              portalRoot={portalRoot}
              disabled={disabled}
              selected={draft.flatMap((entry) => (entry.kind != 'workflow' ? [entry.action] : []))}
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
          )}
        </div>
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
                    disabled={disabled || refreshing || !draft.some((entry) => entry.kind != 'workflow' && prepared[entry.action]?.action.authenticated)}
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
                  if (entry.kind == 'workflow')
                    return (
                      <SelectedWorkflowTool
                        key={entry.id ?? entryKey(entry)}
                        entry={entry}
                        disabled={disabled}
                        load={workflows?.load}
                        onChange={(name) => replace(index, { ...entry, name })}
                        portalRoot={portalRoot}
                        onRemove={() => remove(index)}
                        onRefresh={(contract) => {
                          if (workflows) replace(index, workflows.refresh(entry, contract))
                        }}
                      >
                        {renderSettings(entry, index, entry.name)}
                      </SelectedWorkflowTool>
                    )
                  const resolved = prepared[entry.action]
                  const action = resolved?.action ?? discovered.current.get(entry.action) ?? actions[entry.action]
                  const accounts = resolved?.connections ?? []
                  const selected = connections.find((account) => account.connectionId == entry.connectionId)
                  const accountInvalid =
                    resolved != null &&
                    action?.authenticated &&
                    entry.connectionId != null &&
                    entry.connectionId !== '' &&
                    !accounts.some((account) => account.connectionId == entry.connectionId && account.status == 'active')
                  return (
                    <SelectedToolRow
                      key={entry.id ?? entry.action}
                      icon={<ProviderAppIcon src={action == null ? undefined : providerIcon(action)} />}
                      title={action?.name ?? entry.action}
                      subtitle={
                        <span className="truncate">
                          {t('toolPicker.connectors')}
                          {action == null ? '' : ` · ${action.serviceName}`}
                        </span>
                      }
                      actions={
                        settings ? (
                          renderSettings(entry, index, action?.name ?? entry.action, resolved != null)
                        ) : (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  disabled={disabled}
                                  aria-label={t('actionPicker.remove', { action: action?.name ?? entry.action })}
                                  onClick={() => remove(index)}
                                >
                                  <i aria-hidden="true" className="i-lucide-light:trash-2 size-4 text-muted-foreground" />
                                </Button>
                              }
                            />
                            <TooltipContent container={portalRoot}>{t('actionPicker.remove', { action: action?.name ?? entry.action })}</TooltipContent>
                          </Tooltip>
                        )
                      }
                    >
                      <div className="open-flow-property-panel flex min-h-[30px] min-w-0 items-center [&>*]:w-full">
                        {resolved == null && preparationErrors[entry.action] != null ? (
                          <AccountControlButton
                            status="danger"
                            disabled={disabled}
                            label={t('inspector.account.retry')}
                            hint={preparationErrors[entry.action]}
                            onClick={() => {
                              connectors.retryAction(entry.action)
                              setAttempt((value) => value + 1)
                            }}
                          />
                        ) : action?.authenticated === false ? (
                          <div className="text-muted-foreground">{t('actionPicker.noAccount')}</div>
                        ) : (
                          <AccountSelect
                            loading={resolved == null}
                            connections={accounts.filter((account) => account.status == 'active')}
                            selectedConnection={selected}
                            selectedId={entry.connectionId}
                            invalid={accountInvalid === true}
                            warning={entry.connectionId == null}
                            allowDeferred
                            label={t('actionPicker.accountFor', { action: action?.name ?? entry.action })}
                            disabled={disabled}
                            onChange={(connectionId) => {
                              const { connectionId: _previous, ...rest } = entry
                              replace(index, (connectionId == null ? rest : { ...rest, connectionId }) as T)
                            }}
                            onManage={resolved == null ? undefined : () => void connectors.connect(resolved.action.serviceId)}
                          />
                        )}
                      </div>
                    </SelectedToolRow>
                  )
                })}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
      {attempted && !valid && (
        <div role="alert" className="flex items-center gap-2 px-4 pb-3 text-destructive">
          <span>{t('agent.invalidValues')}</span>
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
            try {
              await onSave(draft)
            } catch (cause) {
              notify(errorNotice(cause, t))
            }
          }}
        >
          {t('common.save')}
        </Button>
      </div>
    </>
  )
}
