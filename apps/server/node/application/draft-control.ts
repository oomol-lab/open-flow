import type { Draft, DraftChange, FlowCatalogEvent, FlowChangeEvent, FlowCheck, TriggerKeySummary } from '@oomol-lab/open-flow/control-api'
import type { AuthoringRead, AuthoringRequest, AuthoringSearch, AuthoringType, DraftOperation } from '@oomol-lab/open-flow/control-requests'
import type { JsonValue, RevisionContent, TriggerKeySnapshot } from '@oomol-lab/open-flow/flow-change'
import type { ConnectorAccessHost } from '../deployment/connector-access.ts'
import type { StoredFlowRevision } from '../storage/flow-store.ts'
import type { Store } from '../storage/store.ts'
import type { ConnectorControl } from './connector-control.ts'
import type { EventSourceControl } from './event-source-control.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import {
  AuthoringError,
  authoringDiagnostics,
  authoringSchema,
  compileAuthoring,
  readAuthoring,
  resolveDraftOperations,
  searchAuthoring,
} from '@oomol-lab/open-flow/control-requests'
import { FlowChangeError, applyFlowChanges, currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { canonicalJsonBytes, digestBytes, encodeRevision, repairRevision, upgradeRevisionContent } from '@oomol-lab/open-flow/flow-encoding'
import { removeConnectionUsage, validateFlow } from '@oomol-lab/open-flow/flow-semantics'
import { triggerConfigValues } from '@oomol-lab/open-flow/integration-trigger'
import { PermanentPollError, PollConnectionError } from '@oomol-lab/open-flow/poll-trigger'
import { triggerDefinitions as providerDefinitions } from '@oomol-lab/open-flow/provider-triggers'
import { currentEngineContract, findEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { createHash, randomUUID } from 'node:crypto'
import { ConnectorTaskError } from '../deployment/connector-contract.ts'
import { loadOpenApiDocument } from '../deployment/openapi.ts'
import { ControlError, serverErrorCode } from '../error.ts'
import { RevisionIntegrityError } from '../storage/revision-store.ts'
import { ControlAccess, notFound } from './control-access.ts'
import { draft, readRevisionOrRepair, revisionContent, revisionMetadata } from './control-views.ts'
import { requireNoWorkflowSelfReference, workflowAuthoringTarget, workflowDiagnostics } from './workflow.ts'

export class DraftControl {
  constructor(
    private readonly triggerDefinitions: readonly TriggerKeySnapshot[],
    private readonly eventSources: Pick<EventSourceControl, 'listEventSources'>,
    private readonly connectors: Pick<ConnectorControl, 'request' | 'getConnectorAction' | 'accountDiagnostics'>,
    private readonly access: ControlAccess,
    private readonly store: Pick<Store, 'flows' | 'publications'>,
    private readonly clock: () => number,
    private readonly connectorAccess: ConnectorAccessHost,
    private readonly triggersChanged: () => void,
    private readonly flowCatalogChanged: (event?: FlowCatalogEvent, ownerId?: string) => void,
    private readonly flowChanged: (event: FlowChangeEvent) => void,
    private readonly llmAvailable: (kind?: 'agent' | 'decision') => boolean,
  ) {}

  listTriggerKeys(): readonly TriggerKeySummary[] {
    return this.triggerDefinitions.map(({ description, displayName, key, name, provider, type }) => ({ description, displayName, key, name, provider, type }))
  }

  listTriggerDefinitions(): readonly TriggerKeySnapshot[] {
    return this.triggerDefinitions
  }

  getTriggerKey(key: string): TriggerKeySnapshot {
    const definition = this.triggerDefinitions.find((candidate) => candidate.key == key)
    if (definition == null) throw new ControlError(controlErrorCode.triggerKeyNotFound, 'The Trigger Key was not found.')
    return definition
  }

  async listTriggerConfigOptions(actorId: string, flowId: string, nodeId: string, field: string, signal: AbortSignal) {
    const currentDraft = this.getDraft(actorId, flowId)
    const trigger = currentDraft.content.document.graph.nodes[nodeId]
    if (trigger == null || (trigger.kind != 'poll' && trigger.kind != 'integration'))
      throw new ControlError(controlErrorCode.triggerKeyNotFound, 'The Trigger was not found.')
    const definition = providerDefinitions.find((item) => item.snapshot.key == trigger.definition.key)
    if (definition != null && 'eventSource' in definition && definition.eventSource != null) {
      if (trigger.connectionId == null) throw new ControlError(serverErrorCode.connectorConnectionRequired, 'Select a Connection first.')
      const sources = (await this.eventSources.listEventSources(actorId, flowId, signal)).sources.filter(
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
    return await this.connectors.request(
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

  getDraft(actorId: string, flowId: string): Draft {
    this.access.authorize(actorId, { flowId })

    return draft(this.requireDraft(flowId))
  }

  getRevision(actorId: string, flowId: string, revisionId: string): Draft {
    this.access.authorize(actorId, { flowId })

    const stored = readRevisionOrRepair(() => this.store.flows.revision(flowId, revisionId))
    if (stored == null) notFound()
    return draft(stored)
  }

  syncDraft(actorId: string, flowId: string): { readonly draft: Draft; readonly kind: 'snapshot'; readonly version: 1 } {
    this.access.authorize(actorId, { flowId })

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
    this.access.authorize(actorId, { flowId })

    this.requireDraft(flowId)
    const requestDigest = await digestBytes(canonicalJsonBytes({ kind: 'connection-usage.remove', connectionId, expectedRevisionId, expectedAccessRevision }))
    const previous = this.store.flows.change(flowId, changeId)
    if (previous != null) {
      if (previous.requestDigest != requestDigest) throw new ControlError(controlErrorCode.flowConflict, 'The change identity refers to another Draft change.')
      return { revision: revisionMetadata(previous), version: 1 }
    }
    const base = readRevisionOrRepair(() => this.store.flows.revision(flowId, expectedRevisionId))
    if (base == null) throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed.')
    const content = upgradeRevisionContent(removeConnectionUsage(revisionContent(base), connectionId))
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
        revisionId: `revision_${randomUUID().replaceAll('-', '')}`,
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
    this.access.authorize(actorId, { flowId })

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

  readAuthoring(actorId: string, flowId: string, query: AuthoringRead = {}) {
    const revision = this.getRevision(actorId, flowId, query.revision ?? this.access.requireFlow(actorId, flowId).draftRevisionId)
    try {
      return { flowId, revision: revision.revisionId, data: readAuthoring(revision.content, query), version: 1 as const }
    } catch (error) {
      return this.authoringError(error)
    }
  }

  searchAuthoring(actorId: string, flowId: string, query: AuthoringSearch) {
    const revision = this.getRevision(actorId, flowId, query.revision ?? this.access.requireFlow(actorId, flowId).draftRevisionId)
    try {
      return { flowId, revision: revision.revisionId, data: searchAuthoring(revision.content, query), version: 1 as const }
    } catch (error) {
      return this.authoringError(error)
    }
  }

  async authoringSchema(actorId: string, flowId: string, query: { type?: AuthoringType; action?: string }) {
    this.access.authorize(actorId, { flowId })
    if (query.action != null) {
      const action = await this.connectors.getConnectorAction(actorId, query.action, flowId)
      return { action: action.actionId, name: action.name, inputs: action.inputs, outputs: action.outputs, version: 1 as const }
    }
    return { ...authoringSchema(query.type), version: 1 as const }
  }

  async checkAuthoring(actorId: string, flowId: string, revisionId: string) {
    const check = await this.checkFlow(actorId, flowId, revisionId, currentEngineContract)
    const revision = this.getRevision(actorId, flowId, revisionId)
    return { flowId, revisionId, valid: check.valid, diagnostics: authoringDiagnostics(revision.content, check.diagnostics), version: 1 as const }
  }

  private authoringError(error: unknown): never {
    if (error instanceof AuthoringError)
      throw new ControlError(controlErrorCode.flowInvalid, error.message, { cause: error, details: { ...error.details, reason: error.code } })
    throw error
  }

  async editAuthoring(actorId: string, flowId: string, request: AuthoringRequest) {
    this.access.authorize(actorId, { flowId })

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
            workflow: async (targetId) => workflowAuthoringTarget(this.store, actorId, targetId),
            action: (action) => this.connectors.getConnectorAction(actorId, action, flowId, undefined, undefined),
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
      const revision = this.getRevision(actorId, flowId, result.revision.revisionId)
      const checked = await this.checkAuthoring(actorId, flowId, revision.revisionId)
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
    if (this.access.requireFlow(actorId, flowId).draftRevisionId != expectedRevisionId)
      throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed. Read the affected nodes before editing again.', {
        details: { revision: this.access.requireFlow(actorId, flowId).draftRevisionId },
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
    requireNoWorkflowSelfReference(flowId, content)
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
      revisionId: `revision_${randomUUID().replaceAll('-', '')}`,
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
    this.access.authorize(actorId, { flowId })

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
      revisionId: `revision_${randomUUID().replaceAll('-', '')}`,
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

  async upgradeDraft(actorId: string, flowId: string, expectedRevisionId: string, changeId: string = randomUUID()): Promise<DraftChange> {
    const currentFlow = this.access.requireFlow(actorId, flowId)
    const requestDigest = await digestBytes(canonicalJsonBytes({ kind: 'draft.upgrade', expectedRevisionId, version: 1 }))
    const previous = this.store.flows.change(flowId, changeId)
    if (previous != null) {
      if (previous.requestDigest != requestDigest) throw new ControlError(controlErrorCode.flowConflict, 'The upgrade identity refers to another Draft change.')
      return { revision: revisionMetadata(previous), version: 1 }
    }
    if (currentFlow.draftRevisionId != expectedRevisionId) throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed.')
    const base = readRevisionOrRepair(() => this.store.flows.revision(flowId, expectedRevisionId))
    if (base == null) throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft content is unavailable.')
    if ((await digestBytes(new TextEncoder().encode(base.content))) != base.digest)
      throw new ControlError(controlErrorCode.flowInvalid, 'The stored Draft does not match its digest.')
    const content = upgradeRevisionContent(revisionContent(base))
    const bytes = encodeRevision(content)
    const digest = await digestBytes(bytes)
    if (digest == base.digest) {
      const latest = this.access.requireFlow(actorId, flowId)
      if (latest.status != 'active') throw new ControlError(controlErrorCode.flowBusy, 'The Flow is retiring.')
      if (latest.draftRevisionId != expectedRevisionId) throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed.')
      return { revision: revisionMetadata(base), version: 1 }
    }
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
      revisionId: `revision_${randomUUID().replaceAll('-', '')}`,
    })
    switch (stored.kind) {
      case 'busy':
        throw new ControlError(controlErrorCode.flowBusy, 'The Flow is retiring.')
      case 'conflict':
        throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed.')
      case 'request-conflict':
        throw new ControlError(controlErrorCode.flowConflict, 'The upgrade identity refers to another Draft change.')
      case 'not-found':
        return notFound()
      case 'committed':
        this.triggersChanged()
        this.flowCatalogChanged(undefined, this.store.flows.get(flowId)?.ownerId)
        this.flowChanged({ kind: 'draft.changed', flowId, revisionId: stored.revision.revisionId, version: 1 })
        return { revision: revisionMetadata(stored.revision), version: 1 }
    }
  }

  async checkFlow(actorId: string, flowId: string, revisionId: string, engineContract: string): Promise<FlowCheck> {
    this.access.authorize(actorId, { flowId })

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
    const callDiagnostics = workflowDiagnostics(this.store, flowId, content)
    const accountDiagnostics = await this.connectors.accountDiagnostics(actorId, flowId, content, checked.closure.dependencies)
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
      diagnostics: [...checked.diagnostics, ...llmDiagnostics, ...accountDiagnostics, ...callDiagnostics],
      engineContract,
      flowId,
      modelVersion: content.modelVersion,
      revisionDigest: stored.digest,
      revisionId,
      valid: checked.valid && llmDiagnostics.length == 0 && accountDiagnostics.length == 0 && callDiagnostics.length == 0,
      version: 1,
    }
  }

  private requireDraft(flowId: string): StoredFlowRevision {
    const stored = readRevisionOrRepair(() => this.store.flows.draft(flowId))
    if (stored == null) notFound()
    return stored
  }
}
export function emptyRevision(): RevisionContent {
  return {
    document: { bindings: {}, graph: { edges: [], nodes: {} } },
    modelVersion: currentFlowModelVersion,
    modules: {},
  }
}
function invalidFlow(message: string): never {
  throw new ControlError(controlErrorCode.flowInvalid, message)
}
