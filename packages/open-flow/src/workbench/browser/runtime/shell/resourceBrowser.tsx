import type { ComponentProps, FormEvent, MouseEvent, ReactElement } from 'react'
import type { Flow } from '../api.ts'
import type { WorkbenchLanguage } from '../contract.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'
import type { WorkspaceBusy } from '../stores/workspaceModel.ts'

import { lazy, Suspense, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { resourceNameIssue, resourceNameMaxLength } from '../../../../flow/common/change.ts'
import { uiLanguageNames, uiLanguages } from '../../../../localization/common/languages.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../../ui/browser/dialog.tsx'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../../../ui/browser/empty.tsx'
import { Field, FieldError, FieldLabel } from '../../../../ui/browser/field.tsx'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../../../ui/browser/input-group.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../../../../ui/browser/popover.tsx'
import { Skeleton } from '../../../../ui/browser/skeleton.tsx'
import { Switch } from '../../../../ui/browser/switch.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { cn } from '../../../../ui/browser/utils.ts'
import { Icon } from '../icons.tsx'
import { followWorkbenchLink } from '../navigationLink.ts'
import { HostMenu } from './hostMenu.tsx'
import { WorkbenchSelect } from './workbenchSelect.tsx'

const CreateResourceDialog = lazy(() => import('./createResourceDialog.tsx'))

const languageOptions = uiLanguages.map((language) => ({ label: uiLanguageNames[language], value: language }))
const flowIdTooltipAlignOffset = 44
const renamePopoverAlignOffset = -12
const renamePopoverVerticalShift = 8
const rowControlSelector = 'a, button, input, select, textarea, [data-slot="tooltip-trigger"]'

interface LanguageSelectProps {
  readonly language: WorkbenchLanguage
  readonly onLanguageChange?: ((language: WorkbenchLanguage) => void) | undefined
}

export function LanguageSelect({ language, onLanguageChange }: LanguageSelectProps): ReactElement | null {
  const t = useTranslate()
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null)
  if (onLanguageChange == null) return null
  return (
    <div className="resource-language" ref={setPortalRoot}>
      <span className="sr-only">{t('language.label')}</span>
      <WorkbenchSelect
        ariaLabel={t('language.label')}
        onValueChange={(value) => onLanguageChange(value as WorkbenchLanguage)}
        options={languageOptions}
        portalRoot={portalRoot}
        value={language}
      />
    </div>
  )
}

