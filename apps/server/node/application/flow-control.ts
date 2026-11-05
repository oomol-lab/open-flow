import type {
  CanvasBroadcast,
  CanvasCommand,
  Flow,
  FlowCatalogEvent,
  FlowChangeEvent,
  FlowListItem,
  FlowQuery,
  FlowUpdate,
  Presentation,
} from '@oomol-lab/open-flow/control-api'
import type { JsonValue, RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { WorkflowBundle, WorkflowExportPreview, WorkflowFile } from '@oomol-lab/open-flow/flow-encoding'
import type { Store } from '../storage/store.ts'
import type { PublicationControl } from './publication-control.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { resourceNameIssue } from '@oomol-lab/open-flow/flow-change'
import {
  canonicalJsonBytes,
  cleanWorkflowBundle,
  cleanWorkflowFile,
  digestBytes,
  encodeRevision,
  remapWorkflowBundle,
  upgradeRevisionContent,
} from '@oomol-lab/open-flow/flow-encoding'
import { flowResourceReferences } from '@oomol-lab/open-flow/flow-semantics'
import { randomUUID } from 'node:crypto'
import { ControlError } from '../error.ts'
import { TagAssignmentError } from '../storage/tag-store.ts'
import { ControlAccess, notFound } from './control-access.ts'
import { flow, flowListItem, presentation } from './control-views.ts'
import { DraftControl, emptyRevision } from './draft-control.ts'
import { workflowTarget } from './workflow.ts'

export interface FlowPosition {
  readonly filter?: string
  readonly createdAt: number
  readonly flowId: string
}
const unreadableWorkflowCodes: ReadonlySet<string> = new Set([
  controlErrorCode.flowNotFound,
  controlErrorCode.flowInvalid,
  controlErrorCode.flowRepairRequired,
  controlErrorCode.flowUpgradeRequired,
])
export class FlowControl {
  private readonly access: ControlAccess
  private readonly flowChanged: (event: FlowChangeEvent) => void
  private readonly drafts: Pick<DraftControl, 'getDraft'>
  private readonly store: Pick<Store, 'flows' | 'resourceReferences' | 'publications'>
  private readonly resolveConnectorTeam: (teamId?: string) => Promise<string | undefined>
  private readonly clock: () => number
  private readonly flowCatalogChanged: (event?: FlowCatalogEvent, ownerId?: string) => void
  private readonly triggersChanged: () => void
  private readonly publications: Pick<PublicationControl, 'getLive'>

  constructor(
    access: ControlAccess,
    flowChanged: (event: FlowChangeEvent) => void,
    drafts: Pick<DraftControl, 'getDraft'>,
    store: Pick<Store, 'flows' | 'resourceReferences' | 'publications'>,
    resolveConnectorTeam: (teamId?: string) => Promise<string | undefined>,
    clock: () => number,
    flowCatalogChanged: (event?: FlowCatalogEvent, ownerId?: string) => void,
    triggersChanged: () => void,
    publications: Pick<PublicationControl, 'getLive'>,
  ) {
    this.access = access
    this.flowChanged = flowChanged
    this.drafts = drafts
    this.store = store
    this.resolveConnectorTeam = resolveConnectorTeam
    this.clock = clock
    this.flowCatalogChanged = flowCatalogChanged
    this.triggersChanged = triggersChanged
    this.publications = publications
  }

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
      icon: currentFlow.icon,
      description: currentFlow.description,
      content: currentDraft.content,
      presentation: this.getPresentation(actorId, flowId).value,
    }).file
  }

  getExportPreview(actorId: string, entryFlowId: string): WorkflowExportPreview {
    this.access.requireFlow(actorId, entryFlowId)
    const pending = [entryFlowId]
    const seen = new Set<string>()
    const workflows: WorkflowExportPreview['workflows'][number][] = []
    const unavailableFlowIds: string[] = []
    for (const flowId of pending) {
      if (seen.has(flowId)) continue
      seen.add(flowId)
      const stored = this.store.flows.get(flowId)
      if (stored?.ownerId != actorId || stored.status != 'active') {
        unavailableFlowIds.push(flowId)
        continue
      }
      let file: WorkflowFile
      try {
        file = this.exportFlow(actorId, flowId)
      } catch (error) {
        if (flowId == entryFlowId || !(error instanceof ControlError) || !unreadableWorkflowCodes.has(error.code)) throw error
        unavailableFlowIds.push(flowId)
        continue
      }
      workflows.push({ flowId, file })
      pending.push(...(flowResourceReferences(file.content).calledFlowIds ?? []))
    }
    if (!workflows.some((item) => item.flowId == entryFlowId)) throw new ControlError(controlErrorCode.flowBusy, 'The Flow is retiring.')
    workflows.sort((left, right) =>
      left.flowId == right.flowId ? 0 : left.flowId == entryFlowId ? -1 : right.flowId == entryFlowId ? 1 : left.flowId.localeCompare(right.flowId),
    )
    return { version: 1, entryFlowId, workflows, unavailableFlowIds: unavailableFlowIds.toSorted() }
  }

  async importBundle(
    actorId: string,
    value: unknown,
    idempotencyKey: string,
    name?: string,
    teamId?: string,
    defaultName = 'Imported workflow',
    tagIds: readonly string[] = [],
  ) {
    let bundle: WorkflowBundle
    try {
      bundle = cleanWorkflowBundle(value)
      bundle = {
        ...bundle,
        workflows: bundle.workflows.map((item) => ({ ...item, file: { ...item.file, content: upgradeRevisionContent(item.file.content) } })),
      }
    } catch {
      throw new ControlError(controlErrorCode.flowInvalid, 'Invalid or unsupported workflow bundle.')
    }
    const names = new Map(bundle.workflows.map(({ flowId, file }) => [flowId, (flowId == bundle.entryFlowId ? name : undefined) ?? file.name ?? defaultName]))
    if ([...names.values()].some((item) => item != item.trim() || resourceNameIssue(item) != null))
      throw new ControlError(controlErrorCode.flowInvalid, 'Flow name is invalid.')
    const ids = [...new Set(tagIds)].toSorted()
    const requestDigest = await digestBytes(canonicalJsonBytes({ file: value as JsonValue, name: name ?? null, teamId: teamId ?? null, tagIds: ids }))
    const replay = this.store.flows.replayBundleImport(actorId, idempotencyKey, requestDigest)
    if (replay != null) {
      if ('kind' in replay) throw new ControlError(controlErrorCode.flowConflict, 'The workflow bundle import conflicts with this request.')
      return { created: false, version: 1 as const, flow: flow(replay.flow), flows: replay.flows.map(flow) }
    }
    const connectorTeamId = await this.resolveConnectorTeam(teamId)
    if (teamId != null && connectorTeamId == null) throw new ControlError(controlErrorCode.flowInvalid, 'Connector Team is not available for this deployment.')
    const flowIds = new Map(bundle.workflows.map((item) => [item.flowId, `flow_${randomUUID().replaceAll('-', '')}`]))
    const mapped = remapWorkflowBundle(bundle, flowIds)
    const mappedNames = new Map([...names].map(([id, item]) => [flowIds.get(id)!, item]))
    const createdAt = this.clock()
    const inputs = await Promise.all(
      mapped.workflows.map(async ({ flowId, file }) => {
        const bytes = encodeRevision(file.content)
        return {
          actorId,
          flowId,
          tagIds: ids,
          connectorTeamId,
          createdAt,
          idempotencyKey,
          requestDigest,
          content: new TextDecoder().decode(bytes),
          digest: await digestBytes(bytes),
          modelVersion: file.content.modelVersion,
          name: mappedNames.get(flowId)!,
          icon: file.icon,
          description: file.description,
          presentation: file.presentation,
          revisionId: `revision_${randomUUID().replaceAll('-', '')}`,
        }
      }),
    )
    const stored = this.assignTags(() => this.store.flows.importBundle(actorId, idempotencyKey, requestDigest, mapped.entryFlowId, inputs))
    if ('kind' in stored) throw new ControlError(controlErrorCode.flowConflict, 'The workflow bundle import conflicts with this request.')
    if (stored.created) this.flowCatalogChanged(undefined, actorId)
    return { created: stored.created, version: 1 as const, flow: flow(stored.flow), flows: stored.flows.map(flow) }
  }

  async importFlow(
    actorId: string,
    value: unknown,
    idempotencyKey: string,
    name?: string,
    teamId?: string,
    defaultName = 'Imported workflow',
    tagIds?: readonly string[],
  ) {
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
      tagIds,
      name: resolvedName,
      icon: file.icon,
      description: file.description,
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
    tagIds?: readonly string[],
    initialPresentation?: Readonly<Record<string, JsonValue>>,
  ): Promise<{ readonly created: boolean; readonly flow: Flow }> {
    return await this.#createFlow({
      actorId,
      tagIds,
      name,
      idempotencyKey,
      connectorTeamId,
      content: emptyRevision(),
      presentation: initialPresentation,
      request: { connectorTeamId: connectorTeamId ?? null, name, ...(initialPresentation == null ? {} : { presentation: initialPresentation }) },
    })
  }

  async #createFlow({
    actorId,
    tagIds = [],
    name,
    icon,
    description,
    idempotencyKey,
    connectorTeamId,
    content,
    presentation: initialPresentation,
    request,
  }: {
    readonly actorId: string
    readonly tagIds?: readonly string[]
    readonly name: string
    readonly icon?: string | undefined
    readonly description?: string | undefined
    readonly idempotencyKey: string
    readonly connectorTeamId?: string
    readonly content: RevisionContent
    readonly presentation?: Readonly<Record<string, JsonValue>>
    readonly request: JsonValue
  }): Promise<{ readonly created: boolean; readonly flow: Flow }> {
    const ids = [...new Set(tagIds)].toSorted()
    const requestDigest = await digestBytes(canonicalJsonBytes(ids.length ? { ...(request as Record<string, JsonValue>), tagIds: ids } : request))
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
    const revisionDigest = await digestBytes(bytes)
    const stored = this.assignTags(() =>
      this.store.flows.createFlow({
        tagIds: ids,
        actorId,
        connectorTeamId: selectedConnectorTeamId,
        content: new TextDecoder().decode(bytes),
        createdAt,
        digest: revisionDigest,
        idempotencyKey,
        modelVersion: content.modelVersion,
        presentation: initialPresentation,
        name,
        icon,
        description,
        flowId: `flow_${randomUUID().replaceAll('-', '')}`,
        requestDigest,
        revisionId: `revision_${randomUUID().replaceAll('-', '')}`,
      }),
    )
    if ('kind' in stored) throw new ControlError(controlErrorCode.flowConflict, 'The idempotency key refers to another Flow request.')
    if (stored.created) this.flowCatalogChanged({ kind: 'flow.created', flowId: stored.flow.flowId, version: 1 })
    return { created: stored.created, flow: flow(stored.flow) }
  }

  listFlows(
    ownerId: string,
    limit: number,
    after?: FlowPosition,
    includeTotal = false,
    query: FlowQuery = {},
  ): {
    readonly next?: FlowPosition
    readonly page: { readonly flows: readonly FlowListItem[]; readonly total?: number; readonly version: 1 }
  } {
    const stored = this.store.flows.list(limit + 1, after, includeTotal, ownerId, query)
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
    return this.updateFlow(actorId, flowId, { name })
  }

  setFlowTags(actorId: string, flowId: string, tagIds: readonly string[]): Flow {
    return this.updateFlow(actorId, flowId, { tagIds })
  }

  updateFlow(actorId: string, flowId: string, changes: FlowUpdate): Flow {
    const current = this.access.requireFlow(actorId, flowId)
    if (current.status != 'active') throw new ControlError(controlErrorCode.flowBusy, 'The Flow is retiring.')
    if (
      (changes.name === undefined && changes.tagIds === undefined && changes.icon === undefined && changes.description === undefined) ||
      (changes.icon != null && typeof changes.icon != 'string') ||
      (changes.description != null && typeof changes.description != 'string') ||
      (changes.name != null && (changes.name != changes.name.trim() || resourceNameIssue(changes.name) != null))
    ) {
      throw new ControlError(controlErrorCode.flowInvalid, 'Flow settings are invalid.')
    }
    const stored = this.assignTags(() => this.store.flows.updateMetadata(flowId, changes, this.clock()))
    if (stored == null) return notFound()
    this.flowCatalogChanged(undefined, stored.ownerId)
    return flow(stored)
  }

  private assignTags<Value>(operation: () => Value): Value {
    try {
      return operation()
    } catch (error) {
      if (error instanceof TagAssignmentError) throw new ControlError(controlErrorCode.tagNotFound, error.message)
      throw error
    }
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
