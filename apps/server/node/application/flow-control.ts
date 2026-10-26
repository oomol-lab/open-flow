import type { CanvasBroadcast, CanvasCommand, Flow, FlowCatalogEvent, FlowChangeEvent, FlowListItem, Presentation } from '@oomol-lab/open-flow/control-api'
import type { JsonValue, RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { WorkflowFile } from '@oomol-lab/open-flow/flow-encoding'
import type { Store } from '../storage/store.ts'
import type { PublicationControl } from './publication-control.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { resourceNameIssue } from '@oomol-lab/open-flow/flow-change'
import { canonicalJsonBytes, cleanWorkflowFile, digestBytes, encodeRevision, upgradeRevisionContent } from '@oomol-lab/open-flow/flow-encoding'
import { randomUUID } from 'node:crypto'
import { ControlError } from '../error.ts'
import { ControlAccess, notFound } from './control-access.ts'
import { flow, flowListItem, presentation } from './control-views.ts'
import { DraftControl, emptyRevision } from './draft-control.ts'
import { workflowTarget } from './workflow.ts'

export interface FlowPosition {
  readonly createdAt: number
  readonly flowId: string
}
export class FlowControl {
  constructor(
    private readonly access: ControlAccess,
    private readonly flowChanged: (event: FlowChangeEvent) => void,
    private readonly drafts: Pick<DraftControl, 'getDraft'>,
    private readonly store: Pick<Store, 'flows' | 'resourceReferences' | 'publications'>,
    private readonly resolveConnectorTeam: (teamId?: string) => Promise<string | undefined>,
    private readonly clock: () => number,
    private readonly flowCatalogChanged: (event?: FlowCatalogEvent, ownerId?: string) => void,
    private readonly triggersChanged: () => void,
    private readonly publications: Pick<PublicationControl, 'getLive'>,
  ) {}

  broadcastCanvas(actorId: string, flowId: string, command: CanvasCommand): CanvasBroadcast {
    this.access.authorize(actorId, { flowId })
    this.flowChanged({ kind: 'canvas.command', flowId, command, version: 1 })
    return { version: 1, flowId, broadcast: true }
  }

  exportFlow(actorId: string, flowId: string): WorkflowFile {
    const currentFlow = this.getFlow(actorId, flowId)
    const currentDraft = this.drafts.getDraft(actorId, flowId)
    return cleanWorkflowFile({
      kind: 'open-flow-workflow',
      version: 1,
      name: currentFlow.name,
      content: currentDraft.content,
      presentation: this.getPresentation(actorId, flowId).value,
    }).file
  }

  async importFlow(actorId: string, value: unknown, idempotencyKey: string, name?: string, teamId?: string, defaultName = 'Imported workflow') {
    let file: WorkflowFile
    try {
      const cleaned = cleanWorkflowFile(value).file
      file = { ...cleaned, content: upgradeRevisionContent(cleaned.content) }
    } catch {
      throw new ControlError(controlErrorCode.flowInvalid, 'Invalid or unsupported workflow file.')
    }
    const resolvedName = name ?? file.name ?? defaultName
    if (resolvedName != resolvedName.trim() || resourceNameIssue(resolvedName) != null)
      throw new ControlError(controlErrorCode.flowInvalid, 'Flow name is invalid.')
    return await this.#createFlow({
      actorId,
      name: resolvedName,
      idempotencyKey,
      connectorTeamId: teamId,
      content: file.content,
      presentation: file.presentation,
      request: { connectorTeamId: teamId ?? null, import: { file: value as JsonValue, name: name ?? null } },
    })
  }

  async createFlow(
    actorId: string,
    name: string,
    idempotencyKey: string,
    connectorTeamId?: string,
  ): Promise<{ readonly created: boolean; readonly flow: Flow }> {
    return await this.#createFlow({
      actorId,
      name,
      idempotencyKey,
      connectorTeamId,
      content: emptyRevision(),
      request: { connectorTeamId: connectorTeamId ?? null, name },
    })
  }

  async #createFlow({
    actorId,
    name,
    idempotencyKey,
    connectorTeamId,
    content,
    presentation: initialPresentation,
    request,
  }: {
    readonly actorId: string
    readonly name: string
    readonly idempotencyKey: string
    readonly connectorTeamId?: string
    readonly content: RevisionContent
    readonly presentation?: Readonly<Record<string, JsonValue>>
    readonly request: JsonValue
  }): Promise<{ readonly created: boolean; readonly flow: Flow }> {
    const requestDigest = await digestBytes(canonicalJsonBytes(request))
    const replay = this.store.flows.replayCreation(actorId, idempotencyKey, requestDigest)
    if (replay != null) {
      if ('kind' in replay) throw new ControlError(controlErrorCode.flowConflict, 'The idempotency key refers to another Flow request.')
      return { created: false, flow: flow(replay.flow) }
    }
    const selectedConnectorTeamId = await this.resolveConnectorTeam(connectorTeamId)
    if (connectorTeamId != null && selectedConnectorTeamId == null) {
      throw new ControlError(controlErrorCode.flowInvalid, 'Connector Team is not available for this deployment.')
    }
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
      presentation: initialPresentation,
      name,
      flowId: `flow_${randomUUID().replaceAll('-', '')}`,
      requestDigest,
      revisionId: `revision_${randomUUID().replaceAll('-', '')}`,
    })
    if ('kind' in stored) throw new ControlError(controlErrorCode.flowConflict, 'The idempotency key refers to another Flow request.')
    if (stored.created) this.flowCatalogChanged({ kind: 'flow.created', flowId: stored.flow.flowId, version: 1 })
    return { created: stored.created, flow: flow(stored.flow) }
  }

  listFlows(
    ownerId: string,
    limit: number,
    after?: FlowPosition,
    includeTotal = false,
  ): {
    readonly next?: FlowPosition
    readonly page: { readonly flows: readonly FlowListItem[]; readonly total?: number; readonly version: 1 }
  } {
    const stored = this.store.flows.list(limit + 1, after, includeTotal, ownerId)
    const rows = stored.flows.slice(0, limit)
    const last = rows.at(-1)
    const counts = this.store.resourceReferences.incomingFlowCounts(rows)
    return {
      ...(stored.flows.length > limit && last != null ? { next: { createdAt: last.createdAt, flowId: last.flowId } } : {}),
      page: {
        flows: rows.map((row) => flowListItem(row, counts.get(row.flowId) ?? 0)),
        ...(stored.total == null ? {} : { total: stored.total }),
        version: 1,
      },
    }
  }

  getFlow(actorId: string, flowId: string): Flow {
    return flow(this.access.requireFlow(actorId, flowId))
  }

  renameFlow(actorId: string, flowId: string, name: string): Flow {
    this.access.authorize(actorId, { flowId })

    const stored = this.store.flows.rename(flowId, name, this.clock())
    if (stored == null) notFound()
    this.flowCatalogChanged(undefined, stored.ownerId)
    return flow(stored)
  }

  retireFlow(actorId: string, flowId: string): Flow {
    this.access.authorize(actorId, { flowId })

    const stored = this.store.flows.retire(flowId, this.clock())
    if (stored == null) notFound()
    this.triggersChanged()
    this.flowCatalogChanged(undefined, stored.ownerId)
    return flow(stored)
  }

  async getEditor(actorId: string, flowId: string) {
    const currentFlow = this.getFlow(actorId, flowId)
    const currentDraft = this.drafts.getDraft(actorId, flowId)
    const currentPresentation = this.getPresentation(actorId, flowId)
    const live = await this.publications.getLive(actorId, flowId)
    return { flow: currentFlow, draft: currentDraft, live, presentation: currentPresentation, version: 1 as const }
  }

  getWorkflowContract(actorId: string, flowId: string) {
    this.access.authorize(actorId, { flowId })

    return workflowTarget(this.store, actorId, flowId).contract
  }

  getFlowReferences(actorId: string, flowId: string, direction: 'incoming' | 'outgoing', offset: number, limit: number) {
    this.access.authorize(actorId, { flowId })
    return this.store.resourceReferences.flowReferences(actorId, flowId, direction, offset, limit)
  }

  getPresentation(actorId: string, flowId: string): Presentation {
    this.access.authorize(actorId, { flowId })

    const stored = this.store.flows.presentation(flowId)
    if (stored == null) notFound()
    return presentation(stored)
  }

  updatePresentation(actorId: string, flowId: string, expectedRevision: number, value: Readonly<Record<string, JsonValue>>): Presentation {
    this.access.authorize(actorId, { flowId })

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
}
