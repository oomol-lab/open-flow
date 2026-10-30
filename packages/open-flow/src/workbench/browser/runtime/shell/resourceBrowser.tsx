import type { ComponentProps, FormEvent, ReactElement } from 'react'
import type { WorkflowFile } from '../../../../flow/common/workflowFile.ts'
import type { Flow } from '../api.ts'
import type { OpenFlowWorkbenchHandle, WorkbenchImportInput, WorkbenchLanguage, WorkbenchView } from '../contract.ts'
import type { OpenFlowWorkbenchProps } from '../openFlowWorkbench.tsx'
import type { FlowCatalogItem } from '../stores/flowCatalog.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'
import type { WorkspaceBusy } from '../stores/workspaceModel.ts'

import { forwardRef, lazy, Suspense, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { randomId } from '../../../../control/common/random.ts'
import { resourceNameIssue, resourceNameMaxLength } from '../../../../flow/common/change.ts'
import { parseWorkflowFile, workflowNameFromFile } from '../../../../flow/common/workflowFile.ts'
import { importedWorkflowName } from '../../../../localization/common/languages.ts'
import { Badge } from '../../../../ui/browser/badge.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
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
import { FlowDeletionDialog } from './flowDeletionDialog.tsx'
import { useFlowQuery } from './flowQuery.ts'
import { FlowReferencesButton } from './flowReferences.tsx'
import { FlowSettingsDialog } from './flowSettings.tsx'
import { FlowTagChips, TagPicker } from './flowTags.tsx'
import { IdTooltip } from './idTooltip.tsx'
import { WorkflowExportMenuItem } from './workflowExportMenuItem.tsx'

const CreateResourceDialog = lazy(() => import('./createResourceDialog.tsx'))

const flowIdTooltipAlignOffset = 44
const renamePopoverAlignOffset = -12

interface LanguageSelectProps {
  readonly language: WorkbenchLanguage
  readonly onLanguageChange?: ((language: WorkbenchLanguage) => void) | undefined
}

interface FlowItemProps {
  readonly settingsFinalFocus: () => HTMLElement | null
  readonly onChanged: () => void
  readonly onTagFilter: (tagId: string) => void
  readonly busy: WorkspaceBusy | undefined
  readonly flow: FlowCatalogItem
  readonly href: string
  readonly hrefForFlow: FlowBrowserProps['hrefForFlow']
  readonly onSelect: (flow: Pick<Flow, 'flowId'>, view?: WorkbenchView) => void
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

function FlowItem({ busy, flow, href, hrefForFlow, onSelect, store, onTagFilter, onChanged, settingsFinalFocus }: FlowItemProps): ReactElement {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const renameAnchor = useRef<HTMLSpanElement>(null)
  const actionsButton = useRef<HTMLButtonElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const locale = useLang()
  const t = useTranslate()
  const [mode, setMode] = useState<'delete' | 'idle' | 'rename' | 'settings'>('idle')
  const [name, setName] = useState(flow.name)
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
      onChanged()
    } finally {
      setPending(undefined)
    }
  }
  const issue = resourceNameIssue(name)

  async function rename(event: FormEvent): Promise<void> {
    event.preventDefault()
    const nextName = name.trim()
    if (resourceNameIssue(nextName) == null && (await store.workspace.renameFlow(flow.flowId, nextName))) {
      setMode('idle')
      onChanged()
    }
  }

  async function remove(): Promise<void> {
    if (await store.workspace.deleteFlow(flow.flowId)) {
      setMode('idle')
      onChanged()
    }
  }

  return (
    <div className="resource-item-row" ref={setRoot}>
      <div className="resource-list-row flow-columns">
        <span className="resource-primary-cell">
          <span aria-hidden="true" className="resource-flow-icon">
            <i className="i-lucide-light:workflow" />
          </span>
          <span className="resource-primary-copy">
            <span className="resource-primary-heading">
              <Tooltip>
                <TooltipTrigger
                  render={
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
                    />
                  }
                >
                  <span className="resource-primary-name" ref={renameAnchor}>
                    {flow.name}
                  </span>
                </TooltipTrigger>
                <TooltipContent container={root} collisionBoundary={[]} positionMethod="fixed">
                  {flow.name}
                </TooltipContent>
              </Tooltip>
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
                    sideOffset={({ anchor, positioner }) => -(anchor.height + positioner.height) / 2}
                  >
                    <PopoverTitle className="sr-only">{t('sidebar.renameFlow', { name: flow.name })}</PopoverTitle>
                    <form onSubmit={(event) => void rename(event)}>
                      <Field data-invalid={name.length > 0 && issue != null}>
                        <FieldLabel className="sr-only" htmlFor={`rename-flow-${flow.flowId}`}>
                          {t('resource.flowName')}
                        </FieldLabel>
                        <div className="resource-rename-form">
                          <Input
                            controlSize="field"
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
                          <Button onClick={() => setMode('idle')} size="sm" type="button" variant="ghost">
                            {t('common.cancel')}
                          </Button>
                          <Button disabled={busy != null || issue != null} size="sm" type="submit">
                            {t('common.save')}
                          </Button>
                        </div>
                        {name.length > 0 && issue != null && (
                          <FieldError id={`rename-error-${flow.flowId}`}>{t(`resource.nameIssue.${issue}`, { max: resourceNameMaxLength })}</FieldError>
                        )}
                      </Field>
                    </form>
                  </PopoverContent>
                </Popover>
              )}
            </span>
            <FlowTagChips container={root} ids={flow.tagIds ?? []} store={store} onFilter={onTagFilter} />
          </span>
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
        <span className="resource-status" aria-busy={pending == 'enabled'}>
          <span aria-hidden="true" className={cn('status-dot', flow.live?.enabled ? 'success' : 'neutral')} />
          <span>{t(flow.live == null ? 'resource.runtimeUnpublished' : flow.live.enabled ? 'resource.enabled' : 'resource.disabled')}</span>
        </span>
      </div>
      <div className="resource-live-controls" aria-busy={pending != null}>
        <FlowReferencesButton flow={flow} workspace={store.workspace} container={root} hrefForFlow={hrefForFlow} onSelectFlow={onSelect} />
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
            <DropdownMenuItem disabled={flow.status != 'active' || busy != null} onClick={() => setMode('settings')}>
              <i aria-hidden="true" className="i-lucide-light:settings size-4 shrink-0" />
              {t('flowSettings.title')}
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
            <WorkflowExportMenuItem disabled={flow.status != 'active' || busy != null} onClick={() => void store.workspace.exportFlow(flow.flowId)} />
            <DropdownMenuItem disabled={flow.status != 'active'} onClick={() => onSelect(flow, 'publications')}>
              <i aria-hidden="true" className="i-lucide-light:cloud-upload size-4 shrink-0" />
              {t('workspace.publications')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={flow.status != 'active'} onClick={() => onSelect(flow, 'runs')}>
              <i aria-hidden="true" className="i-lucide-light:history size-4 shrink-0" />
              {t('workspace.runs')}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="mx-2 bg-border/50" />
            <DropdownMenuItem disabled={flow.status != 'active' || busy != null || pending != null} variant="destructive" onClick={() => setMode('delete')}>
              <i aria-hidden="true" className="i-lucide-light:trash-2 size-4 shrink-0" />
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {mode == 'settings' && (
        <FlowSettingsDialog
          store={store}
          flow={flow}
          container={root}
          hrefForFlow={hrefForFlow}
          onSelectFlow={onSelect}
          onSaved={onChanged}
          finalFocus={() => actionsButton.current ?? settingsFinalFocus()}
          onClose={() => setMode('idle')}
        />
      )}
      {mode == 'delete' && (
        <FlowDeletionDialog
          flow={flow}
          workspace={store.workspace}
          container={root}
          busy={busy}
          finalFocus={() => actionsButton.current}
          onClose={() => setMode('idle')}
          onDelete={() => void remove()}
          hrefForFlow={hrefForFlow}
          onSelectFlow={onSelect}
        />
      )}
    </div>
  )
}

