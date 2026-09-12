import type { PublishOperation } from '@oomol-lab/open-flow/control-api'
import type { RevisionContent, TriggerNode } from '@oomol-lab/open-flow/flow-change'
import type { PreparedFlow } from '@oomol-lab/open-flow/flow-semantics'
import type { Logger } from 'pino'
import type { ConnectorHost } from '../deployment/connector.ts'
import type { IntegrationRuntime } from '../runtime/integration-runtime.ts'
import type { ListenerRuntime } from '../runtime/listener-runtime.ts'
import type { PublicationStore } from '../storage/publication-store.ts'
import type { PublicationAcceptance } from '../storage/publication-store.ts'
import type { Store } from '../storage/store.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { nextTriggerScheduledAt, validateTriggerSchedule } from '@oomol-lab/open-flow/cron-trigger'
import { canonicalJsonBytes, digestBytes } from '@oomol-lab/open-flow/flow-encoding'
import { agentActions, codeActions } from '@oomol-lab/open-flow/flow-semantics'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { checkCodeActions, ConnectorTaskError } from '../deployment/connector.ts'
import { AcceptanceError, ControlError } from '../error.ts'
import { publishPending } from '../storage/publication-store.ts'

const batchSize = 100

interface PublishFlowInput {
  readonly control?:
    | { readonly actorId: string; readonly operation: 'publish' }
    | { readonly actorId: string; readonly operation: 'rollback'; readonly sourcePublicationId: string }
  readonly engineContract?: string
  readonly expectedLivePublicationId: string | null
  readonly flowId: string
  readonly idempotencyKey: string
  readonly revision: RevisionContent
  readonly revisionDigest?: string
  readonly revisionId: string
}

type PublicationMetadata =
  | { readonly actorId: string; readonly modelVersion: number; readonly operation: 'publish' }
  | { readonly actorId: string; readonly modelVersion: number; readonly operation: 'rollback'; readonly sourcePublicationId: string }