interface FlowItemProps {
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

function clickedRowControl(event: MouseEvent<HTMLDivElement>): boolean {
  return event.target instanceof Element && event.target.closest(rowControlSelector) != null
}

function FlowItem({ badge, busy, flow, href, onSelect, store }: FlowItemProps): ReactElement {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const renameAnchor = useRef<HTMLSpanElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const cancelDelete = useRef<HTMLButtonElement>(null)
  const locale = useLang()
  const t = useTranslate()
  const [mode, setMode] = useState<'delete' | 'idle' | 'rename'>('idle')
  const [name, setName] = useState(flow.name)
  const [copied, setCopied] = useState(false)
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

  function openFromRow(event: MouseEvent<HTMLDivElement>): void {
    if (!clickedRowControl(event)) onSelect(flow)
  }

  return (
    <div className="resource-item-row" ref={setRoot}>
      <div className="resource-list-row flow-columns" onClick={openFromRow}>
        <span className="resource-primary-cell">
          <span aria-hidden="true" className="resource-flow-icon">
            <i className="i-lucide-light:workflow" />
          </span>
          <span className="resource-primary-copy">
            <span className="resource-primary-heading" ref={renameAnchor}>
              <Button
                aria-disabled={flow.status == 'retiring'}
                className="resource-primary-title"
                nativeButton={false}
                onClick={(event) => {
                  if (flow.status == 'retiring') {
                    event.preventDefault()
                    return
                  }
                  followWorkbenchLink(event, () => onSelect(flow))
                }}
                render={<a href={flow.status == 'retiring' ? undefined : href} />}
                tabIndex={flow.status == 'retiring' ? -1 : undefined}
                title={flow.name}
                variant="link"
              >
                {flow.name}
              </Button>
              {flow.status == 'active' && (
                <Popover
                  onOpenChange={(open) => {
                    setMode(open ? 'rename' : 'idle')
                    if (open) setName(flow.name)
                  }}
                  open={mode == 'rename'}
                >
                  <PopoverTrigger
                    render={
                      <Button
                        aria-label={t('sidebar.renameFlow', { name: flow.name })}
                        className="resource-rename-trigger"
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      />
                    }
                  >
                    <i aria-hidden="true" className="i-lucide-light:pencil" />
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    alignOffset={renamePopoverAlignOffset}
                    anchor={renameAnchor}
                    className="resource-rename-popover"
                    collisionBoundary={[]}
                    container={root}
                    initialFocus={nameInput}
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
            {badge != null && (
              <span className="resource-team-label" title={badge}>
                {badge}
              </span>
            )}
          </span>
        </span>
        <span className="resource-flow-id-cell">
          <Tooltip>
            <TooltipTrigger render={<code className="resource-flow-id" tabIndex={0} translate="no" />}>{compactFlowId(flow.flowId)}</TooltipTrigger>
            <TooltipContent
              align="start"
              alignOffset={flowIdTooltipAlignOffset}
              className="resource-flow-id-tooltip"
              collisionBoundary={[]}
              container={root}
              positionMethod="fixed"
              side="top"
              sideOffset={6}
            >
              <Button
                aria-label={t(copied ? 'resource.flowIdCopied' : 'resource.copyFlowId')}
                className="resource-tooltip-icon-button"
                onClick={() => {
                  void navigator.clipboard.writeText(flow.flowId).then(() => setCopied(true))
                }}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <i aria-hidden="true" className="i-lucide-light:copy" />
              </Button>
              <code translate="no">{flow.flowId}</code>
            </TooltipContent>
          </Tooltip>
        </span>
        <Tooltip>
          <TooltipTrigger render={<time className="resource-updated-at" dateTime={flow.updatedAt} tabIndex={0} />}>
            {formatUpdatedAt(flow.updatedAt, locale)}
          </TooltipTrigger>
          <TooltipContent align="center" collisionBoundary={[]} container={root} positionMethod="fixed" side="top" sideOffset={6}>
            {new Date(flow.updatedAt).toLocaleString(locale)}
          </TooltipContent>
        </Tooltip>
        <span className="resource-status">
          <span aria-hidden="true" className={cn('status-dot', publicationTone)} />
          {t(publicationStatus)}
          {flow.live != null && (
            <>
              <span aria-hidden="true" className="resource-status-separator">
                ·
              </span>
              <span>{t(flow.live.enabled ? 'resource.enabled' : 'resource.disabled')}</span>
            </>
          )}
        </span>
      </div>
      <div className="resource-live-controls" aria-busy={pending != null} onClick={openFromRow}>
        {flow.live != null && (
          <Switch
            aria-label={t('resource.enableFlow', { name: flow.name })}
            checked={flow.live.enabled}
            disabled={flow.status != 'active' || busy != null || pending != null}
            onCheckedChange={(enabled) => void update(enabled)}
            size="sm"
            title={t('resource.enabledHint')}
          />
        )}
        {flow.status == 'active' && (
          <Button onClick={() => onSelect(flow)} size="sm" variant="outline">
            {t('resource.edit')}
          </Button>
        )}
        <Button
          disabled={flow.status != 'active' || busy != null || pending != null || (flow.live != null && !changed)}
          onClick={() => void update('publish')}
          size="sm"
          variant="outline"
        >
          {t(pending == 'publish' ? 'workspace.publishing' : flow.live == null ? 'resource.publish' : 'resource.publishUpdate')}
        </Button>
        {flow.status == 'active' && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={t('sidebar.deleteFlow', { name: flow.name })}
                  ref={deleteButton}
                  disabled={busy != null || pending != null}
                  onClick={() => setMode('delete')}
                  size="icon-sm"
                  variant="destructive"
                />
              }
            >
              <i aria-hidden="true" className="i-lucide-light:trash-2" />
            </TooltipTrigger>
            <TooltipContent align="center" collisionBoundary={[]} container={root} positionMethod="fixed" side="top">
              {t('common.delete')}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <Dialog
        open={mode == 'delete'}
        onOpenChange={(open) => {
          if (!open) setMode('idle')
        }}
      >
        <DialogContent container={root} initialFocus={cancelDelete} finalFocus={deleteButton} showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('sidebar.deleteFlowConfirm', { name: flow.name })}</DialogTitle>
            <DialogDescription>{t('resource.deleteDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button ref={cancelDelete} variant="outline" />}>{t('common.cancel')}</DialogClose>
            <Button disabled={busy != null} onClick={() => void remove()} variant="destructive">
              {t(busy == 'flow' ? 'common.deleting' : 'common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FlowSkeleton(): ReactElement {
  return (
    <div aria-hidden="true" className="resource-item-row">
      <div className="resource-list-row resource-skeleton-row flow-columns">
        <span className="resource-skeleton-copy">
          <Skeleton className="h-3.5 w-36 max-w-full" />
          <Skeleton className="h-3 w-24 max-w-full" />
        </span>
        <Skeleton className="h-3 w-36 max-w-full" />
        <Skeleton className="h-3 w-28 max-w-full" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="resource-live-controls">
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-7 w-14" />
      </div>
    </div>
  )
}

interface FlowBrowserProps extends LanguageSelectProps {
  readonly catalogWidth?: 'default' | 'full' | undefined
  readonly createFlowDisabled?: boolean | undefined
  readonly createFlowField?: ComponentProps<typeof CreateResourceDialog>['field']
  readonly flowBadges?: Readonly<Record<string, string>> | undefined
  readonly hrefForFlow: (flow: Flow) => string
  readonly hostAction?: string | undefined
  readonly hostTitle?: string | undefined
  readonly onCreateFlow: (name: string) => Promise<boolean>
  readonly onHostAction?: (() => void) | undefined
  readonly onSelectFlow: (flow: Flow) => void
  readonly store: WorkbenchStore
}

export function FlowBrowser({
  catalogWidth,
  createFlowDisabled,
  createFlowField,
  flowBadges,
  hrefForFlow,
  hostAction,
  hostTitle,
  language,
  onCreateFlow,
  onHostAction,
  onLanguageChange,
  onSelectFlow,
  store,
}: FlowBrowserProps): ReactElement {
  const t = useTranslate()
  const busy = useVal(store.workspace.$.busy)
  const loadFailed = useVal(store.workspace.$.flowLoadFailed)
  const loadMoreFailed = useVal(store.workspace.$.flowLoadMoreFailed)
  const loading = useVal(store.workspace.$.flowLoading)
  const loadingMore = useVal(store.workspace.$.flowLoadingMore)
  const nextCursor = useVal(store.workspace.$.flowNextCursor)
  const refreshing = useVal(store.workspace.$.flowRefreshing)
  const flows = useVal(store.workspace.$.flows)
  const total = useVal(store.workspace.$.flowTotal)
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState('')
  const [name, setName] = useState('')
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
      <div className={cn('resource-page', catalogWidth != 'default' && 'resource-page-full')}>
        <h1 className="sr-only">{t('resource.flows')}</h1>
        <section aria-labelledby="flow-list-title" className="resource-list-section rounded-lg">
          <div className="resource-list-title">
            <div className="resource-list-heading">
              <h2 id="flow-list-title">{t('resource.flows')}</h2>
              {!loading && <span>{t('resource.flowCount', { count: total ?? flows.length })}</span>}
            </div>
            <div className="resource-list-actions">
              <LanguageSelect language={language} onLanguageChange={onLanguageChange} />
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
              <Button className="pr-3" disabled={busy != null} onClick={() => setCreating(true)}>
                <Icon data-icon="inline-start" name="plus" />
                {t('resource.newFlow')}
              </Button>
              {hostAction != null && hostTitle != null && onHostAction != null && <HostMenu action={hostAction} onAction={onHostAction} title={hostTitle} />}
            </div>
          </div>
          <div aria-hidden="true" className="resource-list-columns-shell">
            <div className="resource-list-columns flow-columns">
              <span>{t('resource.name')}</span>
              <span className="resource-flow-id-heading">{t('resource.flowId')}</span>
              <span className="resource-updated-heading">{t('resource.updated')}</span>
              <span>{t('resource.status')}</span>
            </div>
            <span className="resource-actions-heading">{t('resource.actions')}</span>
          </div>
          <div className="resource-list">
            {loading ? (
              Array.from({ length: 5 }, (_, index) => <FlowSkeleton key={index} />)
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
