import type { DragEvent as ReactDragEvent, ReactElement, ReactNode, RefObject } from 'react'
import type { WorkbenchTheme } from '../contract.ts'
import type { IconName } from '../icons.tsx'
import type { AddNodeOption } from './addNodeOptions.ts'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Virtualizer } from 'virtua'
import { setAddItemId } from '../../../../canvas/browser/addItemDrag.ts'
import { Button, buttonVariants } from '../../../../ui/browser/button.tsx'
import { filterCollectionItems, useCollectionItems } from '../../../../ui/browser/collectionSearch.ts'
import { useDebouncedValue } from '../../../../ui/browser/hooks.ts'
import { ContentIcon } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../../../ui/browser/input-group.tsx'
import { ScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { cn } from '../../../../ui/browser/utils.ts'
import { Icon } from '../icons.tsx'
import { indexAddNodeOptions } from './addNodeOptions.ts'
import { cycleContextPanelFocus, observeContextPanelOverlay } from './contextPanelBehavior.ts'

interface ContextPanelProps {
  readonly heading?: ReactNode
  readonly headerRef?: (element: HTMLDivElement | null) => void
  readonly children: ReactNode
  readonly focusOnOpen: boolean
  readonly icon: IconName
  readonly onClose: () => void
  readonly theme: WorkbenchTheme
  readonly title: string
}

interface LibraryItemProps {
  readonly disabled: boolean
  readonly draggable: boolean
  readonly item: LibraryNodeItem
  readonly onAdd: (itemId: string) => void
  readonly onDrag: (event: ReactDragEvent, itemId: string) => void
  readonly onLoadChoices: (itemId: string, signal: AbortSignal) => Promise<readonly LibraryChoice[] | undefined>
  readonly onOpenChange: (itemId: string, open: boolean) => void
}

interface LibraryChoice {
  readonly data: string
  readonly label: string
  readonly description?: string
}

interface LibraryNodeItem {
  readonly type: AddNodeOption['kind']
  readonly data: string
  readonly label: string
  readonly description?: string
  readonly detail?: string
  readonly icon?: string
  readonly disabled?: boolean
  readonly choices?: readonly LibraryChoice[]
}

type LibraryMenuItem = LibraryNodeItem | { readonly type: 'divider'; readonly label: string; readonly detail?: string }

interface BlockLibraryProps {
  readonly browseOptions: (signal: AbortSignal) => Promise<readonly AddNodeOption[] | undefined>
  readonly searchOptions: (query: string, signal: AbortSignal) => Promise<readonly AddNodeOption[] | undefined>
  readonly disabled: boolean
  readonly draggable?: boolean
  readonly focusRequest: number
  readonly onAdd: (option: AddNodeOption) => Promise<string | undefined>
  readonly onRegisterDragOption?: (option: AddNodeOption) => void
  readonly options: readonly AddNodeOption[]
  readonly provideChoices: (optionId: string, signal: AbortSignal) => Promise<readonly AddNodeOption[] | undefined>
}

function useOverlayPanel(panel: RefObject<HTMLElement | null>): boolean {
  const [overlay, setOverlay] = useState(false)

  useEffect(() => {
    const root = panel.current?.closest<HTMLElement>('.open-flow-workbench')
    if (root == null) return
    return observeContextPanelOverlay(root, setOverlay)
  }, [panel])

  return overlay
}

export function ContextPanel({ children, focusOnOpen, headerRef, heading, icon, onClose, theme, title }: ContextPanelProps): ReactElement {
  const t = useTranslate()
  const panel = useRef<HTMLElement>(null)
  const overlay = useOverlayPanel(panel)
  const titleId = useId()

  useEffect(() => {
    if (overlay && focusOnOpen) panel.current?.focus({ preventScroll: true })
  }, [focusOnOpen, overlay])

  useEffect(() => {
    if (!overlay) return
    const close = (event: KeyboardEvent): void => {
      const target = event.target
      if (event.key != 'Escape' || event.defaultPrevented || (target instanceof Element && target.closest('.oo-designer-quick-pick-panel') != null)) return
      event.preventDefault()
      onClose()
    }
    globalThis.addEventListener('keydown', close)
    return () => globalThis.removeEventListener('keydown', close)
  }, [onClose, overlay])

  const keyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return
    const current = panel.current
    if (current == null || !(event.target instanceof Node) || !current.contains(event.target)) return
    if (event.key == 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (!overlay || event.key != 'Tab') return
    const focusable = [
      ...current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ]
    if (cycleContextPanelFocus(current, focusable, current.ownerDocument.activeElement, event.shiftKey)) event.preventDefault()
  }

  useEffect(() => {
    const current = panel.current
    current?.ownerDocument.addEventListener('keydown', keyDown)
    return () => current?.ownerDocument.removeEventListener('keydown', keyDown)
  }, [onClose, overlay])

  return (
    <>
      <div aria-hidden="true" className="context-panel-backdrop" onClick={onClose} />
      <aside
        aria-labelledby={titleId}
        aria-modal={overlay || undefined}
        className="context-panel"
        data-theme={theme}
        ref={panel}
        role={overlay ? 'dialog' : 'complementary'}
        tabIndex={-1}
      >
        <header>
          {headerRef == null ? (
            <>
              <span className="node-icon small">
                <Icon name={icon} size={16} />
              </span>
              <strong id={titleId}>{title}</strong>
            </>
          ) : (
            <>
              <span className="sr-only" id={titleId}>
                {title}
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {heading}
                <div className={heading == null ? 'context-panel-node-heading' : 'shrink-0'} ref={headerRef} />
              </div>
            </>
          )}
          <Button aria-label={t('contextPanel.close')} onClick={onClose} size="icon-sm" type="button" variant="ghost">
            <Icon name="close" />
          </Button>
        </header>
        <div className="context-panel-content">{children}</div>
      </aside>
    </>
  )
}

function menuItems(options: readonly AddNodeOption[]): LibraryMenuItem[] {
  const items: LibraryMenuItem[] = []
  let group: string | undefined
  for (const option of options) {
    if (option.group != null && option.group != group) {
      group = option.group
      items.push({ label: group, type: 'divider' })
    }
    items.push({
      choices: option.choices?.map((choice) => ({
        data: choice.option.id,
        description: choice.description,
        label: choice.label,
      })),
      data: option.id,
      description: option.description,
      detail: option.description,
      icon: option.icon,
      label: option.label,
      type: option.kind,
    })
  }
  return items
}

function fallbackIcon(item: LibraryNodeItem): IconName {
  switch (item.type) {
    case 'agent':
      return 'llm'
    case 'condition':
      return 'condition'
    case 'connector':
    case 'connector-group':
      return 'connection'
    case 'llm':
      return 'llm'
    case 'trigger':
      return 'trigger'
    case 'value':
      return 'value'
    case 'wait':
      return 'wait'
    case 'new-task':
    case 'subflow':
    case 'comment':
      return 'task'
  }
}

function LibraryRow({ item, trailing }: { readonly item: LibraryNodeItem; readonly trailing?: ReactNode }): ReactElement {
  const fallback = <Icon name={fallbackIcon(item)} />
  return (
    <span className="block-library-row" title={item.detail ?? item.description ?? item.label}>
      <span className="block-library-row-icon">
        <ContentIcon className="block-library-row-glyph" fallback={fallback} src={item.icon} />
      </span>
      <span className="block-library-row-label">{item.label}</span>
      {item.description && <span className="block-library-row-description">{item.description}</span>}
      {trailing}
    </span>
  )
}

function LibraryGroup({
  label,
  children,
  nested,
  open,
  onToggle,
}: {
  readonly label: string
  readonly children?: ReactNode
  readonly nested?: boolean
  readonly open?: boolean
  readonly onToggle?: () => void
}): ReactElement {
  return (
    <div className={cn('block-library-group', nested ? 'block-library-subgroup' : 'block-library-category')}>
      {onToggle == null ? (
        <span className={nested ? 'block-library-subgroup-title' : 'block-library-category-title'}>{label}</span>
      ) : (
        <Button
          aria-expanded={open}
          className={cn('min-w-0 flex-1 text-left', nested ? 'justify-start' : 'justify-between px-0')}
          onClick={onToggle}
          size="sm"
          type="button"
          variant="disclosure"
        >
          {nested && <Icon className={open ? undefined : '-rotate-90'} name="chevron-down" />}
          <span className={cn('truncate', nested ? 'block-library-subgroup-title' : 'block-library-category-title')}>{label}</span>
          {!nested && <Icon className={open ? undefined : '-rotate-90'} name="chevron-down" />}
        </Button>
      )}
      {children}
    </div>
  )
}

function LibraryItem({ disabled, draggable, item, onAdd, onDrag, onLoadChoices, onOpenChange }: LibraryItemProps): ReactElement {
  const t = useTranslate()
  const connectionChoices = item.type == 'trigger'
  const controller = useRef<AbortController>()
  const [choices, setChoices] = useState(item.choices)
  const [error, setError] = useState(false)
  const [loaded, setLoaded] = useState(item.choices == null || item.choices.length > 0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    controller.current?.abort()
    setChoices(item.choices)
    setError(false)
    setLoaded(item.choices == null || item.choices.length > 0)
    setLoading(false)
    return () => controller.current?.abort()
  }, [item.choices, item.data])

  const load = useCallback((): void => {
    if (item.data == null || disabled || loading) return
    controller.current?.abort()
    const nextController = new AbortController()
    controller.current = nextController
    setError(false)
    setLoading(true)
    void onLoadChoices(item.data, nextController.signal)
      .then((nextChoices) => {
        if (nextController.signal.aborted || nextChoices == null) return
        setChoices(nextChoices)
        setLoaded(true)
      })
      .catch(() => {
        if (!nextController.signal.aborted) setError(true)
      })
      .finally(() => {
        if (!nextController.signal.aborted) setLoading(false)
      })
  }, [disabled, item.data, loading, onLoadChoices])

  if (item.choices != null) {
    return (
      <details
        className="block-library-choices"
        onToggle={(event) => {
          onOpenChange(item.data ?? item.label, event.currentTarget.open)
          if (event.currentTarget.open && !loaded) load()
        }}
      >
        <summary
          aria-disabled={disabled}
          className={cn(buttonVariants({ variant: 'ghost' }), 'block-library-item h-auto min-h-12 justify-start whitespace-normal px-2 py-2')}
          onClick={(event) => disabled && event.preventDefault()}
        >
          <LibraryRow
            item={item}
            trailing={
              <span className="block-library-expand">
                {loaded && (choices?.length ?? 0)}
                <Icon name="chevron-down" size={13} />
              </span>
            }
          />
        </summary>
        <div className="block-library-choice-list">
          {choices?.map((choice) => {
            const choiceItem = { ...item, choices: undefined, data: choice.data, description: choice.description, label: choice.label }
            return (
              <Button
                className="block-library-item h-auto min-h-12 justify-start whitespace-normal px-2 py-2"
                disabled={disabled}
                draggable={draggable && !disabled}
                key={choice.data}
                onClick={() => onAdd(choice.data)}
                onDragStart={(event) => onDrag(event, choice.data)}
                type="button"
                variant="ghost"
              >
                <LibraryRow item={choiceItem} />
              </Button>
            )
          })}
          {loading && (
            <div className="block-library-choice-feedback">{t(connectionChoices ? 'contextPanel.loadingConnections' : 'contextPanel.loadingActions')}</div>
          )}
          {!loading && error && (
            <div className="block-library-choice-feedback" role="alert">
              <span>{t(connectionChoices ? 'contextPanel.loadConnectionsFailed' : 'contextPanel.loadActionsFailed')}</span>
              <Button onClick={load} size="sm" type="button" variant="secondary">
                {t('contextPanel.retry')}
              </Button>
            </div>
          )}
          {!loading && !error && loaded && choices?.length == 0 && (
            <div className="block-library-choice-feedback">{t(connectionChoices ? 'contextPanel.noConnections' : 'contextPanel.noActions')}</div>
          )}
        </div>
      </details>
    )
  }
  return (
    <Button
      className="block-library-item h-auto min-h-12 justify-start whitespace-normal px-2 py-2"
      disabled={disabled}
      draggable={draggable && !disabled}
      onClick={() => item.data != null && onAdd(item.data)}
      onDragStart={(event) => item.data != null && onDrag(event, item.data)}
      type="button"
      variant="ghost"
    >
      <LibraryRow item={item} />
    </Button>
  )
}

