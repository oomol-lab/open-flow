import styles from '../../../../ui/browser/navigation-page.module.scss'
import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { ResourceState } from '../stores/resource.ts'
import type { AddNodeOption } from './addNodeOptions.ts'

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Virtualizer } from 'virtua'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { useDebouncedValue } from '../../../../ui/browser/hooks.ts'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../../../ui/browser/input-group.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { ScrollArea } from '../../../../ui/browser/scroll-area.tsx'
import { Spinner } from '../../../../ui/browser/spinner.tsx'
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/browser/tooltip.tsx'
import { observeResource } from '../stores/resource.ts'
import { comparePickerApps, pickerConnectionPriorities, pickerAppGroups, pickerAppPriority } from './nodePickerApps.ts'
import { ProviderAppIcon } from './providerAppIcon.tsx'
import { ProviderGroupHeading } from './providerGroupHeading.tsx'

type ProviderOption = Extract<AddNodeOption, { kind: 'connector-group' }>

interface ActionPickerProps {
  readonly portalRoot?: HTMLElement | null
  readonly connectors: ConnectorStore
  readonly disabled: boolean
  readonly selected: readonly string[]
  readonly onToggle: (action: ConnectorActionView) => void
}

/** Selection UI consumes the catalog without inheriting the node library's insertion semantics. */
export function ActionPicker(props: ActionPickerProps) {
  const [provider, setProvider] = useState<ProviderOption>()
  const [navigation, setNavigation] = useState<'forward' | 'back'>()
  // Navigation replaces the search and resource scope together, including any pending debounce.
  return (
    <ActionPickerPage
      key={provider?.id ?? 'providers'}
      {...props}
      provider={provider}
      navigation={navigation}
      onNavigate={(next) => {
        setNavigation(next == null ? 'back' : 'forward')
        setProvider(next)
      }}
    />
  )
}

