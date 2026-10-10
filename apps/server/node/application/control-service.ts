import type { CreateEventSource, UpdateEventSource } from '@oomol-lab/open-flow/control-api'
import type {
  ConnectorAction,
  ConnectorActionMetadata,
  ConnectorAccess,
  ConnectorAccessSnapshot,
  ConnectorAccessCandidatesBatch,
  ConnectorConnection,
  ConnectorProvider,
  Draft,
  DraftChange,
  Flow,
  FlowCatalogEvent,
  FlowChangeEvent,
  FlowCheck,
  Live,
  PollTriggerTestResult,
  Presentation,
  Publication,
  PublishOperation,
  TriggerActivity,
  TriggerBinding,
  TriggerKeySummary,
  Variable,
} from '@oomol-lab/open-flow/control-api'
import type { AuthoringRead, AuthoringSearch, AuthoringRequest, AuthoringType } from '@oomol-lab/open-flow/control-requests'
import type { DraftOperation } from '@oomol-lab/open-flow/control-requests'
import type { JsonValue, RevisionContent, TriggerKeySnapshot } from '@oomol-lab/open-flow/flow-change'
import type { ConnectorAccessHost, ConnectorAccessMutation } from '../deployment/connector-access.ts'
import type { ConnectorAccessContext, ConnectorHost } from '../deployment/connector.ts'
import type { EventSourceRuntime } from '../runtime/event-source-runtime.ts'
import type { StoredFlow, StoredFlowRevision } from '../storage/flow-store.ts'
import type { PublicationAcceptance } from '../storage/publication-store.ts'
import type { StoredTriggerBinding } from '../storage/trigger-store.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { readAuthoring, searchAuthoring, compileAuthoring, authoringSchema, authoringDiagnostics, AuthoringError } from '@oomol-lab/open-flow/control-requests'
import { resolveDraftOperations } from '@oomol-lab/open-flow/control-requests'
import { applyFlowChanges, currentFlowModelVersion, FlowChangeError } from '@oomol-lab/open-flow/flow-change'
import { canonicalJsonBytes, digestBytes, encodeRevision, repairRevision } from '@oomol-lab/open-flow/flow-encoding'
import { flowClosure, removeConnectionUsage, validateFlow } from '@oomol-lab/open-flow/flow-semantics'
import { triggerConfigValues } from '@oomol-lab/open-flow/integration-trigger'
import { PermanentPollError, PollConnectionError } from '@oomol-lab/open-flow/poll-trigger'
import { triggerDefinitions as providerDefinitions } from '@oomol-lab/open-flow/provider-triggers'
import { currentEngineContract, findEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { createHash } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { ConnectorTaskError, ConnectorClient } from '../deployment/connector.ts'
import { loadOpenApiDocument } from '../deployment/openapi.ts'
import { AcceptanceError, ControlError, serverErrorCode } from '../error.ts'
import { RevisionIntegrityError } from '../storage/revision-store.ts'
import { Store } from '../storage/store.ts'
import { actionAccountDiagnostics } from './action-account-diagnostics.ts'
import {
  flow,
  variable,
  revisionContent,
  revisionMetadata,
  readRevisionOrRepair,
  draft,
  presentation,
  triggerBinding,
  triggerActivity,
  publication,
} from './control-views.ts'
import { RunControl } from './run-control.ts'

type PublishInput = {
  readonly control:
    | { readonly actorId: string; readonly operation: 'publish' }
    | { readonly actorId: string; readonly operation: 'rollback'; readonly sourcePublicationId: string }
  readonly engineContract: string
  readonly expectedLivePublicationId: string | null
  readonly flowId: string
  readonly idempotencyKey: string
  readonly revision: RevisionContent
  readonly revisionDigest: string
  readonly revisionId: string
}

export interface TriggerActivityPosition {
  readonly activityId: string
  readonly createdAt: number
}

export interface FlowPosition {
  readonly createdAt: number
  readonly flowId: string
}

export interface PublicationPosition {
  readonly createdAt: number
  readonly publicationId: string
}

export class ControlService {
  private readonly acceptPublish: (input: PublishInput) => Promise<PublishOperation>
  private readonly clock: () => number
  private readonly flowCatalogChanged: (event?: FlowCatalogEvent, ownerId?: string) => void
  private readonly flowChanged: (event: FlowChangeEvent) => void
  private readonly llmAvailable: (kind?: 'agent' | 'decision') => boolean
  private readonly publish: (input: PublishInput) => Promise<PublicationAcceptance>
  private readonly resolveConnector: () => ConnectorHost | undefined
  private readonly connectorAccess: ConnectorAccessHost
  private readonly resolveConnectorConsoleOrigin: () => URL | undefined
  private readonly resolveConnectorTeam: (teamId?: string) => Promise<string | undefined>
  private readonly store: Store
  private readonly testPollTrigger: (flowId: string, triggerNodeId: string) => Promise<PollTriggerTestResult>
  private readonly triggerDefinitions: readonly TriggerKeySnapshot[]
  private readonly triggersChanged: () => void

  readonly users: Store['users']
  readonly runs: RunControl
  readonly eventSources?: EventSourceRuntime

  constructor(
    store: Store,
    clock: () => number,
    abortRun: (runId: string) => void,
    wake: () => void,
    publish: (input: PublishInput) => Promise<PublicationAcceptance>,
    acceptPublish: (input: PublishInput) => Promise<PublishOperation>,
    triggersChanged: () => void,
    triggerDefinitions: readonly TriggerKeySnapshot[],
    testPollTrigger: (flowId: string, triggerNodeId: string) => Promise<PollTriggerTestResult>,
    flowCatalogChanged: (event?: FlowCatalogEvent, ownerId?: string) => void,
    flowChanged: (event: FlowChangeEvent) => void,
    llmAvailable: (kind?: 'agent' | 'decision') => boolean,
    resolveConnector: () => ConnectorHost | undefined,
    connectorAccess: ConnectorAccessHost,
    resolveConnectorConsoleOrigin: () => URL | undefined,
    resolveWaitPublicOrigin: () => URL | undefined,
    resolveConnectorTeam: (teamId?: string) => Promise<string | undefined>,
    eventSources?: EventSourceRuntime,
  ) {
    this.users = store.users
    this.runs = new RunControl(store, clock, abortRun, wake, flowChanged, llmAvailable, resolveConnector, connectorAccess, resolveWaitPublicOrigin)
    this.eventSources = eventSources
    this.store = store
    this.clock = clock
    this.publish = publish
    this.acceptPublish = acceptPublish
    this.triggersChanged = triggersChanged
    this.triggerDefinitions = triggerDefinitions
    this.testPollTrigger = testPollTrigger
    this.flowCatalogChanged = flowCatalogChanged
    this.flowChanged = flowChanged
    this.llmAvailable = llmAvailable
    this.resolveConnector = resolveConnector
    this.connectorAccess = connectorAccess
    this.resolveConnectorConsoleOrigin = resolveConnectorConsoleOrigin
    this.resolveConnectorTeam = resolveConnectorTeam
  }

  requireAdmin(actorId: string): void {
    const user = this.users.get(actorId)
    if (actorId != 'operator' && !(user?.enabled && user.role == 'admin')) {
      throw new ControlError(serverErrorCode.authorizationDenied, 'Administrator permission is required.')
    }
  }

  ownsFlow(actorId: string, flowId: string): boolean {
    return this.store.flows.get(flowId)?.ownerId == actorId
  }

  authorize(actorId: string, resources: { readonly flowId?: string; readonly runId?: string; readonly publicationId?: string }): void {
    if (resources.flowId != null && !this.ownsFlow(actorId, resources.flowId)) notFound()
    if (resources.runId != null) {
      const run = this.store.runViews.controlRun(resources.runId)
      if (run == null || !this.ownsFlow(actorId, run.flowId)) throw new ControlError(controlErrorCode.runNotFound, 'The Run was not found.')
    }
    if (resources.publicationId != null) {
      const storedPublication = this.store.publications.publicationById(resources.publicationId)
      if (storedPublication == null || !this.ownsFlow(actorId, storedPublication.flowId))
        throw new ControlError(controlErrorCode.publicationNotFound, 'The Publication was not found.')
    }
  }

  async listEventSources(flowId?: string) {
    if (this.eventSources == null) throw new ControlError(controlErrorCode.eventSourceInvalid, 'Event sources are unavailable.')
    if (flowId == null) return this.eventSources.list()
    const teamId = (await this.resolveConnectorScope(flowId)) ?? null
    return { ...this.eventSources.list(teamId), teamId }
  }

  async listEventSourceConnections(teamId: string | undefined, signal: AbortSignal) {
    const scope = await this.resolveConnectorTeam(teamId)
    if (scope != teamId) throw new ControlError(controlErrorCode.eventSourceInvalid, 'Select the Connector Team explicitly.')
    const connector = this.resolveConnector()
    if (connector == null) throw new ControlError(controlErrorCode.connectorUnconfigured, 'Connector is not configured.')
    return { version: 1, connections: await connector.listConnections('feishu_app_bot', signal, this.#connectorContext(undefined, scope)) }
  }

  async createEventSource(input: CreateEventSource, signal: AbortSignal) {
    if (this.eventSources == null) throw new ControlError(controlErrorCode.eventSourceInvalid, 'Event sources are unavailable.')
    const teamId = await this.resolveConnectorTeam(input.teamId ?? undefined)
    if ((teamId ?? null) != input.teamId) throw new ControlError(controlErrorCode.eventSourceInvalid, 'Select the Connector Team explicitly.')
    return this.eventSources.create(input, signal)
  }

  updateEventSource(sourceId: string, input: UpdateEventSource) {
    if (this.eventSources == null) throw new ControlError(controlErrorCode.eventSourceInvalid, 'Event sources are unavailable.')
    return this.eventSources.update(sourceId, input)
  }

  deleteEventSource(sourceId: string, revision: number) {
    if (this.eventSources == null) throw new ControlError(controlErrorCode.eventSourceInvalid, 'Event sources are unavailable.')
    this.eventSources.delete(sourceId, revision)
  }

  listTriggerKeys(): readonly TriggerKeySummary[] {
    return this.triggerDefinitions.map(({ description, displayName, key, name, provider, type }) => ({ description, displayName, key, name, provider, type }))
  }

  listTriggerDefinitions(): readonly TriggerKeySnapshot[] {
    return this.triggerDefinitions
  }

  listVariables(actorId: string): { readonly variables: readonly Variable[]; readonly version: 1 } {
    return { variables: this.store.variables.list(actorId).map(variable), version: 1 }
  }

  getVariableReferences(actorId: string, name: string) {
    this.getVariable(actorId, name)
    return this.store.flows.variableReferences(actorId, name)
  }

  getVariable(actorId: string, name: string): Variable {
    const stored = this.store.variables.get(actorId, name)
    if (stored == null) throw new ControlError(controlErrorCode.variableNotFound, 'The variable was not found.')
    return variable(stored)
  }

  putVariable(actorId: string, name: string, value: string): Variable {
    const saved = this.store.variables.put(actorId, name, value)
    if (saved.kind == 'limit-reached') {
      throw new ControlError(controlErrorCode.variableLimitReached, 'The account has reached its variable limit.')
    }
    return variable(saved.variable)
  }

  deleteVariable(actorId: string, name: string): void {
    if (!this.store.variables.delete(actorId, name)) throw new ControlError(controlErrorCode.variableNotFound, 'The variable was not found.')
  }

  getTriggerKey(key: string): TriggerKeySnapshot {
    const definition = this.triggerDefinitions.find((candidate) => candidate.key == key)
    if (definition == null) throw new ControlError(controlErrorCode.triggerKeyNotFound, 'The Trigger Key was not found.')
    return definition
  }

  async listTriggerConfigOptions(flowId: string, nodeId: string, field: string, signal: AbortSignal, actorId?: string) {
    const currentDraft = this.getDraft(flowId)
    const trigger = currentDraft.content.document.graph.nodes[nodeId]
    if (trigger == null || (trigger.kind != 'poll' && trigger.kind != 'integration'))
      throw new ControlError(controlErrorCode.triggerKeyNotFound, 'The Trigger was not found.')
    const definition = providerDefinitions.find((item) => item.snapshot.key == trigger.definition.key)
    if (definition != null && 'eventSource' in definition && definition.eventSource != null) {
      if (trigger.connectionId == null) throw new ControlError(serverErrorCode.connectorConnectionRequired, 'Select a Connection first.')
      const sources = (await this.listEventSources(flowId)).sources.filter(
        (source) => source.connectionId == trigger.connectionId && source.provider == trigger.definition.provider,
      )
      if (field == 'sourceId') return sources.map((source) => ({ value: source.sourceId, label: source.name }))
      if (field == 'eventTypes')
        return (
          sources.find((source) => source.sourceId == (trigger.config.sourceId?.kind === 'value' ? trigger.config.sourceId.value : undefined))?.eventTypes ?? []
        ).map((type) => ({ value: type, label: type }))
      throw new ControlError(controlErrorCode.triggerKeyInvalid, 'Unknown event source configuration field.')
    }
    if (definition?.configOptions == null) throw new ControlError(controlErrorCode.triggerKeyInvalid, 'This Trigger has no dynamic configuration options.')
    const connectionId = trigger.connectionId
    if (connectionId == null) throw new ControlError(serverErrorCode.connectorConnectionRequired, 'Select a Connection first.')
    return await this.#connectorRequest(
      flowId,
      async (connector, access) => {
        try {
          return await definition.configOptions!({
            field,
            config: triggerConfigValues(trigger.definition.configInputs, trigger.config),
            signal,
            connector: {
              execute: () => {
                throw new PermanentPollError('Raw proxy requests are not available to Triggers.')
              },
              trigger: (request) => {
                if (connector.trigger == null) throw new PermanentPollError('Trigger operation transport is unavailable.')
                return connector.trigger(definition.snapshot.provider, connectionId, definition.snapshot.key, request, signal, access)
              },
            },
          })
        } catch (error) {
          if (error instanceof PollConnectionError) throw new ControlError(serverErrorCode.connectorConnectionRequired, error.message)
          if (error instanceof PermanentPollError) throw new ControlError(controlErrorCode.triggerKeyInvalid, error.message)
          if (error instanceof ConnectorTaskError) throw error
          if (signal.aborted) throw error
          throw new ControlError(controlErrorCode.connectorUnavailable, 'Trigger configuration options could not be loaded.')
        }
      },
      actorId,
    )
  }

  async listConnectorProviders(flowId?: string, signal?: AbortSignal, locale?: string, actorId?: string): Promise<readonly ConnectorProvider[]> {
    return await this.#connectorRequest(flowId, (connector, access) => connector.listProviders(signal, access, locale), actorId)
  }

  getConnectorAccess(actorId: string, flowId: string, publicationId?: string): ConnectorAccess | ConnectorAccessSnapshot {
    this.getFlow(flowId)
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
    this.getFlow(flowId)
    try {
      return await this.connectorAccess.listCandidates(actorId, flowId, providerIds, signal)
    } catch (error) {
      if (error instanceof ConnectorTaskError) throw new ControlError(error.code, error.message)
      throw error
    }
  }

  async setConnectorService(actorId: string, flowId: string, providerId: string, selected: boolean, expectedAccessRevision: number): Promise<ConnectorAccess> {
    this.getFlow(flowId)
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
    this.getFlow(flowId)
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
    this.getFlow(flowId)
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

  async listConnectorActionMetadata(serviceId?: string, flowId?: string, locale?: string, actorId?: string): Promise<readonly ConnectorActionMetadata[]> {
    return await this.#connectorRequest(flowId, (connector, access) => connector.listActions(serviceId, undefined, access, locale), actorId)
  }

  async searchConnectorActionMetadata(
    query: string,
    flowId?: string,
    signal?: AbortSignal,
    locale?: string,
    actorId?: string,
  ): Promise<readonly ConnectorActionMetadata[]> {
    return await this.#connectorRequest(flowId, (connector, access) => connector.searchActions(query, signal, access, locale), actorId)
  }

  async getConnectorActionMetadata(
    actionId: string,
    flowId?: string,
    signal?: AbortSignal,
    locale?: string,
    actorId?: string,
  ): Promise<ConnectorActionMetadata> {
    return await this.#connectorRequest(flowId, (connector, access) => connector.getAction(actionId, signal, access, locale), actorId)
  }

  async listConnectorActions(serviceId?: string, flowId?: string, locale?: string, actorId?: string): Promise<readonly ConnectorAction[]> {
    return await this.#connectorRequest(
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

  async searchConnectorActions(query: string, flowId?: string, signal?: AbortSignal, locale?: string, actorId?: string): Promise<readonly ConnectorAction[]> {
    return await this.#connectorRequest(
      flowId,
      async (connector, access) => {
        const [actions, connections] = await Promise.all([connector.searchActions(query, signal, access, locale), connector.listAllConnections(signal, access)])
        return actions.map((action) => actionWithDefaultConnection(action, connections))
      },
      actorId,
    )
  }

  async getConnectorAction(actionId: string, flowId?: string, signal?: AbortSignal, locale?: string, actorId?: string): Promise<ConnectorAction> {
    return await this.#connectorRequest(
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

  async listAllConnectorConnections(flowId?: string, signal?: AbortSignal, actorId?: string): Promise<readonly ConnectorConnection[]> {
    return await this.#connectorRequest(flowId, (connector, access) => connector.listAllConnections(signal, access), actorId)
  }

  async listConnectorConnections(serviceId: string, flowId?: string, signal?: AbortSignal, actorId?: string): Promise<readonly ConnectorConnection[]> {
    return await this.#connectorRequest(flowId, (connector, access) => connector.listConnections(serviceId, signal, access), actorId)
  }

  async connectorConnectionPage(serviceId: string, flowId?: string, teamId?: string, signal?: AbortSignal): Promise<string> {
    if (flowId != null && teamId != null) throw new ControlError(controlErrorCode.flowInvalid, 'Specify either a Flow or a Team for the connection page.')
    if (flowId != null) this.getFlow(flowId)
    const connector = this.resolveConnector()
    if (connector instanceof ConnectorClient && connector.teamSupported()) {
      try {
        return await connector.hostedConnectionPage(serviceId, flowId == null ? teamId : await this.resolveConnectorScope(flowId), signal)
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

  async resolveConnectorScope(flowId?: string): Promise<string | undefined> {
    if (flowId == null) return await this.resolveConnectorTeam()
    this.getFlow(flowId)
    let teamId = this.store.connectorTeams.get(flowId)
    if (teamId == null) {
      const resolved = await this.resolveConnectorTeam()
      if (resolved != null) teamId = this.store.connectorTeams.bind(flowId, resolved)
    }
    return teamId
  }

  async #connectorRequest<Value>(
    flowId: string | undefined,
    request: (connector: ConnectorHost, access: ConnectorAccessContext) => Promise<Value>,
    actorId?: string,
  ): Promise<Value> {
    const connector = this.resolveConnector()
    if (connector == null) throw new ControlError(controlErrorCode.connectorUnconfigured, 'Connector is not configured for this deployment.')
    const teamId = await this.resolveConnectorScope(flowId)
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

  async createFlow(
    actorId: string,
    name: string,
    idempotencyKey: string,
    connectorTeamId?: string,
  ): Promise<{ readonly created: boolean; readonly flow: Flow }> {
    const selectedConnectorTeamId = await this.resolveConnectorTeam(connectorTeamId)
    if (connectorTeamId != null && selectedConnectorTeamId == null) {
      throw new ControlError(controlErrorCode.flowInvalid, 'Connector Team is not available for this deployment.')
    }
    const content = emptyRevision()
    const bytes = encodeRevision(content)
    const createdAt = this.clock()
    const stored = this.store.flows.createFlow({
      actorId,
      connectorTeamId: selectedConnectorTeamId,
      content: new TextDecoder().decode(bytes),
      createdAt,
      digest: await digestBytes(bytes),
      idempotencyKey,
      modelVersion: content.modelVersion,
      name,
      flowId: identity('flow'),
      requestDigest: await digestBytes(canonicalJsonBytes({ connectorTeamId: connectorTeamId ?? null, name })),
      revisionId: identity('revision'),
    })
    if ('kind' in stored) throw new ControlError(controlErrorCode.flowConflict, 'The idempotency key refers to another Flow request.')
    if (stored.created) this.flowCatalogChanged({ kind: 'flow.created', flowId: stored.flow.flowId, version: 1 })
    return { created: stored.created, flow: flow(stored.flow) }
  }

  listFlows(
    limit: number,
    after?: FlowPosition,
    includeTotal = false,
    ownerId?: string,
  ): {
    readonly next?: FlowPosition
    readonly page: { readonly flows: readonly Flow[]; readonly total?: number; readonly version: 1 }
  } {
    const stored = this.store.flows.list(limit + 1, after, includeTotal, ownerId)
    const rows = stored.flows.slice(0, limit)
    const last = rows.at(-1)
    return {
      ...(stored.flows.length > limit && last != null ? { next: { createdAt: last.createdAt, flowId: last.flowId } } : {}),
      page: {
        flows: rows.map(flow),
        ...(stored.total == null ? {} : { total: stored.total }),
        version: 1,
      },
    }
  }

  getFlow(flowId: string): Flow {
    const stored = this.store.flows.get(flowId)
    if (stored == null) notFound()
    return flow(stored)
  }

  setFlowEnabled(flowId: string, publicationId: string, enabled: boolean): Flow {
    this.getFlow(flowId)
    const stored = this.store.flows.setEnabled(flowId, publicationId, enabled)
    if (stored == null) throw new ControlError(controlErrorCode.flowConflict, 'The published Flow changed or is retiring.')
    this.triggersChanged()
    this.flowCatalogChanged(undefined, stored.ownerId)
    return flow(stored)
  }

  renameFlow(flowId: string, name: string): Flow {
    const stored = this.store.flows.rename(flowId, name, this.clock())
    if (stored == null) notFound()
    this.flowCatalogChanged(undefined, stored.ownerId)
    return flow(stored)
  }

  getErrorListeners(flowId: string) {
    this.getFlow(flowId)
    return { version: 1 as const, listeners: this.store.triggers.errorListeners(flowId) }
  }

  retireFlow(flowId: string): Flow {
    const stored = this.store.flows.retire(flowId, this.clock())
    if (stored == null) notFound()
    this.triggersChanged()
    this.flowCatalogChanged(undefined, stored.ownerId)
    return flow(stored)
  }

  async getEditor(flowId: string) {
    const currentFlow = this.getFlow(flowId)
    const currentDraft = this.getDraft(flowId)
    const currentPresentation = this.getPresentation(flowId)
    const live = await this.getLive(flowId)
    return { flow: currentFlow, draft: currentDraft, live, presentation: currentPresentation, version: 1 as const }
  }

  getDraft(flowId: string): Draft {
    return draft(this.requireDraft(flowId))
  }

  getRevision(flowId: string, revisionId: string): Draft {
    const stored = readRevisionOrRepair(() => this.store.flows.revision(flowId, revisionId))
    if (stored == null) notFound()
    return draft(stored)
  }

  syncDraft(flowId: string): { readonly draft: Draft; readonly kind: 'snapshot'; readonly version: 1 } {
    const current = this.requireDraft(flowId)
    return { draft: draft(current), kind: 'snapshot', version: 1 }
  }

  async removeConnectionUsage(
    actorId: string,
    flowId: string,
    connectionId: string,
    expectedRevisionId: string,
    expectedAccessRevision: number,
    changeId: string,
  ): Promise<DraftChange> {
    this.requireDraft(flowId)
    const requestDigest = await digestBytes(canonicalJsonBytes({ kind: 'connection-usage.remove', connectionId, expectedRevisionId, expectedAccessRevision }))
    const previous = this.store.flows.change(flowId, changeId)
    if (previous != null) {
      if (previous.requestDigest != requestDigest) throw new ControlError(controlErrorCode.flowConflict, 'The change identity refers to another Draft change.')
      return { revision: revisionMetadata(previous), version: 1 }
    }
    const base = readRevisionOrRepair(() => this.store.flows.revision(flowId, expectedRevisionId))
    if (base == null) throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed.')
    const content = removeConnectionUsage(revisionContent(base), connectionId)
    const bytes = encodeRevision(content)
    const digest = await digestBytes(bytes)
    const stored = this.store.flows.commitRevision(
      {
        actorId,
        flowId,
        expectedRevisionId,
        changeId,
        requestDigest,
        digest,
        modelVersion: content.modelVersion,
        content: new TextDecoder().decode(bytes),
        createdAt: this.clock(),
        revisionId: identity('revision'),
      },
      () => {
        const result = this.connectorAccess.removeConnection(flowId, connectionId, expectedAccessRevision)
        if (result.kind != 'saved') throw new ControlError(controlErrorCode.connectorAccessConflict, 'Connection usage changed concurrently.')
      },
    )
    switch (stored.kind) {
      case 'busy':
        throw new ControlError(controlErrorCode.flowBusy, 'The Flow is retiring.')
      case 'conflict':
        throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed.')
      case 'request-conflict':
        throw new ControlError(controlErrorCode.flowConflict, 'The change identity refers to another Draft change.')
      case 'not-found':
        return notFound()
      case 'committed':
        this.triggersChanged()
        this.flowCatalogChanged(undefined, this.store.flows.get(flowId)?.ownerId)
        this.flowChanged({ kind: 'draft.changed', flowId, revisionId: stored.revision.revisionId, version: 1 })
        this.flowChanged({ kind: 'access.changed', flowId, accessRevision: this.connectorAccess.current(flowId).accessRevision, version: 1 })
        return { revision: revisionMetadata(stored.revision), version: 1 }
    }
  }

  async changeDraft(
    actorId: string,
    flowId: string,
    expectedRevisionId: string,
    operations: readonly DraftOperation[],
    changeId: string = randomUUID(),
  ): Promise<DraftChange> {
    return this.commitDraft(
      actorId,
      flowId,
      expectedRevisionId,
      changeId,
      { expectedRevisionId, operations: operations as unknown as JsonValue },
      async (base) =>
        applyFlowChanges(
          base,
          resolveDraftOperations(operations, (key) => this.getTriggerKey(key)),
        ),
    )
  }

  readAuthoring(flowId: string, query: AuthoringRead = {}) {
    const revision = this.getRevision(flowId, query.revision ?? this.getFlow(flowId).draftRevisionId)
    try {
      return { flowId, revision: revision.revisionId, data: readAuthoring(revision.content, query), version: 1 as const }
    } catch (error) {
      return this.authoringError(error)
    }
  }

  searchAuthoring(flowId: string, query: AuthoringSearch) {
    const revision = this.getRevision(flowId, query.revision ?? this.getFlow(flowId).draftRevisionId)
    try {
      return { flowId, revision: revision.revisionId, data: searchAuthoring(revision.content, query), version: 1 as const }
    } catch (error) {
      return this.authoringError(error)
    }
  }

  async authoringSchema(flowId: string, query: { type?: AuthoringType; action?: string }) {
    this.getFlow(flowId)
    if (query.action != null) {
      const action = await this.getConnectorAction(query.action, flowId)
      return { action: action.actionId, name: action.name, inputs: action.inputs, outputs: action.outputs, version: 1 as const }
    }
    return { ...authoringSchema(query.type), version: 1 as const }
  }

  async checkAuthoring(flowId: string, revisionId: string) {
    const check = await this.checkFlow(flowId, revisionId, currentEngineContract)
    const revision = this.getRevision(flowId, revisionId)
    return { flowId, revisionId, valid: check.valid, diagnostics: authoringDiagnostics(revision.content, check.diagnostics), version: 1 as const }
  }

  private authoringError(error: unknown): never {
    if (error instanceof AuthoringError)
      throw new ControlError(controlErrorCode.flowInvalid, error.message, { cause: error, details: { ...error.details, reason: error.code } })
    throw error
  }

  async editAuthoring(actorId: string, flowId: string, request: AuthoringRequest) {
    const id = (label: string) =>
      createHash('sha256')
        .update(JSON.stringify([flowId, request.requestId, label]))
        .digest('hex')
        .slice(0, 24)
    const result = await this.commitDraft(actorId, flowId, request.baseRevision, request.requestId, request as unknown as JsonValue, async (base) => {
      try {
        return (
          await compileAuthoring(base, request, {
            id,
            action: (action) => this.getConnectorAction(action, flowId, undefined, undefined, actorId),
            trigger: (key) => this.getTriggerKey(key),
            openapi: (url) => loadOpenApiDocument(url),
          })
        ).content
      } catch (error) {
        return this.authoringError(error)
      }
    })
    // Diagnostics are separate from the commit receipt, including after retention or a check failure.
    let validation: { status: string; diagnostics?: ReturnType<typeof authoringDiagnostics> }
    try {
      const revision = this.getRevision(flowId, result.revision.revisionId)
      const checked = await this.checkAuthoring(flowId, revision.revisionId)
      validation = { status: checked.valid ? 'valid' : 'invalid', diagnostics: checked.diagnostics }
    } catch {
      validation = { status: 'unavailable' }
    }
    return {
      flowId,
      saved: true,
      revision: result.revision.revisionId,
      nodes: Object.fromEntries(request.edits.flatMap((edit) => (edit.op == 'node.add' ? [[edit.as, id(`node:${edit.as}`)]] : []))),
      changes: request.edits.map((edit, index) => ({ index, op: edit.op, ...('node' in edit ? { node: edit.node } : {}) })),
      validation,
      version: 1 as const,
    }
  }

  private async commitDraft(
    actorId: string,
    flowId: string,
    expectedRevisionId: string,
    changeId: string,
    request: JsonValue,
    resolve: (base: RevisionContent) => Promise<RevisionContent>,
  ): Promise<DraftChange> {
    this.requireDraft(flowId)
    const requestDigest = await digestBytes(canonicalJsonBytes(request))
    const previous = this.store.flows.change(flowId, changeId)
    if (previous != null) {
      if (previous.requestDigest != requestDigest) throw new ControlError(controlErrorCode.flowConflict, 'The change identity refers to another Draft change.')
      return { revision: revisionMetadata(previous), version: 1 }
    }
    if (this.getFlow(flowId).draftRevisionId != expectedRevisionId)
      throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed. Read the affected nodes before editing again.', {
        details: { revision: this.getFlow(flowId).draftRevisionId },
      })
    const base = readRevisionOrRepair(() => this.store.flows.revision(flowId, expectedRevisionId))
    if (base == null) throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed.')
    let content: RevisionContent
    try {
      content = await resolve(revisionContent(base))
    } catch (error) {
      if (error instanceof FlowChangeError) invalidFlow(`The Draft change could not be applied. ${error.message}`)
      if (error instanceof ControlError) throw error
      throw new ControlError(controlErrorCode.flowInvalid, 'The Draft operation has an invalid structure.', { cause: error })
    }
    let bytes: Uint8Array
    try {
      bytes = encodeRevision(content)
    } catch (error) {
      throw new ControlError(controlErrorCode.flowInvalid, 'The Draft change produced invalid Revision content.', { cause: error })
    }
    const digest = await digestBytes(bytes)
    if (digest == base.digest) invalidFlow('The Draft change does not modify the Flow.')
    const stored = this.store.flows.commitRevision({
      actorId,
      changeId,
      content: new TextDecoder().decode(bytes),
      createdAt: this.clock(),
      digest,
      modelVersion: content.modelVersion,
      expectedRevisionId,
      flowId,
      requestDigest,
      revisionId: identity('revision'),
    })
    switch (stored.kind) {
      case 'busy':
        throw new ControlError(controlErrorCode.flowBusy, 'The Flow is retiring.')
      case 'conflict':
        throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed.')
      case 'request-conflict':
        throw new ControlError(controlErrorCode.flowConflict, 'The change identity refers to another Draft change.')
      case 'not-found':
        return notFound()
      case 'committed':
        this.triggersChanged()
        this.flowCatalogChanged(undefined, this.store.flows.get(flowId)?.ownerId)
        this.flowChanged({ kind: 'draft.changed', flowId, revisionId: stored.revision.revisionId, version: 1 })
        return { revision: revisionMetadata(stored.revision), version: 1 }
    }
  }

  async repairDraft(actorId: string, flowId: string, expectedRevisionId: string, changeId: string = randomUUID()): Promise<DraftChange> {
    const currentFlow = this.store.flows.get(flowId)
    if (currentFlow == null) notFound()
    const requestDigest = await digestBytes(canonicalJsonBytes({ expectedRevisionId, version: 1 }))
    const previous = this.store.flows.change(flowId, changeId)
    if (previous != null) {
      if (previous.requestDigest != requestDigest) throw new ControlError(controlErrorCode.flowConflict, 'The repair identity refers to another Draft repair.')
      return { revision: revisionMetadata(previous), version: 1 }
    }
    if (currentFlow.draftRevisionId != expectedRevisionId) throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed.')
    let base: StoredFlowRevision | undefined
    try {
      base = this.store.flows.revision(flowId, expectedRevisionId)
    } catch (error) {
      if (!(error instanceof RevisionIntegrityError)) throw error
    }
    let content = emptyRevision()
    if (base != null) {
      const source = new TextEncoder().encode(base.content)
      if ((await digestBytes(source)) == base.digest) {
        try {
          content = repairRevision(source)
        } catch (error) {
          // Only unreadable JSON can fall back to a blank child Draft.
          if (!(error instanceof SyntaxError))
            throw new ControlError(controlErrorCode.flowInvalid, 'The stored Draft cannot be repaired or upgraded.', { cause: error })
        }
      }
    }
    const bytes = encodeRevision(content)
    const digest = await digestBytes(bytes)
    const stored = this.store.flows.commitRevision({
      actorId,
      changeId,
      content: new TextDecoder().decode(bytes),
      createdAt: this.clock(),
      digest,
      forceFull: true,
      modelVersion: content.modelVersion,
      expectedRevisionId,
      flowId,
      requestDigest,
      revisionId: identity('revision'),
    })
    switch (stored.kind) {
      case 'busy':
        throw new ControlError(controlErrorCode.flowBusy, 'The Flow is retiring.')
      case 'conflict':
        throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed.')
      case 'request-conflict':
        throw new ControlError(controlErrorCode.flowConflict, 'The repair identity refers to another Draft repair.')
      case 'not-found':
        return notFound()
      case 'committed':
        this.triggersChanged()
        this.flowCatalogChanged(undefined, this.store.flows.get(flowId)?.ownerId)
        this.flowChanged({ kind: 'draft.changed', flowId, revisionId: stored.revision.revisionId, version: 1 })
        return { revision: revisionMetadata(stored.revision), version: 1 }
    }
  }

  async getLive(flowId: string): Promise<Live> {
    const currentFlow = this.getFlow(flowId)
    const current = this.requireDraft(flowId)
    const stored = this.store.publications.live(flowId)
    if (stored == null) {
      return {
        flowId,
        hasUnpublishedChanges: true,
        publication: null,
        revision: 0,
        status: 'not-published',
        version: 1,
      }
    }
    const draftClosure = await flowClosure(revisionContent(current))
    const providerAccess = this.connectorAccess.current(flowId)
    return {
      flowId,
      hasUnpublishedChanges:
        draftClosure.digest != stored.publication.closureDigest || providerAccess.sharedAccessDigest != stored.publication.sharedAccessDigest,
      publication: publication(stored.publication),
      revision: stored.revision,
      status: currentFlow.live?.enabled == false ? 'suspended' : liveStatus(currentFlow.status, stored.publication.engineContract),
      version: 1,
    }
  }

  listFlowTriggerBindings(flowId: string): readonly TriggerBinding[] {
    this.getFlow(flowId)
    return this.store.triggers.listTriggerBindings(flowId).map((binding) => triggerBinding(binding))
  }

  getFlowTriggerBinding(flowId: string, triggerNodeId: string, endpointOrigin: string): TriggerBinding {
    this.getFlow(flowId)
    return triggerBinding(this.requireTriggerBinding(flowId, triggerNodeId), endpointOrigin)
  }

  changeFlowTriggerState(flowId: string, triggerNodeId: string, operatorState: StoredTriggerBinding['operatorState']): TriggerBinding {
    this.getFlow(flowId)
    const changed = this.store.triggers.setTriggerOperatorState(flowId, triggerNodeId, operatorState, this.clock())
    if (changed == null) triggerNotFound()
    if (changed.kind == 'error') this.flowCatalogChanged(undefined, this.store.flows.get(flowId)?.ownerId)
    this.triggersChanged()
    return triggerBinding(changed)
  }

  listFlowTriggerActivities(
    flowId: string,
    triggerNodeId: string,
    limit: number,
    after?: TriggerActivityPosition,
  ): {
    readonly next?: TriggerActivityPosition
    readonly page: { readonly activities: readonly TriggerActivity[]; readonly version: 1 }
  } {
    this.getFlow(flowId)
    const binding = this.requireTriggerBinding(flowId, triggerNodeId)
    const stored = this.store.triggers.listTriggerActivities(binding.bindingId, limit + 1, this.clock(), after)
    const rows = stored.slice(0, limit)
    const last = rows.at(-1)
    return {
      ...(stored.length > limit && last != null ? { next: { activityId: last.activityId, createdAt: last.createdAt } } : {}),
      page: { activities: rows.map(triggerActivity), version: 1 },
    }
  }

  async testFlowPollTrigger(flowId: string, triggerNodeId: string): Promise<PollTriggerTestResult> {
    this.getFlow(flowId)
    const binding = this.requireTriggerBinding(flowId, triggerNodeId)
    if (binding.kind != 'poll' || binding.currentPublicationId == null) triggerNotFound()
    return await this.testPollTrigger(flowId, triggerNodeId)
  }

  listPublications(
    flowId: string,
    limit: number,
    after?: PublicationPosition,
    includeTotal = false,
  ): {
    readonly next?: PublicationPosition
    readonly page: { readonly publications: readonly Publication[]; readonly total?: number; readonly version: 1 }
  } {
    this.getFlow(flowId)
    const stored = this.store.publications.listPublications(flowId, limit + 1, after, includeTotal)
    const rows = stored.publications.slice(0, limit)
    const last = rows.at(-1)
    return {
      ...(stored.publications.length > limit && last != null ? { next: { createdAt: last.createdAt, publicationId: last.publicationId } } : {}),
      page: {
        publications: rows.map(publication),
        ...(stored.total == null ? {} : { total: stored.total }),
        version: 1,
      },
    }
  }

  async publishFlow(
    actorId: string,
    flowId: string,
    revisionId: string,
    engineContract: string,
    expectedLivePublicationId: string | null,
    idempotencyKey: string,
  ): Promise<PublishOperation> {
    if (engineContract != currentEngineContract) throw new ControlError(controlErrorCode.engineUnsupported, 'The Engine Contract is not supported.')
    const revision = readRevisionOrRepair(() => this.store.flows.revision(flowId, revisionId))
    if (revision == null) notFound()
    return await this.commitPublishOperation({
      control: { actorId, operation: 'publish' },
      engineContract,
      expectedLivePublicationId,
      flowId,
      idempotencyKey,
      revision: revisionContent(revision),
      revisionDigest: revision.digest,
      revisionId,
    })
  }

  getPublishOperation(flowId: string, operationId: string): PublishOperation {
    this.getFlow(flowId)
    const operation = this.store.publications.publishOperation(flowId, operationId)
    if (operation == null) {
      throw new ControlError(controlErrorCode.publishOperationNotFound, 'The Publish operation was not found.')
    }
    return operation
  }

  async rollbackFlow(
    actorId: string,
    flowId: string,
    sourcePublicationId: string,
    expectedLivePublicationId: string,
    idempotencyKey: string,
  ): Promise<{ readonly created: boolean; readonly publication: Publication }> {
    const source = this.store.publications.publication(flowId, sourcePublicationId)
    if (source == null) throw new ControlError(controlErrorCode.publicationNotFound, 'The Publication was not found.')
    const revision = readRevisionOrRepair(() => this.store.flows.revision(flowId, source.revisionId))
    if (revision == null || revision.digest != source.revisionDigest) {
      throw new ControlError(serverErrorCode.flowRevisionStorageConflict, 'The fixed Revision does not match the Publication.')
    }
    const content = revisionContent(revision)
    if (Object.values(content.document.graph.nodes).some((node) => node.kind == 'integration' || node.kind == 'poll')) {
      throw new ControlError(
        controlErrorCode.publicationConflict,
        'Rollback for Provider Triggers is not supported until their resources can be prepared safely.',
      )
    }
    const result = await this.commitPublication({
      control: { actorId, operation: 'rollback', sourcePublicationId },
      engineContract: source.engineContract,
      expectedLivePublicationId,
      flowId,
      idempotencyKey,
      revision: content,
      revisionDigest: revision.digest,
      revisionId: source.revisionId,
    })
    if (result.created) this.flowCatalogChanged(undefined, this.store.flows.get(flowId)?.ownerId)
    return result
  }

  getPublicationPresentation(flowId: string, publicationId: string): { readonly version: 1; readonly presentation: Presentation | null } {
    this.getFlow(flowId)
    if (this.store.publications.publication(flowId, publicationId) == null) {
      throw new ControlError(controlErrorCode.publicationNotFound, 'The Publication was not found.')
    }
    return { version: 1, presentation: this.store.publications.presentation(flowId, publicationId) }
  }

  getPresentation(flowId: string): Presentation {
    const stored = this.store.flows.presentation(flowId)
    if (stored == null) notFound()
    return presentation(stored)
  }

  updatePresentation(flowId: string, expectedRevision: number, value: Readonly<Record<string, JsonValue>>): Presentation {
    const stored = this.store.flows.updatePresentation(flowId, expectedRevision, value, this.clock())
    switch (stored.kind) {
      case 'busy':
        throw new ControlError(controlErrorCode.flowBusy, 'The Flow is retiring.')
      case 'conflict':
        throw new ControlError(controlErrorCode.flowPresentationConflict, 'The Presentation changed.')
      case 'not-found':
        return notFound()
      case 'updated':
        return presentation(stored.presentation)
    }
  }

  async checkFlow(flowId: string, revisionId: string, engineContract: string): Promise<FlowCheck> {
    const engine = findEngineContract(engineContract)
    if (engine == null) throw new ControlError(controlErrorCode.engineUnsupported, 'The Engine Contract is not supported.')
    const stored = readRevisionOrRepair(() => this.store.flows.revision(flowId, revisionId))
    if (stored == null) notFound()
    const content = revisionContent(stored)
    let checked: Awaited<ReturnType<typeof validateFlow>>
    try {
      checked = await validateFlow(content, engine)
    } catch (error) {
      throw new ControlError(controlErrorCode.flowInvalid, 'The stored Flow Revision is not structurally valid.', { cause: error })
    }
    const connector = this.resolveConnector()
    const accountDiagnostics = await actionAccountDiagnostics(content, checked.closure.dependencies, async (actionId) => {
      if (connector == null) throw new ConnectorTaskError('connector.unconfigured', 'Connector is not configured for this deployment.')
      const teamId = await this.resolveConnectorScope(flowId)
      return connector.getAction(actionId, undefined, this.#connectorContext(flowId, teamId))
    })
    const llmDiagnostics = [...checked.closure.dependencies.nodes].toSorted().flatMap((nodeId) => {
      const node = content.document.graph.nodes[nodeId]
      const kind = node?.kind == 'task' && 'executor' in node.task ? node.task.executor.kind : undefined
      if ((kind != 'llm' && kind != 'agent' && kind != 'decision') || this.llmAvailable(kind == 'llm' ? undefined : kind)) return []
      return [
        {
          code: 'llm.unconfigured',
          column: 0,
          line: 0,
          message: 'LLM is not configured for this deployment. Configure OPEN_FLOW_LLM_ORIGIN and OPEN_FLOW_LLM_TOKEN.',
          path: `/document/graph/nodes/${nodeId}/task/executor`,
          values: {},
        },
      ]
    })
    return {
      closureDigest: checked.closure.digest,
      diagnostics: [...checked.diagnostics, ...llmDiagnostics, ...accountDiagnostics],
      engineContract,
      flowId,
      modelVersion: content.modelVersion,
      revisionDigest: stored.digest,
      revisionId,
      valid: checked.valid && llmDiagnostics.length == 0 && accountDiagnostics.length == 0,
      version: 1,
    }
  }

  private async commitPublication(input: PublishInput): Promise<{ readonly created: boolean; readonly publication: Publication }> {
    let accepted: PublicationAcceptance
    try {
      accepted = await this.publish(input)
    } catch (error) {
      this.publicationError(error)
    }
    switch (accepted.kind) {
      case 'access-conflict':
        throw new ControlError(controlErrorCode.connectorAccessConflict, 'Connector access changed while the Publication was being accepted.')
      case 'error-sources-unavailable':
        throw new ControlError(controlErrorCode.flowInvalid, 'Select published upstream Flows other than this Flow.')
      case 'binding-unresolved':
        throw new ControlError(controlErrorCode.bindingUnresolved, 'A required variable is unresolved.')
      case 'busy':
        throw new ControlError(controlErrorCode.flowBusy, 'The Flow is retiring.')
      case 'conflict':
        throw new ControlError(controlErrorCode.publicationConflict, 'The idempotency key refers to another Publication request.')
      case 'live-conflict':
        throw new ControlError(controlErrorCode.liveConflict, 'The Flow Live pointer no longer matches the expected Publication.')
      case 'not-found':
        return notFound()
      case 'operation-pending':
        throw new Error('A synchronous Publication cannot have pending work.')
      case 'revision-conflict':
        throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed.')
      case 'source-not-found':
        throw new ControlError(controlErrorCode.publicationNotFound, 'The Publication was not found.')
      case 'published': {
        const stored = this.store.publications.publication(input.flowId, accepted.publicationId)
        if (stored == null) throw new Error('Committed Publication is missing.')
        return { created: accepted.created, publication: publication(stored) }
      }
    }
  }

  private async commitPublishOperation(input: PublishInput): Promise<PublishOperation> {
    try {
      return await this.acceptPublish(input)
    } catch (error) {
      this.publicationError(error)
    }
  }

  private publicationError(error: unknown): never {
    if (error instanceof ConnectorTaskError) throw new ControlError(error.code, error.message)
    if (!(error instanceof AcceptanceError)) throw error
    switch (error.code) {
      case 'engine-unsupported':
        throw new ControlError(controlErrorCode.engineUnsupported, error.message)
      case 'flow-not-found':
        throw new ControlError(controlErrorCode.flowNotFound, error.message)
      case 'publication-live-conflict':
        throw new ControlError(controlErrorCode.liveConflict, error.message)
      case 'revision-conflict':
        throw new ControlError(serverErrorCode.flowRevisionStorageConflict, error.message)
      case 'flow-inputs-invalid':
      case 'flow-invalid':
      case 'revision-invalid':
      case 'trigger-invalid':
      case 'trigger-outputs-invalid':
        throw new ControlError(controlErrorCode.flowInvalid, error.message)
    }
  }

  private requireDraft(flowId: string): StoredFlowRevision {
    const stored = readRevisionOrRepair(() => this.store.flows.draft(flowId))
    if (stored == null) notFound()
    return stored
  }

  private requireTriggerBinding(flowId: string, triggerNodeId: string): StoredTriggerBinding {
    const stored = this.store.triggers.triggerBinding(flowId, triggerNodeId)
    if (stored == null) triggerNotFound()
    return stored
  }
}

function emptyRevision(): RevisionContent {
  return {
    document: { bindings: {}, graph: { edges: [], nodes: {} } },
    modelVersion: currentFlowModelVersion,
    modules: {},
  }
}

function identity(kind: 'flow' | 'revision'): string {
  return `${kind}_${randomUUID().replaceAll('-', '')}`
}

function liveStatus(flowStatus: StoredFlow['status'], engineContract: string): 'runnable' | 'suspended' {
  return flowStatus == 'active' && findEngineContract(engineContract) != null ? 'runnable' : 'suspended'
}

function invalidFlow(message: string): never {
  throw new ControlError(controlErrorCode.flowInvalid, message)
}

function notFound(): never {
  throw new ControlError(controlErrorCode.flowNotFound, 'The Flow or Revision was not found.')
}

function triggerNotFound(): never {
  throw new ControlError(controlErrorCode.triggerNotFound, 'The Trigger binding was not found.')
}

/** Compose the legacy public response without coupling the upstream metadata cache to accounts. */
function actionWithDefaultConnection(action: ConnectorActionMetadata, connections: readonly ConnectorConnection[]): ConnectorAction {
  const active = connections.filter((connection) => connection.serviceId == action.serviceId && connection.status == 'active')
  const preferred = action.authenticated ? (active.find((connection) => connection.isDefault) ?? (active.length == 1 ? active[0] : undefined)) : undefined
  return { ...action, ...(preferred == null ? {} : { defaultConnection: preferred }) }
}
