import type { I18n, TFunction } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { WorkbenchClient, ConnectorConnection, ConnectorProvider, Diagnostic, JsonValue } from '../api.ts'
import type { WorkbenchHost } from '../contract.ts'
import type { AddNodeOption } from '../editor/addNodeOptions.ts'
import type { ResolvedSelection, RevisionView } from '../revisionView.ts'
import type { ConnectionCatalog, ConnectorActionView } from '../workspace.ts'
import type { CatalogStores } from './catalogStores.ts'
import type { Current } from './latest.ts'
import type { SetNotice } from './workbenchNotice.ts'
import type { WorkspaceStore } from './workspaceStore.ts'

import { compute, derive, val } from 'value-enhancer'
import { flowDependencies } from '../../../../flow/common/semantics.ts'
import { createI18n } from '../i18n.ts'
import { providerIcon } from '../providerIcon.ts'
import { connectionCatalog, actionWithConnections } from '../workspace.ts'
import { Latest } from './latest.ts'
import { scopedValue } from './optionSource.ts'
import { resourceData, resourceValue } from './resource.ts'
import { errorNotice } from './workbenchNotice.ts'

interface ConnectorState {
  readonly actionError?: { readonly actionId: string; readonly message: string }
  readonly actionLoading?: string
  readonly authorizationServiceId?: string
  readonly connectionError?: { readonly message: string; readonly serviceId: string }
  readonly connectionLoading?: string
}

interface Selection {
  readonly action?: ConnectorActionView
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
  readonly connections: ReadonlyVal<readonly ConnectorConnection[]>
  readonly actionLoading: ReadonlyVal<string | undefined>
  readonly actions: ReadonlyVal<Readonly<Record<string, ConnectorActionView>>>
  readonly catalogs: ReadonlyVal<Readonly<Record<string, ConnectionCatalog>>>
  readonly connectionLoading: ReadonlyVal<string | undefined>
  readonly diagnostics: ReadonlyVal<readonly Diagnostic[]>
  readonly selectedAction: ReadonlyVal<ConnectorActionView | undefined>
  readonly selectedActionError: ReadonlyVal<string | undefined>
  readonly selectedActiveConnections: ReadonlyVal<readonly ConnectorConnection[] | undefined>
  readonly selectedAuthorizationPending: ReadonlyVal<boolean>
  readonly selectedConnection: ReadonlyVal<ConnectorConnection | undefined>
  readonly selectedConnectionError: ReadonlyVal<string | undefined>
}

const initialState: ConnectorState = {}

function ports(values: Readonly<Record<string, { readonly description?: string; readonly jsonSchema: JsonValue }>>): AddNodeOption['inputs'] {
  return Object.entries(values).map(([handle, value]) => ({ description: value.description, handle, jsonSchema: value.jsonSchema }))
}

function option(action: ConnectorActionView, t: TFunction): AddNodeOption {
  return {
    connector: action,
    description:
      action.authenticated && action.defaultConnection == null
        ? t('addNode.connectorNeedsConnection', { description: action.description, service: action.serviceName })
        : action.description,
    group: t('addNode.connectorActions'),
    icon: providerIcon(action),
    id: `connector:${action.actionId}`,
    inputs: ports(action.inputs),
    kind: 'connector',
    label: action.name,
    outputs: ports(action.outputs),
  }
}

function providerOptions(actions: readonly ConnectorActionView[], t: TFunction): readonly AddNodeOption[] {
  const providers = new Map<string, ConnectorActionView[]>()
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
        icon: providerIcon(first),
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
    icon: providerIcon(provider),
    id: `connector-provider:${provider.serviceId}`,
    inputs: [],
    kind: 'connector-group',
    label: provider.serviceName,
    outputs: [],
    noSetup: provider.noSetup,
    serviceId: provider.serviceId,
  }
}

