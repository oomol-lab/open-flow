import type {
  ConnectorAccessSnapshot,
  FlowChangeEvent,
  ResultQuery,
  Run,
  RunCancellation,
  RunDetails,
  RunEvents,
  RunInitiator,
  RunResult,
} from '@oomol-lab/open-flow/control-api'
import type { JsonValue, RevisionContent, TaskNode, WaitAction, WorkflowCapability } from '@oomol-lab/open-flow/flow-change'
import type { PreparedFlow } from '@oomol-lab/open-flow/flow-semantics'
import type { RunStatus } from '@oomol-lab/open-flow/run-lifecycle'
import type { FlowRunOptions, TriggerSeed } from '@oomol-lab/open-flow/scheduler'
import type { ConnectorAccessHost } from '../deployment/connector-access.ts'
import type { ConnectorHost } from '../deployment/connector-contract.ts'
import type { LiveRunOrigin, StoredRun } from '../storage/run-store.ts'
import type { StoredControlRun } from '../storage/run-view-store.ts'
import type { Store } from '../storage/store.ts'
import type { ControlAccess } from './control-access.ts'

import { controlErrorCode, decodeRunEvent, readResult } from '@oomol-lab/open-flow/control-api'
import { canonicalJsonBytes, digestBytes } from '@oomol-lab/open-flow/flow-encoding'
import { agentActions, codeActions, normalizeRunTrigger, prepareFlow, validateFlowInputs, variableBindings } from '@oomol-lab/open-flow/flow-semantics'
import { projectExecutionId } from '@oomol-lab/open-flow/run-events'
import { currentEngineContract, findEngineContract, nodejsEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { captureConnectorAccess } from '../deployment/connector-access.ts'
import { WorkflowToolError } from '../deployment/workflow-contract.ts'
import { ControlError, serverErrorCode } from '../error.ts'
import { checkCodeActions, checkCodePermissions } from './connector-capabilities.ts'
import { readRevisionOrRepair, revisionContent, timestamp } from './control-views.ts'
import { requireWorkflowCalls, workflowCallCompatibility, workflowContent, workflowTarget, workflowToolCompatibility, workflowRunOutcome } from './workflow.ts'

type RunInputs = NonNullable<FlowRunOptions['inputs']>

export interface RunPosition {
  readonly createdAt: number
  readonly runId: string
}

export class RunControl {
  private readonly access: ControlAccess
  private readonly store: Store
  private readonly clock: () => number
  private readonly abortRun: (runId: string) => void
  private readonly wake: () => void
  private readonly flowChanged: (event: FlowChangeEvent) => void
  private readonly llmAvailable: (kind?: 'agent' | 'decision') => boolean
  private readonly resolveConnector: () => ConnectorHost | undefined
  private readonly connectorAccess: ConnectorAccessHost
  private readonly resolveWaitPublicOrigin: () => URL | undefined

  constructor(
    store: Store,
    access: ControlAccess,
    clock: () => number,
    abortRun: (runId: string) => void,
    wake: () => void,
    flowChanged: (event: FlowChangeEvent) => void,
    llmAvailable: (kind?: 'agent' | 'decision') => boolean,
    resolveConnector: () => ConnectorHost | undefined,
    connectorAccess: ConnectorAccessHost,
    resolveWaitPublicOrigin: () => URL | undefined,
  ) {
    this.access = access
    this.store = store
    this.clock = clock
    this.abortRun = abortRun
    this.wake = wake
    this.flowChanged = flowChanged
    this.llmAvailable = llmAvailable
    this.resolveConnector = resolveConnector
    this.connectorAccess = connectorAccess
    this.resolveWaitPublicOrigin = resolveWaitPublicOrigin
  }

  async createDraftRun(
    actorId: string,
    flowId: string,
    revisionId: string,
    engineContract: string,
    inputs: RunInputs,
    idempotencyKey: string,
    trigger: TriggerSeed,
    channel: RunInitiator['channel'] = 'api',
  ): Promise<{ readonly created: boolean; readonly run: RunDetails }> {
    this.access.authorize(actorId, { flowId })

    const initiator: RunInitiator = { actorId, channel }
    idempotencyKey = JSON.stringify([actorId, idempotencyKey])
    const sharedAccess = this.connectorAccess.current(flowId)
    const requestDigest = await digestBytes(
      canonicalJsonBytes({
        engineContract,
        flowId,
        inputs,
        trigger: { ...trigger },
        kind: 'draft',
        sharedAccessDigest: sharedAccess.sharedAccessDigest,
        revisionId,
      }),
    )
    const existing = this.replayRun(idempotencyKey, requestDigest, 'draft')
    if (existing != null) return existing
    if (engineContract != currentEngineContract && engineContract != nodejsEngineContract)
      throw new ControlError(controlErrorCode.engineUnsupported, 'The Engine Contract is not supported.')
    const stored = readRevisionOrRepair(() => this.store.flows.revision(flowId, revisionId))
    if (stored == null) notFound()
    const content = revisionContent(stored)
    const seed = normalizeRunTrigger(content, trigger)
    if (seed == null) throw new ControlError(controlErrorCode.runInvalid, 'Select a valid Trigger and outputs.')
    requireWorkflowCalls(this.store, flowId, content, trigger.nodeId)
    const fixed = await this.prepareRun(content, engineContract, trigger.nodeId)
    const providerAccess = await captureConnectorAccess(this.connectorAccess, flowId, { ...content.document, ...fixed.flow }, sharedAccess)
    await this.checkRunActions(fixed.flow, flowId, providerAccess, 'draft')
    if (validateFlowInputs(content, inputs) != 'valid') throw new ControlError(controlErrorCode.runInvalid, 'The Flow inputs are invalid.')
    if (this.connectorAccess.current(flowId).sharedAccessDigest != providerAccess.sharedAccessDigest) {
      throw new ControlError(controlErrorCode.connectorAccessConflict, 'Connector access changed while the Run was being accepted.')
    }
    const accepted = this.store.runs.acceptControlRun({
      initiator,
      closureDigest: fixed.flow.closureDigest,
      flowId,
      idempotencyKey,
      inputs,
      trigger: seed,
      modelVersion: content.modelVersion,
      providerAccess,
      requestDigest,
      revisionDigest: stored.digest,
      revisionId,
      variableNames: Object.values(variableBindings(content, fixed.validation.closure.dependencies.bindings)),
    })
    return this.acceptedRun(flowId, accepted)
  }

  async createLiveRun(
    actorId: string,
    publicationId: string,
    inputs: RunInputs,
    idempotencyKey: string,
    trigger: TriggerSeed,
    channel: RunInitiator['channel'] = 'api',
  ): Promise<{ readonly created: boolean; readonly run: RunDetails }> {
    this.access.authorize(actorId, { publicationId })
    return this.admitLiveRun(publicationId, inputs, idempotencyKey, trigger, { initiator: { actorId, channel } })
  }

  private async admitLiveRun(
    publicationId: string,
    inputs: RunInputs,
    idempotencyKey: string,
    trigger: TriggerSeed,
    origin: LiveRunOrigin,
  ): Promise<{ readonly created: boolean; readonly run: RunDetails }> {
    const actorId = origin.initiator?.actorId
    if (actorId != null) idempotencyKey = JSON.stringify([actorId, idempotencyKey])
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
    const stored = readRevisionOrRepair(() => this.store.flows.revision(flowId, livePublication.revisionId))
    if (stored == null || stored.digest != livePublication.revisionDigest) {
      throw new ControlError(serverErrorCode.flowRevisionStorageConflict, 'The fixed Revision does not match the Publication.')
    }
    const content = revisionContent(stored)
    if (content.document.graph.nodes[trigger.nodeId]?.kind != 'start') {
      throw new ControlError(controlErrorCode.runInvalid, 'Live Runs can only be started through a Start node.')
    }
    requireWorkflowCalls(this.store, flowId, content, trigger.nodeId)
    const fixed = await this.prepareRun(content, livePublication.engineContract)
    const seed = normalizeRunTrigger(content, trigger)
    if (seed == null) throw new ControlError(controlErrorCode.runInvalid, 'Select a valid Trigger and outputs.')
    const inputsValid = validateFlowInputs(content, inputs) == 'valid'
    if (!inputsValid) throw new ControlError(controlErrorCode.runInvalid, 'The Flow inputs are invalid.')
    if (fixed.flow.closureDigest != livePublication.closureDigest || content.modelVersion != livePublication.modelVersion) {
      throw new ControlError(serverErrorCode.flowRevisionStorageConflict, 'The fixed Flow does not match the Publication.')
    }
    const providerAccess = this.store.publications.providerAccess(livePublication.publicationId)
    if (providerAccess == null) throw new ControlError(serverErrorCode.flowRevisionStorageConflict, 'The Publication access snapshot is unavailable.')
    await this.checkRunActions(fixed.flow, flowId, providerAccess, 'publication')
    const accepted = this.store.runs.acceptLiveControlRun({
      ...origin,
      closureDigest: livePublication.closureDigest,
      expectedPublicationId: livePublication.publicationId,
      flowId,
      idempotencyKey,
      inputs,
      trigger: seed,
      modelVersion: livePublication.modelVersion,
      requestDigest,
      revisionDigest: livePublication.revisionDigest,
      revisionId: livePublication.revisionId,
      variableNames: Object.values(variableBindings(content, fixed.validation.closure.dependencies.bindings)),
    })
    return this.acceptedRun(flowId, accepted)
  }

  async invokeWorkflow(parent: StoredRun, nodeId: string, jobId: string, input: Readonly<Record<string, JsonValue>>, node: TaskNode, expectedChild?: string) {
    const task = node.task
    if (!('executor' in task) || task.executor.kind != 'workflow') throw new Error('Expected workflow executor.')
    return this.invokeWorkflowTarget(
      parent,
      nodeId,
      jobId,
      input,
      {
        ...task.executor,
        inputs: task.inputs.filter((port) => 'handle' in port),
        outputs: task.outputs.filter((port) => 'handle' in port),
      },
      { expectedChild, timeoutMs: node.timeoutMs, node },
    )
  }

  async invokeWorkflowTarget(
    parent: StoredRun,
    nodeId: string,
    jobId: string,
    input: Readonly<Record<string, JsonValue>>,
    target: Omit<WorkflowCapability, 'kind' | 'name'>,
    options: { readonly callId?: string; readonly expectedChild?: string; readonly timeoutMs?: number; readonly node?: TaskNode } = {},
  ) {
    const { expectedChild, callId } = options
    const startedAt = this.clock()
    let call = this.store.runs.workflowCalls(parent.runId, jobId).find((row) => (row.callId ?? undefined) == callId)
    if (call == null) {
      if (expectedChild != null) throw new Error('Saved workflow call is unavailable.')
      if (this.store.runs.callAncestors(parent.runId).includes(target.flowId)) throw new Error('Recursive workflow calls are not supported.')
      const owner = this.store.flows.get(parent.flowId)?.ownerId ?? ''
      const { contract } = workflowTarget(this.store, owner, target.flowId)
      const issues =
        options.node == null ? workflowToolCompatibility(this.store, target, contract) : workflowCallCompatibility(this.store, options.node, contract)
      if (issues.length) throw new Error(issues[0]!.message)
      const content = workflowContent(this.store, contract)
      const start = Object.entries(content.document.graph.nodes).find(([, entry]) => entry.kind == 'start')
      if (start == null) throw new ControlError(controlErrorCode.runInvalid, 'Live Runs can only be started through a Start node.')
      const values =
        options.node == null ? input : Object.fromEntries(Object.entries(input).filter(([key]) => contract.inputs.some((port) => port.handle == key)))
      const accepted = await this.admitLiveRun(
        contract.publicationId,
        {},
        JSON.stringify(['workflow', parent.runId, jobId, ...(callId == null ? [] : [callId])]),
        { nodeId: start[0], outputs: values },
        {
          call: {
            parentRunId: parent.runId,
            parentFlowId: parent.flowId,
            nodeId,
            jobId,
            ...(callId == null ? {} : { callId }),
            executionId: await projectExecutionId(parent.runId, parent.runId, jobId),
            ...(options.timeoutMs == null ? {} : { deadlineAt: startedAt + options.timeoutMs }),
          },
        },
      )
      call = this.store.runs.workflowCalls(parent.runId, jobId).find((row) => row.runId == accepted.run.runId)
    }
    if (call == null || call.nodeId != nodeId || (expectedChild != null && call.runId != expectedChild)) throw new Error('Workflow call identity changed.')
    const child = this.store.runViews.controlRun(call.runId)
    if (child == null) throw new Error('Called Run is unavailable.')
    const outcome = workflowRunOutcome(child)
    if (outcome.kind == 'completed') return outcome
    if (outcome.kind != 'calling') {
      if (callId != null) throw new WorkflowToolError(`workflow.${outcome.kind}`, outcome.message)
      throw new Error(outcome.message)
    }
    return { kind: 'calling' as const, childRunId: child.runId }
  }

  getRun(actorId: string, runId: string): RunDetails {
    this.access.authorize(actorId, { runId })

    return this.runDetails(this.requireRun(runId))
  }

  resolveRunWait(
    actorId: string,
    runId: string,
    waitId: string,
    action: WaitAction,
    comment?: string | null,
  ): {
    readonly action: WaitAction | null
    readonly comment: string | null
    readonly resolutionAccepted: boolean
    readonly resolvedAt: string | null
    readonly runId: string
    readonly status: RunStatus
    readonly version: 1
    readonly waitId: string
  } {
    this.access.authorize(actorId, { runId })

    const stored = this.requireRun(runId)
    const receipt = this.store.runViews.waitReceipt(runId, waitId)
    if (receipt == null) throw new ControlError(controlErrorCode.runWaitNotFound, 'The active Wait was not found.')
    const result = this.store.runs.resolveWait(runId, waitId, action, comment)
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
          comment: result.comment,
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
    actorId: string,
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
    this.access.authorize(actorId, { flowId })

    if (this.store.flows.get(flowId) == null) notFound()
    const stored = this.store.runViews.listControlRuns(flowId, limit + 1, options)
    const rows = stored.slice(0, limit)
    const last = rows.at(-1)
    return {
      ...(stored.length > limit && last != null ? { next: { createdAt: last.createdAt, runId: last.runId } } : {}),
      page: { flowId, runs: rows.map(run), version: 1 },
    }
  }

  getRunEvents(actorId: string, runId: string, after: number, limit: number): RunEvents {
    this.access.authorize(actorId, { runId })

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

  listRunResults(actorId: string, runId: string, after?: string) {
    this.access.authorize(actorId, { runId })

    this.requireRun(runId)
    return { version: 1 as const, runId, ...this.store.results.list(runId, after) }
  }

  readRunResult(actorId: string, runId: string, resultId: string, query: ResultQuery) {
    this.access.authorize(actorId, { runId })

    const stored = this.runResultContent(actorId, runId, resultId)
    try {
      return { version: 1 as const, runId, result: stored.result, page: readResult(JSON.parse(stored.content) as JsonValue, query) }
    } catch (error) {
      throw new ControlError(controlErrorCode.runInvalid, error instanceof Error ? error.message : 'Invalid result page.')
    }
  }

  runResultContent(actorId: string, runId: string, resultId: string) {
    this.access.authorize(actorId, { runId })

    this.requireRun(runId)
    const stored = this.store.results.get(runId, resultId)
    if (stored == null) notFound()
    return stored
  }

  getRunResult(actorId: string, runId: string): RunResult {
    this.access.authorize(actorId, { runId })

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

  cancelRun(actorId: string, runId: string): RunCancellation {
    this.access.authorize(actorId, { runId })

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
      Object.values(fixed.flow.graph.nodes)
        .flatMap((node) => (node.kind == 'task' && 'executor' in node.task ? [node.task] : []))
        .some((task) => task.executor.kind == 'agent' && task.executor.notification != null) &&
      this.resolveWaitPublicOrigin() == null
    ) {
      throw new ControlError(controlErrorCode.flowInvalid, 'Wait notification requires OPEN_FLOW_PUBLIC_ORIGIN.')
    }
    return fixed
  }

  private async checkRunActions(
    prepared: PreparedFlow,
    flowId: string,
    providerAccess: ConnectorAccessSnapshot,
    source: 'draft' | 'publication' = 'draft',
  ): Promise<void> {
    if (
      Object.values(prepared.graph.nodes)
        .flatMap((node) => (node.kind == 'task' && 'executor' in node.task ? [node.task] : []))
        .some((task) => task.executor.kind == 'agent') &&
      !this.llmAvailable('agent')
    )
      throw new ControlError(controlErrorCode.flowInvalid, 'Agent requires a configured model host.')
    if (
      Object.values(prepared.graph.nodes)
        .flatMap((node) => (node.kind == 'task' && 'executor' in node.task ? [node.task] : []))
        .some((task) => task.executor.kind == 'decision') &&
      !this.llmAvailable('decision')
    )
      throw new ControlError(controlErrorCode.flowInvalid, 'AI Decision requires a configured decision host.')
    const teamId = this.store.connectorTeams.get(flowId)
    await checkCodeActions(agentActions(prepared), this.resolveConnector(), {
      flowId,
      providerAccess,
      purpose: 'eligibility',
      scope: 'selected',
      source,
      ...(teamId == null ? {} : { teamId }),
    })
    await checkCodePermissions(codeActions(prepared), this.resolveConnector(), {
      flowId,
      providerAccess,
      purpose: 'eligibility',
      scope: 'shared',
      source,
      ...(teamId == null ? {} : { teamId }),
    })
  }

  private acceptedRun(flowId: string, accepted: ReturnType<Store['runs']['acceptLiveControlRun']>) {
    switch (accepted.kind) {
      case 'binding-unresolved':
        throw new ControlError(controlErrorCode.bindingUnresolved, 'A required variable is unresolved.')
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
        autoContinueAt: receipt.autoContinueAt == null ? undefined : timestamp(receipt.autoContinueAt),
        waitingSince: timestamp(receipt.waitingSince),
      })),
    }
    const caller = this.store.runs.workflowOrigin(stored.runId)
    const details = {
      ...run(stored),
      ...(stored.initiator == null ? {} : { initiator: stored.initiator }),
      ...this.store.runViews.errorHandling(stored.runId),
      ...state,
      calls: this.store.runs
        .workflowCalls(stored.runId)
        .map(({ deadlineAt: _deadline, jobId: _jobId, callId, ...call }) => Object.assign(call, callId == null ? {} : { callId })),
      ...(caller == null ? {} : { caller: { ...caller, callId: caller.callId ?? undefined } }),
      ...(stored.triggerNodeId == null ? {} : { triggerNodeId: stored.triggerNodeId }),
      closureDigest: stored.closureDigest,
      engineContract: stored.engineContract,
      engineDigest: stored.engineDigest,
      ...(stored.eventsExpiresAt == null ? {} : { eventsExpiresAt: timestamp(stored.eventsExpiresAt) }),
      modelVersion: stored.modelVersion,
      revisionDigest: stored.revisionDigest,
      sharedAccessDigest: stored.sharedAccessDigest,
    }
    switch (stored.source) {
      case 'draft':
        return { ...details, source: 'draft' }
      case 'live':
        if (stored.publicationId == null) throw new Error('Live Run is missing its Publication identity.')
        if (stored.occurrenceId != null && stored.triggerNodeId == null) throw new Error('Live Run occurrence is missing its Trigger identity.')
        return {
          ...details,
          publicationId: stored.publicationId,
          source: 'live',
          ...(stored.occurrenceId == null ? {} : { occurrenceId: stored.occurrenceId, triggerNodeId: stored.triggerNodeId! }),
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

function runError(value: unknown) {
  const error = (value as { error?: { code?: string; message?: string; nodeId?: string; jobId?: string; path?: readonly string[] } } | undefined)?.error
  return {
    code: error?.code ?? 'run.failed',
    message: error?.message ?? 'The Flow could not be completed.',
    ...(error?.nodeId == null ? {} : { nodeId: error.nodeId }),
    ...(error?.jobId == null ? {} : { jobId: error.jobId }),
    ...(error?.path == null ? {} : { path: error.path }),
  }
}

function runNotFound(): never {
  throw new ControlError(controlErrorCode.runNotFound, 'The Run was not found.')
}

function notFound(): never {
  throw new ControlError(controlErrorCode.flowNotFound, 'The Flow or Revision was not found.')
}
