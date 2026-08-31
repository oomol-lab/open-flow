import type { I18n, TFunction } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { WorkbenchClient, ConnectorAction, ConnectorConnection, ConnectorProvider, JsonValue } from '../api.ts'
import type { WorkbenchHost } from '../contract.ts'
import type { AddNodeOption } from '../designer/addNodeOptions.ts'
import type { ResolvedSelection } from '../revisionView.ts'
import type { ConnectionCatalog } from '../workspace.ts'
import type { Current } from './latest.ts'
import type { SetNotice } from './workbenchNotice.ts'
import type { WorkspaceStore } from './workspaceStore.ts'

import { compute, derive, val } from 'value-enhancer'
import { createI18n } from '../i18n.ts'
import { connectionCatalog } from '../workspace.ts'
import { Latest } from './latest.ts'
import { errorNotice } from './workbenchNotice.ts'

interface ConnectorState {
  readonly actionError?: { readonly actionId: string; readonly message: string }
  readonly actionLoading?: string
  readonly actions: Readonly<Record<string, ConnectorAction>>
  readonly authorizationServiceId?: string
  readonly connectionError?: { readonly message: string; readonly serviceId: string }
  readonly connectionLoading?: string
  readonly catalogs: Readonly<Record<string, ConnectionCatalog>>
}

interface Selection {
  readonly action?: ConnectorAction
  readonly actionError?: string
  readonly activeConnections?: readonly ConnectorConnection[]
  readonly authorizationPending: boolean
  readonly connection?: ConnectorConnection
  readonly connectionError?: string
}

interface ConnectorTarget {
  readonly actionId: string
  readonly connectionId?: string
  readonly nodeId: string
  readonly taskId: string
}

export interface Connector$ {
  readonly actionLoading: ReadonlyVal<string | undefined>
  readonly actions: ReadonlyVal<Readonly<Record<string, ConnectorAction>>>
  readonly catalogs: ReadonlyVal<Readonly<Record<string, ConnectionCatalog>>>
  readonly connectionLoading: ReadonlyVal<string | undefined>
  readonly selectedAction: ReadonlyVal<ConnectorAction | undefined>
  readonly selectedActionError: ReadonlyVal<string | undefined>
  readonly selectedActiveConnections: ReadonlyVal<readonly ConnectorConnection[] | undefined>
  readonly selectedAuthorizationPending: ReadonlyVal<boolean>
  readonly selectedConnection: ReadonlyVal<ConnectorConnection | undefined>
  readonly selectedConnectionError: ReadonlyVal<string | undefined>
}

const initialState: ConnectorState = {
  actions: {},
  catalogs: {},
}

function ports(values: Readonly<Record<string, { readonly description?: string; readonly jsonSchema: JsonValue }>>): AddNodeOption['inputs'] {
  return Object.entries(values).map(([handle, value]) => ({ description: value.description, handle, jsonSchema: value.jsonSchema }))
}

function option(action: ConnectorAction, t: TFunction): AddNodeOption {
  return {
    connector: action,
    description:
      action.authenticated && action.defaultConnection == null
        ? t('addNode.connectorNeedsConnection', { description: action.description, service: action.serviceName })
        : action.description,
    group: t('addNode.connectorActions'),
    icon: action.icon ?? ':carbon:connection-signal:',
    id: `connector:${action.actionId}`,
    inputs: ports(action.inputs),
    kind: 'connector',
    label: action.name,
    outputs: ports(action.outputs),
  }
}

function providerOptions(actions: readonly ConnectorAction[], t: TFunction): readonly AddNodeOption[] {
  const providers = new Map<string, ConnectorAction[]>()
  for (const action of actions) {
    const provider = providers.get(action.serviceId) ?? []
    provider.push(action)
    providers.set(action.serviceId, provider)
  }
  return [...providers.values()]
    .toSorted((left, right) => left[0]!.serviceName.localeCompare(right[0]!.serviceName))
    .map((providerActions) => {
      const first = providerActions[0]!
      const choices = providerActions.map((action) => {
        const child = option(action, t)
        return { description: child.description, label: child.label, option: child }
      })
      return {
        choices,
        description: t(choices.length == 1 ? 'addNode.connectorActionCountOne' : 'addNode.connectorActionCount', { count: choices.length }),
        group: t('addNode.connectorActions'),
        icon: first.icon ?? ':carbon:connection-signal:',
        id: `connector-provider:${first.serviceId}`,
        inputs: [],
        kind: 'connector-group',
        label: first.serviceName,
        outputs: [],
        serviceId: first.serviceId,
      }
    })
}

