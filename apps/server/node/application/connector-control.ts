import type {
  ConnectorAccess,
  ConnectorAccessCandidatesBatch,
  ConnectorAccessSnapshot,
  ConnectorAction,
  ConnectorActionMetadata,
  ConnectorConnection,
  ConnectorProvider,
  FlowCatalogEvent,
  FlowChangeEvent,
} from '@oomol-lab/open-flow/control-api'
import type { JsonValue, RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { ConnectorAccessHost, ConnectorAccessMutation } from '../deployment/connector-access.ts'
import type { ConnectorAccessContext, ConnectorHost } from '../deployment/connector-contract.ts'
import type { Store } from '../storage/store.ts'
import type { ControlAccess } from './control-access.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { SourceIdentityError, eventSourceDefinition } from '@oomol-lab/open-flow/event-source'
import { randomUUID } from 'node:crypto'
import { ConnectorTaskError } from '../deployment/connector-contract.ts'
import { ConnectorClient } from '../deployment/connector.ts'
import { ControlError } from '../error.ts'
import { actionAccountDiagnostics } from './action-account-diagnostics.ts'

export class ConnectorControl {
  constructor(
    private readonly access: ControlAccess,
    private readonly store: Pick<Store, 'publications' | 'flows' | 'connectorTeams'>,
    private readonly connectorAccess: ConnectorAccessHost,
    private readonly flowChanged: (event: FlowChangeEvent) => void,
    private readonly flowCatalogChanged: (event?: FlowCatalogEvent, ownerId?: string) => void,
    private readonly resolveConnector: () => ConnectorHost | undefined,
    private readonly resolveConnectorTeam: (teamId?: string) => Promise<string | undefined>,
    private readonly resolveConnectorConsoleOrigin: () => URL | undefined,
  ) {}

  async listConnectorProviders(actorId: string, flowId?: string, signal?: AbortSignal, locale?: string): Promise<readonly ConnectorProvider[]> {
    this.access.authorize(actorId, { flowId })

    return await this.request(flowId, (connector, access) => connector.listProviders(signal, access, locale), actorId)
  }

  async listLeinaBots(actorId: string, flowId: string, signal: AbortSignal): Promise<JsonValue> {
    this.access.authorize(actorId, { flowId })

    return this.request(
      flowId,
      (connector, access) =>
        connector.execute('leina.list_bots', undefined, {}, randomUUID(), signal, {
          ...access,
          scope: 'action',
          action: 'leina.list_bots',
          purpose: 'execute',
          providerAccess: {
            version: 2,
            mode: access.providerAccess.mode,
            sharedAccessDigest: access.providerAccess.sharedAccessDigest,
            sharedBindings: [],
            selectedBindings: [],
          },
        }),
      actorId,
    )
  }

  getConnectorAccess(actorId: string, flowId: string, publicationId?: string): ConnectorAccess | ConnectorAccessSnapshot {
    this.access.authorize(actorId, { flowId })
    if (publicationId != null) {
      if (this.store.publications.publication(flowId, publicationId) == null)
        throw new ControlError(controlErrorCode.publicationNotFound, 'The Publication was not found.')
      return this.store.publications.providerAccess(publicationId)!
    }
    return this.connectorAccess.read(actorId, flowId)
  }

  async getProviderAccessBindingCandidates(
    actorId: string,
    flowId: string,
    providerIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<ConnectorAccessCandidatesBatch> {
    this.access.authorize(actorId, { flowId })
    try {
      return await this.connectorAccess.listCandidates(actorId, flowId, providerIds, signal)
    } catch (error) {
      if (error instanceof ConnectorTaskError) throw new ControlError(error.code, error.message)
      throw error
    }
  }

  async setConnectorService(actorId: string, flowId: string, providerId: string, selected: boolean, expectedAccessRevision: number): Promise<ConnectorAccess> {
    this.access.authorize(actorId, { flowId })
    try {
      return this.#accessMutation(flowId, await this.connectorAccess.setService(actorId, flowId, providerId, selected, expectedAccessRevision))
    } catch (error) {
      if (error instanceof ConnectorTaskError) throw new ControlError(error.code, error.message)
      throw error
    }
  }

  async addProviderAccessBinding(
    actorId: string,
    flowId: string,
    providerId: string,
    accessBindingId: string,
    expectedAccessRevision: number,
  ): Promise<ConnectorAccess> {
    this.access.authorize(actorId, { flowId })
    try {
      return this.#accessMutation(flowId, await this.connectorAccess.add(actorId, flowId, providerId, accessBindingId, expectedAccessRevision))
    } catch (error) {
      if (error instanceof ConnectorTaskError) throw new ControlError(error.code, error.message)
      throw error
    }
  }

  async removeProviderAccessBinding(
    actorId: string,
    flowId: string,
    providerId: string,
    accessBindingId: string,
    expectedAccessRevision: number,
  ): Promise<ConnectorAccess> {
    this.access.authorize(actorId, { flowId })
    return this.#accessMutation(flowId, await this.connectorAccess.remove(actorId, flowId, providerId, accessBindingId, expectedAccessRevision))
  }

  #accessMutation(flowId: string, mutation: ConnectorAccessMutation): ConnectorAccess {
    switch (mutation.kind) {
      case 'saved':
        this.flowChanged({ accessRevision: mutation.access.accessRevision, flowId, kind: 'access.changed', version: 1 })
        this.flowCatalogChanged(undefined, this.store.flows.get(flowId)?.ownerId)
        return mutation.access
      case 'conflict':
        throw new ControlError(controlErrorCode.connectorAccessConflict, 'Connector access changed concurrently.')
      case 'invalid':
        throw new ControlError(controlErrorCode.connectorAccessInvalid, 'The Provider access binding is invalid or unavailable.')
      case 'unsupported':
        throw new ControlError(controlErrorCode.connectorAccessUnsupported, 'This deployment manages Connector access implicitly.')
    }
  }

  async listConnectorActionMetadata(actorId: string, serviceId?: string, flowId?: string, locale?: string): Promise<readonly ConnectorActionMetadata[]> {
    this.access.authorize(actorId, { flowId })

    return await this.request(flowId, (connector, access) => connector.listActions(serviceId, undefined, access, locale), actorId)
  }

  async searchConnectorActionMetadata(
    actorId: string,
    query: string,
    flowId?: string,
    signal?: AbortSignal,
    locale?: string,
  ): Promise<readonly ConnectorActionMetadata[]> {
    this.access.authorize(actorId, { flowId })

    return await this.request(flowId, (connector, access) => connector.searchActions(query, signal, access, locale), actorId)
  }

  async getConnectorActionMetadata(
    actorId: string,
    actionId: string,
    flowId?: string,
    signal?: AbortSignal,
    locale?: string,
  ): Promise<ConnectorActionMetadata> {
    this.access.authorize(actorId, { flowId })

    return await this.request(flowId, (connector, access) => connector.getAction(actionId, signal, access, locale), actorId)
  }

  async listConnectorActions(actorId: string, serviceId?: string, flowId?: string, locale?: string): Promise<readonly ConnectorAction[]> {
    this.access.authorize(actorId, { flowId })

    return await this.request(
      flowId,
      async (connector, access) => {
        const [actions, connections] = await Promise.all([
          connector.listActions(serviceId, undefined, access, locale),
          serviceId == null ? connector.listAllConnections(undefined, access) : connector.listConnections(serviceId, undefined, access),
        ])
        return actions.map((action) => actionWithDefaultConnection(action, connections))
      },
      actorId,
    )
  }

  async searchConnectorActions(actorId: string, query: string, flowId?: string, signal?: AbortSignal, locale?: string): Promise<readonly ConnectorAction[]> {
    this.access.authorize(actorId, { flowId })

    return await this.request(
      flowId,
      async (connector, access) => {
        const [actions, connections] = await Promise.all([connector.searchActions(query, signal, access, locale), connector.listAllConnections(signal, access)])
        return actions.map((action) => actionWithDefaultConnection(action, connections))
      },
      actorId,
    )
  }

  async getConnectorAction(actorId: string, actionId: string, flowId?: string, signal?: AbortSignal, locale?: string): Promise<ConnectorAction> {
    this.access.authorize(actorId, { flowId })

    return await this.request(
      flowId,
      async (connector, access) => {
        const [action, connections] = await Promise.all([connector.getAction(actionId, signal, access, locale), connector.listAllConnections(signal, access)])
        if (flowId == null || access.providerAccess.mode == 'implicit' || !action.authenticated) return actionWithDefaultConnection(action, connections)
        const response = await this.connectorAccess.listCandidates(actorId ?? '', flowId, [action.serviceId], signal)
        const result = response.results[0]
        if (result == null || 'error' in result) throw new ConnectorTaskError('connector.unavailable', 'Connection candidates are unavailable.')
        const allowed = new Set(
          result.candidates
            .filter((candidate) => candidate.permissions == null || candidate.permissions.allActions || candidate.permissions.actionIds.includes(actionId))
            .map((candidate) => candidate.connectionId),
        )
        return actionWithDefaultConnection(
          action,
          connections.filter((connection) => allowed.has(connection.connectionId)),
        )
      },
      actorId,
    )
  }

  async listAllConnectorConnections(actorId: string, flowId?: string, signal?: AbortSignal): Promise<readonly ConnectorConnection[]> {
    this.access.authorize(actorId, { flowId })

    return await this.request(flowId, (connector, access) => connector.listAllConnections(signal, access), actorId)
  }

  async listConnectorConnections(actorId: string, serviceId: string, flowId?: string, signal?: AbortSignal): Promise<readonly ConnectorConnection[]> {
    this.access.authorize(actorId, { flowId })

    return await this.request(flowId, (connector, access) => connector.listConnections(serviceId, signal, access), actorId)
  }

  async connectorConnectionPage(actorId: string, serviceId: string, flowId?: string, teamId?: string, signal?: AbortSignal): Promise<string> {
    this.access.requireAdmin(actorId)
    this.access.authorize(actorId, { flowId })

    if (flowId != null && teamId != null) throw new ControlError(controlErrorCode.flowInvalid, 'Specify either a Flow or a Team for the connection page.')
    const connector = this.resolveConnector()
    if (connector instanceof ConnectorClient && connector.teamSupported()) {
      try {
        return await connector.hostedConnectionPage(serviceId, flowId == null ? teamId : await this.resolveConnectorScope(actorId, flowId), signal)
      } catch (error) {
        if (!(error instanceof ConnectorTaskError)) throw error
        throw new ControlError(error.code, error.message)
      }
    }
    if (teamId != null) await this.resolveConnectorTeam(teamId)
    const origin = this.resolveConnectorConsoleOrigin()
    if (origin == null) {
      throw new ControlError(
        controlErrorCode.connectorConsoleUnconfigured,
        'Connector authorization console URL is not configured. Set OPEN_FLOW_CONNECTOR_CONSOLE_ORIGIN or configure the Connector authorization console URL in deployment Settings.',
      )
    }
    return new URL(`providers/${encodeURIComponent(serviceId)}`, origin).href
  }

  async resolveConnectorScope(actorId: string, flowId?: string): Promise<string | undefined> {
    this.access.authorize(actorId, { flowId })

    if (flowId == null) return await this.resolveConnectorTeam()
    let teamId = this.store.connectorTeams.get(flowId)
    if (teamId == null) {
      const resolved = await this.resolveConnectorTeam()
      if (resolved != null) teamId = this.store.connectorTeams.bind(flowId, resolved)
    }
    return teamId
  }

  async request<Value>(
    flowId: string | undefined,
    request: (connector: ConnectorHost, access: ConnectorAccessContext) => Promise<Value>,
    actorId: string,
  ): Promise<Value> {
    const connector = this.resolveConnector()
    if (connector == null) throw new ControlError(controlErrorCode.connectorUnconfigured, 'Connector is not configured for this deployment.')
    const teamId = await this.resolveConnectorScope(actorId, flowId)
    try {
      return await request(connector, this.#connectorContext(flowId, teamId, actorId))
    } catch (error) {
      if (!(error instanceof ConnectorTaskError)) throw error
      throw new ControlError(error.code, error.message)
    }
  }

  #connectorContext(flowId: string | undefined, teamId?: string, actorId?: string): ConnectorAccessContext {
    return {
      ...(actorId == null ? {} : { actorId }),
      ...(flowId == null ? {} : { flowId }),
      providerAccess: flowId != null && actorId != null ? this.connectorAccess.read(actorId, flowId) : this.connectorAccess.current(flowId ?? ''),
      scope: 'catalog',
      purpose: 'catalog',
      source: flowId == null ? 'operator' : 'draft',
      ...(teamId == null ? {} : { teamId }),
    }
  }

  async listEventSourceConnections(actorId: string, teamId: string | undefined, signal: AbortSignal, kind = 'feishu') {
    this.access.requireAdmin(actorId)

    const scope = await this.resolveConnectorTeam(teamId)
    if (scope != teamId) throw new ControlError(controlErrorCode.eventSourceInvalid, 'Select the Connector Team explicitly.')
    const connector = this.resolveConnector()
    if (connector == null) throw new ControlError(controlErrorCode.connectorUnconfigured, 'Connector is not configured.')
    let definition
    try {
      definition = eventSourceDefinition(kind)
    } catch (error) {
      if (error instanceof SourceIdentityError) throw new ControlError(controlErrorCode.eventSourceInvalid, error.message)
      throw error
    }
    return { version: 1, connections: await connector.listConnections(definition.provider, signal, this.#connectorContext(undefined, scope)) }
  }

  async accountDiagnostics(actorId: string, flowId: string, content: RevisionContent, dependencies: { readonly nodes: Iterable<string> }) {
    this.access.authorize(actorId, { flowId })
    const connector = this.resolveConnector()
    return actionAccountDiagnostics(content, dependencies, async (actionId) => {
      if (connector == null) throw new ConnectorTaskError('connector.unconfigured', 'Connector is not configured for this deployment.')
      const teamId = await this.resolveConnectorScope(actorId, flowId)
      return connector.getAction(actionId, undefined, this.#connectorContext(flowId, teamId))
    })
  }
}
function actionWithDefaultConnection(action: ConnectorActionMetadata, connections: readonly ConnectorConnection[]): ConnectorAction {
  const active = connections.filter((connection) => connection.serviceId == action.serviceId && connection.status == 'active')
  const preferred = action.authenticated ? (active.find((connection) => connection.isDefault) ?? (active.length == 1 ? active[0] : undefined)) : undefined
  return { ...action, ...(preferred == null ? {} : { defaultConnection: preferred }) }
}
