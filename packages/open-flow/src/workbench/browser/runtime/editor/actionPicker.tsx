import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { ResourceState } from '../stores/resource.ts'
import type { AddNodeOption } from './addNodeOptions.ts'
import type { ToolPickerGroup, ToolPickerOption } from './toolPickerList.tsx'

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { useDebouncedValue } from '../../../../ui/browser/hooks.ts'
import { observeResource } from '../stores/resource.ts'
import { groupActionOptions } from './actionGroups.ts'
import { comparePickerApps, pickerConnectionPriorities, pickerAppGroups, pickerAppPriority } from './nodePickerApps.ts'
import { ProviderAppIcon } from './providerAppIcon.tsx'
import { ToolPickerList } from './toolPickerList.tsx'

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
  const scrollPositions = useRef(new Map<string, number>())
  // Navigation replaces the search and resource scope together, including any pending debounce.
  return (
    <ActionPickerPage
      key={provider?.id ?? 'providers'}
      {...props}
      provider={provider}
      initialScrollTop={scrollPositions.current.get(provider?.id ?? 'providers') ?? 0}
      navigation={navigation}
      onNavigate={(next, scrollTop) => {
        // The page reports its current viewport before the keyed page is replaced.
        scrollPositions.current.set(provider?.id ?? 'providers', scrollTop)
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
  initialScrollTop,
}: ActionPickerProps & {
  readonly navigation: 'forward' | 'back' | undefined
  readonly provider: ProviderOption | undefined
  readonly onNavigate: (provider: ProviderOption | undefined, scrollTop: number) => void
  readonly initialScrollTop: number
}) {
  const t = useTranslate()
  const [query, setQuery] = useState('')
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
  const groups = useMemo<ToolPickerGroup<AddNodeOption>[]>(() => {
    if (provider != null || term != '') {
      return groupActionOptions(items).map(({ type, items: members }) => ({
        id: type,
        title: t(`nodePicker.actionGroups.${type}`),
        items: members.map(
          (item): ToolPickerOption<AddNodeOption> => ({
            id: item.id,
            value: item,
            kind: 'selection',
            name: item.connector.name,
            icon: <ProviderAppIcon src={item.icon} />,
            subtitle: provider == null ? item.connector.serviceName : undefined,
            description: item.connector.description,
            checked: selected.includes(item.connector.actionId),
          }),
        ),
      }))
    }
    const priorities = pickerConnectionPriorities(connections)
    const providers = items
      .filter((item): item is ProviderOption => item.kind == 'connector-group')
      .map((item) => ({ item, label: item.label, priority: pickerAppPriority(item.serviceId, item.noSetup, priorities) }))
      .toSorted(comparePickerApps)
    return pickerAppGroups.flatMap((group, priority) => {
      const members = providers.filter((entry) => entry.priority == priority)
      if (members.length == 0) return []
      return [
        {
          id: group,
          title: t(`nodePicker.${group}`),
          help: t(`nodePicker.${group}Description`),
          items: members.map(
            ({ item }): ToolPickerOption<AddNodeOption> => ({
              id: item.id,
              value: item,
              kind: 'navigation',
              name: item.label,
              icon: <ProviderAppIcon src={item.icon} />,
            }),
          ),
        },
      ]
    })
  }, [items, connections, provider, term, selected, t])
  return (
    <ToolPickerList
      groups={groups}
      query={query}
      onQueryChange={setQuery}
      searchLabel={t(provider == null ? 'actionPicker.search' : 'actionPicker.searchActions')}
      loading={state.refreshing && state.data == null}
      error={state.error != null ? t('contextPanel.loadFailed') : undefined}
      empty={state.data != null && items.length == 0 ? t('actionPicker.noResults') : undefined}
      onRetry={() => {
        connectors.retryCatalog()
        setAttempt((value) => value + 1)
      }}
      disabled={disabled}
      onChoose={(item, scrollTop) => {
        if (item.kind == 'connector-group') onNavigate(item, scrollTop)
        else if (item.kind == 'connector') onToggle(item.connector)
      }}
      portalRoot={portalRoot}
      parent={provider == null ? undefined : { name: provider.label, onBack: (scrollTop) => onNavigate(undefined, scrollTop) }}
      navigation={navigation}
      initialScrollTop={initialScrollTop}
    />
  )
}
