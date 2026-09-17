import type { FlowChangeEvent, ResultQuery, Run, RunCancellation, RunDetails, RunEvents, RunResult } from '@oomol-lab/open-flow/control-api'
import type { JsonValue, RevisionContent, WaitAction } from '@oomol-lab/open-flow/flow-change'
import type { PreparedFlow } from '@oomol-lab/open-flow/flow-semantics'
import type { RunStatus } from '@oomol-lab/open-flow/run-lifecycle'
import type { FlowRunOptions, TriggerSeed } from '@oomol-lab/open-flow/scheduler'
import type { ConnectorHost } from '../deployment/connector.ts'
import type { StoredControlRun } from '../storage/run-view-store.ts'
import type { Store } from '../storage/store.ts'

import { controlErrorCode, decodeRunEvent, readResult } from '@oomol-lab/open-flow/control-api'
import { canonicalJsonBytes, digestBytes } from '@oomol-lab/open-flow/flow-encoding'
import { agentActions, codeActions, prepareFlow, validateFlowInputs, validRunTrigger, variableBindings } from '@oomol-lab/open-flow/flow-semantics'
import { currentEngineContract, findEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { checkCodeActions } from '../deployment/connector.ts'
import { ControlError, serverErrorCode } from '../error.ts'
import { revisionContent, timestamp } from './control-views.ts'

type RunInputs = NonNullable<FlowRunOptions['inputs']>

export interface RunPosition {
  readonly createdAt: number
  readonly runId: string
}

export class RunControl {
  private readonly store: Store
  private readonly clock: () => number
  private readonly abortRun: (runId: string) => void
  private readonly wake: () => void
  private readonly flowChanged: (event: FlowChangeEvent) => void
  private readonly llmAvailable: (kind?: 'agent') => boolean
  private readonly resolveConnector: () => ConnectorHost | undefined
  private readonly resolveWaitPublicOrigin: () => URL | undefined

  constructor(
    store: Store,
    clock: () => number,
    abortRun: (runId: string) => void,
    wake: () => void,
    flowChanged: (event: FlowChangeEvent) => void,
    llmAvailable: (kind?: 'agent') => boolean,
    resolveConnector: () => ConnectorHost | undefined,
    resolveWaitPublicOrigin: () => URL | undefined,
  ) {
    this.store = store
    this.clock = clock
    this.abortRun = abortRun
    this.wake = wake
    this.flowChanged = flowChanged
    this.llmAvailable = llmAvailable
    this.resolveConnector = resolveConnector
    this.resolveWaitPublicOrigin = resolveWaitPublicOrigin
  }

  async createDraftRun(
    flowId: string,
    revisionId: string,
    engineContract: string,
    inputs: RunInputs,
    idempotencyKey: string,
    trigger: TriggerSeed,
  ): Promise<{ readonly created: boolean; readonly run: RunDetails }> {
    const requestDigest = await digestBytes(canonicalJsonBytes({ engineContract, flowId, inputs, trigger: { ...trigger }, kind: 'draft', revisionId }))
    const existing = this.replayRun(idempotencyKey, requestDigest, 'draft')
    if (existing != null) return existing
    if (engineContract != currentEngineContract) throw new ControlError(controlErrorCode.engineUnsupported, 'The Engine Contract is not supported.')
    const stored = this.store.flows.revision(flowId, revisionId)
    if (stored == null) notFound()
    const content = revisionContent(stored)
    if (!validRunTrigger(content, trigger)) throw new ControlError(controlErrorCode.runInvalid, 'Select a valid Trigger and outputs.')
    const fixed = await this.prepareRun(content, engineContract, trigger.nodeId)
    await this.checkRunActions(fixed.flow, flowId)
    if (validateFlowInputs(content, inputs) != 'valid') throw new ControlError(controlErrorCode.runInvalid, 'The Flow inputs are invalid.')
    const accepted = this.store.runs.acceptControlRun({
      closureDigest: fixed.flow.closureDigest,
      flowId,
      idempotencyKey,
      inputs,
      trigger,
      modelVersion: content.modelVersion,
      requestDigest,
      revisionDigest: stored.digest,
      revisionId,
      variableNames: Object.values(variableBindings(content, fixed.validation.closure.dependencies.inputBindings)),
    })
    return this.acceptedRun(flowId, accepted)
  }

  async createLiveRun(
    publicationId: string,
    inputs: RunInputs,
    idempotencyKey: string,
    trigger: TriggerSeed,
  ): Promise<{ readonly created: boolean; readonly run: RunDetails }> {
    const requestDigest = await digestBytes(canonicalJsonBytes({ inputs, trigger: { ...trigger }, kind: 'live', publicationId }))
    const existing = this.replayRun(idempotencyKey, requestDigest, 'live')
    if (existing != null) return existing

    const livePublication = this.store.publications.publicationById(publicationId)
    if (livePublication == null) throw new ControlError(controlErrorCode.publicationNotFound, 'The Publication was not found.')
    const { flowId } = livePublication
    const currentFlow = this.store.flows.get(flowId)
    if (currentFlow == null) notFound()
    if (currentFlow.status != 'active') throw new ControlError(controlErrorCode.flowBusy, 'The Flow is retiring.')
    const live = this.store.publications.live(flowId)
    if (live?.publication.publicationId != publicationId) {
      throw new ControlError(controlErrorCode.liveConflict, 'The Publication is no longer the current Live target.')
    }
    if (findEngineContract(livePublication.engineContract) == null) {
      throw new ControlError(controlErrorCode.engineUnsupported, 'The Engine Contract is not supported.')
    }
    const stored = this.store.flows.revision(flowId, livePublication.revisionId)
    if (stored == null || stored.digest != livePublication.revisionDigest) {
      throw new ControlError(serverErrorCode.flowRevisionStorageConflict, 'The fixed Revision does not match the Publication.')
    }
    const content = revisionContent(stored)
    const fixed = await this.prepareRun(content, livePublication.engineContract)
    if (!validRunTrigger(content, trigger)) throw new ControlError(controlErrorCode.runInvalid, 'Select a valid Trigger and outputs.')
    const inputsValid = validateFlowInputs(content, inputs) == 'valid'
    if (!inputsValid) throw new ControlError(controlErrorCode.runInvalid, 'The Flow inputs are invalid.')
    if (fixed.flow.closureDigest != livePublication.closureDigest || content.modelVersion != livePublication.modelVersion) {
      throw new ControlError(serverErrorCode.flowRevisionStorageConflict, 'The fixed Flow does not match the Publication.')
    }
    await this.checkRunActions(fixed.flow, flowId)
    const accepted = this.store.runs.acceptLiveControlRun({
      closureDigest: livePublication.closureDigest,
      expectedPublicationId: livePublication.publicationId,
      flowId,
      idempotencyKey,
      inputs,
      trigger,
      modelVersion: livePublication.modelVersion,
      requestDigest,
      revisionDigest: livePublication.revisionDigest,
      revisionId: livePublication.revisionId,
      variableNames: Object.values(variableBindings(content, fixed.validation.closure.dependencies.inputBindings)),
    })
    return this.acceptedRun(flowId, accepted)
  }

  getRun(runId: string): RunDetails {
    return this.runDetails(this.requireRun(runId))
  }

  resolveRunWait(
    runId: string,
    waitId: string,
    action: WaitAction,
  ): {
    readonly action: WaitAction | null
    readonly resolutionAccepted: boolean
    readonly resolvedAt: string | null
    readonly runId: string
    readonly status: RunStatus
    readonly version: 1
    readonly waitId: string
  } {
    const stored = this.requireRun(runId)
    const receipt = this.store.runViews.waitReceipt(runId, waitId)
    if (receipt == null) throw new ControlError(controlErrorCode.runWaitNotFound, 'The active Wait was not found.')
    const result = this.store.runs.resolveWait(runId, waitId, action)
    switch (result.kind) {
      case 'invalid-action':
        throw new ControlError(controlErrorCode.runInvalid, 'The Wait action is invalid.')
      case 'not-found':
        throw new ControlError(controlErrorCode.runWaitNotFound, 'The active Wait was not found.')
      case 'resolved':
        if (result.changed) {
          this.flowChanged({ flowId: stored.flowId, kind: 'run.changed', runId, version: 1 })
          if (result.status == 'queued') this.wake()
        }
        return {
          action: result.action,
          resolutionAccepted: result.resolutionAccepted,
          resolvedAt: result.resolvedAt == null ? null : timestamp(result.resolvedAt),
          runId,
          status: result.status,
          version: 1,
          waitId,
        }
    }
  }

  listRuns(
    flowId: string,
    limit: number,
    options: {
      readonly after?: RunPosition
      readonly createdBefore?: number
      readonly createdFrom?: number
      readonly pendingWait?: boolean
      readonly runId?: string
      readonly source?: StoredControlRun['source']
      readonly status?: RunStatus
    } = {},
  ): {
    readonly next?: RunPosition
    readonly page: { readonly flowId: string; readonly runs: readonly Run[]; readonly version: 1 }
  } {
    if (this.store.flows.get(flowId) == null) notFound()
    const stored = this.store.runViews.listControlRuns(flowId, limit + 1, options)
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
    const stored = this.store.runViews.controlEvents(runId, after, limit)
    const events = stored.map((event) =>
      decodeRunEvent({
        createdAt: timestamp(event.createdAt),
        kind: event.kind,
        payload: event.kind == 'node.completed' && event.value !== undefined ? { ...event.payload, outputs: event.value } : event.payload,
        sequence: event.sequence,
      }),
    )
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

  listRunResults(runId: string, after?: string) {
    this.requireRun(runId)
    return { version: 1 as const, runId, ...this.store.results.list(runId, after) }
  }

  readRunResult(runId: string, resultId: string, query: ResultQuery) {
    const stored = this.runResultContent(runId, resultId)
    try {
      return { version: 1 as const, runId, result: stored.result, page: readResult(JSON.parse(stored.content) as JsonValue, query) }
    } catch (error) {
      throw new ControlError(controlErrorCode.runInvalid, error instanceof Error ? error.message : 'Invalid result page.')
    }
  }

  runResultContent(runId: string, resultId: string) {
    this.requireRun(runId)
    const stored = this.store.results.get(runId, resultId)
    if (stored == null) notFound()
    return stored
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
      case 'waiting':
        throw new Error('Non-terminal Run passed the terminal guard.')
    }
  }

  cancelRun(runId: string): RunCancellation {
    const canceled = this.store.runs.cancelControlRun(runId)
    if (canceled == null) runNotFound()
    if (canceled.accepted) {
      this.abortRun(runId)
      this.flowChanged({ flowId: canceled.run.flowId, kind: 'run.changed', runId, version: 1 })
    }
    return { cancelAccepted: canceled.accepted, runId, status: terminalStatus(canceled.run.status), version: 1 }
  }

  private replayRun(idempotencyKey: string, requestDigest: string, source: 'draft' | 'live') {
    const existing = this.store.runViews.request(idempotencyKey)
    if (existing == null) return
    if (existing.requestDigest != requestDigest || existing.source != source) {
      throw new ControlError(controlErrorCode.runConflict, 'The idempotency key refers to another Run request.')
    }
    if (existing.status == 'queued' || existing.status == 'starting') this.wake()
    return { created: false, run: this.runDetails(this.requireRun(existing.runId)) }
  }

  private async prepareRun(content: RevisionContent, engineContract: string, triggerId?: string) {
    const fixed = await prepareFlow(content, engineContract, triggerId)
    switch (fixed.kind) {
      case 'engine-unsupported':
        throw new ControlError(controlErrorCode.engineUnsupported, 'The Engine Contract is not supported.')
      case 'flow-invalid':
        throw new ControlError(controlErrorCode.flowInvalid, 'The Flow is invalid.')
      case 'prepared':
        break
    }
    if (
      Object.values(fixed.flow.tasks).some((task) => task.executor.kind == 'agent' && task.executor.notification != null) &&
      this.resolveWaitPublicOrigin() == null
    ) {
      throw new ControlError(controlErrorCode.flowInvalid, 'Wait notification requires OPEN_FLOW_PUBLIC_ORIGIN.')
    }
    return fixed
  }

  private async checkRunActions(prepared: PreparedFlow, flowId: string): Promise<void> {
    if (Object.values(prepared.tasks).some((task) => task.executor.kind == 'agent') && !this.llmAvailable('agent'))
      throw new ControlError(controlErrorCode.flowInvalid, 'Agent requires a configured model host.')
    await checkCodeActions([...codeActions(prepared), ...agentActions(prepared)], this.resolveConnector(), this.store.connectorTeams.get(flowId))
  }

  private acceptedRun(flowId: string, accepted: ReturnType<Store['runs']['acceptLiveControlRun']>) {
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
        return { created: accepted.created, run: this.runDetails(this.requireRun(accepted.runId)) }
      }
    }
  }

  private requireRun(runId: string): StoredControlRun {
    const stored = this.store.runViews.controlRun(runId)
    if (stored == null) runNotFound()
    return stored
  }

  private runDetails(stored: StoredControlRun): RunDetails {
    const state = {
      status: stored.status,
      waits: this.store.runViews.activeWaits(stored.runId).map((receipt) => ({
        actions: receipt.actions,
        expiresAt: timestamp(receipt.expiresAt),
        nodeId: receipt.nodeId,
        prompt: receipt.prompt,
        waitId: receipt.waitId,
        waitingSince: timestamp(receipt.waitingSince),
      })),
    }
    const details = {
      ...run(stored),
      ...state,
      closureDigest: stored.closureDigest,
      engineContract: stored.engineContract,
      engineDigest: stored.engineDigest,
      ...(stored.eventsExpiresAt == null ? {} : { eventsExpiresAt: timestamp(stored.eventsExpiresAt) }),
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
}

function run(stored: StoredControlRun): Run {
  return {
    createdAt: timestamp(stored.createdAt),
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

function runNotFound(): never {
  throw new ControlError(controlErrorCode.runNotFound, 'The Run was not found.')
}

function notFound(): never {
  throw new ControlError(controlErrorCode.flowNotFound, 'The Flow or Revision was not found.')
}