function providerOption(provider: ConnectorProvider, t: TFunction): AddNodeOption {
  return {
    choices: [],
    description: t('addNode.connectorBrowseActions'),
    group: t('addNode.connectorActions'),
    icon: provider.icon ?? ':carbon:connection-signal:',
    id: `connector-provider:${provider.serviceId}`,
    inputs: [],
    kind: 'connector-group',
    label: provider.serviceName,
    outputs: [],
    serviceId: provider.serviceId,
  }
}

function connectorTarget(selection: ResolvedSelection | undefined): ConnectorTarget | undefined {
  if (selection?.kind != 'task' || selection.node.task != null) return
  const task = selection.definition
  if (task == null || !('executor' in task) || task.executor.kind != 'connector') return
  return {
    actionId: task.executor.action,
    connectionId: task.executor.connectionId,
    nodeId: selection.id,
    taskId: selection.node.taskId,
  }
}

export class ConnectorStore {
  readonly #client: WorkbenchClient
  readonly #i18n: I18n
  readonly #host: Pick<WorkbenchHost, 'openExternalPage'>
  readonly #providerActions = new Map<string, readonly ConnectorAction[]>()
  readonly #loadingActions = new Set<string>()
  readonly #refresh = new Latest()
  readonly #flowReaction: () => void
  readonly #revisionReaction: () => void
  readonly #selected: ReadonlyVal<Selection>
  readonly #setNotice: SetNotice
  readonly #state: Val<ConnectorState> = val(initialState)
  readonly #workspace: WorkspaceStore
  #authorization?: { readonly connectionIds: ReadonlySet<string>; readonly serviceId: string }
  #providers?: readonly ConnectorProvider[]
  #disposed = false

  public readonly $: Connector$

