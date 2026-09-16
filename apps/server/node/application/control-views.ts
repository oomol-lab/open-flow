import type { Draft, Flow, Presentation, Publication, TriggerActivity, TriggerBinding, Variable } from '@oomol-lab/open-flow/control-api'
import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { StoredFlow, StoredFlowRevision, StoredPresentation } from '../storage/flow-store.ts'
import type { StoredPublication } from '../storage/publication-store.ts'
import type { StoredTriggerActivity, StoredTriggerBinding } from '../storage/trigger-store.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { decodeRevision, revisionRepairKind } from '@oomol-lab/open-flow/flow-encoding'
import { ControlError } from '../error.ts'

export function timestamp(value: number): string {
  return new Date(value).toISOString()
}

export function flow(stored: StoredFlow): Flow {
  return {
    ...(stored.publicationId == null || stored.publishedRevisionId == null
      ? {}
      : {
          live: {
            enabled: stored.liveEnabled == 1,
            publicationId: stored.publicationId,
            revisionId: stored.publishedRevisionId,
          },
        }),
    createdAt: timestamp(stored.createdAt),
    draftRevisionId: stored.draftRevisionId,
    name: stored.name,
    flowId: stored.flowId,
    status: stored.status,
    updatedAt: timestamp(stored.updatedAt),
    version: 1,
  }
}

export function variable(stored: { readonly name: string; readonly updatedAt: number; readonly value: string }): Variable {
  return { name: stored.name, updatedAt: timestamp(stored.updatedAt), value: stored.value, version: 1 }
}

export function revisionContent(stored: { readonly content: string }): RevisionContent {
  try {
    return decodeRevision(new TextEncoder().encode(stored.content))
  } catch (error) {
    if (error instanceof ControlError) throw error
    const kind = revisionRepairKind(new TextEncoder().encode(stored.content))
    if (kind == 'upgrade') throw new ControlError(controlErrorCode.flowUpgradeRequired, 'The stored Flow Revision uses an older model.')
    if (kind == 'repair') throw new ControlError(controlErrorCode.flowRepairRequired, 'The stored Flow Revision can be repaired.')
    throw new ControlError(controlErrorCode.flowInvalid, 'The stored Flow Revision is not structurally valid.', { cause: error })
  }
}

export function revisionMetadata(stored: StoredFlowRevision): Omit<Draft, 'content'> {
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

export function draft(stored: StoredFlowRevision): Draft {
  return { ...revisionMetadata(stored), content: revisionContent(stored) }
}

export function presentation(stored: StoredPresentation): Presentation {
  return { revision: stored.revision, updatedAt: timestamp(stored.updatedAt), value: stored.value, version: 1 }
}

export function triggerBinding(stored: StoredTriggerBinding, endpointOrigin?: string): TriggerBinding {
  return {
    ...(stored.listenerHealth == null
      ? {}
      : { listener: { health: stored.listenerHealth, ...(stored.listenerErrorCode == null ? {} : { lastErrorCode: stored.listenerErrorCode }) } }),
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

export function triggerActivity(stored: StoredTriggerActivity): TriggerActivity {
  return {
    activityId: stored.activityId,
    createdAt: timestamp(stored.createdAt),
    ...(stored.errorCode == null ? {} : { errorCode: stored.errorCode }),
    ...(stored.errorMessage == null ? {} : { errorMessage: stored.errorMessage }),
    kind: stored.kind,
  }
}

export function publication(stored: StoredPublication): Publication {
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
