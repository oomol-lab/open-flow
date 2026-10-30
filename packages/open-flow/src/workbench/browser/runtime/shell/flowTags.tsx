import type { Flow, TagListItem } from '../../../../control/common/api.ts'
import type { WorkbenchStore } from '../stores/workbenchStore.ts'

import { Combobox } from '@base-ui/react/combobox'
import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { resourceNameIssue, resourceNameMaxLength } from '../../../../flow/common/change.ts'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { selectionMenuContentClass, selectionMenuItemClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../../ui/browser/dialog.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../../../ui/browser/dropdown-menu.tsx'
import { Field } from '../../../../ui/browser/field.tsx'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../../../ui/browser/input-group.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../../../../ui/browser/popover.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { cn } from '../../../../ui/browser/utils.ts'
import { followWorkbenchLink } from '../navigationLink.ts'
import { useFlowQuery } from './flowQuery.ts'

export interface TagsContext {
  readonly store: WorkbenchStore
  readonly container?: HTMLElement | null | undefined
  readonly hrefForFlow: (flow: Pick<Flow, 'flowId'>) => string
  readonly onSelectFlow: (flow: Pick<Flow, 'flowId'>) => void
}

type TagOption = { readonly kind: 'tag'; readonly tagId: string; readonly name: string } | { readonly kind: 'create' | 'untagged'; readonly name: string }

export function TagPicker({
  value,
  onChange,
  untagged,
  onUntaggedChange,
  dialogContainer,
  onPendingChange,
  id,
  ...context
}: TagsContext & {
  readonly value: readonly string[]
  readonly onChange: (ids: readonly string[]) => void
  readonly untagged?: boolean
  readonly onUntaggedChange?: (value: boolean) => void
  readonly dialogContainer?: HTMLElement | null | undefined
  readonly onPendingChange?: ((pending: boolean) => void) | undefined
  readonly id?: string
}) {
  const t = useTranslate()
  const { store, container } = context
  const state = useVal(store.tags.state)
  const [open, setOpen] = useState(false)
  const [manage, setManage] = useState<'closed' | 'opening' | 'open'>('closed')
  const input = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState(false)
  const filter = onUntaggedChange != null
  const query = search.trim().toLowerCase()
  const tags: TagOption[] = state.tags.map((tag) => ({ kind: 'tag', tagId: tag.tagId, name: tag.name }))
  const selected = tags.filter((option) => option.kind == 'tag' && value.includes(option.tagId))
  if (untagged) selected.push({ kind: 'untagged', name: t('tags.untagged') })
  const options = tags.filter((option) => option.name.toLowerCase().includes(query))
  if (filter && (!query || t('tags.untagged').toLowerCase().includes(query))) options.push({ kind: 'untagged', name: t('tags.untagged') })
  if (!filter && query && !state.failed && !state.loading && resourceNameIssue(search.trim()) == null && !store.tags.hasName(search)) {
    options.push({ kind: 'create', name: t('tags.createNamed', { name: search.trim() }) })
  }
  useEffect(() => store.tags.start(), [store])
  useEffect(() => {
    if (state.loading || state.failed) return
    const ids = value.filter((tagId) => state.tags.some((tag) => tag.tagId == tagId))
    if (ids.length != value.length) onChange(ids)
  }, [state, value, onChange])
  async function create(): Promise<void> {
    const name = search
    setPending(true)
    onPendingChange?.(true)
    try {
      const tag = await store.tags.save(name)
      if (alive.current) {
        if (tag != null) {
          onChange([...value, tag.tagId])
          setSearch('')
        } else setSearch(name)
      }
    } finally {
      if (alive.current) {
        setPending(false)
        onPendingChange?.(false)
      }
    }
  }
  return (
    <div className={filter ? 'inline-flex' : 'flex min-w-0 flex-wrap items-center gap-1.5'}>
      {!filter &&
        state.tags
          .filter((tag) => value.includes(tag.tagId))
          .map((tag) => (
            <Button
              key={tag.tagId}
              type="button"
              variant="secondary"
              size="sm"
              aria-label={t('tags.remove', { name: tag.name })}
              disabled={pending}
              onClick={() => onChange(value.filter((tagId) => tagId != tag.tagId))}
            >
              <span className="max-w-48 truncate">{tag.name}</span>
              <i aria-hidden="true" className="i-lucide-light:x size-3" />
            </Button>
          ))}
      <Combobox.Root<TagOption, true>
        multiple
        autoHighlight
        readOnly={pending}
        value={selected}
        items={options}
        filter={null}
        itemToStringLabel={(option) => option.name}
        isItemEqualToValue={(left, right) => left.kind == right.kind && (left.kind != 'tag' || (right.kind == 'tag' && left.tagId == right.tagId))}
        inputValue={search}
        onInputValueChange={setSearch}
        onValueChange={(next, details) => {
          if (details.reason == 'escape-key') {
            details.cancel()
            details.allowPropagation()
            return
          }
          if (next.some((option) => option.kind == 'create')) {
            details.cancel()
            void create()
            return
          }
          onChange(next.flatMap((option) => (option.kind == 'tag' ? [option.tagId] : [])))
          onUntaggedChange?.(next.some((option) => option.kind == 'untagged'))
          setSearch('')
        }}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setSearch('')
        }}
        onOpenChangeComplete={(next) => {
          if (!next && manage == 'opening') setManage('open')
        }}
      >
        {filter ? (
          <Tooltip>
            <TooltipTrigger
              render={<Combobox.Trigger ref={trigger} id={id} render={<Button type="button" variant="outline" size="icon" />} aria-label={t('tags.filter')} />}
            >
              <i aria-hidden="true" className="i-lucide-light:tags size-4" />
            </TooltipTrigger>
            <TooltipContent container={container}>{t('tags.filter')}</TooltipContent>
          </Tooltip>
        ) : (
          <Combobox.Trigger
            ref={trigger}
            id={id}
            aria-label={t('tags.add')}
            render={<Button type="button" variant="outline" size="sm" className="border-dashed text-muted-foreground" />}
          >
            <i aria-hidden="true" className="i-lucide-light:plus size-3.5" />
            {t('tags.add')}
          </Combobox.Trigger>
        )}
        <Combobox.Portal container={container} className="contents">
          <Combobox.Positioner align="start" sideOffset={4} collisionBoundary={[]} positionMethod="fixed" className="isolate z-50">
            <Combobox.Popup
              initialFocus={input}
              finalFocus={manage == 'closed' ? trigger : false}
              aria-label={t(filter ? 'tags.filter' : 'tags.add')}
              className={`flex max-h-(--available-height) w-72 max-w-[calc(100vw-24px)] flex-col overflow-hidden bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none ${selectionMenuContentClass}`}
            >
              <div className="shrink-0 p-1">
                <Combobox.InputGroup render={<InputGroup />}>
                  <InputGroupAddon>
                    <i aria-hidden="true" className="i-lucide-light:search size-4 shrink-0" />
                  </InputGroupAddon>
                  <Combobox.Input ref={input} render={<InputGroupInput />} aria-label={t('tags.search')} placeholder={t('tags.search')} />
                </Combobox.InputGroup>
              </div>
              {filter && <p className="m-0 shrink-0 px-2 py-1 text-xs text-muted-foreground">{t('tags.matchAny')}</p>}
              <Combobox.List aria-label={t('tags.title')} className="min-h-0 max-h-[min(50vh,360px)] overflow-y-auto overscroll-contain">
                {state.loading ? (
                  <p role="status" className="m-0 px-2 py-2 text-xs text-muted-foreground">
                    {t('tags.loading')}
                  </p>
                ) : state.failed ? (
                  <div role="alert" className="p-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => void store.tags.reload()}>
                      {t('empty.retry')}
                    </Button>
                  </div>
                ) : (
                  <>
                    {options.map((option) => (
                      <Combobox.Item
                        key={option.kind == 'tag' ? option.tagId : option.kind}
                        value={option}
                        className={`flex w-full cursor-pointer items-center gap-2 px-2 text-left select-none hover:bg-accent data-highlighted:bg-accent ${selectionMenuItemClass}`}
                      >
                        <i
                          aria-hidden="true"
                          className={cn(
                            'size-3.5 shrink-0 text-muted-foreground',
                            option.kind == 'tag' ? 'i-lucide-light:tag' : option.kind == 'untagged' ? 'i-lucide-light:tag-x' : 'i-lucide-light:plus',
                          )}
                        />
                        <span className="min-w-0 flex-1 break-words">{option.name}</span>
                        {filter && option.kind == 'tag' && (
                          <span className="text-muted-foreground">{state.tags.find((tag) => tag.tagId == option.tagId)?.referenceCount}</span>
                        )}
                        <Combobox.ItemIndicator>
                          <i aria-hidden="true" className="i-lucide-light:check size-3.5 shrink-0" />
                        </Combobox.ItemIndicator>
                      </Combobox.Item>
                    ))}
                    {options.length == 0 && <p className="m-0 px-2 py-2 text-xs text-muted-foreground">{t('tags.noMatches')}</p>}
                  </>
                )}
              </Combobox.List>
              <div className="mx-2 my-1 h-px shrink-0 bg-border/50" />
              <Button
                type="button"
                variant="ghost"
                className="w-full cursor-pointer justify-start"
                disabled={pending}
                onClick={() => {
                  setOpen(false)
                  setSearch('')
                  setManage('opening')
                }}
              >
                {t('tags.manage')}
              </Button>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      {manage == 'open' && (
        <TagManager {...context} container={dialogContainer ?? container} finalFocus={() => trigger.current} onClose={() => setManage('closed')} />
      )}
    </div>
  )
}

