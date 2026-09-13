import styles from './nodePicker.module.scss'
import type { ReactElement } from 'react'
import type { AddNodeOption } from './addNodeOptions.ts'
import type { BlockLibraryProps } from './contextPanel.tsx'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { useDebouncedValue } from '../../../../ui/browser/hooks.ts'
import { ContentIcon } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../../../ui/browser/input-group.tsx'
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../../../ui/browser/tabs.tsx'
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/browser/tooltip.tsx'
import { Icon } from '../icons.tsx'

interface App {
  id: string
  label: string
  icon?: string
  directory?: AddNodeOption
  triggers: AddNodeOption[]
}

export function NodePickerContent({
  options,
  browseOptions,
  searchOptions,
  provideChoices,
  onAdd,
  disabled,
  catalogRevision,
  catalogFailed,
  refreshCatalog,
}: BlockLibraryProps): ReactElement {
  const t = useTranslate()
  const [page, setPage] = useState('nodes')
  const [query, setQuery] = useState('')
  const term = useDebouncedValue(query, 150).trim()
  const [catalog, setCatalog] = useState<readonly AddNodeOption[]>([])
  const [results, setResults] = useState<readonly AddNodeOption[]>([])
  const [appId, setAppId] = useState<string>()
  const [navigation, setNavigation] = useState<'forward' | 'back'>()
  const navigateApp = (id?: string) => {
    setNavigation(id ? 'forward' : 'back')
    setAppId(id)
  }
  const [actions, setActions] = useState<readonly AddNodeOption[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState(false)
  const busy = useRef(false)
  const list = useRef<HTMLDivElement>(null)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setFailed(false)
    setLoading(true)
    setResults([])
    const request = term ? searchOptions(term, controller.signal) : browseOptions(controller.signal)
    void request
      .then((items) => {
        if (controller.signal.aborted) return
        if (term) setResults(items ?? [])
        else setCatalog(items ?? [])
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [term, browseOptions, searchOptions, catalogRevision, retry, options])

  const apps = useMemo(() => {
    const entries = new Map<string, App>()
    for (const item of catalog) {
      if (item.kind == 'connector-group') entries.set(item.serviceId, { id: item.serviceId, label: item.label, icon: item.icon, directory: item, triggers: [] })
    }
    for (const item of catalog) {
      if (item.kind != 'trigger' || !('trigger' in item) || item.trigger.kind != 'catalog') continue
      const id = item.trigger.definition.provider
      const app = entries.get(id) ?? { id, label: id, icon: item.icon, triggers: [] }
      app.triggers.push(item)
      entries.set(id, app)
    }
    return [...entries.values()].toSorted((a, b) => a.label.localeCompare(b.label))
  }, [catalog])
  const app = apps.find((item) => item.id == appId)
  const directoryId = page == 'nodes' ? app?.directory?.id : undefined
  const [choicesLoading, setChoicesLoading] = useState(false)
  const [choicesFailed, setChoicesFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setActions([])
    setChoicesFailed(false)
    setChoicesLoading(directoryId != null)
    if (directoryId != null)
      void provideChoices(directoryId, controller.signal)
        .then((items) => {
          if (!controller.signal.aborted) setActions(items ?? [])
        })
        .catch(() => {
          if (!controller.signal.aborted) setChoicesFailed(true)
        })
        .finally(() => {
          if (!controller.signal.aborted) setChoicesLoading(false)
        })
    return () => controller.abort()
  }, [directoryId, provideChoices, retry])
  useEffect(() => {
    list.current?.scrollTo(0, 0)
  }, [appId, term, page])

  const add = async (item: AddNodeOption) => {
    if (busy.current || disabled) return
    busy.current = true
    setAdding(true)
    setAddError(false)
    try {
      if ((await onAdd(item)) == null) setAddError(true)
    } catch {
      setAddError(true)
    } finally {
      busy.current = false
      setAdding(false)
    }
  }
  const row = (item: AddNodeOption, compact = false) => {
    const button = (
      <Button
        variant="ghost"
        type="button"
        disabled={disabled || adding}
        onClick={() => void add(item)}
        className="group/app h-auto justify-start whitespace-normal font-normal flex min-w-0 items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {item.kind == 'connector' || (item.kind == 'trigger' && 'trigger' in item && (item.trigger.kind == 'catalog' || item.trigger.kind == 'connect')) ? (
          <AppIcon src={item.icon} />
        ) : (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
            <ContentIcon src={item.icon} className="size-[18px] data-[icon-kind=initials]:text-[20px]" />
          </span>
        )}
        <span className="min-w-0 flex-1 py-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 text-[13px] font-medium leading-5">{item.label}</span>
            {term && (
              <span className="max-w-[35%] shrink-0 truncate text-[11px] font-normal text-muted-foreground">
                {item.kind == 'trigger' ? t('addNode.triggers') : item.kind == 'connector' ? item.connector.serviceName : t('addNode.blocks')}
              </span>
            )}
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
        <TooltipContent container={root} side="bottom">
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
        <div className={compact ? 'grid grid-cols-2 gap-x-2' : 'grid'}>{items.map((item) => row(item, compact))}</div>
      </section>
    )
  const local = options.filter((item) => !term || `${item.label} ${item.description}`.toLowerCase().includes(term.toLowerCase()))
  const matches = [...new Map([...local, ...results].filter((item) => item.kind != 'connector-group').map((item) => [item.id, item])).values()]
  return (
    <Tabs ref={setRoot} value={page} onValueChange={(value) => setPage(String(value))} className="h-full min-h-0 gap-0" aria-busy={adding}>
      <div className="shrink-0 px-3 pb-2 pt-3">
        <InputGroup>
          <InputGroupAddon>
            <Icon name="search" size={16} />
          </InputGroupAddon>
          <InputGroupInput
            autoFocus
            aria-label={t('nodePicker.search')}
            placeholder={t('nodePicker.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key == 'ArrowDown') {
                event.preventDefault()
                list.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
              }
            }}
          />
        </InputGroup>
      </div>
      {!term && (
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
      <TabsContent value={page} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div key={appId ?? 'catalog'} className={styles.page} data-navigation={navigation}>
          {!term && page == 'nodes' && app != null && (
            <div className="mx-3 mb-1 flex shrink-0 items-center gap-2 border-b border-[color-mix(in_srgb,var(--ui-foreground)_9%,var(--ui-popover))] pb-3 pt-1">
              <Button size="icon-sm" variant="ghost" aria-label={t('nodePicker.back')} onClick={() => navigateApp()}>
                <Icon name="chevron-left" />
              </Button>
              <AppIcon src={app.icon} />
              <span className="text-sm font-medium">{app.label}</span>
            </div>
          )}
          <div
            ref={list}
            className="min-h-0 flex-1 overflow-y-scroll overscroll-contain py-2 pl-2 pr-0"
            onKeyDown={(event) => {
              if (event.key != 'ArrowDown' && event.key != 'ArrowUp') return
              const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
              const index = buttons.indexOf(event.target as HTMLButtonElement)
              if (index < 0) return
              event.preventDefault()
              buttons[(index + (event.key == 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
            }}
          >
            {term ? (
              <>
                {section(
                  t('addNode.triggers'),
                  matches.filter((item) => item.kind == 'trigger'),
                )}
                {section(
                  t('addNode.blocks'),
                  matches.filter((item) => item.kind != 'trigger'),
                )}
                {!loading && !failed && matches.length == 0 && <p className="p-3 text-sm text-muted-foreground">{t('contextPanel.empty')}</p>}
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
            ) : app != null ? (
              <>
                <div className="grid">{actions.map((item) => row(item))}</div>
                {!choicesLoading && !choicesFailed && actions.length == 0 && <p className="p-3 text-sm text-muted-foreground">{t('contextPanel.empty')}</p>}
              </>
            ) : (
              <>
                {section(
                  t('nodePicker.builtIn'),
                  local.filter((item) => item.kind != 'trigger'),
                  true,
                )}
                <section>
                  <h3 style={{ margin: 0 }} className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">
                    {t('nodePicker.apps')}
                  </h3>
                  <div className="grid grid-cols-2 gap-x-2">
                    {apps
                      .filter((item) => item.directory != null)
                      .map((item) => (
                        <Button
                          variant="ghost"
                          key={item.id}
                          type="button"
                          disabled={disabled || adding}
                          onClick={() => navigateApp(item.id)}
                          className="group/app h-auto justify-start whitespace-normal font-normal flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        >
                          <AppIcon src={item.icon} />
                          <span className="min-w-0 flex-1 truncate py-1 text-[13px] font-normal leading-5">{item.label}</span>
                          <span aria-hidden="true">›</span>
                        </Button>
                      ))}
                  </div>
                </section>
              </>
            )}
            {(loading || (!term && page == 'nodes' && choicesLoading)) && (
              <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground" role="status">
                <Spinner />
                {t('contextPanel.loading')}
              </div>
            )}
            {(failed || catalogFailed || (!term && page == 'nodes' && choicesFailed)) && (
              <div className="flex items-center justify-between gap-2 p-3 text-xs" role="alert">
                {t('contextPanel.loadFailed')}
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    setRetry((value) => value + 1)
                    refreshCatalog?.()
                  }}
                >
                  {t('contextPanel.retry')}
                </Button>
              </div>
            )}
            {addError && (
              <p className="p-3 text-xs text-destructive" role="alert">
                {t('actionPicker.failed')}
              </p>
            )}
          </div>
        </div>
      </TabsContent>
    </Tabs>
  )
}

function AppIcon({ src }: { src?: string }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-popover border border-[color-mix(in_srgb,var(--ui-foreground)_9%,var(--ui-popover))] text-[16px] group-hover/app:border-[color-mix(in_srgb,var(--ui-foreground)_14%,var(--ui-popover))] group-focus-visible/app:border-[color-mix(in_srgb,var(--ui-foreground)_14%,var(--ui-popover))] [--content-icon-initials-background:transparent]">
      <ContentIcon src={src} className="size-4 data-[icon-kind=initials]:text-[20px]" />
    </span>
  )
}