function FlowSkeleton(): ReactElement {
  return (
    <div aria-hidden="true" className="resource-item-row">
      <div className="resource-list-row flow-columns">
        <span className="resource-primary-cell">
          <Skeleton className="resource-flow-icon" />
          <span className="resource-primary-copy">
            <Skeleton className="h-3.5 w-36 max-w-full" />
          </span>
        </span>
        <Skeleton className="resource-flow-id-cell h-3 w-36 max-w-full" />
        <Skeleton className="resource-updated-at h-3 w-28 max-w-full" />
        <Skeleton className="resource-publication-status h-3 w-16" />
        <Skeleton className="resource-status h-3 w-16" />
      </div>
      <div className="resource-live-controls">
        <Skeleton className="size-7" />
      </div>
    </div>
  )
}

type FlowCreation = { readonly kind: 'create' } | { readonly kind: 'import'; readonly file: WorkflowFile; readonly key: string; readonly sourceUrl?: string }

interface FlowBrowserProps extends LanguageSelectProps {
  readonly catalogWidth?: OpenFlowWorkbenchProps['catalogWidth']
  readonly createFlowDisabled?: boolean | undefined
  readonly createFlowField?: ComponentProps<typeof CreateResourceDialog>['field']
  readonly hrefForFlow: (flow: Pick<Flow, 'flowId'>, view?: WorkbenchView) => string
  readonly initializing?: boolean
  readonly onImportFlow?: (file: WorkflowFile, name: string, key: string, tagIds?: readonly string[]) => Promise<boolean>
  readonly onCreateFlow: (name: string, tagIds?: readonly string[]) => Promise<boolean>
  readonly onSelectFlow: (flow: Pick<Flow, 'flowId'>, view?: WorkbenchView) => void
  readonly store: WorkbenchStore
}

