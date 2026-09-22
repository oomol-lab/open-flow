import styles from './nodePicker.module.scss'
import type { DragEvent as ReactDragEvent, ReactElement } from 'react'
import type { AddNodeOption } from './addNodeOptions.ts'
import type { BlockLibraryProps } from './blockLibrary.tsx'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { setAddItemId } from '../../../../canvas/browser/addItemDrag.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { useDebouncedValue } from '../../../../ui/browser/hooks.ts'
import { ContentIcon } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../../../ui/browser/input-group.tsx'
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../../../ui/browser/tabs.tsx'
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/browser/tooltip.tsx'
import { Icon } from '../icons.tsx'
import { observeResource } from '../stores/resource.ts'
import { comparePickerApps, pickerConnectionPriorities } from './nodePickerApps.ts'

interface App {
  id: string
  label: string
  icon?: string
  priority?: number
  directory?: AddNodeOption
  triggers: AddNodeOption[]
}

export function NodePickerContent({
  options,
  connections,
  loadConnections,
  browseOptions,
  searchOptions,
  provideChoices,
  onAdd,
  onDragStart,
  onDragEnd,
  onRegisterDragOption,
  draggable = true,
  disabled,
  isOptionDisabled,
  catalogFailed,
  initialQuery = '',
  initialTab = 'nodes',
}: BlockLibraryProps & { readonly initialQuery?: string }): ReactElement {
  const t = useTranslate()
  const [page, setPage] = useState(initialTab)
  const [query, setQuery] = useState(initialQuery)
  const [appQuery, setAppQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const searchSession = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    searchSession.current = controller
    return () => controller.abort()
  }, [])
  const debouncedQuery = useDebouncedValue(query, 150)
  const term = query.trim() ? debouncedQuery.trim() : ''
  const [catalog, setCatalog] = useState<readonly AddNodeOption[]>([])
  const [results, setResults] = useState<readonly AddNodeOption[]>([])
  const [appId, setAppId] = useState<string>()
  const [navigation, setNavigation] = useState<'forward' | 'back'>()
  const navigateApp = (id?: string) => {
    setNavigation(id ? 'forward' : 'back')
    setAppId(id)
    setAppQuery('')
    searchInput.current?.focus()
  }
  const [actions, setActions] = useState<readonly AddNodeOption[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [adding, setAdding] = useState(false)
  const busy = useRef(false)
  const list = useRef<HTMLDivElement>(null)
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const mount = useCallback((element: HTMLDivElement | null) => {
    setRoot(element?.closest<HTMLElement>('.open-flow-workbench') ?? element?.closest<HTMLElement>('.open-flow-theme') ?? null)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setCatalogError(false)
    setCatalogLoading(true)
    observeResource(browseOptions(controller.signal), controller.signal, (state) => {
      setCatalog(state.data ?? [])
      setCatalogError(state.error != null)
      setCatalogLoading(state.refreshing || (state.data == null && state.error == null))
    })
    return () => controller.abort()
  }, [browseOptions, options, t])

  useEffect(() => {
    const controller = new AbortController()
    setFailed(false)
    setLoading(false)
    setResults([])
    if (term && appId == null) {
      setLoading(true)
      observeResource(searchOptions(term, controller.signal, searchSession.current!.signal), controller.signal, (state) => {
        setResults(state.data ?? [])
        setFailed(state.error != null)
        setLoading(state.refreshing || (state.data == null && state.error == null))
      })
    }
    return () => controller.abort()
  }, [term, appId, searchOptions, options, t])

  useEffect(() => {
    const controller = new AbortController()
    void loadConnections?.(controller.signal).catch(() => {
      // Connection availability enriches ordering without blocking the app directory.
    })
    return () => controller.abort()
  }, [loadConnections])

  const apps = useMemo(() => {
    const priorities = pickerConnectionPriorities(connections ?? [])
    const entries = new Map<string, App>()
    for (const item of catalog) {
      if (item.kind == 'connector-group')
        entries.set(item.serviceId, {
          id: item.serviceId,
          label: item.label,
          icon: item.icon,
          priority: Math.min(priorities.get(item.serviceId) ?? 3, item.noSetup ? 2 : 3),
          directory: item,
          triggers: [],
        })
    }
    for (const item of catalog) {
      if (item.kind != 'trigger' || !('trigger' in item) || item.trigger.kind != 'catalog') continue
      const id = item.trigger.definition.provider
      const app = entries.get(id) ?? { id, label: id, icon: item.icon, priority: priorities.get(id), triggers: [] }
      app.triggers.push(item)
      entries.set(id, app)
    }
    return [...entries.values()].toSorted(comparePickerApps)
  }, [catalog, connections])
  const app = apps.find((item) => item.id == appId)
  const directoryId = app?.directory?.id
  const searching = term != '' && app == null
  const [choicesLoading, setChoicesLoading] = useState(false)
  const [choicesFailed, setChoicesFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setActions([])
    setChoicesFailed(false)
    setChoicesLoading(directoryId != null)
    if (directoryId != null)
      observeResource(provideChoices(directoryId, controller.signal), controller.signal, (state) => {
        setActions(state.data ?? [])
        setChoicesFailed(state.error != null)
        setChoicesLoading(state.data == null && state.error == null)
      })
    return () => controller.abort()
  }, [directoryId, provideChoices, t])
  useEffect(() => {
    list.current?.scrollTo(0, 0)
  }, [appId, term, page])

  const add = async (item: AddNodeOption) => {
    if (busy.current || disabled || isOptionDisabled?.(item)) return
    busy.current = true
    setAdding(true)
    try {
      await onAdd(item)
    } finally {
      busy.current = false
      setAdding(false)
    }
  }
  const drag = (event: ReactDragEvent, item: AddNodeOption) => {
    if (disabled || adding || isOptionDisabled?.(item)) return
    setAddItemId(event.dataTransfer, onRegisterDragOption?.(item) ?? item.id)
    onDragStart?.()
  }
  const row = (item: AddNodeOption, compact = false, index = 0) => {
    const button = (
      <Button
        variant="ghost"
        type="button"
        disabled={disabled || adding || isOptionDisabled?.(item)}
        draggable={draggable && !disabled && !adding && !isOptionDisabled?.(item)}
        onClick={() => void add(item)}
        onDragStart={(event) => drag(event, item)}
        onDragEnd={onDragEnd}
        className={`group/app h-auto justify-start whitespace-normal font-normal flex min-w-0 items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${compact ? '' : '[&>span:first-child]:translate-y-[2px]'}`}
      >
        {item.kind == 'connector' || (item.kind == 'trigger' && 'trigger' in item && (item.trigger.kind == 'catalog' || item.trigger.kind == 'connect')) ? (
          <AppIcon src={item.icon} />
        ) : (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
            <ContentIcon src={item.icon} className="size-[18px] data-[icon-kind=initials]:text-[20px]" />
          </span>
        )}
        <span className="min-w-0 flex-1 py-1">
          <span className="block text-[13px] leading-5">
            {searching && (
              <span className="text-xs font-normal text-muted-foreground">
                {item.kind == 'trigger'
                  ? 'trigger' in item && item.trigger.kind == 'catalog'
                    ? (apps.find((candidate) => candidate.triggers.some((trigger) => trigger.id == item.id))?.label ?? item.trigger.definition.provider)
                    : t('nodePicker.builtIn')
                  : item.kind == 'connector'
                    ? item.connector.serviceName
                    : t('nodePicker.builtIn')}
                <span aria-hidden="true" className="mx-2 text-muted-foreground/40">
                  |
                </span>
              </span>
            )}
            <span className="font-medium">{item.label}</span>
          </span>
          {!compact && (
            <span className="mt-1 block text-xs leading-[18px] text-muted-foreground">
              {item.kind == 'connector' ? item.connector.description : item.description}
            </span>
          )}
        </span>
      </Button>
    )
    return compact ? (
      <Tooltip key={item.id}>
        <TooltipTrigger render={button} />
        <TooltipContent container={root} side={index % 2 == 0 ? 'left' : 'right'} sideOffset={24}>
          {item.description}
        </TooltipContent>
      </Tooltip>
    ) : (
      <div key={item.id} className="grid">
        {button}
      </div>
    )
  }
  const section = (title: string, items: readonly AddNodeOption[], compact = false, appLabel?: string) =>
    items.length > 0 && (
      <section className={appLabel ? 'mb-1' : 'mb-3'}>
        <h3 style={{ margin: 0 }} className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">
          {title}
        </h3>
        <div className={compact ? 'grid grid-cols-2 gap-x-2' : 'grid'}>{items.map((item, index) => row(item, compact, index))}</div>
      </section>
    )
  const actionSections = (items: readonly AddNodeOption[]) =>
    (['read', 'write', 'destructive', 'other'] as const).map((type) => {
      const grouped = items.filter((item) => {
        if (item.kind != 'connector') return false
        const operation = item.connector.operationType
        return type == 'other' ? !['read', 'write', 'destructive'].includes(operation ?? '') : operation == type
      })
      return <div key={type}>{section(t(`nodePicker.actionGroups.${type}`), grouped)}</div>
    })
  const local = options.filter((item) => !term || `${item.label} ${item.description}`.toLowerCase().includes(term.toLowerCase()))
  const matches = [...new Map([...local, ...results].filter((item) => item.kind != 'connector-group').map((item) => [item.id, item])).values()]
  const matchedApps = apps.filter((item) => `${item.label} ${item.id}`.toLowerCase().includes(term.toLowerCase()))
  const filterAppOptions = (items: readonly AddNodeOption[]) =>
    items.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(appQuery.trim().toLowerCase()))
  const visibleActions = filterAppOptions(actions)
  const visibleTriggers = filterAppOptions(app?.triggers ?? [])
  const searchLabel = t(app == null ? 'nodePicker.search' : 'nodePicker.searchActions')
  const appRow = (item: App, description = false) => (
    <Button
      variant="ghost"
      key={item.id}
      type="button"
      disabled={disabled || adding}
      onClick={() => navigateApp(item.id)}
      className="group/app h-auto justify-start whitespace-normal font-normal flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      <AppIcon src={item.icon} />
      <span className="min-w-0 flex-1 py-1 text-[13px] font-normal leading-5">
        <span className="block truncate">{item.label}</span>
        {description && <span className="mt-1 block text-xs text-muted-foreground">{t('nodePicker.browseNodes')}</span>}
      </span>
      <span aria-hidden="true">›</span>
    </Button>
  )
  const inputQuery = app == null ? query : appQuery
  const setInputQuery = app == null ? setQuery : setAppQuery
  return (
    <Tabs value={page} onValueChange={(value) => setPage(value === 'triggers' ? 'triggers' : 'nodes')} className="h-full min-h-0 gap-0" aria-busy={adding}>
      <div ref={mount} className="shrink-0 px-3 pb-2 pt-3">
        <InputGroup>
          <InputGroupAddon>
            <Icon name="search" size={16} />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchInput}
            autoFocus
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={inputQuery}
            onChange={(event) => setInputQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key == 'ArrowDown') {
                event.preventDefault()
                list.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
              }
            }}
          />
          {inputQuery.length > 0 && (
            <InputGroupAddon align="inline-end">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('nodePicker.clearSearch')}
                onClick={() => {
                  setInputQuery('')
                  searchInput.current?.focus()
                }}
              >
                <Icon name="close" />
              </Button>
            </InputGroupAddon>
          )}
        </InputGroup>
      </div>
      {!term && app == null && (
        <div className="shrink-0 px-3 pb-2">
          <TabsList aria-label={t('designer.addNode')} variant="flat" className="w-full">
            <TabsTrigger value="nodes" className="px-3">
              {t('addNode.blocks')}
            </TabsTrigger>
            <TabsTrigger value="triggers" className="px-3">
              {t('addNode.triggers')}
            </TabsTrigger>
          </TabsList>
        </div>
      )}
      <TabsContent value={page} className="flex min-h-0 flex-1 flex-col overflow-visible">
        <div key={appId ?? 'catalog'} className={styles.page} data-navigation={navigation}>
          {app != null && (
            <div className="mx-3 mb-2 grid h-8 shrink-0 grid-cols-[28px_minmax(0,1fr)_28px] items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--ui-foreground)_4%,var(--ui-popover))] px-1.5">
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:bg-popover hover:text-foreground hover:shadow-sm focus-visible:bg-popover focus-visible:text-foreground dark:hover:bg-[color-mix(in_srgb,var(--ui-foreground)_12%,var(--ui-popover))] dark:focus-visible:bg-[color-mix(in_srgb,var(--ui-foreground)_12%,var(--ui-popover))]"
                aria-label={t(query.trim() ? 'nodePicker.backToResults' : 'nodePicker.back')}
                onClick={() => navigateApp()}
              >
                <Icon name="chevron-left" />
              </Button>
              <span className="min-w-0 truncate text-center text-sm font-semibold" title={app.label}>
                {app.label}
              </span>
            </div>
          )}
          <div
            ref={list}
            className="min-h-0 flex-1 overflow-y-scroll overscroll-contain px-2 py-2"
            onKeyDown={(event) => {
              if (event.key != 'ArrowDown' && event.key != 'ArrowUp') return
              const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
              const index = buttons.indexOf(event.target as HTMLButtonElement)
              if (index < 0) return
              event.preventDefault()
              buttons[(index + (event.key == 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
            }}
          >
            {app != null ? (
              <>
                {section(t('addNode.triggers'), visibleTriggers)}
                {actionSections(visibleActions)}
                {!choicesLoading && !choicesFailed && !catalogFailed && visibleActions.length == 0 && visibleTriggers.length == 0 && <PickerStatus />}
              </>
            ) : searching ? (
              <>
                {matchedApps.length > 0 && (
                  <section className="mb-3">
                    <h3 style={{ margin: 0 }} className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">
                      {t('nodePicker.apps')}
                    </h3>
                    {matchedApps.length == 1 ? (
                      <div className="grid">{matchedApps.map((item) => appRow(item, true))}</div>
                    ) : (
                      <AppDirectory viewport={list.current}>{matchedApps.map((item) => appRow(item))}</AppDirectory>
                    )}
                  </section>
                )}
                {section(
                  t('addNode.triggers'),
                  matches.filter((item) => item.kind == 'trigger'),
                )}
                {section(
                  t('addNode.blocks'),
                  matches.filter((item) => item.kind != 'trigger' && item.kind != 'connector'),
                )}
                {actionSections(matches)}
                {!loading && !catalogLoading && !failed && !catalogError && !catalogFailed && matchedApps.length == 0 && matches.length == 0 && (
                  <PickerStatus />
                )}
              </>
            ) : page == 'triggers' ? (
              <>
                {section(
                  t('nodePicker.builtIn'),
                  local.filter((item) => item.kind == 'trigger'),
                )}
                {apps
                  .filter((item) => item.triggers.length > 0)
                  .map((item) => (
                    <div key={item.id}>{section(item.label, item.triggers, false, item.label)}</div>
                  ))}
              </>
            ) : (
              <>
                {section(
                  t('nodePicker.builtInNodes'),
                  local.filter((item) => item.kind != 'trigger'),
                  true,
                )}
                {(['configured', 'builtInAccount', 'noSetup', 'needsSetup'] as const).map((group, priority) => {
                  const items = apps.filter((item) => item.directory != null && (item.priority ?? 3) == priority)
                  if (items.length == 0) return null
                  return (
                    <section key={group} className="mb-3">
                      <div className="flex items-center gap-1 px-2.5 pb-1 text-muted-foreground">
                        <h3 style={{ margin: 0 }} className="text-xs font-medium">
                          {t(`nodePicker.${group}`)}
                        </h3>
                        <Tooltip>
                          <TooltipTrigger
                            aria-label={t(`nodePicker.${group}`)}
                            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <i aria-hidden="true" className="i-codicon:question text-[13px]" />
                          </TooltipTrigger>
                          <TooltipContent container={root} side="top" align="start">
                            {t(`nodePicker.${group}Description`)}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <AppDirectory viewport={list.current}>{items.map((item) => appRow(item))}</AppDirectory>
                    </section>
                  )
                })}
              </>
            )}
            {(app != null ? choicesLoading : catalogLoading || loading) && <PickerStatus loading searching={searching} />}
          </div>
        </div>
      </TabsContent>
    </Tabs>
  )
}

function AppIcon({ src }: { src?: string }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-popover border border-[color-mix(in_srgb,var(--ui-foreground)_9%,var(--ui-popover))] text-[16px] group-hover/app:border-[color-mix(in_srgb,var(--ui-foreground)_14%,var(--ui-popover))] group-focus-visible/app:border-[color-mix(in_srgb,var(--ui-foreground)_14%,var(--ui-popover))] [--content-icon-initials-background:transparent]">
      <ContentIcon src={src} loading="eager" decoding="sync" className="size-4 data-[icon-kind=initials]:text-[20px]" />
    </span>
  )
}