  public constructor(
    client: WorkbenchClient,
    workspace: WorkspaceStore,
    setNotice: SetNotice,
    host: Pick<WorkbenchHost, 'openExternalPage'>,
    i18n: I18n = createI18n(),
  ) {
    this.#client = client
    this.#host = host
    this.#workspace = workspace
    this.#setNotice = setNotice
    this.#i18n = i18n
    const actions = derive(this.#state, (state) => state.actions)
    const catalogs = derive(this.#state, (state) => state.catalogs)
    this.#selected = compute<Selection>((get) => {
      const target = connectorTarget(get(workspace.$.selection))
      const state = get(this.#state)
      if (target == null) return { authorizationPending: false }
      const action = state.actions[target.actionId]
      const catalog = action == null ? undefined : state.catalogs[action.serviceId]
      let connection = target.connectionId == null ? undefined : catalog?.byId.get(target.connectionId)
      if (connection == null && action?.defaultConnection?.connectionId == target.connectionId) connection = action.defaultConnection
      return {
        action,
        actionError: state.actionError?.actionId == target.actionId ? state.actionError.message : undefined,
        activeConnections: catalog?.active,
        authorizationPending: action != null && state.authorizationServiceId == action.serviceId,
        connection,
        connectionError: action != null && state.connectionError?.serviceId == action.serviceId ? state.connectionError.message : undefined,
      }
    })
    this.$ = {
      actionLoading: derive(this.#state, (state) => state.actionLoading),
      actions,
      catalogs,
      connectionLoading: derive(this.#state, (state) => state.connectionLoading),
      selectedAction: derive(this.#selected, (value) => value.action),
      selectedActionError: derive(this.#selected, (value) => value.actionError),
      selectedActiveConnections: derive(this.#selected, (value) => value.activeConnections),
      selectedAuthorizationPending: derive(this.#selected, (value) => value.authorizationPending),
      selectedConnection: derive(this.#selected, (value) => value.connection),
      selectedConnectionError: derive(this.#selected, (value) => value.connectionError),
    }
    this.#flowReaction = workspace.$.flowId.reaction(() => this.reset())
    this.#revisionReaction = workspace.$.revision.reaction(() => void this.#loadDraftActions())
  }

  public dispose(): void {
    this.#disposed = true
    this.#refresh.invalidate()
    this.#flowReaction()
    this.#revisionReaction()
    for (const value of Object.values(this.$)) value.dispose()
    this.#selected.dispose()
    this.#state.dispose()
  }

  public reset(): void {
    if (this.#disposed) return
    this.#refresh.invalidate()
    this.#authorization = undefined
    this.#providerActions.clear()
    this.#providers = undefined
    this.#loadingActions.clear()
    this.#state.set(initialState)
  }

  public readonly browseAddNodeOptions = async (signal: AbortSignal): Promise<readonly AddNodeOption[] | undefined> => {
    if (this.#disposed) return
    const flowId = this.#workspace.$.flowId.value
    if (flowId == null) return
    const providers = this.#providers ?? (await this.#client.listConnectorProviders(signal, flowId))
    if (signal.aborted || this.#disposed || flowId != this.#workspace.$.flowId.value) return
    this.#providers = providers
    return providers.toSorted((left, right) => left.serviceName.localeCompare(right.serviceName)).map((provider) => providerOption(provider, this.#i18n.t))
  }

  public readonly provideAddNodeOptionChoices = async (optionId: string, signal: AbortSignal): Promise<readonly AddNodeOption[] | undefined> => {
    if (this.#disposed) return
    const flowId = this.#workspace.$.flowId.value
    const provider = this.#providers?.find((candidate) => `connector-provider:${candidate.serviceId}` == optionId)
    if (flowId == null || provider == null) return
    const loaded = this.#providerActions.get(provider.serviceId)
    const actions = loaded ?? (await this.#client.listConnectorActions(provider.serviceId, signal, flowId))
    if (signal.aborted || this.#disposed || flowId != this.#workspace.$.flowId.value) return
    const resolved = actions.map((action) =>
      Object.assign({}, action, action.icon == null && provider.icon != null ? { icon: provider.icon } : {}, { serviceName: provider.serviceName }),
    )
    this.#providerActions.set(provider.serviceId, resolved)
    this.#set({ actions: { ...this.#state.value.actions, ...Object.fromEntries(resolved.map((action) => [action.actionId, action])) } })
    return resolved.map((action) => option(action, this.#i18n.t))
  }

  public readonly provideAddNodeOptions = async (searchTerm: string, signal: AbortSignal): Promise<readonly AddNodeOption[] | undefined> => {
    if (this.#disposed) return
    const flowId = this.#workspace.$.flowId.value
    if (flowId == null) return
    const query = searchTerm.trim()
    const actions = query.length == 0 ? Object.values(this.#state.value.actions) : await this.#client.searchConnectorActions(query, signal, flowId)
    if (signal.aborted || this.#disposed || flowId != this.#workspace.$.flowId.value) return
    const next = { ...this.#state.value.actions }
    for (const action of actions) next[action.actionId] = action
    this.#set({ actions: next })
    if (query.length != 0) return actions.map((action) => option(action, this.#i18n.t))
    const visible = new Map(actions.map((action) => [action.actionId, action]))
    for (const actionId of this.#workspace.$.revision.value?.connectorActionIds ?? []) {
      const action = next[actionId]
      if (action != null) visible.set(actionId, action)
    }
    return providerOptions([...visible.values()], this.#i18n.t)
  }

  public async refresh(force = false): Promise<void> {
    if (this.#disposed) return
    const current = this.#refresh.begin()
    const flowId = this.#workspace.$.flowId.value
    const target = connectorTarget(this.#workspace.$.selection.value)
    if (flowId == null || target == null) {
      if (this.#state.value.actionLoading != null || this.#state.value.connectionLoading != null) {
        this.#set({ actionLoading: undefined, connectionLoading: undefined })
      }
      return
    }
    this.#set({ actionError: undefined, actionLoading: target.actionId, connectionError: undefined, connectionLoading: undefined })
    try {
      const action = await this.#loadAction(target.actionId, force)
      if (!this.#isCurrent(current, flowId)) return
      this.#set({ actions: { ...this.#state.value.actions, [action.actionId]: action } })
      if (action.authenticated) await this.#refreshConnections(flowId, target, action.serviceId, force, current)
    } catch (error) {
      if (this.#isCurrent(current, flowId)) {
        this.#set({ actionError: { actionId: target.actionId, message: errorNotice(error, this.#i18n.t).message } })
      }
    } finally {
      if (this.#isCurrent(current, flowId) && this.#state.value.actionLoading == target.actionId) this.#set({ actionLoading: undefined })
    }
  }

  public async connect(serviceId: string): Promise<void> {
    if (this.#disposed) return
    const flowId = this.#workspace.$.flowId.value
    if (flowId == null) return
    const catalog = this.#state.value.catalogs[serviceId]
    try {
      const opened = await this.#host.openExternalPage(() => this.#client.createConnectorConnectionPage(serviceId, flowId))
      if (!opened) {
        this.#setNotice({ kind: 'error', message: this.#i18n.t('notice.connectionPopupBlocked') })
        return
      }
      if (this.#disposed || flowId != this.#workspace.$.flowId.value) return
      this.#authorization = { connectionIds: new Set(catalog?.all.map((connection) => connection.connectionId)), serviceId }
      this.#set({ authorizationServiceId: serviceId })
    } catch (error) {
      if (!this.#disposed) this.#setNotice(errorNotice(error, this.#i18n.t))
    }
  }

  public async setConnection(taskId: string, connectionId: string): Promise<boolean> {
    return await this.#workspace.setConnectorConnection(taskId, connectionId)
  }

  public async refreshAfterAuthorization(): Promise<void> {
    if (this.#disposed || this.#authorization == null) return
    const serviceId = this.#authorization.serviceId
    this.#providerActions.delete(serviceId)
    this.#set({ authorizationServiceId: undefined })
    if (this.$.selectedAction.value?.serviceId == serviceId) await this.refresh(true)
    if (!this.#disposed && this.#authorization?.serviceId == serviceId) this.#authorization = undefined
  }

  async #loadAction(actionId: string, force: boolean): Promise<ConnectorAction> {
    const action = this.#state.value.actions[actionId]
    if (!force && action != null) return action
    return await this.#client.getConnectorAction(actionId, undefined, this.#workspace.$.flowId.value)
  }

  async #refreshConnections(flowId: string, target: ConnectorTarget, serviceId: string, force: boolean, current: Current): Promise<void> {
    this.#set({ connectionLoading: serviceId })
    try {
      const catalog = await this.#loadCatalog(flowId, serviceId, force, current)
      if (catalog == null || !this.#isCurrent(current, flowId)) return
      await this.#pinPreferredConnection(target, serviceId, catalog)
    } finally {
      if (this.#isCurrent(current, flowId) && this.#state.value.connectionLoading == serviceId) this.#set({ connectionLoading: undefined })
    }
  }

  async #loadCatalog(flowId: string, serviceId: string, force: boolean, current: Current): Promise<ConnectionCatalog | undefined> {
    const cached = this.#state.value.catalogs[serviceId]
    if (!force && cached != null) return cached
    let connections: readonly ConnectorConnection[]
    try {
      connections = await this.#client.listConnectorConnections(serviceId, undefined, flowId)
    } catch (error) {
      if (this.#isCurrent(current, flowId)) this.#set({ connectionError: { message: errorNotice(error, this.#i18n.t).message, serviceId } })
      return
    }
    if (!this.#isCurrent(current, flowId)) return
    const catalog = connectionCatalog(connections)
    this.#set({ catalogs: { ...this.#state.value.catalogs, [serviceId]: catalog } })
    return catalog
  }

  async #pinPreferredConnection(target: ConnectorTarget, serviceId: string, catalog: ConnectionCatalog): Promise<void> {
    const authorization = this.#authorization?.serviceId == serviceId ? this.#authorization : undefined
    const created = authorization == null ? [] : catalog.active.filter((connection) => !authorization.connectionIds.has(connection.connectionId))
    const connection = created.length == 1 ? created[0] : catalog.preferred
    const task = this.#workspace.$.revision.value?.task(target.taskId)
    if (
      connection != null &&
      this.#workspace.$.selectedNodeIds.value.includes(target.nodeId) &&
      task != null &&
      'executor' in task &&
      task.executor.kind == 'connector' &&
      task.executor.connectionId == null
    ) {
      await this.#workspace.setConnectorConnection(target.taskId, connection.connectionId)
    }
  }

  #set(patch: Partial<ConnectorState>): void {
    if (this.#disposed) return
    this.#state.set({ ...this.#state.value, ...patch })
  }

  #isCurrent(current: Current, flowId: string): boolean {
    return !this.#disposed && current() && flowId == this.#workspace.$.flowId.value
  }

  async #loadDraftActions(): Promise<void> {
    if (this.#disposed) return
    const current = this.#refresh.capture()
    const flowId = this.#workspace.$.flowId.value
    const revision = this.#workspace.$.revision.value
    if (flowId == null || revision == null) return
    const missing = [...revision.connectorActionIds].filter((actionId) => this.#state.value.actions[actionId] == null && !this.#loadingActions.has(actionId))
    if (missing.length == 0) return
    for (const actionId of missing) this.#loadingActions.add(actionId)
    try {
      const actions = await Promise.all(missing.map((actionId) => this.#client.getConnectorAction(actionId, undefined, flowId)))
      if (!this.#isCurrent(current, flowId)) return
      const next = { ...this.#state.value.actions }
      for (const action of actions) next[action.actionId] = action
      this.#set({ actions: next })
    } catch {
      return
    } finally {
      for (const actionId of missing) this.#loadingActions.delete(actionId)
    }
  }
}
