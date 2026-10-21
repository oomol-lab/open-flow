import type { RunStatus } from '../../execution/common/runLifecycle.ts'
import type { JsonValue, WaitAction } from '../../flow/common/change.ts'
import type { Run, RunCancellation, RunChannel, RunDetails, RunInitiator, RunPage, RunResult } from './api.ts'

import { runStatuses } from '../../execution/common/runLifecycle.ts'
import { requiredFields, integer, invalidResponse, record, string } from './decoding.ts'

const runStatusSet: ReadonlySet<RunStatus> = new Set(runStatuses)

function runStatus(value: unknown): RunStatus {
  return typeof value == 'string' && runStatusSet.has(value as RunStatus) ? (value as RunStatus) : invalidResponse()
}

function run(value: unknown): Run {
  const source = record(value)
  const kind = source.source
  const startedAt = source.startedAt
  const finishedAt = source.finishedAt
  if (source.version != 1 || (kind != 'draft' && kind != 'live')) return invalidResponse()
  if (startedAt != null && typeof startedAt != 'string') return invalidResponse()
  if (finishedAt != null && typeof finishedAt != 'string') return invalidResponse()
  return {
    createdAt: string(source.createdAt),
    ...(finishedAt == null ? {} : { finishedAt }),
    flowId: string(source.flowId),
    revisionId: string(source.revisionId),
    runId: string(source.runId),
    source: kind as Run['source'],
    ...(startedAt == null ? {} : { startedAt }),
    status: runStatus(source.status),
    version: 1,
  }
}

function runWaiting(value: unknown) {
  const source = record(value)
  requiredFields(source, ['actions', 'expiresAt', 'nodeId', 'prompt', 'waitId', 'waitingSince'])
  const actions = source.actions
  if (
    !Array.isArray(actions) ||
    !((actions.length == 1 && actions[0] == 'continue') || (actions.length == 2 && actions[0] == 'approve' && actions[1] == 'reject'))
  ) {
    return invalidResponse()
  }
  return {
    actions: actions as unknown as readonly ['continue'] | readonly ['approve', 'reject'],
    ...(source.autoContinueAt === undefined ? {} : { autoContinueAt: string(source.autoContinueAt) }),
    expiresAt: string(source.expiresAt),
    nodeId: string(source.nodeId),
    prompt: string(source.prompt),
    waitId: string(source.waitId),
    waitingSince: string(source.waitingSince),
  }
}

function workflowIdentity(value: unknown) {
  const ref = record(value)
  return { flowId: string(ref.flowId), runId: string(ref.runId), nodeId: string(ref.nodeId), executionId: string(ref.executionId) }
}

function runInitiator(value: unknown): RunInitiator {
  const source = record(value)
  const channels: readonly RunChannel[] = ['workbench', 'cli', 'mcp', 'api', 'trigger', 'workflow']
  if (!channels.includes(source.channel as RunChannel)) return invalidResponse()
  return {
    channel: source.channel as RunChannel,
    ...(source.actorId === undefined ? {} : { actorId: string(source.actorId) }),
  }
}

export function runDetails(value: unknown): RunDetails {
  const source = record(value)
  const summary = run(source)
  const eventsExpiresAt = source.eventsExpiresAt
  if (eventsExpiresAt != null && typeof eventsExpiresAt != 'string') return invalidResponse()
  if (source.waiting !== undefined || !Array.isArray(source.waits)) return invalidResponse()
  const waits = source.waits.map(runWaiting)
  if (
    new Set(waits.map((wait) => wait.waitId)).size != waits.length ||
    (summary.status == 'waiting' && waits.length == 0 && (!Array.isArray(source.calls) || source.calls.length == 0)) ||
    (['completed', 'failed', 'canceled', 'indeterminate'].includes(summary.status) && waits.length > 0)
  )
    return invalidResponse()
  if (source.occurrenceId !== undefined && source.triggerNodeId === undefined) return invalidResponse()
  const state = { status: summary.status, waits }
  if (source.calls !== undefined && !Array.isArray(source.calls)) return invalidResponse()
  const details = {
    ...summary,
    ...(source.initiator === undefined ? {} : { initiator: runInitiator(source.initiator) }),
    ...errorHandling(source),
    ...(source.triggerNodeId === undefined ? {} : { triggerNodeId: string(source.triggerNodeId) }),
    ...(source.caller === undefined ? {} : { caller: workflowIdentity(source.caller) }),
    ...(source.calls === undefined
      ? {}
      : {
          calls: (source.calls as unknown[]).map((item) =>
            Object.assign(workflowIdentity(item), { status: record(item).status === null ? null : runStatus(record(item).status) }),
          ),
        }),
    closureDigest: string(source.closureDigest),
    engineContract: string(source.engineContract),
    engineDigest: string(source.engineDigest),
    ...(eventsExpiresAt == null ? {} : { eventsExpiresAt }),
    modelVersion: integer(source.modelVersion),
    sharedAccessDigest: string(source.sharedAccessDigest),
    revisionDigest: string(source.revisionDigest),
    ...state,
  }
  switch (summary.source) {
    case 'draft':
      return { ...details, source: 'draft' }
    case 'live':
      return {
        ...details,
        publicationId: string(source.publicationId),
        source: 'live',
        ...(source.occurrenceId === undefined ? {} : { occurrenceId: string(source.occurrenceId), triggerNodeId: string(source.triggerNodeId) }),
      }
  }
}

