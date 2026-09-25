import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { TriggerDisplay } from '../../../../control/common/triggerCatalog.ts'
import type { WorkbenchClient, ConnectorConnection, TriggerKeySnapshot } from '../api.ts'
import type { WorkbenchHost } from '../contract.ts'
import type { AddNodeOption } from '../editor/addNodeOptions.ts'
import type { ResolvedSelection } from '../revisionView.ts'
import type { SetNotice } from './workbenchNotice.ts'
import type { WorkspaceStore } from './workspaceStore.ts'

import { compute, derive, val } from 'value-enhancer'
import { resolveUiLanguage } from '../../../../localization/common/languages.ts'
import { connectionCatalog } from '../connectionCatalog.ts'
import { createI18n } from '../i18n.ts'
import { providerIcon } from '../providerIcon.ts'
import { Latest } from './latest.ts'
import { scopedValue } from './optionSource.ts'
import { resourceValue } from './resource.ts'
import { TriggerCatalogStore } from './triggerCatalog.ts'
import { errorNotice } from './workbenchNotice.ts'

interface TriggerState {
  readonly authorizationProvider?: string
  readonly connectionError?: { readonly message: string; readonly provider: string }
  readonly connectionLoading?: string
}

interface TriggerTarget {
  readonly connectionId?: string
  readonly provider: string
  readonly triggerId: string
}

interface Selection {
  readonly activeConnections?: readonly ConnectorConnection[]
  readonly authorizationPending: boolean
  readonly connection?: ConnectorConnection
  readonly connectionError?: string
  readonly definition?: TriggerKeySnapshot
}

export interface Trigger$ {
  readonly connectionLoading: ReadonlyVal<string | undefined>
  readonly selectedActiveConnections: ReadonlyVal<readonly ConnectorConnection[] | undefined>
  readonly selectedAuthorizationPending: ReadonlyVal<boolean>
  readonly selectedConnection: ReadonlyVal<ConnectorConnection | undefined>
  readonly selectedConnectionError: ReadonlyVal<string | undefined>
  readonly selectedDefinition: ReadonlyVal<TriggerKeySnapshot | undefined>
}

const initialState: TriggerState = {}
const optionPrefix = 'trigger:'

function target(selection: ResolvedSelection | undefined): TriggerTarget | undefined {
  if (selection?.kind != 'trigger') return
  const trigger = selection.trigger
  if (trigger.kind != 'poll' && trigger.kind != 'integration') return
  return {
    ...(trigger.connectionId == null ? {} : { connectionId: trigger.connectionId }),
    provider: trigger.definition.provider,
    triggerId: selection.id,
  }
}

function option(definition: TriggerKeySnapshot, i18n: I18n, display?: TriggerDisplay): AddNodeOption {
  return {
    description: display?.description ?? definition.description,
    group: i18n.t('addNode.integrationTriggers'),
    icon: providerIcon({ serviceId: definition.provider, serviceName: definition.provider }),
    id: `${optionPrefix}${definition.key}`,
    inputs: [],
    kind: 'trigger',
    label: display?.displayName ?? definition.displayName,
    outputs: definition.outputs.map((output) => {
      const description = display?.outputs[output.handle]
      return description == null ? output : { ...output, description }
    }),
    trigger: { definition, kind: 'catalog' },
  }
}

export class TriggerStore {
  public readonly catalog: TriggerCatalogStore
  readonly #client: WorkbenchClient
  readonly #host: Pick<WorkbenchHost, 'openExternalPage'>
  readonly #i18n: I18n
  readonly #refresh = new Latest()
  readonly #stale = new Set<string>()
  readonly #selected: ReadonlyVal<Selection>
  readonly #setNotice: SetNotice
  readonly #state: Val<TriggerState> = val(initialState)
  readonly #workspace: WorkspaceStore
  #disposed = false

  public readonly $: Trigger$

