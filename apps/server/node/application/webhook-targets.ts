import type { JsonValue, RevisionContent, TriggerNode } from '@oomol-lab/open-flow/flow-change'
import type { Store } from '../storage/store.ts'
import type { RunAdmission } from '../storage/trigger-store.ts'
import type { RevisionValidator } from './flow-validation.ts'

import { canonicalJsonBytes, decodeRevision, digestBytes } from '@oomol-lab/open-flow/flow-encoding'
import { matchesSchema, triggerPayloadSchema } from '@oomol-lab/open-flow/flow-semantics'
import { isDeepStrictEqual } from 'node:util'
import { AcceptanceError } from '../error.ts'

export interface WebhookTarget {
  readonly closureDigest: string
  readonly endpointId: string
  readonly engineContract: string
  readonly flowId: string
  readonly publicationId: string
  readonly revision: RevisionContent
  readonly revisionDigest: string
  readonly revisionId: string
  readonly runtimeVersion: number
  readonly trigger: Extract<TriggerNode, { readonly kind: 'webhook' }>
  readonly triggerNodeId: string
}

export class WebhookTargets {
  readonly #runCreated: (flowId: string, runId: string) => void
  readonly #signal: () => void
  readonly #store: Store
  readonly #validate: RevisionValidator

  constructor(store: Store, validate: RevisionValidator, runCreated: (flowId: string, runId: string) => void, signal: () => void) {
    this.#runCreated = runCreated
    this.#signal = signal
    this.#store = store
    this.#validate = validate
  }

  async accept(target: WebhookTarget, occurrenceId: string, payload: JsonValue): Promise<RunAdmission | undefined> {
    const fixed = await this.#validate(target.revision)
    const trigger = fixed.prepared.graph.nodes[target.triggerNodeId]
    if (
      fixed.revisionDigest != target.revisionDigest ||
      fixed.prepared.closureDigest != target.closureDigest ||
      trigger?.kind != 'webhook' ||
      !isDeepStrictEqual(trigger, target.trigger)
    ) {
      return
    }
    if (!matchesSchema(payload, triggerPayloadSchema(trigger))) {
      throw new AcceptanceError('trigger-payload-invalid', 'Webhook payload does not match the fixed Trigger schema.')
    }
    const requestDigest = await digestBytes(
      canonicalJsonBytes({
        endpointId: target.endpointId,
        flowId: target.flowId,
        kind: 'webhook',
        occurrenceId,
        payload,
        publicationId: target.publicationId,
        revisionDigest: fixed.revisionDigest,
        runtimeVersion: target.runtimeVersion,
        triggerNodeId: target.triggerNodeId,
      }),
    )
    const accepted = this.#store.triggers.acceptWebhookTarget({
      closureDigest: target.closureDigest,
      content: fixed.content,
      endpointId: target.endpointId,
      engineContract: target.engineContract,
      flowId: target.flowId,
      modelVersion: target.revision.modelVersion,
      occurrenceId,
      payload,
      publicationId: target.publicationId,
      requestDigest,
      revisionDigest: fixed.revisionDigest,
      revisionId: target.revisionId,
      runtimeVersion: target.runtimeVersion,
      triggerJson: JSON.stringify(target.trigger),
      triggerNodeId: target.triggerNodeId,
    })
    if (accepted?.kind == 'accepted' && accepted.created) this.#runCreated(target.flowId, accepted.runId)
    if (accepted != null) this.#signal()
    return accepted
  }

  target(endpointId: string): WebhookTarget | undefined {
    const stored = this.#store.triggers.webhookTarget(endpointId)
    if (stored == null) return
    const { content, triggerJson, ...target } = stored
    return {
      ...target,
      revision: decodeRevision(new TextEncoder().encode(content)),
      trigger: JSON.parse(triggerJson) as Extract<TriggerNode, { readonly kind: 'webhook' }>,
    }
  }
}
