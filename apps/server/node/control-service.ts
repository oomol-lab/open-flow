import type { ConnectorAction, ConnectorConnection, ConnectorProvider, FlowChangeEvent, Variable } from '@oomol-lab/open-flow/control-api'
import type { ChangeOperation, JsonValue, RevisionContent, TriggerKeySnapshot } from '@oomol-lab/open-flow/flow-change'
import type { RunStatus } from '@oomol-lab/open-flow/run-lifecycle'
import type { FlowRunOptions } from '@oomol-lab/open-flow/scheduler'
import type { ConnectorHost } from './connector.ts'
import type { PublicationAcceptance, StoredControlRun, StoredPresentation, StoredFlow, StoredFlowRevision, StoredPublication } from './store.ts'
import type { StoredTriggerActivity, StoredTriggerBinding } from './trigger-store.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { applyFlowChanges } from '@oomol-lab/open-flow/flow-change'
import { canonicalJsonBytes, digestBytes, encodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { flowClosure, prepareFlow, validateFlow, validateFlowInputs, variableBindings } from '@oomol-lab/open-flow/flow-semantics'
import { currentEngineContract, findEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { randomUUID } from 'node:crypto'
import { ConnectorTaskError } from './connector.ts'
import { AcceptanceError, ControlError, serverErrorCode } from './error.ts'
import { Store } from './store.ts'

type RunInputs = NonNullable<FlowRunOptions['inputs']>
type PublishInput = {
  readonly control:
    | { readonly actorId: string; readonly operation: 'publish' }
    | { readonly actorId: string; readonly operation: 'rollback'; readonly sourcePublicationId: string }
  readonly engineContract: string
  readonly expectedLivePublicationId: string | null
  readonly flowId: string
  readonly idempotencyKey: string
  readonly revision: RevisionContent
  readonly revisionId: string
}

interface Flow {
  readonly createdAt: string
  readonly draftRevisionId: string
  readonly name: string
  readonly flowId: string
  readonly status: 'active' | 'retiring'
  readonly updatedAt: string
  readonly version: 1
}

interface RevisionMetadata {
  readonly actorId: string
  readonly createdAt: string
  readonly digest: string
  readonly modelVersion: number
  readonly parentRevisionId: string | null
  readonly flowId: string
  readonly revisionId: string
  readonly version: 1
}

interface Draft extends RevisionMetadata {
  readonly content: RevisionContent
}

interface DraftChange {
  readonly revision: RevisionMetadata
  readonly version: 1
}

interface Publication {
  readonly actorId: string
  readonly closureDigest: string
  readonly createdAt: string
  readonly engineContract: string
  readonly flowId: string
  readonly modelVersion: number
  readonly operation: 'publish' | 'rollback'
  readonly publicationId: string
  readonly revisionDigest: string
  readonly revisionId: string
  readonly sourcePublicationId?: string
  readonly version: 1
}

interface Live {
  readonly flowId: string
  readonly hasUnpublishedChanges: boolean
  readonly publication: Publication | null
  readonly revision: number
  readonly status: 'not-published' | 'runnable' | 'suspended'
  readonly version: 1
}

interface FlowCheck {
  readonly closureDigest: string
  readonly diagnostics: readonly { readonly code: string; readonly column: number; readonly line: number; readonly message: string; readonly path: string }[]
  readonly engineContract: string
  readonly flowId: string
  readonly modelVersion: number
  readonly revisionDigest: string
  readonly revisionId: string
  readonly valid: boolean
  readonly version: 1
}

interface Run {
  readonly createdAt: string
  readonly finishedAt?: string
  readonly flowId: string
  readonly revisionId: string
  readonly runId: string
  readonly source: 'draft' | 'live' | 'trigger'
  readonly startedAt?: string
  readonly status: RunStatus
  readonly version: 1
}

interface RunDetailsBase extends Run {
  readonly closureDigest: string
  readonly engineContract: string
  readonly engineDigest: string
  readonly modelVersion: number
  readonly revisionDigest: string
}

type RunDetails =
  | (RunDetailsBase & { readonly source: 'draft' })
  | (RunDetailsBase & { readonly publicationId: string; readonly source: 'live' })
  | (RunDetailsBase & {
      readonly occurrenceId: string
      readonly publicationId: string
      readonly source: 'trigger'
      readonly triggerNodeId: string
    })

interface RunEvents {
  readonly done: boolean
  readonly events: readonly {
    readonly createdAt: string
    readonly kind: string
    readonly payload: Readonly<Record<string, JsonValue>>
    readonly sequence: number
  }[]
  readonly historyComplete: boolean
  readonly nextAfter: number
  readonly runId: string
  readonly version: 1
}

interface RunCancellation {
  readonly cancelAccepted: boolean
  readonly runId: string
  readonly status: Extract<RunStatus, 'canceled' | 'completed' | 'failed' | 'indeterminate'>
  readonly version: 1
}

type RunResult =
  | { readonly finishedAt: string; readonly result: JsonValue; readonly runId: string; readonly status: 'completed'; readonly version: 1 }
  | {
      readonly error: { readonly code: string; readonly message: string }
      readonly finishedAt: string
      readonly runId: string
      readonly status: 'failed' | 'indeterminate'
      readonly version: 1
    }
  | { readonly finishedAt: string; readonly runId: string; readonly status: 'canceled'; readonly version: 1 }

interface Presentation {
  readonly revision: number
  readonly updatedAt: string
  readonly value: Readonly<Record<string, JsonValue>>
  readonly version: 1
}

interface TriggerKeySummary {
  readonly description: string
  readonly displayName: string
  readonly key: string
  readonly name: string
  readonly provider: string
  readonly type: TriggerKeySnapshot['type']
}

interface TriggerBinding {
  readonly currentPublicationId?: string
  readonly currentRevisionId?: string
  readonly endpointUrl?: string
  readonly flowId: string
  readonly health: StoredTriggerBinding['health']
  readonly kind: StoredTriggerBinding['kind']
  readonly lastErrorCode?: string
  readonly operatorState: StoredTriggerBinding['operatorState']
  readonly runtimeVersion: number
  readonly triggerNodeId: string
  readonly updatedAt: string
  readonly version: 1
}

interface TriggerActivity {
  readonly activityId: string
  readonly createdAt: string
  readonly errorCode?: string
  readonly errorMessage?: string
  readonly kind: StoredTriggerActivity['kind']
}

export interface TriggerActivityPosition {
  readonly activityId: string
  readonly createdAt: number
}

type PollTriggerTestResult = {
  readonly events: readonly Readonly<Record<string, JsonValue>>[]
  readonly filtered: number
  readonly hasMore: boolean
  readonly version: 1
}

export interface FlowPosition {
  readonly createdAt: number
  readonly flowId: string
}

export interface RunPosition {
  readonly createdAt: number
  readonly runId: string
}

export interface PublicationPosition {
  readonly createdAt: number
  readonly publicationId: string
}

export class ControlService {
  private readonly abortRun: (runId: string) => void
  private readonly clock: () => number
  private readonly connector?: ConnectorHost
  private readonly connectorConsoleOrigin?: URL
  private readonly flowCatalogChanged: () => void
  private readonly flowChanged: (event: FlowChangeEvent) => void
  private readonly publish: (input: PublishInput) => Promise<PublicationAcceptance>
  private readonly store: Store
  private readonly testPollTrigger: (flowId: string, triggerNodeId: string) => Promise<PollTriggerTestResult>
  private readonly triggerDefinitions: readonly TriggerKeySnapshot[]
  private readonly triggersChanged: () => void
  private readonly wake: () => void

  constructor(
    store: Store,
    clock: () => number,
    abortRun: (runId: string) => void,
    wake: () => void,
    publish: (input: PublishInput) => Promise<PublicationAcceptance>,
    triggersChanged: () => void,
    triggerDefinitions: readonly TriggerKeySnapshot[],
    testPollTrigger: (flowId: string, triggerNodeId: string) => Promise<PollTriggerTestResult>,
    flowCatalogChanged: () => void,
    flowChanged: (event: FlowChangeEvent) => void,
    connector?: ConnectorHost,
    connectorConsoleOrigin?: URL,
  ) {
    this.store = store
    this.clock = clock
    this.abortRun = abortRun
    this.wake = wake
    this.publish = publish
    this.triggersChanged = triggersChanged
    this.triggerDefinitions = triggerDefinitions
    this.testPollTrigger = testPollTrigger
    this.flowCatalogChanged = flowCatalogChanged
    this.flowChanged = flowChanged
    this.connector = connector
    this.connectorConsoleOrigin = connectorConsoleOrigin
  }

  listTriggerKeys(): readonly TriggerKeySummary[] {
    return this.triggerDefinitions.map(({ description, displayName, key, name, provider, type }) => ({ description, displayName, key, name, provider, type }))
  }

  listTriggerDefinitions(): readonly TriggerKeySnapshot[] {
    return this.triggerDefinitions
  }

  listVariables(): { readonly variables: readonly Variable[]; readonly version: 1 } {
    return { variables: this.store.listVariables().map(variable), version: 1 }
  }

  getVariable(name: string): Variable {
    const stored = this.store.variable(name)
    if (stored == null) throw new ControlError(controlErrorCode.variableNotFound, 'The Variable was not found.')
    return variable(stored)
  }

  putVariable(name: string, value: string): Variable {
    const saved = this.store.putVariable(name, value)
    if (saved.kind == 'limit-reached') {
      throw new ControlError(controlErrorCode.variableLimitReached, 'The deployment has reached its Variable limit.')
    }
    return variable(saved.variable)
  }

  deleteVariable(name: string): void {
    if (!this.store.deleteVariable(name)) throw new ControlError(controlErrorCode.variableNotFound, 'The Variable was not found.')
  }

  getTriggerKey(key: string): TriggerKeySnapshot {
    const definition = this.triggerDefinitions.find((candidate) => candidate.key == key)
    if (definition == null) throw new ControlError(controlErrorCode.triggerKeyNotFound, 'The Trigger Key was not found.')
    return definition
  }

  async listConnectorProviders(): Promise<readonly ConnectorProvider[]> {
    return await this.#connectorRequest((connector) => connector.listProviders())
  }

  async listConnectorActions(serviceId?: string): Promise<readonly ConnectorAction[]> {
    return await this.#connectorRequest((connector) => connector.listActions(serviceId))
  }

  async searchConnectorActions(query: string): Promise<readonly ConnectorAction[]> {
    return await this.#connectorRequest((connector) => connector.searchActions(query))
  }

  async getConnectorAction(actionId: string): Promise<ConnectorAction> {
    return await this.#connectorRequest((connector) => connector.getAction(actionId))
  }

  async listConnectorConnections(serviceId: string): Promise<readonly ConnectorConnection[]> {
    return await this.#connectorRequest((connector) => connector.listConnections(serviceId))
  }

  connectorConnectionPage(serviceId: string): string {
    if (this.connectorConsoleOrigin == null) throw new ControlError(controlErrorCode.connectorUnavailable, 'The Connector request could not be completed.')
    return new URL(`providers/${encodeURIComponent(serviceId)}`, this.connectorConsoleOrigin).href
  }

  async #connectorRequest<Value>(request: (connector: ConnectorHost) => Promise<Value>): Promise<Value> {
    if (this.connector == null) throw new ControlError(controlErrorCode.connectorUnavailable, 'The Connector request could not be completed.')
    try {
      return await request(this.connector)
    } catch (error) {
      if (!(error instanceof ConnectorTaskError)) throw error
      throw new ControlError(error.code, error.message)
    }
  }

  async createFlow(actorId: string, name: string, idempotencyKey: string): Promise<{ readonly created: boolean; readonly flow: Flow }> {
    const content = emptyRevision()
    const bytes = encodeRevision(content)
    const createdAt = this.clock()
    const stored = this.store.createFlow({
      actorId,
      content: new TextDecoder().decode(bytes),
      createdAt,
      digest: await digestBytes(bytes),
      idempotencyKey,
      name,
      flowId: identity('flow'),
      requestDigest: await digestBytes(canonicalJsonBytes({ name })),
      revisionId: identity('revision'),
    })
    if ('kind' in stored) throw new ControlError(controlErrorCode.flowConflict, 'The idempotency key refers to another Flow request.')
    if (stored.created) this.flowCatalogChanged()
    return { created: stored.created, flow: flow(stored.flow) }
  }

  listFlows(
    limit: number,
    after?: FlowPosition,
    includeTotal = false,
  ): {
    readonly next?: FlowPosition
    readonly page: { readonly flows: readonly Flow[]; readonly total?: number; readonly version: 1 }
  } {
    const stored = this.store.listFlows(limit + 1, after, includeTotal)
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
    const stored = this.store.flow(flowId)
    if (stored == null) notFound()
    return flow(stored)
  }

  renameFlow(flowId: string, name: string): Flow {
    const stored = this.store.renameFlow(flowId, name, this.clock())
    if (stored == null) notFound()
    this.flowCatalogChanged()
    return flow(stored)
  }

  retireFlow(flowId: string): Flow {
    const stored = this.store.retireFlow(flowId, this.clock())
    if (stored == null) notFound()
    this.triggersChanged()
    this.flowCatalogChanged()
    return flow(stored)
  }

  getDraft(flowId: string): Draft {
    return draft(this.requireDraft(flowId))
  }

  getRevision(flowId: string, revisionId: string): Draft {
    const stored = this.store.revision(flowId, revisionId)
    if (stored == null) notFound()
    return draft(stored)
  }

  syncDraft(flowId: string): { readonly draft: Draft; readonly kind: 'snapshot'; readonly version: 1 } {
    const current = this.requireDraft(flowId)
    return { draft: draft(current), kind: 'snapshot', version: 1 }
  }

  async changeDraft(actorId: string, flowId: string, expectedRevisionId: string, operations: readonly ChangeOperation[]): Promise<DraftChange> {
    const base = this.requireDraft(flowId)
    if (base.revisionId != expectedRevisionId) throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed.')
    let content: RevisionContent
    let bytes: Uint8Array
    try {
      content = applyFlowChanges(revisionContent(base), operations)
      bytes = encodeRevision(content)
    } catch {
      invalidFlow('The Draft change is invalid.')
    }
    const digest = await digestBytes(bytes)
    if (digest == base.digest) invalidFlow('The Draft change does not modify the Flow.')
    const stored = this.store.commitRevision({
      actorId,
      content: new TextDecoder().decode(bytes),
      createdAt: this.clock(),
      digest,
      expectedRevisionId,
      flowId,
      revisionId: identity('revision'),
    })
    switch (stored.kind) {
      case 'busy':
        throw new ControlError(controlErrorCode.flowBusy, 'The Flow is retiring.')
      case 'conflict':
        throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed.')
      case 'not-found':
        return notFound()
      case 'committed':
        this.triggersChanged()
        this.flowChanged({ kind: 'draft.changed', flowId, revisionId: stored.revision.revisionId, version: 1 })
        return { revision: revisionMetadata(stored.revision), version: 1 }
    }
  }

  async getLive(flowId: string): Promise<Live> {
    const currentFlow = this.getFlow(flowId)
    const current = this.requireDraft(flowId)
    const draftClosure = await flowClosure(revisionContent(current))
    const stored = this.store.live(flowId)
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
    return {
      flowId,
      hasUnpublishedChanges: draftClosure.digest != stored.publication.closureDigest,
      publication: publication(stored.publication),
      revision: stored.revision,
      status: liveStatus(currentFlow.status, stored.publication.engineContract),
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
    const stored = this.store.listPublications(flowId, limit + 1, after, includeTotal)
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
  ): Promise<{ readonly created: boolean; readonly publication: Publication }> {
    if (engineContract != currentEngineContract) throw new ControlError(controlErrorCode.engineUnsupported, 'The Engine Contract is not supported.')
    const revision = this.store.revision(flowId, revisionId)
    if (revision == null) notFound()
    return await this.commitPublication({
      control: { actorId, operation: 'publish' },
      engineContract,
      expectedLivePublicationId,
      flowId,
      idempotencyKey,
      revision: revisionContent(revision),
      revisionId,
    })
  }

  async rollbackFlow(
    actorId: string,
    flowId: string,
    sourcePublicationId: string,
    expectedLivePublicationId: string,
    idempotencyKey: string,
  ): Promise<{ readonly created: boolean; readonly publication: Publication }> {
    const source = this.store.publication(flowId, sourcePublicationId)
    if (source == null) throw new ControlError(controlErrorCode.publicationNotFound, 'The Publication was not found.')
    const revision = this.store.revision(flowId, source.revisionId)
    if (revision == null || revision.digest != source.revisionDigest) {
      throw new ControlError(serverErrorCode.flowRevisionStorageConflict, 'The fixed Revision does not match the Publication.')
    }
    return await this.commitPublication({
      control: { actorId, operation: 'rollback', sourcePublicationId },
      engineContract: source.engineContract,
      expectedLivePublicationId,
      flowId,
      idempotencyKey,
      revision: revisionContent(revision),
      revisionId: source.revisionId,
    })
  }

  getPresentation(flowId: string): Presentation {
    const stored = this.store.presentation(flowId)
    if (stored == null) notFound()
    return presentation(stored)
  }

  updatePresentation(flowId: string, expectedRevision: number, value: Readonly<Record<string, JsonValue>>): Presentation {
    const stored = this.store.updatePresentation(flowId, expectedRevision, value, this.clock())
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
    const stored = this.store.revision(flowId, revisionId)
    if (stored == null) notFound()
    const content = revisionContent(stored)
    const checked = await validateFlow(content, engine)
    return {
      closureDigest: checked.closure.digest,
      diagnostics: checked.diagnostics,
      engineContract,
      flowId,
      modelVersion: content.modelVersion,
      revisionDigest: stored.digest,
      revisionId,
      valid: checked.valid,
      version: 1,
    }
  }

  async createDraftRun(
    flowId: string,
    revisionId: string,
    engineContract: string,
    inputs: RunInputs,
    idempotencyKey: string,
  ): Promise<{ readonly created: boolean; readonly run: RunDetails }> {
    const requestDigest = await digestBytes(canonicalJsonBytes({ engineContract, flowId, inputs, kind: 'draft', revisionId }))
    const existing = this.store.runRequest(idempotencyKey)
    if (existing != null) {
      if (existing.requestDigest != requestDigest || existing.source != 'draft') {
        throw new ControlError(controlErrorCode.runConflict, 'The idempotency key refers to another Run request.')
      }
      if (existing.status == 'queued' || existing.status == 'starting') this.wake()
      return { created: false, run: runDetails(this.requireRun(existing.runId)) }
    }
    if (engineContract != currentEngineContract) throw new ControlError(controlErrorCode.engineUnsupported, 'The Engine Contract is not supported.')
    const stored = this.store.revision(flowId, revisionId)
    if (stored == null) notFound()
    const content = revisionContent(stored)
    const fixed = await prepareFlow(content, engineContract)
    switch (fixed.kind) {
      case 'engine-unsupported':
        throw new ControlError(controlErrorCode.engineUnsupported, 'The Engine Contract is not supported.')
      case 'flow-invalid':
        throw new ControlError(controlErrorCode.flowInvalid, 'The Flow is invalid.')
      case 'prepared':
        break
    }
    if (validateFlowInputs(content, inputs) != 'valid') throw new ControlError(controlErrorCode.runInvalid, 'The Flow inputs are invalid.')
    const accepted = this.store.acceptControlRun({
      closureDigest: fixed.flow.closureDigest,
      flowId,
      idempotencyKey,
      inputs,
      modelVersion: content.modelVersion,
      requestDigest,
      revisionDigest: stored.digest,
      revisionId,
      variableNames: Object.values(variableBindings(content, fixed.validation.closure.dependencies.inputBindings)),
    })
    switch (accepted.kind) {
      case 'binding-unresolved':
        throw new ControlError(controlErrorCode.bindingUnresolved, 'A required Variable is unresolved.')
      case 'busy':
        throw new ControlError(controlErrorCode.flowBusy, 'The Flow is retiring.')
      case 'conflict':
        throw new ControlError(controlErrorCode.runConflict, 'The idempotency key refers to another Run request.')
      case 'not-found':
        return notFound()
      case 'overloaded':
        throw new ControlError(controlErrorCode.runOverloaded, 'The deployment has reached its pending Run limit.')
      case 'accepted': {
        if (accepted.created) {
          this.flowChanged({ flowId, kind: 'run.created', runId: accepted.runId, version: 1 })
          this.wake()
        }
        return { created: accepted.created, run: runDetails(this.requireRun(accepted.runId)) }
      }
    }
  }

  async createLiveRun(publicationId: string, inputs: RunInputs, idempotencyKey: string): Promise<{ readonly created: boolean; readonly run: RunDetails }> {
    const requestDigest = await digestBytes(canonicalJsonBytes({ inputs, kind: 'live', publicationId }))
    const existing = this.store.runRequest(idempotencyKey)
    if (existing != null) {
      if (existing.requestDigest != requestDigest || existing.source != 'live') {
        throw new ControlError(controlErrorCode.runConflict, 'The idempotency key refers to another Run request.')
      }
      if (existing.status == 'queued' || existing.status == 'starting') this.wake()
      return { created: false, run: runDetails(this.requireRun(existing.runId)) }
    }

    const livePublication = this.store.publicationById(publicationId)
    if (livePublication == null) throw new ControlError(controlErrorCode.publicationNotFound, 'The Publication was not found.')
    const { flowId } = livePublication
    const currentFlow = this.store.flow(flowId)
    if (currentFlow == null) notFound()
    if (currentFlow.status != 'active') throw new ControlError(controlErrorCode.flowBusy, 'The Flow is retiring.')
    const live = this.store.live(flowId)
    if (live?.publication.publicationId != publicationId) {
      throw new ControlError(controlErrorCode.liveConflict, 'The Publication is no longer the current Live target.')
    }
    if (findEngineContract(livePublication.engineContract) == null) {
      throw new ControlError(controlErrorCode.engineUnsupported, 'The Engine Contract is not supported.')
    }
    const stored = this.store.revision(flowId, livePublication.revisionId)
    if (stored == null || stored.digest != livePublication.revisionDigest) {
      throw new ControlError(serverErrorCode.flowRevisionStorageConflict, 'The fixed Revision does not match the Publication.')
    }
    const content = revisionContent(stored)
    const fixed = await prepareFlow(content, livePublication.engineContract)
    switch (fixed.kind) {
      case 'engine-unsupported':
        throw new ControlError(controlErrorCode.engineUnsupported, 'The Engine Contract is not supported.')
      case 'flow-invalid':
        throw new ControlError(controlErrorCode.flowInvalid, 'The Flow is invalid.')
      case 'prepared':
        break
    }
    const inputsValid = validateFlowInputs(content, inputs) == 'valid'
    if (!inputsValid) throw new ControlError(controlErrorCode.runInvalid, 'The Flow inputs are invalid.')
    if (fixed.flow.closureDigest != livePublication.closureDigest || content.modelVersion != livePublication.modelVersion) {
      throw new ControlError(serverErrorCode.flowRevisionStorageConflict, 'The fixed Flow does not match the Publication.')
    }
    const accepted = this.store.acceptLiveControlRun({
      closureDigest: livePublication.closureDigest,
      expectedPublicationId: livePublication.publicationId,
      flowId,
      idempotencyKey,
      inputs,
      modelVersion: livePublication.modelVersion,
      requestDigest,
      revisionDigest: livePublication.revisionDigest,
      revisionId: livePublication.revisionId,
      variableNames: Object.values(variableBindings(content, fixed.validation.closure.dependencies.inputBindings)),
    })
    switch (accepted.kind) {
      case 'binding-unresolved':
        throw new ControlError(controlErrorCode.bindingUnresolved, 'A required Variable is unresolved.')
      case 'busy':
        throw new ControlError(controlErrorCode.flowBusy, 'The Flow is retiring.')
      case 'conflict':
        throw new ControlError(controlErrorCode.runConflict, 'The idempotency key refers to another Run request.')
      case 'live-conflict':
        throw new ControlError(controlErrorCode.liveConflict, 'The Publication is no longer the current Live target.')
      case 'not-found':
        return notFound()
      case 'overloaded':
        throw new ControlError(controlErrorCode.runOverloaded, 'The deployment has reached its pending Run limit.')
      case 'accepted': {
        if (accepted.created) {
          this.flowChanged({ flowId, kind: 'run.created', runId: accepted.runId, version: 1 })
          this.wake()
        }
        return { created: accepted.created, run: runDetails(this.requireRun(accepted.runId)) }
      }
    }
  }

  getRun(runId: string): RunDetails {
    return runDetails(this.requireRun(runId))
  }

  listRuns(
    flowId: string,
    limit: number,
    options: { readonly after?: RunPosition; readonly status?: RunStatus } = {},
  ): {
    readonly next?: RunPosition
    readonly page: { readonly flowId: string; readonly runs: readonly Run[]; readonly version: 1 }
  } {
    if (this.store.flow(flowId) == null) notFound()
    const stored = this.store.listControlRuns(flowId, limit + 1, options)
    const rows = stored.slice(0, limit)
    const last = rows.at(-1)
    return {
      ...(stored.length > limit && last != null ? { next: { createdAt: last.createdAt, runId: last.runId } } : {}),
      page: { flowId, runs: rows.map(run), version: 1 },
    }
  }

  getRunEvents(runId: string, after: number, limit: number): RunEvents {
    const current = this.requireRun(runId)
    if (current.eventsExpiresAt != null && current.eventsExpiresAt <= this.clock()) {
      throw new ControlError(controlErrorCode.runEventsExpired, 'The Run event history has expired.')
    }
    const stored = this.store.controlEvents(runId, after, limit)
    const events = stored.map((event) => ({
      createdAt: timestamp(event.createdAt),
      kind: event.kind,
      payload:
        event.kind == 'node.output' && event.value !== undefined
          ? { ...event.payload, output: { kind: 'inline' as const, value: event.value } }
          : event.payload,
      sequence: event.sequence,
    }))
    return {
      done: terminal(current.status),
      events,
      ...(current.eventsExpiresAt == null ? {} : { eventsExpiresAt: timestamp(current.eventsExpiresAt) }),
      historyComplete: !current.eventsTruncated,
      nextAfter: events.at(-1)?.sequence ?? after,
      runId,
      version: 1,
    }
  }

  getRunResult(runId: string): RunResult {
    const stored = this.requireRun(runId)
    if (!terminal(stored.status)) throw new ControlError(controlErrorCode.runNotTerminal, 'The Run is not terminal.')
    if (stored.finishedAt == null) throw new Error('Terminal Run is missing its completion timestamp.')
    const base = { finishedAt: timestamp(stored.finishedAt), runId, version: 1 as const }
    switch (stored.status) {
      case 'canceled':
        return { ...base, status: 'canceled' }
      case 'completed':
        return { ...base, result: stored.result as JsonValue, status: 'completed' }
      case 'failed':
      case 'indeterminate':
        return { ...base, error: runError(stored.result), status: stored.status }
      case 'queued':
      case 'running':
      case 'starting':
        throw new Error('Non-terminal Run passed the terminal guard.')
    }
  }

  cancelRun(runId: string): RunCancellation {
    const canceled = this.store.cancelControlRun(runId)
    if (canceled == null) runNotFound()
    if (canceled.accepted) this.abortRun(runId)
    return { cancelAccepted: canceled.accepted, runId, status: terminalStatus(canceled.run.status), version: 1 }
  }

  private async commitPublication(input: PublishInput): Promise<{ readonly created: boolean; readonly publication: Publication }> {
    let accepted: PublicationAcceptance
    try {
      accepted = await this.publish(input)
    } catch (error) {
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
        case 'trigger-payload-invalid':
          throw new ControlError(controlErrorCode.flowInvalid, error.message)
      }
    }
    switch (accepted.kind) {
      case 'binding-unresolved':
        throw new ControlError(controlErrorCode.bindingUnresolved, 'A required Variable is unresolved.')
      case 'busy':
        throw new ControlError(controlErrorCode.flowBusy, 'The Flow is retiring.')
      case 'conflict':
        throw new ControlError(controlErrorCode.publicationConflict, 'The idempotency key refers to another Publication request.')
      case 'live-conflict':
        throw new ControlError(controlErrorCode.liveConflict, 'The Flow Live pointer no longer matches the expected Publication.')
      case 'not-found':
        return notFound()
      case 'revision-conflict':
        throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed.')
      case 'source-not-found':
        throw new ControlError(controlErrorCode.publicationNotFound, 'The Publication was not found.')
      case 'published': {
        const stored = this.store.publication(input.flowId, accepted.publicationId)
        if (stored == null) throw new Error('Committed Publication is missing.')
        return { created: accepted.created, publication: publication(stored) }
      }
    }
  }

  private requireDraft(flowId: string): StoredFlowRevision {
    const stored = this.store.draft(flowId)
    if (stored == null) notFound()
    return stored
  }

  private requireRun(runId: string): StoredControlRun {
    const stored = this.store.controlRun(runId)
    if (stored == null) runNotFound()
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
    document: { bindings: {}, graph: { nodes: {} }, subflows: {}, tasks: {} },
    modelVersion: 1,
    modules: {},
  }
}

function identity(kind: 'flow' | 'revision'): string {
  return `${kind}_${randomUUID().replaceAll('-', '')}`
}

function timestamp(value: number): string {
  return new Date(value).toISOString()
}

function flow(stored: StoredFlow): Flow {
  return {
    createdAt: timestamp(stored.createdAt),
    draftRevisionId: stored.draftRevisionId,
    name: stored.name,
    flowId: stored.flowId,
    status: stored.status,
    updatedAt: timestamp(stored.updatedAt),
    version: 1,
  }
}

function variable(stored: { readonly name: string; readonly updatedAt: number; readonly value: string }): Variable {
  return { name: stored.name, updatedAt: timestamp(stored.updatedAt), value: stored.value, version: 1 }
}

function revisionContent(stored: { readonly content: string }): RevisionContent {
  return JSON.parse(stored.content) as RevisionContent
}

function revisionMetadata(stored: StoredFlowRevision): Omit<Draft, 'content'> {
  return {
    actorId: stored.actorId,
    createdAt: timestamp(stored.createdAt),
    digest: stored.digest,
    modelVersion: revisionContent(stored).modelVersion,
    parentRevisionId: stored.parentRevisionId,
    flowId: stored.flowId,
    revisionId: stored.revisionId,
    version: 1,
  }
}

function draft(stored: StoredFlowRevision): Draft {
  return { ...revisionMetadata(stored), content: revisionContent(stored) }
}

function presentation(stored: StoredPresentation): Presentation {
  return { revision: stored.revision, updatedAt: timestamp(stored.updatedAt), value: stored.value, version: 1 }
}

function triggerBinding(stored: StoredTriggerBinding, endpointOrigin?: string): TriggerBinding {
  return {
    ...(stored.currentPublicationId == null ? {} : { currentPublicationId: stored.currentPublicationId }),
    ...(stored.currentRevisionId == null ? {} : { currentRevisionId: stored.currentRevisionId }),
    ...(endpointOrigin == null || stored.currentPublicationId == null || stored.kind != 'webhook' || stored.endpointId == null
      ? {}
      : { endpointUrl: `${endpointOrigin}/v1/webhooks/${stored.endpointId}` }),
    flowId: stored.flowId,
    health: stored.health,
    kind: stored.kind,
    ...(stored.lastErrorCode == null ? {} : { lastErrorCode: stored.lastErrorCode }),
    operatorState: stored.operatorState,
    runtimeVersion: stored.runtimeVersion,
    triggerNodeId: stored.triggerNodeId,
    updatedAt: timestamp(stored.updatedAt),
    version: 1,
  }
}

function triggerActivity(stored: StoredTriggerActivity): TriggerActivity {
  return {
    activityId: stored.activityId,
    createdAt: timestamp(stored.createdAt),
    ...(stored.errorCode == null ? {} : { errorCode: stored.errorCode }),
    ...(stored.errorMessage == null ? {} : { errorMessage: stored.errorMessage }),
    kind: stored.kind,
  }
}

function run(stored: StoredControlRun): Run {
  return {
    createdAt: timestamp(stored.createdAt),
    ...(stored.eventsExpiresAt == null ? {} : { eventsExpiresAt: timestamp(stored.eventsExpiresAt) }),
    ...(stored.finishedAt == null ? {} : { finishedAt: timestamp(stored.finishedAt) }),
    flowId: stored.flowId,
    revisionId: stored.revisionId,
    runId: stored.runId,
    source: stored.source,
    ...(stored.startedAt == null ? {} : { startedAt: timestamp(stored.startedAt) }),
    status: stored.status,
    version: 1,
  }
}

function runDetails(stored: StoredControlRun): RunDetails {
  const details = {
    ...run(stored),
    closureDigest: stored.closureDigest,
    engineContract: stored.engineContract,
    engineDigest: stored.engineDigest,
    modelVersion: stored.modelVersion,
    revisionDigest: stored.revisionDigest,
  }
  switch (stored.source) {
    case 'draft':
      return { ...details, source: 'draft' }
    case 'live':
      if (stored.publicationId == null) throw new Error('Live Run is missing its Publication identity.')
      return { ...details, publicationId: stored.publicationId, source: 'live' }
    case 'trigger':
      if (stored.occurrenceId == null || stored.publicationId == null || stored.triggerNodeId == null) {
        throw new Error('Trigger Run is missing its admission identity.')
      }
      return {
        ...details,
        occurrenceId: stored.occurrenceId,
        publicationId: stored.publicationId,
        source: 'trigger',
        triggerNodeId: stored.triggerNodeId,
      }
  }
}

function publication(stored: StoredPublication): Publication {
  return {
    actorId: stored.actorId,
    closureDigest: stored.closureDigest,
    createdAt: timestamp(stored.createdAt),
    engineContract: stored.engineContract,
    flowId: stored.flowId,
    modelVersion: stored.modelVersion,
    operation: stored.operation,
    publicationId: stored.publicationId,
    revisionDigest: stored.revisionDigest,
    revisionId: stored.revisionId,
    ...(stored.sourcePublicationId == null ? {} : { sourcePublicationId: stored.sourcePublicationId }),
    version: 1,
  }
}

function liveStatus(flowStatus: StoredFlow['status'], engineContract: string): 'runnable' | 'suspended' {
  return flowStatus == 'active' && findEngineContract(engineContract) != null ? 'runnable' : 'suspended'
}

function terminal(status: RunStatus): boolean {
  return status == 'canceled' || status == 'completed' || status == 'failed' || status == 'indeterminate'
}

function terminalStatus(status: RunStatus): RunCancellation['status'] {
  if (status == 'canceled' || status == 'completed' || status == 'failed' || status == 'indeterminate') return status
  throw new Error('Canceled Run did not reach a terminal state.')
}

function runError(value: unknown): { readonly code: string; readonly message: string } {
  const candidate = value as { readonly error?: { readonly code?: unknown; readonly message?: unknown } } | undefined
  return {
    code: typeof candidate?.error?.code == 'string' ? candidate.error.code : 'run.failed',
    message: typeof candidate?.error?.message == 'string' ? candidate.error.message : 'The Flow could not be completed.',
  }
}

function invalidFlow(message: string): never {
  throw new ControlError(controlErrorCode.flowInvalid, message)
}

function notFound(): never {
  throw new ControlError(controlErrorCode.flowNotFound, 'The Flow or Revision was not found.')
}

function runNotFound(): never {
  throw new ControlError(controlErrorCode.runNotFound, 'The Run was not found.')
}

function triggerNotFound(): never {
  throw new ControlError(controlErrorCode.triggerNotFound, 'The Trigger binding was not found.')
}
