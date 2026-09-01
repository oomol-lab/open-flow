import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { TriggerSettings } from '../../../../flow/common/nodeChanges.ts'
import type { WorkbenchClient, ConnectorConnection, TriggerKeySnapshot } from '../api.ts'
import type { WorkbenchHost } from '../contract.ts'
import type { AddNodeOption } from '../designer/addNodeOptions.ts'
import type { ResolvedSelection } from '../revisionView.ts'
import type { ConnectionCatalog } from '../workspace.ts'
import type { SetNotice } from './workbenchNotice.ts'
import type { WorkspaceStore } from './workspaceStore.ts'

import { compute, derive, val } from 'value-enhancer'
import { createI18n } from '../i18n.ts'
import { providerIcon } from '../providerIcon.ts'
import { connectionCatalog } from '../workspace.ts'
import { Latest } from './latest.ts'
import { errorNotice } from './workbenchNotice.ts'

interface TriggerState {
  readonly authorizationProvider?: string
  readonly catalogs: Readonly<Record<string, ConnectionCatalog>>
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

const initialState: TriggerState = { catalogs: {} }
const optionPrefix = 'trigger:'

function target(selection: ResolvedSelection | undefined, workspace: WorkspaceStore): TriggerTarget | undefined {
  if (selection?.kind != 'trigger') return
  const trigger = selection.trigger
  if (trigger.kind != 'poll' && trigger.kind != 'integration') return
  const binding = workspace.$.revision.value?.binding(trigger.bindingId)
  return {
    ...(binding?.kind == 'connection' ? { connectionId: binding.target } : {}),
    provider: trigger.definition.provider,
    triggerId: selection.id,
  }
}

function option(definition: TriggerKeySnapshot, i18n: I18n): AddNodeOption {
  return {
    description: i18n.t('addNode.triggerNeedsConnection', { provider: definition.provider }),
    group: i18n.t('addNode.triggers'),
    icon: providerIcon({ serviceId: definition.provider, serviceName: definition.provider }),
    id: `${optionPrefix}${definition.key}`,
    inputs: [],
    kind: 'trigger',
    label: definition.displayName,
    outputs: [{ handle: 'payload', jsonSchema: definition.payloadSchema }],
    trigger: { definition, kind: 'catalog' },
  }
}

export class TriggerStore {
  #catalog?: Promise<ReadonlyMap<string, TriggerKeySnapshot>>
  #catalogController = new AbortController()
  readonly #client: WorkbenchClient
  readonly #host: Pick<WorkbenchHost, 'openExternalPage'>
  readonly #i18n: I18n
  readonly #refresh = new Latest()
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
    host: Pick<WorkbenchHost, 'openExternalPage'>,
    i18n: I18n = createI18n(),
  ) {
    this.#client = client
    this.#host = host
    this.#i18n = i18n
    this.#setNotice = setNotice
    this.#workspace = workspace
    this.#selected = compute((get) => {
      const selection = get(workspace.$.selection)
      const current = target(selection, workspace)
      const state = get(this.#state)
      if (selection?.kind != 'trigger') return { authorizationPending: false }
      const trigger = selection.trigger
      if (trigger.kind != 'poll' && trigger.kind != 'integration') return { authorizationPending: false }
      const catalog = current == null ? undefined : state.catalogs[current.provider]
      const connectionError = state.connectionError
      return {
        activeConnections: catalog?.active,
        authorizationPending: state.authorizationProvider == current?.provider,
        connection: current?.connectionId == null ? undefined : catalog?.byId.get(current.connectionId),
        connectionError: connectionError != null && connectionError.provider == current?.provider ? connectionError.message : undefined,
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
    this.#catalogController.abort()
    this.#refresh.invalidate()
    for (const value of Object.values(this.$)) value.dispose()
    this.#selected.dispose()
    this.#state.dispose()
  }

  public reset(): void {
    if (this.#disposed) return
    this.#catalogController.abort()
    this.#catalogController = new AbortController()
    this.#catalog = undefined
    this.#refresh.invalidate()
    this.#state.set(initialState)
  }

  public readonly browseAddNodeOptions = async (signal: AbortSignal): Promise<readonly AddNodeOption[] | undefined> => {
    const flowId = this.#workspace.$.flowId.value
    if (signal.aborted || this.#disposed || flowId == null || this.#workspace.$.target.value?.kind != 'flow') return []
    const definitions = await this.#loadCatalog()
    if (signal.aborted || this.#disposed || flowId != this.#workspace.$.flowId.value) return
    return [...definitions.values()].map((definition) => option(definition, this.#i18n))
  }

  public readonly provideAddNodeOptions = async (searchTerm: string, signal: AbortSignal): Promise<readonly AddNodeOption[] | undefined> => {
    const flowId = this.#workspace.$.flowId.value
    if (signal.aborted || this.#disposed || flowId == null || this.#workspace.$.target.value?.kind != 'flow') return []
    const query = searchTerm.trim().toLowerCase()
    if (query.length == 0) return []
    const catalog = await this.#loadCatalog()
    if (signal.aborted || this.#disposed || flowId != this.#workspace.$.flowId.value) return
    const definitions = [...catalog.values()].filter((item) =>
      [item.description, item.displayName, item.key, item.name, item.provider, item.type].some((value) => value.toLowerCase().includes(query)),
    )
    return definitions.map((definition) => option(definition, this.#i18n))
  }

  public async refresh(force = false): Promise<void> {
    const current = this.#refresh.begin()
    const flowId = this.#workspace.$.flowId.value
    const selected = target(this.#workspace.$.selection.value, this.#workspace)
    if (this.#disposed) return
    if (flowId == null || selected == null) {
      if (this.#state.value.connectionLoading != null) this.#set({ connectionLoading: undefined })
      return
    }
    if (!force && this.#state.value.catalogs[selected.provider] != null) return
    this.#set({ connectionError: undefined, connectionLoading: selected.provider })
    try {
      const catalog = connectionCatalog(await this.#client.listConnectorConnections(selected.provider, undefined, flowId))
      if (!this.#current(current, flowId)) return
      this.#set({ catalogs: { ...this.#state.value.catalogs, [selected.provider]: catalog } })
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

  public async setConnection(triggerId: string, connectionId: string): Promise<boolean> {
    return await this.#workspace.setTriggerConnection(triggerId, connectionId)
  }

  public async saveSettings(triggerId: string, settings: TriggerSettings): Promise<boolean> {
    return await this.#workspace.saveTriggerSettings(triggerId, settings)
  }

  public async refreshAfterAuthorization(): Promise<void> {
    const provider = this.#state.value.authorizationProvider
    if (this.#disposed || provider == null) return
    const catalogs = { ...this.#state.value.catalogs }
    delete catalogs[provider]
    this.#set({ authorizationProvider: undefined, catalogs })
    if (target(this.#workspace.$.selection.value, this.#workspace)?.provider == provider) await this.refresh(true)
  }

  #loadCatalog(): Promise<ReadonlyMap<string, TriggerKeySnapshot>> {
    if (this.#catalog != null) return this.#catalog
    const request = this.#client
      .listTriggerDefinitions(this.#catalogController.signal)
      .then((definitions) => new Map(definitions.map((definition) => [definition.key, definition])))
    this.#catalog = request
    void request.catch(() => {
      if (this.#catalog == request) this.#catalog = undefined
    })
    return request
  }

  #set(patch: Partial<TriggerState>): void {
    if (!this.#disposed) this.#state.set({ ...this.#state.value, ...patch })
  }

  #current(current: () => boolean, flowId: string): boolean {
    return !this.#disposed && current() && flowId == this.#workspace.$.flowId.value
  }
}
