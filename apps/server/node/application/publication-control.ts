import type {
  Flow,
  FlowCatalogEvent,
  Live,
  LiveDetails,
  PollTriggerTestResult,
  Presentation,
  Publication,
  PublishOperation,
  TriggerActivity,
  TriggerBinding,
} from '@oomol-lab/open-flow/control-api'
import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { ConnectorAccessHost } from '../deployment/connector-access.ts'
import type { StoredFlow } from '../storage/flow-store.ts'
import type { PublicationAcceptance } from '../storage/publication-store.ts'
import type { Store } from '../storage/store.ts'
import type { StoredTriggerBinding } from '../storage/trigger-store.ts'
import type { DraftControl } from './draft-control.ts'

import { controlErrorCode, flowInputDefinitions, liveEntries } from '@oomol-lab/open-flow/control-api'
import { flowClosure } from '@oomol-lab/open-flow/flow-semantics'
import { currentEngineContract, findEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { ConnectorTaskError } from '../deployment/connector-contract.ts'
import { AcceptanceError, ControlError, serverErrorCode } from '../error.ts'
import { ControlAccess, notFound } from './control-access.ts'
import { flow, publication, readRevisionOrRepair, revisionContent, triggerActivity, triggerBinding } from './control-views.ts'

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
export interface PublicationPosition {
  readonly createdAt: number
  readonly publicationId: string
}
export interface TriggerActivityPosition {
  readonly activityId: string
  readonly createdAt: number
}
export class PublicationControl {
  constructor(
    private readonly access: ControlAccess,
    private readonly store: Pick<Store, 'flows' | 'triggers' | 'publications'>,
    private readonly triggersChanged: () => void,
    private readonly flowCatalogChanged: (event?: FlowCatalogEvent, ownerId?: string) => void,
    private readonly drafts: Pick<DraftControl, 'getDraft'>,
    private readonly connectorAccess: ConnectorAccessHost,
    private readonly clock: () => number,
    private readonly testPollTrigger: (flowId: string, triggerNodeId: string) => Promise<PollTriggerTestResult>,
    private readonly publish: (input: PublishInput) => Promise<PublicationAcceptance>,
    private readonly acceptPublish: (input: PublishInput) => Promise<PublishOperation>,
  ) {}

  setFlowEnabled(actorId: string, flowId: string, publicationId: string, enabled: boolean): Flow {
    this.access.authorize(actorId, { flowId })
    const stored = this.store.flows.setEnabled(flowId, publicationId, enabled)
    if (stored == null) throw new ControlError(controlErrorCode.flowConflict, 'The published Flow changed or is retiring.')
    this.triggersChanged()
    this.flowCatalogChanged(undefined, stored.ownerId)
    return flow(stored)
  }

  getErrorListeners(actorId: string, flowId: string) {
    this.access.authorize(actorId, { flowId })
    return { version: 1 as const, listeners: this.store.triggers.errorListeners(flowId) }
  }

  getLiveDetails(actorId: string, flowId: string, endpointOrigin: string): LiveDetails {
    const currentFlow = flow(this.access.requireFlow(actorId, flowId))
    const stored = this.store.publications.live(flowId)
    if (stored == null) return { flowId, inputDefs: null, publication: null, status: 'not-published', entries: [], version: 1 }
    const current = publication(stored.publication)
    const revision = readRevisionOrRepair(() => this.store.flows.revision(flowId, current.revisionId))
    if (revision == null || revision.digest != current.revisionDigest) {
      throw new ControlError(serverErrorCode.flowRevisionStorageConflict, 'The fixed Revision does not match the Publication.')
    }
    const content = revisionContent(revision)
    const bindings = this.store.triggers.listTriggerBindings(flowId).map((item) => triggerBinding(item, endpointOrigin))
    const enabled = currentFlow.live?.enabled === true
    return {
      flowId,
      publication: current,
      enabled,
      status: enabled ? liveStatus(currentFlow.status, current.engineContract) : 'suspended',
      inputDefs: flowInputDefinitions(content),
      entries: liveEntries(content, current, bindings),
      version: 1,
    }
  }

  async getLive(actorId: string, flowId: string): Promise<Live> {
    const currentFlow = flow(this.access.requireFlow(actorId, flowId))
    const current = this.drafts.getDraft(actorId, flowId)
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
    const draftClosure = await flowClosure(current.content)
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

  listFlowTriggerBindings(actorId: string, flowId: string): readonly TriggerBinding[] {
    this.access.authorize(actorId, { flowId })
    return this.store.triggers.listTriggerBindings(flowId).map((binding) => triggerBinding(binding))
  }

  getFlowTriggerBinding(actorId: string, flowId: string, triggerNodeId: string, endpointOrigin: string): TriggerBinding {
    this.access.authorize(actorId, { flowId })
    return triggerBinding(this.requireTriggerBinding(flowId, triggerNodeId), endpointOrigin)
  }

  listFlowTriggerActivities(
    actorId: string,
    flowId: string,
    triggerNodeId: string,
    limit: number,
    after?: TriggerActivityPosition,
  ): {
    readonly next?: TriggerActivityPosition
    readonly page: { readonly activities: readonly TriggerActivity[]; readonly version: 1 }
  } {
    this.access.authorize(actorId, { flowId })
    const binding = this.requireTriggerBinding(flowId, triggerNodeId)
    const stored = this.store.triggers.listTriggerActivities(binding.bindingId, limit + 1, this.clock(), after)
    const rows = stored.slice(0, limit)
    const last = rows.at(-1)
    return {
      ...(stored.length > limit && last != null ? { next: { activityId: last.activityId, createdAt: last.createdAt } } : {}),
      page: { activities: rows.map(triggerActivity), version: 1 },
    }
  }

  async testFlowPollTrigger(actorId: string, flowId: string, triggerNodeId: string): Promise<PollTriggerTestResult> {
    this.access.authorize(actorId, { flowId })
    const binding = this.requireTriggerBinding(flowId, triggerNodeId)
    if (binding.kind != 'poll' || binding.currentPublicationId == null) triggerNotFound()
    return await this.testPollTrigger(flowId, triggerNodeId)
  }

  listPublications(
    actorId: string,
    flowId: string,
    limit: number,
    after?: PublicationPosition,
    includeTotal = false,
  ): {
    readonly next?: PublicationPosition
    readonly page: { readonly publications: readonly Publication[]; readonly total?: number; readonly version: 1 }
  } {
    this.access.authorize(actorId, { flowId })
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
    this.access.authorize(actorId, { flowId })

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

  getPublishOperation(actorId: string, flowId: string, operationId: string): PublishOperation {
    this.access.authorize(actorId, { flowId })
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
    this.access.authorize(actorId, { flowId })

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

  getPublicationPresentation(actorId: string, flowId: string, publicationId: string): { readonly version: 1; readonly presentation: Presentation | null } {
    this.access.authorize(actorId, { flowId })
    if (this.store.publications.publication(flowId, publicationId) == null) {
      throw new ControlError(controlErrorCode.publicationNotFound, 'The Publication was not found.')
    }
    return { version: 1, presentation: this.store.publications.presentation(flowId, publicationId) }
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

  private requireTriggerBinding(flowId: string, triggerNodeId: string): StoredTriggerBinding {
    const stored = this.store.triggers.triggerBinding(flowId, triggerNodeId)
    if (stored == null) triggerNotFound()
    return stored
  }
}
function liveStatus(flowStatus: StoredFlow['status'], engineContract: string): 'runnable' | 'suspended' {
  return flowStatus == 'active' && findEngineContract(engineContract) != null ? 'runnable' : 'suspended'
}
function triggerNotFound(): never {
  throw new ControlError(controlErrorCode.triggerNotFound, 'The Trigger binding was not found.')
}
