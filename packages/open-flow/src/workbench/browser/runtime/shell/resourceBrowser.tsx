import type { ComponentProps, FormEvent, ReactElement } from 'react'
import type { ErrorListener, Flow } from '../api.ts'
import type { WorkbenchLanguage } from '../contract.ts'
import type { OpenFlowWorkbenchProps } from '../openFlowWorkbench.tsx'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'
import type { WorkspaceBusy } from '../stores/workspaceModel.ts'

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { resourceNameIssue, resourceNameMaxLength } from '../../../../flow/common/change.ts'
import { Badge } from '../../../../ui/browser/badge.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../../ui/browser/dialog.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../../../ui/browser/dropdown-menu.tsx'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../../../ui/browser/empty.tsx'
import { Field, FieldError, FieldLabel } from '../../../../ui/browser/field.tsx'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../../../ui/browser/input-group.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Popover, PopoverContent, PopoverTitle } from '../../../../ui/browser/popover.tsx'
import { Skeleton } from '../../../../ui/browser/skeleton.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { cn } from '../../../../ui/browser/utils.ts'
import { Icon } from '../icons.tsx'
import { followWorkbenchLink } from '../navigationLink.ts'
import { IdTooltip } from './idTooltip.tsx'

const CreateResourceDialog = lazy(() => import('./createResourceDialog.tsx'))

const flowIdTooltipAlignOffset = 44
const renamePopoverAlignOffset = -12
const renamePopoverVerticalShift = 8

interface LanguageSelectProps {
  readonly language: WorkbenchLanguage
  readonly onLanguageChange?: ((language: WorkbenchLanguage) => void) | undefined
}

interface FlowItemProps {
  readonly showTeam: boolean
  readonly badge?: string | undefined
  readonly busy: WorkspaceBusy | undefined
  readonly flow: Flow
  readonly href: string
  readonly onSelect: (flow: Flow) => void
  readonly store: WorkbenchStore
}

function compactFlowId(flowId: string): string {
  return flowId.length <= 20 ? flowId : `${flowId.slice(0, 10)}…${flowId.slice(-6)}`
}

function formatUpdatedAt(updatedAt: string, locale: string): string {
  const date = new Date(updatedAt)
  const current = new Date()
  return date.toLocaleString(locale, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: date.getFullYear() == current.getFullYear() ? undefined : 'numeric',
  })
}