export class Publisher {
  readonly #store: Store
  readonly #integration: IntegrationRuntime
  readonly #listeners: ListenerRuntime
  readonly #agentAvailable: () => boolean
  readonly #resolveConnector: () => ConnectorHost | undefined
  readonly #resolveWaitPublicOrigin: () => URL | undefined
  readonly #clock: () => number
  readonly #logger: Logger
  readonly #validatedFlow: (revision: RevisionContent) => Promise<{
    readonly content: string
    readonly prepared: PreparedFlow
    readonly revisionDigest: string
    readonly variableBindings: Readonly<Record<string, string>>
  }>
  readonly #signal: () => void
  readonly #wakeMaintenance: () => void
  readonly #notifyFlowCatalog: () => void

  constructor(
    store: Store,
    integration: IntegrationRuntime,
    listeners: ListenerRuntime,
    resolveConnector: () => ConnectorHost | undefined,
    resolveWaitPublicOrigin: () => URL | undefined,
    clock: () => number,
    logger: Logger,
    validatedFlow: (revision: RevisionContent) => Promise<{
      readonly content: string
      readonly prepared: PreparedFlow
      readonly revisionDigest: string
      readonly variableBindings: Readonly<Record<string, string>>
    }>,
    signal: () => void,
    wakeMaintenance: () => void,
    notifyFlowCatalog: () => void,
    agentAvailable: () => boolean,
  ) {
    this.#agentAvailable = agentAvailable
    this.#store = store
    this.#integration = integration
    this.#listeners = listeners
    this.#resolveConnector = resolveConnector
    this.#resolveWaitPublicOrigin = resolveWaitPublicOrigin
    this.#clock = clock
    this.#logger = logger
    this.#validatedFlow = validatedFlow
    this.#signal = signal
    this.#wakeMaintenance = wakeMaintenance
    this.#notifyFlowCatalog = notifyFlowCatalog
  }

  async publish(input: PublishFlowInput): Promise<PublicationAcceptance> {
    const revisionDigest = input.revisionDigest ?? (await this.#validatedFlow(input.revision)).revisionDigest
    const replay = this.#store.publications.replayPublication(input.flowId, input.idempotencyKey, await this.#publicationRequestDigest(input, revisionDigest))
    if (replay != null) return replay
    const planned = await this.#publication(input)
    const accepted = this.#store.publications.publish(planned)
    this.#signal()
    return accepted
  }

  async accept(input: PublishFlowInput): Promise<PublishOperation> {
    const revisionDigest = input.revisionDigest ?? (await this.#validatedFlow(input.revision)).revisionDigest
    const replay = this.#store.publications.replayPublishOperation(
      input.flowId,
      input.idempotencyKey,
      await this.#publicationRequestDigest(input, revisionDigest),
    )
    if (replay?.kind == 'accepted') return replay.operation
    if (replay?.kind == 'conflict') {
      throw new ControlError(controlErrorCode.publicationConflict, 'The idempotency key refers to another Publish request.')
    }
    const accepted = this.#store.publications.acceptPublishOperation(await this.#publication(input))
    switch (accepted.kind) {
      case 'accepted':
        this.#wakeMaintenance()
        return accepted.operation
      case 'binding-unresolved':
        throw new ControlError(controlErrorCode.bindingUnresolved, 'A required Variable is unresolved.')
      case 'busy':
        throw new ControlError(controlErrorCode.flowBusy, 'Another Publish operation is already pending for this Flow.')
      case 'conflict':
        throw new ControlError(controlErrorCode.publicationConflict, 'The idempotency key refers to another Publish request.')
      case 'live-conflict':
        throw new ControlError(controlErrorCode.liveConflict, 'The Flow Live pointer no longer matches the expected Publication.')
      case 'not-found':
        throw new ControlError(controlErrorCode.flowNotFound, 'The Flow was not found.')
      case 'revision-conflict':
        throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed.')
      case 'unsupported':
        throw new ControlError(controlErrorCode.publicationUnsupported, 'The existing Integration subscription cannot be changed safely during Publish.')
    }
  }

  async #publication(input: PublishFlowInput): Promise<Parameters<PublicationStore['publish']>[0]> {
    const fixed = await this.#validatedFlow(input.revision)
    if (Object.values(fixed.prepared.tasks).some((task) => task.executor.kind == 'agent') && !this.#agentAvailable())
      throw new ControlError(controlErrorCode.flowInvalid, 'Agent requires a configured model host.')
    await checkCodeActions(
      [...codeActions(fixed.prepared), ...agentActions(fixed.prepared)],
      this.#resolveConnector(),
      this.#store.connectorTeams.get(input.flowId),
    )
    const engineContract = input.engineContract ?? currentEngineContract
    if (input.revisionDigest != null && input.revisionDigest != fixed.revisionDigest) {
      throw new AcceptanceError('revision-conflict', 'The fixed Revision digest does not match its content.')
    }
    if (
      (Object.values(fixed.prepared.graph.nodes).some((node) => node.kind == 'wait' && node.notification != null) ||
        Object.values(fixed.prepared.tasks).some((task) => task.executor.kind == 'agent' && task.executor.notification != null)) &&
      this.#resolveWaitPublicOrigin() == null
    ) {
      throw new ControlError(controlErrorCode.flowInvalid, 'Wait notification requires OPEN_FLOW_PUBLIC_ORIGIN.')
    }
    const requestDigest = await this.#publicationRequestDigest(input, fixed.revisionDigest)
    const publishedAt = this.#clock()
    const integrations = this.#integration.bindings(input.revision, fixed.prepared, publishedAt)
    const connectorTasks = Object.values(fixed.prepared.tasks).flatMap((task) =>
      'executor' in task && task.executor.kind == 'connector' ? [task.executor] : [],
    )
    const providerTriggers = Object.values(fixed.prepared.graph.nodes).filter(
      (trigger): trigger is Extract<TriggerNode, { readonly kind: 'integration' | 'poll' }> => trigger.kind == 'integration' || trigger.kind == 'poll',
    )
    if (connectorTasks.length > 0 || providerTriggers.length > 0) {
      const connector = this.#resolveConnector()
      if (connector == null) throw new ConnectorTaskError('connector.unconfigured', 'Connector is not configured for this deployment.')
      const teamId = this.#store.connectorTeams.get(input.flowId)
      const actionRequests = new Map<string, ReturnType<ConnectorHost['getAction']>>()
      const connectionRequests = new Map<string, ReturnType<ConnectorHost['listConnections']>>()
      const action = (actionId: string): ReturnType<ConnectorHost['getAction']> => {
        const existing = actionRequests.get(actionId)
        if (existing != null) return existing
        const request = connector.getAction(actionId, undefined, teamId)
        actionRequests.set(actionId, request)
        return request
      }
      const connections = (serviceId: string): ReturnType<ConnectorHost['listConnections']> => {
        const existing = connectionRequests.get(serviceId)
        if (existing != null) return existing
        const request = connector.listConnections(serviceId, undefined, teamId)
        connectionRequests.set(serviceId, request)
        return request
      }
      await Promise.all([
        ...connectorTasks.map(async (executor) => {
          const definition = await action(executor.action)
          if (!definition.authenticated && executor.connectionId == null) return
          if (executor.connectionId == null) {
            throw new ConnectorTaskError('connector.connection-required', 'The Connector Task requires a Connection before it can be published.')
          }
          const available = await connections(definition.serviceId)
          if (!available.some((candidate) => candidate.connectionId == executor.connectionId && candidate.status == 'active')) {
            throw new ConnectorTaskError('connector.connection-required', 'The selected Connector Connection must be reconnected or replaced.')
          }
        }),
        ...providerTriggers.map(async (trigger) => {
          const binding = input.revision.document.bindings[trigger.bindingId]
          if (binding?.kind != 'connection') {
            throw new ConnectorTaskError('connector.connection-required', 'The Trigger requires a Connection before it can be published.')
          }
          const available = await connections(trigger.definition.provider)
          if (!available.some((candidate) => candidate.connectionId == binding.target && candidate.status == 'active')) {
            throw new ConnectorTaskError('connector.connection-required', 'The selected Connector Connection must be reconnected or replaced.')
          }
        }),
      ])
    }
    const webhooks = Object.entries(fixed.prepared.graph.nodes)
      .filter((entry): entry is [string, Extract<TriggerNode, { readonly kind: 'webhook' }>] => entry[1].kind == 'webhook')
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([triggerNodeId, trigger]) => ({ triggerJson: JSON.stringify(trigger), triggerNodeId }))
    const crons = Object.entries(fixed.prepared.graph.nodes)
      .filter((entry): entry is [string, Extract<TriggerNode, { readonly kind: 'cron' }>] => entry[1].kind == 'cron')
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([triggerNodeId, trigger]) => {
        try {
          validateTriggerSchedule(trigger.cronTimes)
        } catch (error) {
          throw new AcceptanceError('trigger-invalid', error instanceof Error ? error.message : 'Cron Trigger schedule is invalid.')
        }
        return {
          nextAt: nextTriggerScheduledAt(trigger.cronTimes, publishedAt),
          scheduleJson: JSON.stringify(trigger.cronTimes),
          triggerJson: JSON.stringify(trigger),
          triggerNodeId,
        }
      })
    const polls = Object.entries(fixed.prepared.graph.nodes)
      .filter((entry): entry is [string, Extract<TriggerNode, { readonly kind: 'poll' }>] => entry[1].kind == 'poll')
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([triggerNodeId, trigger]) => {
        try {
          validateTriggerSchedule(trigger.pollTimes)
        } catch (error) {
          throw new AcceptanceError('trigger-invalid', error instanceof Error ? error.message : 'Poll Trigger schedule is invalid.')
        }
        if (!this.#listeners.supports(trigger.definition.key, trigger.definition.definitionVersion)) {
          throw new AcceptanceError('trigger-invalid', 'Poll Trigger definition is not available.')
        }
        const binding = input.revision.document.bindings[trigger.bindingId]
        if (binding?.kind != 'connection' || binding.target.length == 0) {
          throw new AcceptanceError('trigger-invalid', 'Poll Trigger Connection is unresolved.')
        }
        return {
          connectionId: binding.target,
          nextAt: nextTriggerScheduledAt(trigger.pollTimes, publishedAt),
          scheduleJson: JSON.stringify(trigger.pollTimes),
          triggerJson: JSON.stringify(trigger),
          triggerNodeId,
        }
      })
    let metadata: PublicationMetadata | undefined
    if (input.control?.operation == 'publish') {
      metadata = { actorId: input.control.actorId, modelVersion: input.revision.modelVersion, operation: 'publish' }
    } else if (input.control?.operation == 'rollback') {
      metadata = {
        actorId: input.control.actorId,
        modelVersion: input.revision.modelVersion,
        operation: 'rollback',
        sourcePublicationId: input.control.sourcePublicationId,
      }
    }
    return {
      closureDigest: fixed.prepared.closureDigest,
      content: fixed.content,
      crons,
      engineContract,
      expectedLivePublicationId: input.expectedLivePublicationId,
      flowId: input.flowId,
      idempotencyKey: input.idempotencyKey,
      integrations,
      ...(metadata == null ? {} : { metadata }),
      polls,
      publishedAt,
      requestDigest,
      revisionDigest: fixed.revisionDigest,
      revisionId: input.revisionId,
      variableNames: Object.values(fixed.variableBindings),
      webhooks,
    }
  }

  async #publicationRequestDigest(input: PublishFlowInput, revisionDigest: string): Promise<string> {
    return await digestBytes(
      canonicalJsonBytes({
        engineContract: input.engineContract ?? currentEngineContract,
        expectedLivePublicationId: input.expectedLivePublicationId,
        flowId: input.flowId,
        operation: input.control?.operation ?? 'publish',
        revisionDigest,
        ...(input.control?.operation == 'rollback' ? { sourcePublicationId: input.control.sourcePublicationId } : {}),
      }),
    )
  }

  advance(now: number): 'pending' | 'more' | 'idle' {
    let publishCount = 0
    for (; publishCount < batchSize; publishCount += 1) {
      const target = this.#store.publications.nextPublishOperation(now)
      if (target == null) break
      if (target.kind == 'failed') {
        const { operationId, ...issue } = target
        this.#store.publications.failPublishOperation(operationId, issue)
        this.#logger.warn({ category: 'publication.failed', operationId, ...issue }, 'Publish operation failed.')
        continue
      }
      const input = JSON.parse(target.input) as Parameters<PublicationStore['publish']>[0]
      let accepted: PublicationAcceptance
      try {
        accepted = this.#store.publications.publish({ ...input, operationId: target.operationId, publishedAt: now })
      } catch (error) {
        if (error === publishPending) return 'pending'
        throw error
      }
      switch (accepted.kind) {
        case 'published':
          this.#notifyFlowCatalog()
          this.#logger.info(
            { category: 'publication.succeeded', operationId: target.operationId, publicationId: accepted.publicationId },
            'Publish operation succeeded.',
          )
          break
        case 'binding-unresolved':
          this.#store.publications.failPublishOperation(target.operationId, {
            code: controlErrorCode.bindingUnresolved,
            message: 'A required Variable is unresolved.',
          })
          break
        case 'busy':
          this.#store.publications.failPublishOperation(target.operationId, { code: controlErrorCode.flowBusy, message: 'The Flow is retiring.' })
          break
        case 'conflict':
          this.#store.publications.failPublishOperation(target.operationId, {
            code: controlErrorCode.publicationConflict,
            message: 'The idempotency key refers to another Publication request.',
          })
          break
        case 'live-conflict':
          this.#store.publications.failPublishOperation(target.operationId, {
            code: controlErrorCode.liveConflict,
            message: 'The Flow Live pointer no longer matches the expected Publication.',
          })
          break
        case 'not-found':
          this.#store.publications.failPublishOperation(target.operationId, { code: controlErrorCode.flowNotFound, message: 'The Flow was not found.' })
          break
        case 'revision-conflict':
          this.#store.publications.failPublishOperation(target.operationId, { code: controlErrorCode.flowRevisionConflict, message: 'The Draft changed.' })
          break
        case 'source-not-found':
          this.#store.publications.failPublishOperation(target.operationId, {
            code: controlErrorCode.publicationNotFound,
            message: 'The source Publication was not found.',
          })
          break
        case 'operation-pending':
          return 'pending'
      }
    }
    return publishCount == batchSize ? 'more' : 'idle'
  }
}