export function BlockLibrary({
  browseOptions,
  disabled,
  draggable = true,
  focusRequest,
  onAdd,
  onRegisterDragOption,
  options,
  provideChoices,
  searchOptions,
}: BlockLibraryProps): ReactElement {
  const t = useTranslate()
  const searchLabel = options.length == 0 ? t('actionPicker.search') : t('contextPanel.search')
  const search = useRef<HTMLInputElement>(null)
  const active = useRef(true)
  const dynamicOptions = useRef<ReadonlyMap<string, AddNodeOption>>(new Map())
  const [query, setQuery] = useState('')
  const [viewport, setViewport] = useState<HTMLElement | null>(null)
  const filterQuery = useDebouncedValue(query, 100)
  const [adding, setAdding] = useState(false)
  const [settled, setSettled] = useState(false)
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set(options.length == 0 ? [t('addNode.connectorActions')] : []))
  const [openItems, setOpenItems] = useState<ReadonlySet<string>>(() => new Set())
  const staticOptions = useMemo(() => indexAddNodeOptions(options), [options])
  const integrationGroup = t('addNode.connectorActions')
  const triggerGroup = t('addNode.integrationTriggers')
  const triggers = t('addNode.triggers')
  const localItems = useMemo(() => {
    const items = menuItems(options)
    if (!items.some((item) => item.type == 'divider' && item.label == integrationGroup)) items.push({ type: 'divider', label: integrationGroup })
    if (items.some((item) => item.type == 'divider' && item.label == triggers) && !items.some((item) => item.type == 'divider' && item.label == triggerGroup)) {
      items.push({ type: 'divider', label: triggerGroup })
    }
    return items
  }, [options, integrationGroup, triggerGroup, triggers])
  const provideAsyncItems = useCallback(
    async (searchTerm: string, signal: AbortSignal): Promise<readonly LibraryMenuItem[] | undefined> => {
      setSettled(false)
      try {
        const nextOptions = await (searchTerm.trim() == '' ? browseOptions(signal) : searchOptions(searchTerm, signal))
        if (signal.aborted || nextOptions == null) return
        dynamicOptions.current = indexAddNodeOptions(nextOptions)
        return menuItems(nextOptions)
      } finally {
        if (!signal.aborted) setSettled(true)
      }
    },
    [browseOptions, searchOptions],
  )
  const loadChoices = useCallback(
    async (itemId: string, signal: AbortSignal): Promise<readonly LibraryChoice[] | undefined> => {
      const nextOptions = await provideChoices(itemId, signal)
      if (signal.aborted || nextOptions == null) return
      dynamicOptions.current = new Map([...dynamicOptions.current, ...indexAddNodeOptions(nextOptions)])
      return nextOptions.map((option) => ({ data: option.id, description: option.description, label: option.label }))
    },
    [provideChoices],
  )
  const { error, items: catalogItems, retry } = useCollectionItems(localItems, filterQuery, provideAsyncItems)
  const loading = !settled
  const searching = filterQuery.trim() != ''
  const items = useMemo(() => {
    const ordered = [...catalogItems]
    const start = ordered.findIndex((item) => item.type == 'divider' && item.label == triggerGroup)
    if (start >= 0) {
      const next = ordered.findIndex((item, index) => index > start && item.type == 'divider')
      const group = ordered.splice(start, (next < 0 ? ordered.length : next) - start)
      const parent = ordered.findIndex((item) => item.type == 'divider' && item.label == triggers)
      const end = parent < 0 ? -1 : ordered.findIndex((item, index) => index > parent && item.type == 'divider')
      const heading = group[0]
      if (heading != null) group[0] = { ...heading, detail: triggers }
      ordered.splice(end < 0 ? ordered.length : end, 0, ...group)
    }
    const matches = filterCollectionItems('', ordered)
    if (searching) return matches
    let hidden = false
    return matches.filter((item) => {
      if (item.type == 'divider') {
        hidden = (item.label == integrationGroup || item.label == triggerGroup) && !openGroups.has(item.label)
        return true
      }
      return !hidden
    })
  }, [catalogItems, integrationGroup, triggerGroup, triggers, openGroups, searching])
  const keptItems = useMemo(() => {
    const indexes: number[] = []
    for (let index = 0; index < items.length; index++) {
      const item = items[index]!
      if (item.type != 'divider' && openItems.has(item.data ?? item.label)) indexes.push(index)
    }
    return indexes
  }, [items, openItems])
  const busy = disabled || adding

  const setOpen = useCallback((itemId: string, open: boolean): void => {
    setOpenItems((current) => {
      const next = new Set(current)
      if (open) next.add(itemId)
      else next.delete(itemId)
      return next
    })
  }, [])

  useEffect(() => {
    search.current?.focus({ preventScroll: true })
  }, [focusRequest])

  useEffect(() => {
    const itemIds = new Set<string>()
    for (const item of items) {
      if (item.type != 'divider') itemIds.add(item.data ?? item.label)
    }
    setOpenItems((current) => {
      if ([...current].every((itemId) => itemIds.has(itemId))) return current
      return new Set([...current].filter((itemId) => itemIds.has(itemId)))
    })
  }, [items])

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])

  const resolve = (itemId: string): AddNodeOption | undefined => staticOptions.get(itemId) ?? dynamicOptions.current.get(itemId)
  const add = async (itemId: string): Promise<void> => {
    const option = resolve(itemId)
    if (option == null || busy) return
    setAdding(true)
    try {
      await onAdd(option)
    } finally {
      if (active.current) setAdding(false)
    }
  }
  const drag = (event: ReactDragEvent, itemId: string): void => {
    const option = resolve(itemId)
    if (option == null || busy) return
    onRegisterDragOption?.(option)
    setAddItemId(event.dataTransfer, itemId)
  }

  const feedback = loading ? (
    <span className="inline-flex items-center gap-1.5" role="status">
      <Spinner /> {t('contextPanel.loading')}
    </span>
  ) : error ? (
    <span className="inline-flex flex-wrap items-center gap-1.5" role="alert">
      {t('contextPanel.loadFailed')}
      <Button
        onClick={() => {
          setSettled(false)
          retry()
        }}
        size="sm"
        type="button"
        variant="secondary"
      >
        {t('contextPanel.retry')}
      </Button>
    </span>
  ) : undefined
  const hasConnectors = catalogItems.some((item) => item.type == 'connector' || item.type == 'connector-group')

  const renderItem = (item: (typeof items)[number]): ReactElement => {
    const option = item.type == 'divider' || item.data == null ? undefined : resolve(item.data)
    const nested =
      option?.kind == 'connector' || option?.kind == 'connector-group' || (option?.kind == 'trigger' && 'trigger' in option && option.trigger.kind == 'catalog')
    return (
      <div
        className={cn('block-library-list-entry', nested && 'block-library-subitem')}
        key={item.type == 'divider' ? `group:${item.label}` : (item.data ?? item.label)}
      >
        {item.type == 'divider' ? (
          <LibraryGroup
            label={item.label}
            nested={item.label == triggerGroup}
            open={searching || openGroups.has(item.label)}
            onToggle={
              (item.label == integrationGroup || item.label == triggerGroup) && !searching
                ? () =>
                    setOpenGroups((current) => {
                      const next = new Set(current)
                      if (next.has(item.label)) next.delete(item.label)
                      else next.add(item.label)
                      return next
                    })
                : undefined
            }
          >
            {item.label == integrationGroup && feedback}
            {item.label == integrationGroup && !loading && !error && !hasConnectors && openGroups.has(integrationGroup) && (
              <span role="status">{t('contextPanel.empty')}</span>
            )}
          </LibraryGroup>
        ) : (
          <LibraryItem
            disabled={busy || item.disabled == true}
            draggable={draggable}
            item={item}
            onAdd={(id) => void add(id)}
            onDrag={drag}
            onLoadChoices={loadChoices}
            onOpenChange={setOpen}
          />
        )}
      </div>
    )
  }

  return (
    <div aria-busy={adding || loading} className="block-library">
      <div className="mx-3.5 mb-2 mt-3 flex-none">
        <InputGroup>
          <span className="sr-only">{searchLabel}</span>
          <InputGroupAddon>
            <Icon name="search" size={15} />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={searchLabel}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchLabel}
            ref={search}
            value={query}
          />
        </InputGroup>
      </div>
      <ScrollArea className="block-library-list" defer={false} events={{ initialized: (instance) => setViewport(instance.elements().viewport) }} tabIndex={-1}>
        {viewport == null ? (
          items.map(renderItem)
        ) : (
          <Virtualizer data={items} itemSize={48} keepMounted={keptItems} key={items.length} scrollRef={{ current: viewport }}>
            {renderItem}
          </Virtualizer>
        )}
        {!items.some((item) => item.type == 'divider' && item.label == integrationGroup) && feedback != null && (
          <div className="block-library-feedback">{feedback}</div>
        )}
        {!loading && !error && items.length == 0 && <div className="block-library-feedback">{t('contextPanel.empty')}</div>}
        <div aria-hidden="true" className="h-4" />
      </ScrollArea>
    </div>
  )
}