export function runPage(value: unknown): RunPage {
  const source = record(value)
  const nextCursor = source.nextCursor
  if (source.version != 1 || !Array.isArray(source.runs)) return invalidResponse()
  if (nextCursor != null && typeof nextCursor != 'string') return invalidResponse()
  return {
    flowId: string(source.flowId),
    ...(nextCursor == null ? {} : { nextCursor }),
    runs: source.runs.map(run),
    version: 1,
  }
}

export function runCancellation(value: unknown): RunCancellation {
  const source = record(value)
  const status = runStatus(source.status)
  if (
    source.version != 1 ||
    typeof source.cancelAccepted != 'boolean' ||
    status == 'queued' ||
    status == 'starting' ||
    status == 'running' ||
    status == 'waiting'
  ) {
    return invalidResponse()
  }
  return { cancelAccepted: source.cancelAccepted, runId: string(source.runId), status, version: 1 }
}

export function waitResolution(value: unknown) {
  const source = record(value)
  requiredFields(source, ['action', 'comment', 'resolutionAccepted', 'resolvedAt', 'runId', 'status', 'version', 'waitId'])
  const action = source.action
  const resolvedAt = source.resolvedAt
  if (
    source.version != 1 ||
    typeof source.resolutionAccepted != 'boolean' ||
    (source.comment !== null && typeof source.comment != 'string') ||
    (action !== null && action != 'approve' && action != 'continue' && action != 'reject') ||
    (resolvedAt !== null && typeof resolvedAt != 'string') ||
    (action === null) != (resolvedAt === null) ||
    (source.resolutionAccepted && action === null)
  ) {
    return invalidResponse()
  }
  return {
    action: action as WaitAction | null,
    comment: source.comment as string | null,
    resolutionAccepted: source.resolutionAccepted,
    resolvedAt: resolvedAt as string | null,
    runId: string(source.runId),
    status: runStatus(source.status),
    version: 1 as const,
    waitId: string(source.waitId),
  }
}

export function runResult(value: unknown): RunResult {
  const source = record(value)
  const status = source.status
  if (source.version != 1) return invalidResponse()
  const base = { finishedAt: string(source.finishedAt), runId: string(source.runId), version: 1 as const }
  if (status == 'completed') {
    if (!Object.hasOwn(source, 'result')) return invalidResponse()
    return { ...base, result: source.result as JsonValue, status: 'completed' }
  }
  if (status == 'canceled') return { ...base, status: 'canceled' }
  if (status == 'failed') {
    const error = record(source.error)
    return { ...base, error: runFailure(error), status: 'failed' }
  }
  if (status == 'indeterminate') {
    const error = record(source.error)
    return { ...base, error: runFailure(error), status: 'indeterminate' }
  }
  return invalidResponse()
}

function errorHandling(source: Record<string, unknown>): Pick<RunDetails, 'errorDispatches' | 'errorSource'> {
  const errorSource = source.errorSource == null ? undefined : record(source.errorSource)
  if (source.errorDispatches != null && !Array.isArray(source.errorDispatches)) return invalidResponse()
  return {
    ...(errorSource == null ? {} : { errorSource: { flowId: string(errorSource.flowId), runId: string(errorSource.runId) } }),
    ...(source.errorDispatches == null
      ? {}
      : {
          errorDispatches: (source.errorDispatches as unknown[]).map((value) => {
            const dispatch = record(value)
            const flowId = string(dispatch.flowId)
            switch (dispatch.status) {
              case 'pending':
                return { status: 'pending' as const, flowId }
              case 'dispatched':
                return { status: 'dispatched' as const, flowId, runId: string(dispatch.runId) }
              case 'failed':
                return { status: 'failed' as const, flowId, message: string(dispatch.message) }
              default:
                return invalidResponse()
            }
          }),
        }),
  }
}

export function runFailure(error: Record<string, unknown>) {
  return {
    code: string(error.code),
    message: string(error.message),
    ...(error.nodeId === undefined ? {} : { nodeId: string(error.nodeId) }),
    ...(error.jobId === undefined ? {} : { jobId: string(error.jobId) }),
    ...(error.path === undefined ? {} : { path: (Array.isArray(error.path) ? error.path : invalidResponse()).map(string) }),
  }
}