// App rows have a fixed 42px height. Keep only the viewport and a small overscan mounted.
function AppDirectory({ children, viewport }: { children: ReactElement[]; viewport: HTMLDivElement | null }) {
  const container = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState({ start: 0, end: 20 })
  useEffect(() => {
    if (!viewport || !container.current) return
    const update = () => {
      const offset = container.current!.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
      const start = Math.max(0, Math.floor((viewport.scrollTop - offset) / 42) - 4)
      const end = Math.max(20, Math.ceil((viewport.scrollTop - offset + viewport.clientHeight) / 42) + 4)
      setRange((previous) => (previous.start == start && previous.end == end ? previous : { start, end }))
    }
    update()
    viewport.addEventListener('scroll', update)
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    return () => {
      viewport.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [viewport, children.length])
  const start = Math.min(range.start * 2, children.length)
  const end = Math.min(range.end * 2, children.length)
  return (
    <div
      ref={container}
      className="grid grid-cols-2 gap-x-2"
      style={{ paddingTop: Math.ceil(start / 2) * 42, paddingBottom: Math.ceil((children.length - end) / 2) * 42 }}
      onKeyDown={(event) => {
        const button = (event.target as HTMLElement).closest('button')
        const index = [...event.currentTarget.querySelectorAll('button')].indexOf(button!) + start
        const step = event.key == 'ArrowDown' ? 1 : event.key == 'ArrowUp' ? -1 : event.key == 'Tab' ? (event.shiftKey ? -1 : 1) : 0
        const next = index + step
        if (!step || next < 0 || next >= children.length) return
        event.preventDefault()
        event.stopPropagation()
        if (next < start || next >= end) setRange({ start: Math.max(0, Math.floor(next / 2) - 4), end: Math.floor(next / 2) + 16 })
        requestAnimationFrame(() => {
          const target = container.current?.querySelector<HTMLButtonElement>(`[data-app-index="${next}"] button`)
          target?.focus()
          target?.scrollIntoView({ block: 'nearest' })
        })
      }}
    >
      {children.slice(start, end).map((child, index) => (
        <div key={child.key} data-app-index={start + index} className="grid h-[42px] min-w-0">
          {child}
        </div>
      ))}
    </div>
  )
}

function PickerStatus({ loading = false, searching = false }: { loading?: boolean; searching?: boolean }) {
  const t = useTranslate()
  return (
    <div className="flex items-center gap-2 p-3 text-xs leading-4 text-muted-foreground" role="status">
      <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
        {loading ? <Spinner /> : <i className="i-lucide-light:search-x text-base" />}
      </span>
      <span>{t(loading ? (searching ? 'nodePicker.searching' : 'contextPanel.loading') : 'contextPanel.empty')}</span>
    </div>
  )
}