function ActionPickerPage({
  portalRoot,
  connectors,
  disabled,
  selected,
  onToggle,
  provider,
  onNavigate,
  navigation,
}: ActionPickerProps & {
  readonly navigation: 'forward' | 'back' | undefined
  readonly provider: ProviderOption | undefined
  readonly onNavigate: (provider: ProviderOption | undefined) => void
}) {
  const t = useTranslate()
  const id = useId()
  const [query, setQuery] = useState('')
  const [viewport, setViewport] = useState<HTMLElement | null>(null)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    search.current?.focus()
  }, [])
  const term = useDebouncedValue(query.trim(), 100)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ResourceState<readonly AddNodeOption[]>>({ data: undefined, refreshing: true, error: undefined })
  // Read cached snapshots before paint so navigation never flashes a synthetic loading state.
  useLayoutEffect(() => {
    const controller = new AbortController()
    setState({ data: undefined, refreshing: true, error: undefined })
    const source =
      provider != null
        ? connectors.provideAddNodeOptionChoices(provider.id, controller.signal)
        : term == ''
          ? connectors.browseAddNodeOptions(controller.signal)
          : connectors.provideAddNodeOptions(term, controller.signal)
    observeResource(source, controller.signal, setState)
    return () => controller.abort()
  }, [connectors, provider?.id, provider == null ? term : '', attempt])
  const connections = useVal(connectors.$.pickerConnections)
  const items = useMemo(
    () =>
      (state.data ?? []).filter(
        (item) =>
          provider == null ||
          term == '' ||
          `${item.label} ${item.kind == 'connector' ? item.connector.description : ''}`.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
      ),
    [state.data, provider, term],
  )
  const rows = useMemo(() => {
    if (provider != null || term != '') return items
    const priorities = pickerConnectionPriorities(connections)
    const providers = items
      .filter((item): item is ProviderOption => item.kind == 'connector-group')
      .map((item) => ({ item, label: item.label, priority: pickerAppPriority(item.serviceId, item.noSetup, priorities) }))
      .toSorted(comparePickerApps)
    const result: (AddNodeOption | { kind: 'provider-heading'; group: (typeof pickerAppGroups)[number] })[] = []
    pickerAppGroups.forEach((group, priority) => {
      const members = providers.filter((entry) => entry.priority == priority)
      if (members.length > 0) {
        result.push({ kind: 'provider-heading', group })
        result.push(...members.map((entry) => entry.item))
      }
    })
    return result
  }, [items, connections, provider, term])
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-2 px-4">
        <InputGroup>
          <InputGroupAddon>
            <i aria-hidden="true" className="i-lucide-light:search size-4" />
          </InputGroupAddon>
          <InputGroupInput
            ref={search}
            className="text-[13px]"
            aria-label={t(provider == null ? 'actionPicker.search' : 'actionPicker.searchActions')}
            placeholder={t(provider == null ? 'actionPicker.search' : 'actionPicker.searchActions')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
      </div>
      <div className={`${styles.page} gap-3`} data-navigation={navigation}>
        {provider != null && (
          <div className="mx-4 grid h-8 shrink-0 grid-cols-[28px_minmax(0,1fr)_28px] items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--ui-foreground)_4%,var(--ui-popover))] px-1.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t('actionPicker.back')} onClick={() => onNavigate(undefined)}>
                    <i aria-hidden="true" className="i-lucide-light:chevron-left size-4" />
                  </Button>
                }
              />
              <TooltipContent container={portalRoot}>{t('actionPicker.back')}</TooltipContent>
            </Tooltip>
            <span className="min-w-0 truncate text-center text-[13px] font-semibold" title={provider.label}>
              {provider.label}
            </span>
          </div>
        )}
        <ScrollArea className="min-h-0 flex-1" defer={false} events={{ initialized: (instance) => setViewport(instance.elements().viewport) }}>
          <div className="flex flex-col gap-1 px-4">
            {state.refreshing && state.data == null && (
              <div role="status" className="flex items-center gap-2 px-2 py-3 text-muted-foreground">
                <Spinner />
                {t('contextPanel.loading')}
              </div>
            )}
            {state.error != null && (
              <div role="alert" className="flex items-center justify-between gap-2 px-2 py-3 text-muted-foreground">
                {t('contextPanel.loadFailed')}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-[13px] font-normal"
                  onClick={() => {
                    connectors.retryCatalog()
                    setAttempt((value) => value + 1)
                  }}
                >
                  {t('contextPanel.retry')}
                </Button>
              </div>
            )}
            {state.data != null && items.length == 0 && <p className="m-0 px-2 py-3 text-muted-foreground">{t('actionPicker.noResults')}</p>}
          </div>
          {viewport != null && (
            <Virtualizer data={rows} itemSize={provider == null && term == '' ? 44 : 76} scrollRef={{ current: viewport }}>
              {(item) => (
                <div className="px-4 pb-1">
                  {item.kind == 'provider-heading' ? (
                    <div className="pt-2">
                      <ProviderGroupHeading group={item.group} container={portalRoot} />
                    </div>
                  ) : item.kind == 'connector-group' ? (
                    <Button
                      key={item.id}
                      type="button"
                      variant="ghost"
                      size="lg"
                      className="group/app h-auto min-w-0 w-full justify-start gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-normal hover:bg-accent focus-visible:bg-accent"
                      onClick={() => onNavigate(item)}
                    >
                      <ProviderAppIcon src={item.icon} />
                      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                      <i aria-hidden="true" className="i-lucide-light:chevron-right size-4 text-muted-foreground" />
                    </Button>
                  ) : item.kind == 'connector' ? (
                    <Label
                      key={item.id}
                      className="group/app flex cursor-pointer text-[13px] font-normal items-start gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-accent has-[:focus-visible]:bg-accent has-data-disabled:cursor-default has-data-disabled:opacity-50"
                    >
                      <ProviderAppIcon src={item.icon} />
                      <span className="flex min-w-0 flex-1 flex-col gap-1 py-1 leading-5">
                        <span id={`${id}-${item.id}`} className="truncate font-medium" title={item.connector.name}>
                          {item.connector.name}
                        </span>
                        {provider == null && <span className="truncate text-muted-foreground">{item.connector.serviceName}</span>}
                        {item.connector.description && (
                          <span className="line-clamp-2 text-xs leading-[18px] text-muted-foreground" title={item.connector.description}>
                            {item.connector.description}
                          </span>
                        )}
                      </span>
                      <Checkbox
                        className="mt-1.5 shrink-0"
                        checked={selected.includes(item.connector.actionId)}
                        disabled={disabled}
                        onCheckedChange={() => onToggle(item.connector)}
                        aria-labelledby={`${id}-${item.id}`}
                      />
                    </Label>
                  ) : null}
                </div>
              )}
            </Virtualizer>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}
