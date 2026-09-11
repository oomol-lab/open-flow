import type { RunStatus } from '../../execution/common/runLifecycle.ts'
import type { JsonValue, WaitAction } from '../../flow/common/change.ts'
import type { Run, RunCancellation, RunDetails, RunPage, RunResult } from './api.ts'

import { runStatuses } from '../../execution/common/runLifecycle.ts'
import { exact, integer, invalidResponse, record, string } from './decoding.ts'

const runStatusSet: ReadonlySet<RunStatus> = new Set(runStatuses)

function runStatus(value: unknown): RunStatus {
  return typeof value == 'string' && runStatusSet.has(value as RunStatus) ? (value as RunStatus) : invalidResponse()
}

function run(value: unknown): Run {
  const source = record(value)
  const kind = source.source
  const startedAt = source.startedAt
  const finishedAt = source.finishedAt
  if (source.version != 1 || (kind != 'draft' && kind != 'live' && kind != 'trigger')) return invalidResponse()
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
  exact(source, ['actions', 'expiresAt', 'nodeId', 'prompt', 'waitId', 'waitingSince'])
  const actions = source.actions
  if (
    !Array.isArray(actions) ||
    !((actions.length == 1 && actions[0] == 'continue') || (actions.length == 2 && actions[0] == 'approve' && actions[1] == 'reject'))
  ) {
    return invalidResponse()
  }
  return {
    actions: actions as unknown as readonly ['continue'] | readonly ['approve', 'reject'],
    expiresAt: string(source.expiresAt),
    nodeId: string(source.nodeId),
    prompt: string(source.prompt),
    waitId: string(source.waitId),
    waitingSince: string(source.waitingSince),
  }
}

export function runDetails(value: unknown): RunDetails {
  const source = record(value)
  const summary = run(source)
  const eventsExpiresAt = source.eventsExpiresAt
  if (eventsExpiresAt != null && typeof eventsExpiresAt != 'string') return invalidResponse()
  if (summary.status != 'waiting' && source.waiting !== undefined) return invalidResponse()
  const state = summary.status == 'waiting' ? { status: 'waiting' as const, waiting: runWaiting(source.waiting) } : { status: summary.status }
  const details = {
    ...summary,
    closureDigest: string(source.closureDigest),
    engineContract: string(source.engineContract),
    engineDigest: string(source.engineDigest),
    ...(eventsExpiresAt == null ? {} : { eventsExpiresAt }),
    modelVersion: integer(source.modelVersion),
    revisionDigest: string(source.revisionDigest),
    ...state,
  }
  switch (summary.source) {
    case 'draft':
      return { ...details, source: 'draft' }
    case 'live':
      return { ...details, publicationId: string(source.publicationId), source: 'live' }
    case 'trigger':
      return {
        ...details,
        occurrenceId: string(source.occurrenceId),
        publicationId: string(source.publicationId),
        source: 'trigger',
        triggerNodeId: string(source.triggerNodeId),
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
  exact(source, ['action', 'resolutionAccepted', 'resolvedAt', 'runId', 'status', 'version', 'waitId'])
  const action = source.action
  const resolvedAt = source.resolvedAt
  if (
    source.version != 1 ||
    typeof source.resolutionAccepted != 'boolean' ||
    (action !== null && action != 'approve' && action != 'continue' && action != 'reject') ||
    (resolvedAt !== null && typeof resolvedAt != 'string') ||
    (action === null) != (resolvedAt === null) ||
    (source.resolutionAccepted && action === null)
  ) {
    return invalidResponse()
  }
  return {
    action: action as WaitAction | null,
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
    return { ...base, error: { code: string(error.code), message: string(error.message) }, status: 'failed' }
  }
  if (status == 'indeterminate') {
    const error = record(source.error)
    return { ...base, error: { code: string(error.code), message: string(error.message) }, status: 'indeterminate' }
  }
  return invalidResponse()
}