  public constructor(
    client: WorkbenchClient,
    workspace: WorkspaceStore,
    setNotice: SetNotice,
    host: Pick<WorkbenchHost, 'openExternalPage' | 'catalogCache'>,
    i18n: I18n = createI18n(),
  ) {
    this.catalog = new TriggerCatalogStore(client, resolveUiLanguage([i18n.lang]), host)
    this.#client = client
    this.#host = host
    this.#i18n = i18n
    this.#setNotice = setNotice
    this.#workspace = workspace
    this.#selected = compute((get) => {
      const selection = get(workspace.$.selection)
      const current = target(selection)
      const state = get(this.#state)
      if (selection?.kind != 'trigger') return { authorizationPending: false }
      const trigger = selection.trigger
      if (trigger.kind != 'poll' && trigger.kind != 'integration') return { authorizationPending: false }
      const connections = current == null ? undefined : get(workspace.catalogs.connections.get(current.provider, get(workspace.$.flowId))).data
      const catalog = connections == null ? undefined : connectionCatalog(connections)
      const connectionError = current == null ? undefined : get(workspace.catalogs.connections.get(current.provider, get(workspace.$.flowId))).error
      return {
        activeConnections: catalog?.active,
        authorizationPending: state.authorizationProvider == current?.provider,
        connection: current?.connectionId == null ? undefined : catalog?.byId.get(current.connectionId),
        connectionError: connectionError == null ? undefined : errorNotice(connectionError, this.#i18n.t).message,
        definition: trigger.definition,
      }
    })
    this.$ = {
      connectionLoading: derive(this.#state, (state) => state.connectionLoading),
      selectedActiveConnections: derive(this.#selected, (selection) => selection.activeConnections),
      selectedAuthorizationPending: derive(this.#selected, (selection) => selection.authorizationPending),
      selectedConnection: derive(this.#selected, (selection) => selection.connection),
      selectedConnectionError: derive(this.#selected, (selection) => selection.connectionError),
      selectedDefinition: derive(this.#selected, (selection) => selection.definition),
    }
  }

  public dispose(): void {
    this.#disposed = true
    this.catalog.dispose()
    this.#refresh.invalidate()
    for (const value of Object.values(this.$)) value.dispose()
    this.#selected.dispose()
    this.#state.dispose()
  }

  public reset(): void {
    if (this.#disposed) return
    this.#stale.clear()
    this.#refresh.invalidate()
    this.#state.set(initialState)
  }

  public readonly browseAddNodeOptions = (signal: AbortSignal) => this.#options('', signal)
  public readonly provideAddNodeOptions = (searchTerm: string, signal: AbortSignal) => this.#options(searchTerm, signal)

  #options(searchTerm: string, signal: AbortSignal) {
    const source = this.catalog.get()
    const query = searchTerm.trim().toLowerCase()
    return scopedValue(signal, (get) => {
      const state = get(source)
      get(this.#i18n.t$)
      const enabled = get(this.#workspace.$.flowId) != null && get(this.#workspace.$.target)?.kind == 'flow'
      const catalog = state.data
      const definitions = catalog?.definitions.filter(
        (item) =>
          !query ||
          [
            catalog.display[item.key]?.displayName,
            catalog.display[item.key]?.description,
            item.description,
            item.displayName,
            item.key,
            item.name,
            item.provider,
            item.type,
          ].some((value) => value?.toLowerCase().includes(query)),
      )
      return { ...state, data: !enabled ? [] : definitions?.map((definition) => option(definition, this.#i18n, catalog!.display[definition.key])) }
    })
  }

  public async refresh(force = false): Promise<void> {
    if (this.#disposed) return
    const current = this.#refresh.begin()
    const flowId = this.#workspace.$.flowId.value
    const selected = target(this.#workspace.$.selection.value)
    if (flowId == null || selected == null) {
      if (this.#state.value.connectionLoading != null) this.#set({ connectionLoading: undefined })
      return
    }
    this.#set({ connectionError: undefined, connectionLoading: selected.provider })
    try {
      const state = this.#workspace.catalogs.connections.get(selected.provider, flowId, force || this.#stale.has(selected.provider))
      await Promise.resolve()
      await resourceValue(state, undefined, force || this.#stale.has(selected.provider))
      if (!this.#current(current, flowId)) return
      this.#stale.delete(selected.provider)
    } catch (error) {
      if (this.#current(current, flowId)) {
        this.#set({ connectionError: { message: errorNotice(error, this.#i18n.t).message, provider: selected.provider } })
      }
    } finally {
      if (this.#current(current, flowId) && this.#state.value.connectionLoading == selected.provider) this.#set({ connectionLoading: undefined })
    }
  }

  public async connect(provider: string): Promise<void> {
    const flowId = this.#workspace.$.flowId.value
    if (this.#disposed || flowId == null) return
    try {
      const opened = await this.#host.openExternalPage(() => this.#client.createConnectorConnectionPage(provider, flowId))
      if (!opened) {
        this.#setNotice({ kind: 'error', message: this.#i18n.t('notice.connectionPopupBlocked') })
        return
      }
      if (!this.#disposed && flowId == this.#workspace.$.flowId.value) this.#set({ authorizationProvider: provider })
    } catch (error) {
      if (!this.#disposed) this.#setNotice(errorNotice(error, this.#i18n.t))
    }
  }

  public async setConnection(triggerId: string, connectionId: string | undefined): Promise<boolean> {
    return await this.#workspace.setTriggerConnection(triggerId, connectionId)
  }

  public async refreshAfterAuthorization(): Promise<void> {
    if (this.#disposed) return
    const provider = this.#state.value.authorizationProvider
    if (provider == null) return
    this.#stale.add(provider)
    this.#set({ authorizationProvider: undefined })
    if (target(this.#workspace.$.selection.value)?.provider == provider) await this.refresh(true)
  }

  #set(patch: Partial<TriggerState>): void {
    if (!this.#disposed) this.#state.set({ ...this.#state.value, ...patch })
  }

  #current(current: () => boolean, flowId: string): boolean {
    return !this.#disposed && current() && flowId == this.#workspace.$.flowId.value
  }
}