function connectorTarget(selection: ResolvedSelection | undefined, revision: RevisionView | undefined): ConnectorTarget | undefined {
  if (selection == null) return
  const taskId = selection.kind == 'task' && selection.node.task == null ? selection.node.taskId : undefined
  if (taskId == null) return
  const task = selection.kind == 'task' ? selection.definition : revision?.task(taskId)
  if (task == null || !('executor' in task) || task.executor.kind != 'connector') return
  return {
    actionId: task.executor.action,
    connectionId: task.executor.connectionId,
    nodeId: selection.id,
    taskId,
  }
}

function connectionDiagnostics(
  revision: RevisionView | undefined,
  actions: Readonly<Record<string, ConnectorActionView>>,
  catalogs: Readonly<Record<string, ConnectionCatalog>>,
): readonly Diagnostic[] {
  if (revision == null) return []
  const diagnostics: Diagnostic[] = []
  for (const taskId of [...flowDependencies(revision.revision.content).tasks].toSorted()) {
    const task = revision.task(taskId)
    if (task?.executor.kind != 'connector') continue
    const action = actions[task.executor.action]
    if (action?.authenticated != true) continue
    const connection = task.executor.connectionId == null ? undefined : catalogs[action.serviceId]?.byId.get(task.executor.connectionId)
    if (task.executor.connectionId != null && (catalogs[action.serviceId] == null || connection?.status == 'active')) continue
    diagnostics.push({
      code: 'task.connector-connection-required',
      column: 0,
      line: 1,
      message: `Connector Task "${taskId}" requires an active Connection.`,
      path: `/document/tasks/${taskId}/executor/connectionId`,
      values: { taskId },
    })
  }
  return diagnostics
}

export class ConnectorStore {
  readonly #client: WorkbenchClient
  readonly #i18n: I18n
  #language: string
  readonly #host: Pick<WorkbenchHost, 'openExternalPage'>
  readonly #loadingActions = new Set<string>()
  readonly #draftRefresh = new Latest()
  readonly #refresh = new Latest()
  readonly #flowReaction: () => void
  readonly #revisionReaction: () => void
  readonly #selected: ReadonlyVal<Selection>
  readonly #setNotice: SetNotice
  readonly #state: Val<ConnectorState> = val(initialState)
  // Membership is independent of transient request state, so loading cannot invalidate the graph.
  readonly #actionIds = val<readonly string[]>([])
  readonly #services = val<readonly string[]>([])
  readonly #workspace: WorkspaceStore
  #authorization?: { readonly connectionIds: ReadonlySet<string>; readonly serviceId: string }
  #disposed = false

  public readonly $: Connector$