export function FlowTagChips({
  ids,
  store,
  onFilter,
  container,
}: {
  readonly ids: readonly string[]
  readonly store: WorkbenchStore
  readonly onFilter: (id: string) => void
  readonly container?: HTMLElement | null
}) {
  const { tags } = useVal(store.tags.state)
  const t = useTranslate()
  const selected = tags.filter((tag) => ids.includes(tag.tagId))
  if (selected.length == 0) return null
  return (
    <div className="resource-flow-tags">
      {selected.slice(0, 2).map((tag) => (
        <Tooltip key={tag.tagId}>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="secondary"
                size="xs"
                className="resource-flow-tag text-muted-foreground"
                aria-label={t('tags.filterBy', { name: tag.name })}
                onClick={() => onFilter(tag.tagId)}
              />
            }
          >
            <span className="truncate">{tag.name}</span>
          </TooltipTrigger>
          <TooltipContent container={container}>{t('tags.filterBy', { name: tag.name })}</TooltipContent>
        </Tooltip>
      ))}
      {selected.length > 2 && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      className="text-muted-foreground"
                      aria-label={t('tags.expand', { count: selected.length - 2 })}
                    />
                  }
                />
              }
            >
              +{selected.length - 2}
            </TooltipTrigger>
            <TooltipContent container={container}>{t('tags.expand', { count: selected.length - 2 })}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent container={container} align="start" className="w-64 max-w-[calc(100vw-2rem)]">
            {selected.slice(2).map((tag) => (
              <DropdownMenuItem key={tag.tagId} aria-label={t('tags.filterBy', { name: tag.name })} onClick={() => onFilter(tag.tagId)}>
                <span className="min-w-0 break-words">{tag.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

function TagReferences({ tag, ...context }: TagsContext & { readonly tag: TagListItem }) {
  const t = useTranslate()
  const result = useFlowQuery(context.store, { tagIds: [tag.tagId] })
  return (
    <div className="flex flex-col gap-3">
      {result.loading ? (
        <p role="status" className="m-0 text-muted-foreground">
          {t('tags.loading')}
        </p>
      ) : result.failed ? (
        <Button variant="outline" onClick={() => void result.catalog?.reload()}>
          {t('empty.retry')}
        </Button>
      ) : (
        <ul className="m-0 max-h-64 list-none divide-y divide-border/50 overflow-y-auto p-0">
          {result.flows.map((flow) => (
            <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 last:pb-0" key={flow.flowId}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <a
                      className="flex min-w-0 flex-1 basis-30 items-center gap-2 font-medium text-foreground no-underline hover:underline"
                      href={context.hrefForFlow(flow)}
                      onClick={(event) => followWorkbenchLink(event, () => context.onSelectFlow(flow))}
                    />
                  }
                >
                  <i aria-hidden="true" className="i-lucide-light:workflow size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate">{flow.name}</span>
                </TooltipTrigger>
                <TooltipContent container={context.container} collisionBoundary={[]} positionMethod="fixed" className="max-w-sm break-words">
                  {flow.name}
                </TooltipContent>
              </Tooltip>
              <div className="flex max-w-full flex-wrap gap-1 text-xs text-muted-foreground">
                <span className="rounded-[var(--ui-control-radius)] bg-muted px-1.5 py-0.5">
                  {t(
                    flow.live == null
                      ? 'resource.notPublished'
                      : flow.live.revisionId != flow.draftRevisionId
                        ? 'resource.unpublishedChanges'
                        : 'resource.isPublished',
                  )}
                </span>
                {flow.live != null && (
                  <span className="rounded-[var(--ui-control-radius)] bg-muted px-1.5 py-0.5">
                    {t(flow.live.enabled ? 'resource.enabled' : 'resource.disabled')}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!result.loading && !result.failed && result.flows.length == 0 && <p className="m-0 text-muted-foreground">{t('tags.unused')}</p>}
      {result.nextCursor != null && (
        <Button variant="outline" disabled={result.loadingMore || result.refreshing} onClick={() => void result.catalog?.loadMore()}>
          {t(result.loadingMore ? 'resource.loadingMore' : result.loadMoreFailed ? 'resource.retryLoadMore' : 'resource.loadMore')}
        </Button>
      )}
    </div>
  )
}

function TagActions({
  container,
  disabled,
  onRename,
  onDelete,
}: {
  readonly container: HTMLElement | null
  readonly disabled: boolean
  readonly onRename: (focus: () => HTMLElement | null) => void
  readonly onDelete: (focus: () => HTMLElement | null) => void
}) {
  const t = useTranslate()
  const trigger = useRef<HTMLButtonElement>(null)
  const [handoff, setHandoff] = useState(false)
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) setHandoff(false)
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button ref={trigger} type="button" size="icon-sm" variant="ghost" disabled={disabled} aria-label={t('resource.actions')} />}
            />
          }
        >
          <i aria-hidden="true" className="i-lucide-light:ellipsis size-4" />
        </TooltipTrigger>
        <TooltipContent container={container}>{t('resource.actions')}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent container={container} align="end" className="w-40" finalFocus={handoff ? false : trigger}>
        <DropdownMenuItem
          onClick={() => {
            setHandoff(true)
            onRename(() => trigger.current)
          }}
        >
          <i aria-hidden="true" className="i-lucide-light:text-cursor-input size-4" />
          {t('common.rename')}
        </DropdownMenuItem>
        <DropdownMenuSeparator className="mx-2 bg-border/50" />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            setHandoff(true)
            onDelete(() => trigger.current)
          }}
        >
          <i aria-hidden="true" className="i-lucide-light:trash-2 size-4" />
          {t('common.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TagManager({ onClose, finalFocus, ...context }: TagsContext & { readonly onClose: () => void; readonly finalFocus: () => HTMLElement | null }) {
  const t = useTranslate()
  const { store } = context
  const state = useVal(store.tags.state)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<{ readonly tagId?: string; readonly name: string; readonly conflict?: boolean }>()
  const [deleting, setDeleting] = useState<TagListItem>()
  const [pending, setPending] = useState(false)
  const cancelDelete = useRef<HTMLButtonElement>(null)
  const createButton = useRef<HTMLButtonElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<() => HTMLElement | null>()
  const issue = editing == null ? undefined : resourceNameIssue(editing.name.trim())
  const conflict = editing != null && (editing.conflict || store.tags.hasName(editing.name, editing.tagId))
  const nameError =
    editing == null || editing.name.length == 0
      ? undefined
      : issue != null
        ? t(`resource.nameIssue.${issue}`, { max: resourceNameMaxLength })
        : conflict
          ? t('tags.conflict')
          : undefined
  const invalid = nameError != null
  const visible = state.tags.filter((tag) => tag.name.toLowerCase().includes(search.trim().toLowerCase()))
  async function save(): Promise<void> {
    if (editing == null || pending || issue != null || conflict) return
    setPending(true)
    try {
      if (
        await store.tags.save(editing.name, editing.tagId, () => {
          setEditing((current) => (current === editing ? { ...current, conflict: true } : current))
        })
      )
        setEditing(undefined)
    } finally {
      setPending(false)
    }
  }
  async function remove(): Promise<void> {
    if (deleting == null) return
    setPending(true)
    try {
      if (await store.tags.remove(deleting.tagId)) setDeleting(undefined)
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose()
      }}
    >
      <DialogContent
        ref={setRoot}
        container={context.container}
        initialFocus={searchInput}
        finalFocus={finalFocus}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 p-0 sm:max-w-3xl"
        showCloseButton={false}
      >
        <DialogHeader className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <div className="flex min-w-0 items-baseline gap-2">
            <DialogTitle>{t('tags.manage')}</DialogTitle>
            {!state.loading && !state.failed && <span className="text-xs text-muted-foreground">{t('tags.count', { count: visible.length })}</span>}
          </div>
          <div className="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
            <InputGroup className="w-48 max-w-full">
              <InputGroupAddon>
                <i aria-hidden="true" className="i-lucide-light:search size-4" />
              </InputGroupAddon>
              <InputGroupInput
                ref={searchInput}
                aria-label={t('tags.search')}
                placeholder={t('tags.search')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </InputGroup>
            <Button
              ref={createButton}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={editing != null && editing.tagId == null}
              disabled={pending || editing != null}
              onClick={() => {
                returnFocus.current = () => createButton.current
                setSearch('')
                setEditing({ name: '' })
              }}
            >
              <i aria-hidden="true" className="i-lucide-light:plus size-4" />
              {t('tags.create')}
            </Button>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={
                <DialogClose
                  className="col-start-2 row-start-1 sm:col-start-3"
                  render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t('common.close')} disabled={pending} />}
                />
              }
            >
              <i aria-hidden="true" className="i-lucide-light:x size-4" />
            </TooltipTrigger>
            <TooltipContent container={root}>{t('common.close')}</TooltipContent>
          </Tooltip>
        </DialogHeader>
        <Popover
          open={editing != null}
          onOpenChange={(open) => {
            if (!open && !pending) setEditing(undefined)
          }}
        >
          <PopoverContent
            anchor={returnFocus.current?.()}
            align="end"
            container={root}
            initialFocus={nameInput}
            finalFocus={() => returnFocus.current?.() ?? createButton.current}
            className="w-96 max-w-[calc(100vw-2rem)]"
            aria-label={editing?.tagId == null ? t('tags.create') : t('common.rename')}
          >
            {editing != null && (
              <form
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  // Portal events still bubble to the surrounding Flow form in the React tree.
                  event.stopPropagation()
                  void save()
                }}
              >
                <Field className="min-w-0 flex-1" data-invalid={invalid}>
                  <ValueEditorFeedback error={nameError}>
                    {(errorId) => (
                      <Input
                        ref={nameInput}
                        id="tag-name"
                        aria-label={t('resource.name')}
                        placeholder={t('resource.name')}
                        value={editing.name}
                        disabled={pending}
                        onChange={(event) => setEditing({ ...editing, name: event.target.value, conflict: false })}
                        aria-invalid={invalid}
                        aria-describedby={errorId}
                      />
                    )}
                  </ValueEditorFeedback>
                </Field>
                <Button type="button" variant="outline" disabled={pending} onClick={() => setEditing(undefined)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={pending || issue != null || conflict}>
                  {t('common.save')}
                </Button>
              </form>
            )}
          </PopoverContent>
        </Popover>
        {state.loading ? (
          <p role="status" className="m-0 p-4 text-muted-foreground">
            {t('tags.loading')}
          </p>
        ) : state.failed ? (
          <Button className="m-4 justify-self-start" variant="outline" onClick={() => void store.tags.reload()}>
            {t('empty.retry')}
          </Button>
        ) : (
          <div className="min-h-0 max-h-[min(60vh,32rem)] overflow-auto">
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <colgroup>
                <col className="sm:w-3/5" />
                <col className="w-24 sm:w-auto" />
                <col className="w-16 sm:w-20" />
              </colgroup>
              <thead className="sticky top-0 bg-popover text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th scope="col" className="h-10 px-4 font-medium">
                    {t('resource.name')}
                  </th>
                  <th scope="col" className="h-10 px-4 text-center font-medium">
                    {t('tags.usage')}
                  </th>
                  <th scope="col" className="h-10 px-4 text-center font-medium">
                    {t('resource.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((tag) => (
                  <tr key={tag.tagId} className="border-b border-border last:border-0">
                    <td className="h-16 px-4 py-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground">
                          <i aria-hidden="true" className="i-lucide-light:tag size-3.5" />
                        </span>
                        <Tooltip>
                          <TooltipTrigger render={<span tabIndex={0} className="min-w-0 truncate font-medium" />}>{tag.name}</TooltipTrigger>
                          <TooltipContent container={root} className="max-w-sm break-words">
                            {tag.name}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {tag.referenceCount == 0 ? (
                        <span className="font-medium text-muted-foreground">{t('resource.flowCount', { count: 0 })}</span>
                      ) : (
                        <Popover>
                          <PopoverTrigger render={<Button variant="ghost" />} aria-label={t('tags.references', { name: tag.name })}>
                            {t('resource.flowCount', { count: tag.referenceCount })}
                          </PopoverTrigger>
                          <PopoverContent container={root} align="end" className="w-96 max-w-[calc(100vw-2rem)] gap-4 p-4">
                            <PopoverTitle className="break-words text-base font-semibold">{t('tags.references', { name: tag.name })}</PopoverTitle>
                            <TagReferences
                              {...context}
                              onSelectFlow={(flow) => {
                                onClose()
                                context.onSelectFlow(flow)
                              }}
                              tag={tag}
                            />
                          </PopoverContent>
                        </Popover>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <TagActions
                        container={root}
                        disabled={pending || editing != null}
                        onRename={(focus) => {
                          returnFocus.current = focus
                          setEditing({ tagId: tag.tagId, name: tag.name })
                        }}
                        onDelete={(focus) => {
                          returnFocus.current = focus
                          setDeleting(tag)
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length == 0 && <p className="py-8 text-center text-muted-foreground">{t('tags.noMatches')}</p>}
          </div>
        )}
        <DialogFooter className="mx-0 mb-0 shrink-0">
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
        {deleting != null && (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open && !pending) setDeleting(undefined)
            }}
          >
            <DialogContent
              container={root}
              initialFocus={cancelDelete}
              finalFocus={() => returnFocus.current?.() ?? createButton.current}
              closeLabel={t('common.cancel')}
            >
              <DialogHeader>
                <DialogTitle>{t('tags.deleteTitle', { name: deleting.name })}</DialogTitle>
                <DialogDescription>{t('tags.deleteDescription', { count: deleting.referenceCount })}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button ref={cancelDelete} variant="outline" disabled={pending} onClick={() => setDeleting(undefined)}>
                  {t('common.cancel')}
                </Button>
                <Button variant="destructive" disabled={pending} onClick={() => void remove()}>
                  {t('common.delete')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  )
}
