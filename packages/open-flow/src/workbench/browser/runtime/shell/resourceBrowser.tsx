import type { ComponentProps, FormEvent, ReactElement } from 'react'
import type { Flow } from '../api.ts'
import type { WorkbenchLanguage } from '../contract.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'
import type { WorkspaceBusy } from '../stores/workspaceModel.ts'

import { lazy, Suspense, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useLang, useTranslate } from 'val-i18n-react'
import { resourceNameIssue, resourceNameMaxLength } from '../../../../flow/common/change.ts'
import { uiLanguageNames, uiLanguages } from '../../../../localization/common/languages.ts'
import { Badge } from '../../../../ui/browser/badge.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../../ui/browser/dialog.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../../ui/browser/dropdown-menu.tsx'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../../../ui/browser/empty.tsx'
import { Field, FieldError, FieldLabel } from '../../../../ui/browser/field.tsx'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../../../ui/browser/input-group.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { Skeleton } from '../../../../ui/browser/skeleton.tsx'
import { Switch } from '../../../../ui/browser/switch.tsx'
import { cn } from '../../../../ui/browser/utils.ts'
import { Icon } from '../icons.tsx'
import { followWorkbenchLink } from '../navigationLink.ts'
import { HostMenu } from './hostMenu.tsx'
import { WorkbenchSelect } from './workbenchSelect.tsx'

const CreateResourceDialog = lazy(() => import('./createResourceDialog.tsx'))

const languageOptions = uiLanguages.map((language) => ({ label: uiLanguageNames[language], value: language }))

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

function FlowItem({ badge, busy, flow, href, onSelect, store }: FlowItemProps): ReactElement {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const more = useRef<HTMLButtonElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const cancelDelete = useRef<HTMLButtonElement>(null)
  const locale = useLang()
  const t = useTranslate()
  const [mode, setMode] = useState<'delete' | 'idle' | 'rename'>('idle')
  const [name, setName] = useState(flow.name)
  const [pending, setPending] = useState<'publish' | 'enabled' | undefined>()
  const changed = flow.live != null && flow.live.revisionId != flow.draftRevisionId

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
      <Button
        aria-disabled={flow.status == 'retiring'}
        className="resource-list-row flow-columns"
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
        variant="ghost"
      >
        <span className="resource-primary-cell">
          <span className="resource-icon">
            <Icon name="flow" />
          </span>
          <span>
            <span className="flex min-w-0 items-center gap-2">
              <strong className="min-w-0 truncate">{flow.name}</strong>
              {badge != null && (
                <Badge className="min-w-0 shrink" title={badge} variant="secondary">
                  <span className="truncate">{badge}</span>
                </Badge>
              )}
            </span>
            <code translate="no">{flow.flowId}</code>
          </span>
        </span>
        <time dateTime={flow.updatedAt}>{new Date(flow.updatedAt).toLocaleString(locale)}</time>
        <span className="resource-status">
          {t(
            flow.status == 'retiring'
              ? 'resource.retiring'
              : flow.live == null
                ? 'resource.notPublished'
                : changed
                  ? 'resource.unpublishedChanges'
                  : 'resource.isPublished',
          )}
        </span>
      </Button>
      <div className="resource-live-controls" aria-busy={pending != null}>
        {flow.live == null ? (
          <span className="resource-status" title={t('resource.publishFirst')}>
            —
          </span>
        ) : (
          <Label className="resource-enable" title={t('resource.enabledHint')}>
            <Switch
              aria-label={t('resource.enableFlow', { name: flow.name })}
              checked={flow.live?.enabled ?? false}
              disabled={flow.status != 'active' || flow.live == null || busy != null || pending != null}
              onCheckedChange={(enabled) => void update(enabled)}
              size="sm"
            />
            <span>{t(flow.live?.enabled ? 'resource.enabled' : 'resource.disabled')}</span>
          </Label>
        )}
        <Button
          disabled={flow.status != 'active' || busy != null || pending != null || (flow.live != null && !changed)}
          onClick={() => void update('publish')}
          size="sm"
          variant="outline"
        >
          {t(pending == 'publish' ? 'workspace.publishing' : flow.live == null ? 'resource.publish' : 'resource.publishUpdate')}
        </Button>
      </div>
      {flow.status == 'active' && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t('sidebar.flowActions', { name: flow.name })}
            disabled={busy != null || pending != null}
            render={
              <Button className="resource-row-more" ref={more} size="icon-sm" variant="ghost">
                <Icon name="more" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-36" container={root} finalFocus={mode == 'idle'}>
            <DropdownMenuItem
              onClick={() => {
                setName(flow.name)
                setMode('rename')
              }}
            >
              {t('common.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setMode('delete')} variant="destructive">
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Dialog
        open={mode == 'rename'}
        onOpenChange={(open) => {
          if (!open) setMode('idle')
        }}
      >
        <DialogContent container={root} initialFocus={nameInput} finalFocus={more} closeLabel={t('common.cancel')}>
          <form className="flex flex-col gap-4" onSubmit={(event) => void rename(event)}>
            <DialogHeader>
              <DialogTitle>{t('sidebar.renameFlow', { name: flow.name })}</DialogTitle>
            </DialogHeader>
            <Field data-invalid={name.length > 0 && issue != null}>
              <FieldLabel htmlFor={`rename-flow-${flow.flowId}`}>{t('resource.flowName')}</FieldLabel>
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
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />} type="button">
                {t('common.cancel')}
              </DialogClose>
              <Button disabled={busy != null || issue != null} type="submit">
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={mode == 'delete'}
        onOpenChange={(open) => {
          if (!open) setMode('idle')
        }}
      >
        <DialogContent container={root} initialFocus={cancelDelete} finalFocus={more} showCloseButton={false}>
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
    <div aria-hidden="true" className="resource-list-row resource-skeleton-row flow-columns">
      <span className="resource-primary-cell">
        <Skeleton className="size-8 shrink-0" />
        <span className="resource-skeleton-copy">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-2.5 w-48 max-w-full" />
        </span>
      </span>
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-3 w-16" />
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
    <main className="resource-browser">
      <div className={cn('resource-page', catalogWidth != 'default' && 'resource-page-full')}>
        <h1 className="sr-only">{t('resource.flows')}</h1>
        <section aria-labelledby="flow-list-title" className="resource-list-section">
          <div className="resource-list-title">
            <div className="resource-list-heading">
              <h2 id="flow-list-title">{t('resource.allFlows')}</h2>
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
                  aria-label={t('resource.searchFlows')}
                  name="flow-search"
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={t('resource.searchFlows')}
                  value={filter}
                />
              </InputGroup>
              <Button
                aria-label={t('common.refresh')}
                disabled={loading || refreshing || busy != null}
                onClick={() => void store.workspace.reloadFlows()}
                size="icon"
                title={t('common.refresh')}
                variant="outline"
              >
                <Icon className={refreshing ? 'animate-spin' : undefined} name="refresh" />
              </Button>
              <Button className="resource-page-primary-action" disabled={busy != null} onClick={() => setCreating(true)}>
                <Icon data-icon="inline-start" name="plus" />
                {t('resource.newFlow')}
              </Button>
              {hostAction != null && hostTitle != null && onHostAction != null && <HostMenu action={hostAction} onAction={onHostAction} title={hostTitle} />}
            </div>
          </div>
          <div aria-hidden="true" className="resource-list-columns flow-columns">
            <span>{t('resource.name')}</span>
            <span>{t('resource.updated')}</span>
            <span>{t('resource.publication')}</span>
            <span>{t('resource.enabledColumn')}</span>
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