export const FlowBrowser = forwardRef<OpenFlowWorkbenchHandle, FlowBrowserProps>(function FlowBrowser(
  {
    catalogWidth,
    createFlowDisabled,
    createFlowField,
    hrefForFlow,
    initializing = false,
    onCreateFlow,
    onImportFlow,
    onSelectFlow,
    store,
    language,
  }: FlowBrowserProps,
  ref,
): ReactElement {
  const t = useTranslate()
  const busy = useVal(store.workspace.$.busy)
  const [filter, setFilter] = useState('')
  const [tagIds, setTagIds] = useState<readonly string[]>([])
  const [untagged, setUntagged] = useState(false)
  const result = useFlowQuery(store, { query: filter, tagIds, untagged })
  const { catalog, flows, total, failed: loadFailed, loadMoreFailed, loading: flowLoading, loadingMore, nextCursor, refreshing } = result
  const loading = initializing || flowLoading
  const tagState = useVal(store.tags.state)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const tagsContext = { store, container: root, hrefForFlow, onSelectFlow }
  const hasFilters = filter.trim().length > 0 || tagIds.length > 0 || untagged
  function clearFilters(): void {
    setFilter('')
    setTagIds([])
    setUntagged(false)
  }
  useEffect(() => {
    store.tags.start()
  }, [store])
  // The command and React read the same state, including calls before React rerenders.
  const [creation$] = useState(() => val<FlowCreation | undefined>(undefined))
  const creation = useVal(creation$)
  const fileInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [creationTags, setCreationTags] = useState<readonly string[]>([])
  const [creatingTag, setCreatingTag] = useState(false)

  const command = useRef<OpenFlowWorkbenchHandle['openImport']>()
  useImperativeHandle(ref, () => ({ openImport: (input) => command.current?.(input) ?? 'unavailable' }), [])
  useLayoutEffect(() => {
    command.current = openImport
    return () => {
      command.current = undefined
    }
  })

  function openImport(input: WorkbenchImportInput): ReturnType<OpenFlowWorkbenchHandle['openImport']> {
    if (initializing || store.workspace.$.busy.value != null || creation$.value != null || onImportFlow == null) return 'unavailable'
    let file: WorkflowFile
    try {
      file = parseWorkflowFile(input.text)
    } catch {
      store.workspace.notify({ kind: 'error', message: t('resource.importInvalid') })
      return 'invalid-file'
    }
    setCreationTags([])
    setCreatingTag(false)
    setName(file.name ?? (input.fileName == null ? importedWorkflowName(language) : workflowNameFromFile(input.fileName)))
    creation$.set({ kind: 'import', file, key: randomId(), ...(input.sourceUrl == null ? {} : { sourceUrl: input.sourceUrl }) })
    return 'opened'
  }

  function openCreate(): void {
    if (creation$.value != null) return
    setName('')
    setCreationTags([])
    setCreatingTag(false)
    creation$.set({ kind: 'create' })
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    const request = creation$.value
    const nextName = name.trim()
    if (request == null || creatingTag || resourceNameIssue(nextName) != null) return
    const success =
      request.kind == 'create' ? await onCreateFlow(nextName, creationTags) : await onImportFlow?.(request.file, nextName, request.key, creationTags)
    if (!success || command.current == null || creation$.value !== request) return
    creation$.set(undefined)
    setName('')
  }

  return (
    <main className="resource-browser" data-tooltip-portal ref={setRoot}>
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
              {!loading && total != null && <span>{t('resource.flowCount', { count: total })}</span>}
            </div>
            <div className="resource-list-actions">
              <InputGroup className="w-full sm:w-56">
                <InputGroupAddon>
                  <Icon name="search" size={17} />
                </InputGroupAddon>
                <InputGroupInput
                  ref={searchInput}
                  autoComplete="off"
                  aria-label={t('resource.searchByName')}
                  name="flow-search"
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={t('resource.searchByName')}
                  value={filter}
                />
              </InputGroup>
              <TagPicker {...tagsContext} value={tagIds} onChange={setTagIds} untagged={untagged} onUntaggedChange={setUntagged} />
              {onImportFlow != null && (
                <>
                  <Input
                    ref={fileInput}
                    className="hidden"
                    type="file"
                    accept=".openflow.json,.json,application/json"
                    aria-label={t('resource.importFlow')}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (file == null) return
                      void file
                        .text()
                        .then((text) => {
                          command.current?.({ text, fileName: file.name })
                        })
                        .catch(() => store.workspace.notify({ kind: 'error', message: t('resource.importInvalid') }))
                    }}
                  />
                  <Button variant="outline" disabled={initializing || busy != null || createFlowDisabled} onClick={() => fileInput.current?.click()}>
                    {t('resource.importFlow')}
                  </Button>
                </>
              )}

              <Button className="pr-3" disabled={initializing || busy != null} onClick={openCreate}>
                <Icon data-icon="inline-start" name="plus" />
                {t('resource.newFlow')}
              </Button>
            </div>
          </div>
          {(tagIds.length > 0 || untagged) && (
            <div className="flex items-center gap-2 border-t border-border px-4 py-3">
              <i aria-hidden="true" className="i-lucide-light:funnel size-4 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {tagState.tags
                  .filter((tag) => tagIds.includes(tag.tagId))
                  .map((tag) => (
                    <Button
                      key={tag.tagId}
                      variant="secondary"
                      size="sm"
                      aria-label={t('tags.remove', { name: tag.name })}
                      onClick={() => setTagIds(tagIds.filter((id) => id != tag.tagId))}
                    >
                      {tag.name}
                      <i aria-hidden="true" className="i-lucide-light:x size-3" />
                    </Button>
                  ))}
                {untagged && (
                  <Button variant="secondary" size="sm" onClick={() => setUntagged(false)}>
                    {t('tags.untagged')}
                    <i aria-hidden="true" className="i-lucide-light:x size-3" />
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  {t('tags.clear')}
                </Button>
              </div>
            </div>
          )}
          <div className="resource-table-scroll">
            <div className="resource-table">
              <div aria-hidden="true" className="resource-list-columns-shell">
                <div className="resource-list-columns flow-columns">
                  <span>{t('resource.name')}</span>
                  <span className="resource-flow-id-heading">{t('resource.flowId')}</span>
                  <span className="resource-updated-heading">{t('resource.updated')}</span>
                  <span>{t('resource.publicationStatus')}</span>
                  <span>{t('resource.runtimeStatus')}</span>
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
                      <Button onClick={() => void catalog?.reload()} variant="outline">
                        {t('empty.retry')}
                      </Button>
                    </EmptyContent>
                  </Empty>
                ) : flows.length == 0 ? (
                  <Empty className="min-h-64">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Icon name="flow" size={20} />
                      </EmptyMedia>
                      <EmptyTitle>{t(!hasFilters ? 'resource.noFlows' : 'resource.noMatchingFlows')}</EmptyTitle>
                      <EmptyDescription>{t(!hasFilters ? 'resource.noFlowsDescription' : 'resource.noMatchingDescription')}</EmptyDescription>
                    </EmptyHeader>
                    {hasFilters && (
                      <EmptyContent>
                        <Button variant="outline" onClick={clearFilters}>
                          {t('tags.clear')}
                        </Button>
                      </EmptyContent>
                    )}
                    {!hasFilters && (
                      <EmptyContent>
                        <Button onClick={openCreate} variant="outline">
                          <Icon data-icon="inline-start" name="plus" />
                          {t('resource.newFlow')}
                        </Button>
                      </EmptyContent>
                    )}
                  </Empty>
                ) : (
                  flows.map((flow) => (
                    <FlowItem
                      busy={busy}
                      settingsFinalFocus={() => searchInput.current}
                      onChanged={() => void catalog?.reload()}
                      onTagFilter={(id) => setTagIds((current) => (current.includes(id) ? current : [...current, id]))}
                      flow={flow}
                      href={hrefForFlow(flow)}
                      hrefForFlow={hrefForFlow}
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
              <Button disabled={loadingMore || refreshing} onClick={() => void catalog?.loadMore()} variant="outline">
                {t(loadingMore ? 'resource.loadingMore' : loadMoreFailed ? 'resource.retryLoadMore' : 'resource.loadMore')}
              </Button>
            </div>
          )}
        </section>
        {creation != null && (
          <Suspense fallback={null}>
            <CreateResourceDialog
              disabled={createFlowDisabled || creatingTag}
              tagField={(container) => (
                <Field>
                  <FieldLabel>{t('tags.title')}</FieldLabel>
                  <TagPicker
                    {...tagsContext}
                    onPendingChange={setCreatingTag}
                    dialogContainer={root}
                    container={container}
                    value={creationTags}
                    onChange={setCreationTags}
                  />
                </Field>
              )}
              field={createFlowField}
              id="flow-name"
              issue={resourceNameIssue(name)}
              label={t('resource.flowName')}
              name={name}
              onNameChange={setName}
              onOpenChange={(open) => {
                if (!open) {
                  creation$.set(undefined)
                  setName('')
                }
              }}
              onSubmit={(event) => void create(event)}
              pending={busy == 'flow'}
              sourceUrl={creation.kind == 'import' ? creation.sourceUrl : undefined}
              submitLabel={creation.kind == 'import' ? t('resource.importFlow') : undefined}
              title={t(creation.kind == 'create' ? 'resource.newFlow' : 'resource.importFlow')}
            />
          </Suspense>
        )}
      </div>
    </main>
  )
})