  public constructor(
    client: WorkbenchClient,
    workspace: WorkspaceStore,
    setNotice: SetNotice,
    host: Pick<WorkbenchHost, 'openExternalPage'>,
    i18n: I18n = createI18n(),
    private readonly data: CatalogStores = workspace.catalogs,
  ) {
    this.#client = client
    this.#host = host
    this.#workspace = workspace
    this.#setNotice = setNotice
    this.#i18n = i18n
    this.#language = i18n.lang
    const actions = compute((get) => {
      const flowId = get(workspace.$.flowId)
      return Object.fromEntries(
        get(this.#actionIds).flatMap((id) => {
          const action = get(resourceData(this.data.actions.detail(id, flowId, this.#language)))
          return action == null ? [] : [[id, actionWithConnections(action, get(resourceData(this.data.connections.get(action.serviceId, flowId))))]]
        }),
      )
    })
    const catalogs = compute((get) => {
      const flowId = get(workspace.$.flowId)
      return Object.fromEntries(
        get(this.#services).flatMap((service) => {
          const connections = get(resourceData(this.data.connections.get(service, flowId)))
          return connections == null ? [] : [[service, connectionCatalog(connections)]]
        }),
      )
    })
    this.#selected = compute<Selection>((get) => {
      const target = connectorTarget(get(workspace.$.selection), get(workspace.$.revision))
      const state = get(this.#state)
      if (target == null) return { authorizationPending: false }
      const action = get(actions)[target.actionId]
      const catalog = action == null ? undefined : get(catalogs)[action.serviceId]
      const actionFailure = get(this.data.actions.detail(target.actionId, get(workspace.$.flowId), this.#language)).error
      const connectionFailure = action == null ? undefined : get(this.data.connections.get(action.serviceId, get(workspace.$.flowId))).error
      const connection = target.connectionId == null ? undefined : catalog?.byId.get(target.connectionId)
      return {
        action,
        actionError: actionFailure == null ? undefined : errorNotice(actionFailure, this.#i18n.t).message,
        activeConnections: catalog?.active,
        authorizationPending: action != null && state.authorizationServiceId == action.serviceId,
        connection,
        connectionError: connectionFailure == null ? undefined : errorNotice(connectionFailure, this.#i18n.t).message,
      }
    })
    this.$ = {
      connections: compute((get) => {
        const flowId = get(workspace.$.flowId)
        return flowId == null ? [] : (get(resourceData(this.data.connections.get(undefined, flowId))) ?? [])
      }),
      actionLoading: derive(this.#state, (state) => state.actionLoading),
      actions,
      catalogs,
      connectionLoading: derive(this.#state, (state) => state.connectionLoading),
      diagnostics: compute((get) => connectionDiagnostics(get(workspace.$.revision), get(actions), get(catalogs))),
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
    this.#draftRefresh.invalidate()
    this.#refresh.invalidate()
    this.#flowReaction()
    this.#revisionReaction()
    for (const value of Object.values(this.$)) value.dispose()
    this.#selected.dispose()
    this.#state.dispose()
    this.#actionIds.dispose()
    this.#services.dispose()
  }

  public setLanguage(language: string): void {
    if (language == this.#language || this.#disposed) return
    this.#language = language
    this.reset()
    void this.#loadDraftActions()
  }

  public reset(): void {
    if (this.#disposed) return
    this.#draftRefresh.invalidate()
    this.#refresh.invalidate()
    this.#authorization = undefined
    this.#loadingActions.clear()
    this.#state.set(initialState)
    this.#actionIds.set([])
    this.#services.set([])
  }

  public readonly loadConnections = async (signal: AbortSignal): Promise<void> => {
    const flowId = this.#workspace.$.flowId.value
    if (this.#disposed || flowId == null) return
    await resourceValue(this.data.connections.get(undefined, flowId), signal)
  }

  public readonly browseAddNodeOptions = (signal: AbortSignal) => {
    const source = this.data.providers.get(undefined, this.#language)
    return scopedValue(signal, (get) => {
      const state = get(source)
      const t = get(this.#i18n.t$)
      return {
        ...state,
        data: state.data?.toSorted((left, right) => left.serviceName.localeCompare(right.serviceName)).map((provider) => providerOption(provider, t)),
      }
    })
  }

  public readonly provideAddNodeOptionChoices = (optionId: string, signal: AbortSignal) => {
    const service = optionId.slice('connector-provider:'.length)
    const source = this.data.actions.get(service, undefined, this.#language)
    const providers = this.data.providers.get(undefined, this.#language)
    return scopedValue(signal, (get) => {
      const state = get(source)
      const provider = get(providers).data?.find((item) => item.serviceId == service)
      const t = get(this.#i18n.t$)
      return {
        ...state,
        data: state.data?.map((action) =>
          option(
            actionWithConnections(
              { ...action, ...(provider == null ? {} : { serviceName: provider.serviceName, icon: action.icon ?? provider.icon }) },
              undefined,
            ),
            t,
          ),
        ),
      }
    })
  }

  public readonly provideAddNodeOptions = (searchTerm: string, signal: AbortSignal, sessionSignal = signal) => {
    const query = searchTerm.trim()
    if (query.length == 0)
      return scopedValue(signal, (get) => ({
        data: providerOptions(Object.values(get(this.$.actions)), get(this.#i18n.t$)),
        refreshing: false,
        error: undefined,
      }))
    const source = this.data.actions.search(query, undefined, this.#language, sessionSignal).get()
    return scopedValue(signal, (get) => {
      const state = get(source)
      const t = get(this.#i18n.t$)
      return {
        ...state,
        data: state.data?.map((action) => option(actionWithConnections(action, undefined), t)),
      }
    })
  }

  public async resolveAction(actionId: string): Promise<{ readonly action: ConnectorActionView; readonly connections: readonly ConnectorConnection[] }> {
    const flowId = this.#workspace.$.flowId.value
    if (flowId == null || this.#disposed) throw new Error('Connector Action cannot be resolved without an active Flow.')
    await Promise.resolve()
    const action = await resourceValue(this.data.actions.detail(actionId, flowId, this.#language), undefined, true)
    const connections = action.authenticated ? await resourceValue(this.data.connections.get(action.serviceId, flowId), undefined, true) : []
    this.#remember(this.#actionIds, [actionId])
    if (action.authenticated) this.#remember(this.#services, [action.serviceId])
    return { action: actionWithConnections(action, connections), connections: connectionCatalog(connections).active }
  }

  public readonly retryCatalog = (): void => {
    this.data.providers.retryFailed()
    this.data.actions.retryFailed()
    this.data.connections.retryFailed()
  }

  public async refresh(force = false): Promise<void> {
    if (this.#disposed) return
    const current = this.#refresh.begin()
    const flowId = this.#workspace.$.flowId.value
    const target = connectorTarget(this.#workspace.$.selection.value, this.#workspace.$.revision.value)
    if (flowId == null || target == null) {
      if (this.#state.value.actionLoading != null || this.#state.value.connectionLoading != null) {
        this.#set({ actionLoading: undefined, connectionLoading: undefined })
      }
      return
    }
    const actionState = this.data.actions.detail(target.actionId, flowId, this.#language)
    this.#set({
      actionError: undefined,
      actionLoading: actionState.value.data == null ? target.actionId : undefined,
      connectionError: undefined,
      connectionLoading: undefined,
    })
    try {
      const action = await resourceValue(actionState)
      if (!this.#isCurrent(current, flowId)) return
      this.#remember(this.#actionIds, [action.actionId])
      if (action.authenticated) await this.#refreshConnections(flowId, target, action.serviceId, force, current)
    } catch (error) {
      if (this.#isCurrent(current, flowId)) {
        this.#set({ actionError: { actionId: target.actionId, message: errorNotice(error, this.#i18n.t).message } })
      }
    } finally {
      if (this.#isCurrent(current, flowId) && this.#state.value.actionLoading == target.actionId) this.#set({ actionLoading: undefined })
    }
  }

  public async loadCodeConnections(serviceId: string, signal: AbortSignal): Promise<void> {
    const flowId = this.#workspace.$.flowId.value
    if (flowId == null || this.#disposed) return
    await resourceValue(this.data.connections.get(serviceId, flowId), signal)
    if (signal.aborted || this.#disposed || flowId != this.#workspace.$.flowId.value) return
    this.#remember(this.#services, [serviceId])
  }

  public async loadCodeAction(actionId: string, signal: AbortSignal): Promise<void> {
    const language = this.#language
    const flowId = this.#workspace.$.flowId.value
    if (flowId == null || this.#disposed) return
    await resourceValue(this.data.actions.detail(actionId, flowId, language), signal)
    if (signal.aborted || this.#disposed || language != this.#language || flowId != this.#workspace.$.flowId.value) return
    this.#remember(this.#actionIds, [actionId])
  }

  public async connect(serviceId: string): Promise<void> {
    if (this.#disposed) return
    const flowId = this.#workspace.$.flowId.value
    if (flowId == null) return
    const catalog = this.$.catalogs.value[serviceId]
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
    this.#set({ authorizationServiceId: undefined })
    if (this.$.selectedAction.value?.serviceId == serviceId) await this.refresh(true)
    if (!this.#disposed && this.#authorization?.serviceId == serviceId) this.#authorization = undefined
  }

  async #refreshConnections(flowId: string, target: ConnectorTarget, serviceId: string, force: boolean, current: Current): Promise<void> {
    const connections = this.data.connections.get(serviceId, flowId)
    this.#set({ connectionLoading: force || connections.value.data == null ? serviceId : undefined })
    try {
      const catalog = await this.#loadCatalog(flowId, serviceId, force, current)
      if (catalog == null || !this.#isCurrent(current, flowId)) return
      await this.#pinPreferredConnection(target, serviceId, catalog)
    } finally {
      if (this.#isCurrent(current, flowId) && this.#state.value.connectionLoading == serviceId) this.#set({ connectionLoading: undefined })
    }
  }

  async #loadCatalog(flowId: string, serviceId: string, force: boolean, current: Current): Promise<ConnectionCatalog | undefined> {
    let connections: readonly ConnectorConnection[]
    try {
      const state = this.data.connections.get(serviceId, flowId, force)
      await Promise.resolve()
      connections = await resourceValue(state, undefined, force)
    } catch (error) {
      if (this.#isCurrent(current, flowId)) this.#set({ connectionError: { message: errorNotice(error, this.#i18n.t).message, serviceId } })
      return
    }
    if (!this.#isCurrent(current, flowId)) return
    const catalog = connectionCatalog(connections)
    this.#remember(this.#services, [serviceId])
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

  #remember(source: Val<readonly string[]>, ids: readonly string[]): void {
    if (ids.some((id) => !source.value.includes(id))) source.set([...new Set([...source.value, ...ids])])
  }

  #set(patch: Partial<ConnectorState>): void {
    if (this.#disposed || Object.entries(patch).every(([key, value]) => this.#state.value[key as keyof ConnectorState] === value)) return
    this.#state.set({ ...this.#state.value, ...patch })
  }

  #isCurrent(current: Current, flowId: string): boolean {
    return !this.#disposed && current() && flowId == this.#workspace.$.flowId.value
  }

  async #loadDraftActions(): Promise<void> {
    if (this.#disposed) return
    const current = this.#draftRefresh.begin()
    const flowId = this.#workspace.$.flowId.value
    const revision = this.#workspace.$.revision.value
    if (flowId == null || revision == null) return
    if (Object.values(revision.graph({ kind: 'flow' })?.nodes ?? {}).some((node) => node.kind == 'integration' || node.kind == 'poll')) {
      this.data.providers.get(flowId, this.#language)
    }
    const missing = [...revision.connectorActionIds].filter((actionId) => this.$.actions.value[actionId] == null && !this.#loadingActions.has(actionId))
    if (missing.length > 0) {
      for (const actionId of missing) this.#loadingActions.add(actionId)
      try {
        const actions = await Promise.all(missing.map((actionId) => resourceValue(this.data.actions.detail(actionId, flowId, this.#language))))
        if (!this.#isCurrent(current, flowId)) return
        this.#remember(
          this.#actionIds,
          actions.map((action) => action.actionId),
        )
      } catch {
        return
      } finally {
        for (const actionId of missing) this.#loadingActions.delete(actionId)
      }
    }
    if (!this.#isCurrent(current, flowId)) return
    const services = new Set<string>()
    for (const taskId of flowDependencies(revision.revision.content).tasks) {
      const task = revision.task(taskId)
      if (task?.executor.kind != 'connector') continue
      const action = this.$.actions.value[task.executor.action]
      if (action?.authenticated == true) services.add(action.serviceId)
    }
    await Promise.all([...services].map((serviceId) => this.#loadCatalog(flowId, serviceId, false, current)))
  }
}