export function FlowDeletionImpact({
  listeners,
  failed,
  onRetry,
}: {
  readonly listeners: readonly ErrorListener[] | undefined
  readonly failed: boolean
  readonly onRetry: () => void
}) {
  const t = useTranslate()
  if (failed)
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          {t('sidebar.listenersFailed')}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('errorWorkflow.retry')}
        </Button>
      </div>
    )
  if (listeners == null)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('sidebar.listenersLoading')}
      </p>
    )
  if (listeners.length == 0) return null
  return (
    <div className="min-w-0 space-y-3 text-sm">
      <p>{t('sidebar.listenersTitle')}</p>
      <ul className="m-0 max-h-48 list-none space-y-2 overflow-y-auto p-0">
        {listeners.map((listener) => (
          <li key={`${listener.flowId}/${listener.nodeId}`} className="break-words">
            <span className="font-medium">{listener.flowName}</span> / {listener.nodeName}
            {!listener.enabled && <span className="ml-2 text-muted-foreground">{t('sidebar.listenerDisabled')}</span>}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">{t('sidebar.listenersImpact')}</p>
    </div>
  )
}

function FlowItem({ showTeam, badge, busy, flow, href, onSelect, store }: FlowItemProps): ReactElement {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const renameAnchor = useRef<HTMLSpanElement>(null)
  const actionsButton = useRef<HTMLButtonElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const cancelDelete = useRef<HTMLButtonElement>(null)
  const locale = useLang()
  const t = useTranslate()
  const [mode, setMode] = useState<'delete' | 'idle' | 'rename'>('idle')
  const [name, setName] = useState(flow.name)
  const [listeners, setListeners] = useState<readonly ErrorListener[]>()
  const [listenersFailed, setListenersFailed] = useState(false)
  const [listenersRetry, setListenersRetry] = useState(0)
  useEffect(() => {
    if (mode != 'delete') return
    const controller = new AbortController()
    setListeners(undefined)
    setListenersFailed(false)
    void store.workspace.getErrorListeners(flow.flowId, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setListeners(value)
      },
      () => {
        if (!controller.signal.aborted) setListenersFailed(true)
      },
    )
    return () => controller.abort()
  }, [mode, flow.flowId, store, listenersRetry])

  const [pending, setPending] = useState<'publish' | 'enabled' | undefined>()
  const changed = flow.live != null && flow.live.revisionId != flow.draftRevisionId
  const publicationStatus =
    flow.status == 'retiring'
      ? 'resource.retiring'
      : flow.live == null
        ? 'resource.notPublished'
        : changed
          ? 'resource.unpublishedChanges'
          : 'resource.isPublished'
  const publicationTone = flow.status == 'retiring' ? 'danger' : flow.live == null ? 'neutral' : changed ? 'running' : 'success'

  async function update(action: 'publish' | boolean): Promise<void> {
    setPending(action == 'publish' ? 'publish' : 'enabled')
    try {
      if (action == 'publish') await store.workspace.publishFlow(flow)
      else await store.workspace.setFlowEnabled(flow, action)
    } finally {
      setPending(undefined)
    }
  }
  const issue = resourceNameIssue(name)

  async function rename(event: FormEvent): Promise<void> {
    event.preventDefault()
    const nextName = name.trim()
    if (resourceNameIssue(nextName) == null && (await store.workspace.renameFlow(flow.flowId, nextName))) setMode('idle')
  }

  async function remove(): Promise<void> {
    if (await store.workspace.deleteFlow(flow.flowId)) setMode('idle')
  }

  return (
    <div className="resource-item-row" ref={setRoot}>
      <div className="resource-list-row flow-columns">
        <span className="resource-primary-cell">
          <span className="resource-primary-copy">
            <span className="resource-primary-heading">
              <a
                aria-disabled={flow.status == 'retiring'}
                className="resource-primary-title"
                onClick={(event) => {
                  if (flow.status == 'retiring') {
                    event.preventDefault()
                    return
                  }
                  followWorkbenchLink(event, () => onSelect(flow))
                }}
                href={flow.status == 'retiring' ? undefined : href}
                tabIndex={flow.status == 'retiring' ? -1 : undefined}
                title={flow.name}
              >
                <span className="resource-primary-name" ref={renameAnchor}>
                  {flow.name}
                </span>
              </a>
              {flow.status == 'active' && (
                <Popover
                  onOpenChange={(open) => {
                    setMode(open ? 'rename' : 'idle')
                    if (open) setName(flow.name)
                  }}
                  open={mode == 'rename'}
                >
                  <PopoverContent
                    align="start"
                    alignOffset={renamePopoverAlignOffset}
                    anchor={renameAnchor}
                    className="resource-rename-popover"
                    collisionBoundary={[]}
                    container={root}
                    initialFocus={nameInput}
                    finalFocus={actionsButton}
                    positionMethod="fixed"
                    side="top"
                    sideOffset={({ anchor, positioner }) => -(anchor.height + positioner.height) / 2 - renamePopoverVerticalShift}
                  >
                    <PopoverTitle className="sr-only">{t('sidebar.renameFlow', { name: flow.name })}</PopoverTitle>
                    <form className="resource-rename-form" onSubmit={(event) => void rename(event)}>
                      <Field className="min-w-0 flex-1" data-invalid={name.length > 0 && issue != null}>
                        <FieldLabel className="sr-only" htmlFor={`rename-flow-${flow.flowId}`}>
                          {t('resource.flowName')}
                        </FieldLabel>
                        <Input
                          autoComplete="off"
                          aria-invalid={name.length > 0 && issue != null}
                          aria-describedby={name.length > 0 && issue != null ? `rename-error-${flow.flowId}` : undefined}
                          id={`rename-flow-${flow.flowId}`}
                          name="flow-name"
                          onChange={(event) => setName(event.target.value)}
                          ref={nameInput}
                          required
                          value={name}
                        />
                        {name.length > 0 && issue != null && (
                          <FieldError id={`rename-error-${flow.flowId}`}>{t(`resource.nameIssue.${issue}`, { max: resourceNameMaxLength })}</FieldError>
                        )}
                      </Field>
                      <Button onClick={() => setMode('idle')} size="sm" type="button" variant="ghost">
                        {t('common.cancel')}
                      </Button>
                      <Button disabled={busy != null || issue != null} size="sm" type="submit">
                        {t('common.save')}
                      </Button>
                    </form>
                  </PopoverContent>
                </Popover>
              )}
            </span>
          </span>
        </span>
        <span className="resource-status" aria-busy={pending == 'enabled'}>
          {flow.live == null ? (
            '—'
          ) : (
            <>
              <span aria-hidden="true" className={cn('status-dot', flow.live.enabled ? 'success' : 'neutral')} />
              <span>{t(flow.live.enabled ? 'resource.enabled' : 'resource.disabled')}</span>
            </>
          )}
        </span>
        <span className="resource-flow-id-cell">
          <IdTooltip
            value={flow.flowId}
            label={compactFlowId(flow.flowId)}
            trigger={<code className="resource-flow-id" tabIndex={0} translate="no" />}
            container={root}
            alignOffset={flowIdTooltipAlignOffset}
          />
        </span>
        {showTeam && (
          <span className="resource-team-cell" title={badge}>
            {badge?.trim() ? badge : '—'}
          </span>
        )}
        <Tooltip>
          <TooltipTrigger render={<time className="resource-updated-at" dateTime={flow.updatedAt} tabIndex={0} />}>
            {formatUpdatedAt(flow.updatedAt, locale)}
          </TooltipTrigger>
          <TooltipContent align="center" collisionBoundary={[]} container={root} positionMethod="fixed" side="top" sideOffset={6}>
            {new Date(flow.updatedAt).toLocaleString(locale)}
          </TooltipContent>
        </Tooltip>
        <Badge variant="secondary" className={cn('resource-publication-status h-auto px-2.5 py-0.75', publicationTone)}>
          {t(publicationStatus)}
        </Badge>
      </div>
      <div className="resource-live-controls" aria-busy={pending != null}>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={<DropdownMenuTrigger render={<Button ref={actionsButton} aria-label={t('resource.actions')} size="icon-sm" variant="ghost" />} />}
            >
              <i aria-hidden="true" className="i-lucide-light:ellipsis" />
            </TooltipTrigger>
            <TooltipContent container={root} collisionBoundary={[]} positionMethod="fixed">
              {t('resource.actions')}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="end"
            collisionBoundary={[]}
            positionMethod="fixed"
            container={root}
            className="w-48"
            finalFocus={mode == 'idle' ? actionsButton : false}
          >
            <DropdownMenuItem disabled={flow.status != 'active'} onClick={() => onSelect(flow)}>
              <i aria-hidden="true" className="i-lucide-light:square-pen size-4 shrink-0" />
              {t('resource.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={flow.status != 'active' || busy != null || pending != null}
              onClick={() => {
                setName(flow.name)
                setMode('rename')
              }}
            >
              <i aria-hidden="true" className="i-lucide-light:text-cursor-input size-4 shrink-0" />
              {t('common.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={flow.status != 'active' || busy != null || pending != null || (flow.live != null && !changed)}
              onClick={() => void update('publish')}
            >
              <i aria-hidden="true" className="i-lucide-light:upload size-4 shrink-0" />
              {t(pending == 'publish' ? 'workspace.publishing' : flow.live == null ? 'resource.publish' : 'resource.publishUpdate')}
            </DropdownMenuItem>
            {flow.live != null && (
              <DropdownMenuItem disabled={flow.status != 'active' || busy != null || pending != null} onClick={() => void update(flow.live?.enabled != true)}>
                <i aria-hidden="true" className={cn('size-4 shrink-0', flow.live.enabled ? 'i-lucide-light:square' : 'i-lucide-light:play')} />
                {t(flow.live.enabled ? 'resource.stop' : 'resource.start')}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="mx-2 bg-border/50" />
            <DropdownMenuItem disabled={flow.status != 'active' || busy != null || pending != null} variant="destructive" onClick={() => setMode('delete')}>
              <i aria-hidden="true" className="i-lucide-light:trash-2 size-4 shrink-0" />
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog
        open={mode == 'delete'}
        onOpenChange={(open) => {
          if (!open) setMode('idle')
        }}
      >
        <DialogContent container={root} initialFocus={cancelDelete} finalFocus={actionsButton} showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('sidebar.deleteFlowConfirm', { name: flow.name })}</DialogTitle>
            <DialogDescription>{t('resource.deleteDescription')}</DialogDescription>
          </DialogHeader>
          <FlowDeletionImpact listeners={listeners} failed={listenersFailed} onRetry={() => setListenersRetry((value) => value + 1)} />
          <DialogFooter>
            <DialogClose render={<Button ref={cancelDelete} variant="outline" />}>{t('common.cancel')}</DialogClose>
            <Button disabled={busy != null || (listeners == null && !listenersFailed)} onClick={() => void remove()} variant="destructive">
              {t(busy == 'flow' ? 'common.deleting' : 'common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FlowSkeleton({ showTeam }: { readonly showTeam: boolean }): ReactElement {
  return (
    <div aria-hidden="true" className="resource-item-row">
      <div className="resource-list-row resource-skeleton-row flow-columns">
        <span className="resource-skeleton-copy">
          <Skeleton className="h-3.5 w-36 max-w-full" />
        </span>
        <Skeleton className="h-3 w-16" />
        <Skeleton className="resource-flow-id-cell h-3 w-36 max-w-full" />
        {showTeam && <Skeleton className="resource-team-cell h-3 w-24 max-w-full" />}
        <Skeleton className="resource-updated-at h-3 w-28 max-w-full" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="resource-live-controls">
        <Skeleton className="size-7" />
      </div>
    </div>
  )
}

interface FlowBrowserProps extends LanguageSelectProps {
  readonly catalogWidth?: OpenFlowWorkbenchProps['catalogWidth']
  readonly createFlowDisabled?: boolean | undefined
  readonly createFlowField?: ComponentProps<typeof CreateResourceDialog>['field']
  readonly flowBadges?: Readonly<Record<string, string>> | undefined
  readonly hrefForFlow: (flow: Flow) => string
  readonly initializing?: boolean
  readonly onCreateFlow: (name: string) => Promise<boolean>
  readonly onSelectFlow: (flow: Flow) => void
  readonly store: WorkbenchStore
}

export function FlowBrowser({
  catalogWidth,
  createFlowDisabled,
  createFlowField,
  flowBadges,
  hrefForFlow,
  initializing = false,
  onCreateFlow,
  onSelectFlow,
  store,
}: FlowBrowserProps): ReactElement {
  const t = useTranslate()
  const busy = useVal(store.workspace.$.busy)
  const loadFailed = useVal(store.workspace.$.flowLoadFailed)
  const loadMoreFailed = useVal(store.workspace.$.flowLoadMoreFailed)
  const flowLoading = useVal(store.workspace.$.flowLoading)
  const loading = initializing || flowLoading
  const loadingMore = useVal(store.workspace.$.flowLoadingMore)
  const nextCursor = useVal(store.workspace.$.flowNextCursor)
  const refreshing = useVal(store.workspace.$.flowRefreshing)
  const flows = useVal(store.workspace.$.flows)
  const total = useVal(store.workspace.$.flowTotal)
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState('')
  const [name, setName] = useState('')
  const showTeam = flows.some((flow) => (flowBadges?.[flow.flowId]?.trim().length ?? 0) > 0)
  const normalized = filter.trim().toLocaleLowerCase()
  const visible = flows.filter((flow) => flow.name.toLocaleLowerCase().includes(normalized))

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    const nextName = name.trim()
    if (resourceNameIssue(nextName) != null || !(await onCreateFlow(nextName))) return
    setCreating(false)
    setName('')
  }

  return (
    <main className="resource-browser" data-tooltip-portal>
      <div
        className={cn('resource-page', {
          'resource-page-full': catalogWidth == null || catalogWidth == 'full',
          'resource-page-embedded': catalogWidth == 'embedded',
        })}
      >
        <h1 className="sr-only">{t('resource.flows')}</h1>
        <section aria-busy={loading || refreshing} aria-labelledby="flow-list-title" className="resource-list-section rounded-lg">
          <div className="resource-list-title">
            <div className="resource-list-heading">
              <h2 id="flow-list-title">{t('resource.flows')}</h2>
              {!loading && <span>{t('resource.flowCount', { count: total ?? flows.length })}</span>}
            </div>
            <div className="resource-list-actions">
              <InputGroup className="w-full sm:w-56">
                <InputGroupAddon>
                  <Icon name="search" size={17} />
                </InputGroupAddon>
                <InputGroupInput
                  autoComplete="off"
                  aria-label={t('resource.searchByName')}
                  name="flow-search"
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={t('resource.searchByName')}
                  value={filter}
                />
              </InputGroup>
              <Button className="pr-3" disabled={initializing || busy != null} onClick={() => setCreating(true)}>
                <Icon data-icon="inline-start" name="plus" />
                {t('resource.newFlow')}
              </Button>
            </div>
          </div>
          <div className="resource-table-scroll">
            <div className={cn('resource-table', showTeam && 'resource-table-with-teams')}>
              <div aria-hidden="true" className="resource-list-columns-shell">
                <div className="resource-list-columns flow-columns">
                  <span>{t('resource.name')}</span>
                  <span>{t('resource.runtimeStatus')}</span>
                  <span className="resource-flow-id-heading">{t('resource.flowId')}</span>
                  {showTeam && <span className="resource-team-heading">{t('resource.team')}</span>}
                  <span className="resource-updated-heading">{t('resource.updated')}</span>
                  <span>{t('resource.publicationStatus')}</span>
                </div>
                <span className="resource-actions-heading">{t('resource.actions')}</span>
              </div>
              <div className="resource-list">
                {loading ? (
                  Array.from({ length: 5 }, (_, index) => <FlowSkeleton key={index} showTeam={showTeam} />)
                ) : loadFailed ? (
                  <Empty className="min-h-64" role="alert">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Icon name="alert" size={20} />
                      </EmptyMedia>
                      <EmptyTitle>{t('resource.flowsLoadFailed')}</EmptyTitle>
                      <EmptyDescription>{t('resource.flowsLoadFailedDescription')}</EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button onClick={() => void store.retryFlows()} variant="outline">
                        {t('empty.retry')}
                      </Button>
                    </EmptyContent>
                  </Empty>
                ) : visible.length == 0 ? (
                  <Empty className="min-h-64">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Icon name="flow" size={20} />
                      </EmptyMedia>
                      <EmptyTitle>{t(normalized.length == 0 ? 'resource.noFlows' : 'resource.noMatchingFlows')}</EmptyTitle>
                      <EmptyDescription>{t(normalized.length == 0 ? 'resource.noFlowsDescription' : 'resource.noMatchingDescription')}</EmptyDescription>
                    </EmptyHeader>
                    {normalized.length == 0 && (
                      <EmptyContent>
                        <Button onClick={() => setCreating(true)} variant="outline">
                          <Icon data-icon="inline-start" name="plus" />
                          {t('resource.newFlow')}
                        </Button>
                      </EmptyContent>
                    )}
                  </Empty>
                ) : (
                  visible.map((flow) => (
                    <FlowItem
                      showTeam={showTeam}
                      badge={flowBadges?.[flow.flowId]}
                      busy={busy}
                      flow={flow}
                      href={hrefForFlow(flow)}
                      key={flow.flowId}
                      onSelect={onSelectFlow}
                      store={store}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
          {nextCursor != null && (
            <div className="resource-list-footer">
              <Button disabled={loadingMore || refreshing} onClick={() => void store.workspace.loadMoreFlows()} variant="outline">
                {t(loadingMore ? 'resource.loadingMore' : loadMoreFailed ? 'resource.retryLoadMore' : 'resource.loadMore')}
              </Button>
            </div>
          )}
        </section>
        {creating && (
          <Suspense fallback={null}>
            <CreateResourceDialog
              disabled={createFlowDisabled}
              field={createFlowField}
              id="flow-name"
              issue={resourceNameIssue(name)}
              label={t('resource.flowName')}
              name={name}
              onNameChange={setName}
              onOpenChange={setCreating}
              onSubmit={(event) => void create(event)}
              pending={busy == 'flow'}
              title={t('resource.newFlow')}
            />
          </Suspense>
        )}
      </div>
    </main>
  )
}
