import type { TFunction } from 'val-i18n'
import type { ResultInfo } from '../../../../control/common/results.ts'
import type { RunEvent } from '../api.ts'

import { decodeResultList } from '../../../../control/common/results.ts'

export interface EventGroup {
  readonly key: string
  readonly node: boolean
  readonly events: RunEvent[]
}

export function groupEvents(events: readonly RunEvent[]): readonly EventGroup[] {
  const groups: EventGroup[] = []
  const nodes = new Map<string, EventGroup>()
  for (const event of events) {
    const key = executionKey(event)
    if (key == null) {
      groups.push({ key: `event:${event.sequence}`, node: false, events: [event] })
      continue
    }
    let group = nodes.get(key)
    if (group == null) {
      group = { key, node: true, events: [] }
      nodes.set(key, group)
      groups.push(group)
    }
    group.events.push(event)
  }
  return groups
}

export function agentLog(event: RunEvent): Record<string, unknown> | undefined {
  if (event.kind != 'node.log') return
  try {
    const value: unknown = JSON.parse(event.payload.message)
    if (value == null || typeof value != 'object' || Array.isArray(value)) return
    const log = value as Record<string, unknown>
    if (log.kind == 'model' && Number.isSafeInteger(log.round) && Number(log.round) > 0) return log
    if (
      log.kind == 'model-step' &&
      Number.isSafeInteger(log.round) &&
      Number(log.round) > 0 &&
      (typeof log.finishReason == 'string' || log.finishReason === null)
    )
      return log
    if (
      log.kind == 'model-tool' &&
      Number.isSafeInteger(log.round) &&
      Number(log.round) > 0 &&
      typeof log.callId == 'string' &&
      typeof log.toolName == 'string' &&
      (log.status == 'requested' || log.status == 'failed')
    )
      return log
    if (
      log.kind == 'tool' &&
      typeof log.callId == 'string' &&
      typeof log.toolId == 'string' &&
      ['started', 'completed', 'failed', 'approval', 'approved', 'rejected'].includes(String(log.status))
    )
      return log
    if (log.kind == 'result' && log.status == 'read' && typeof log.pointer == 'string' && Number.isSafeInteger(log.offset)) return log
  } catch {
    return
  }
}

export function agentSummary(event: RunEvent, t: TFunction): string | undefined {
  if (event.kind == 'node.started' && event.payload.nodeKind == 'agent') return t('run.agentStarted')
  const log = agentLog(event)
  if (log == null) return
  if (log.kind == 'model') return t('run.agentRound', { round: Number(log.round) })
  if (log.kind == 'model-tool') return t(log.status == 'requested' ? 'run.agentToolRequested' : 'run.agentToolRequestFailed', { action: String(log.toolName) })
  if (log.kind == 'model-step') {
    const reason =
      log.finishReason == 'tool-calls'
        ? t('run.agentFinishTools')
        : log.finishReason == 'stop'
          ? t('run.agentFinishAnswer')
          : log.finishReason == 'length'
            ? t('run.agentFinishLength')
            : log.finishReason
    return reason
      ? t('run.agentRoundFinishedReason', { round: Number(log.round), reason: String(reason) })
      : t('run.agentRoundFinished', { round: Number(log.round) })
  }
  if (log.kind == 'result') return t('run.agentRead', { pointer: String(log.pointer || '/'), offset: Number(log.offset) })
  const output = log.output as { result?: { source?: { kind?: string; action?: string } } } | undefined
  const source = output?.result?.source ?? (log.source as { kind?: string; action?: string } | undefined)
  const action =
    source?.kind == 'code'
      ? t('agent.code')
      : typeof source?.action == 'string'
        ? source.action
        : typeof log.action == 'string'
          ? log.action
          : t('run.agentTool')
  switch (log.status) {
    case 'started':
      return t('run.agentToolStarted', { action })
    case 'completed':
      return t('run.agentToolCompleted', { action })
    case 'failed':
      return t('run.agentToolFailed', { action })
    case 'approval':
      return t('run.agentToolApproval', { action })
    case 'approved':
      return t('run.agentToolApproved', { action })
    case 'rejected':
      return t('run.agentToolRejected', { action })
  }
}

export function eventSubject(event: RunEvent, t?: TFunction, nodeTitles?: ReadonlyMap<string, string>): string {
  const title = event.kind == 'node.started' ? event.payload.nodeTitle : undefined
  if (typeof title == 'string') return title
  const executionId = 'executionId' in event.payload ? event.payload.executionId : undefined
  if (typeof executionId == 'string') {
    const executionTitle = nodeTitles?.get(executionId)
    if (executionTitle != null) return executionTitle
  }
  const nodeId = event.payload.nodeId
  if (typeof nodeId == 'string')
    return nodeTitles?.get(JSON.stringify([event.payload.scopeId, nodeId])) ?? (event.payload.scopeId == null ? nodeTitles?.get(nodeId) : undefined) ?? nodeId
  return event.kind.startsWith('run.') ? (t?.('run.flowSubject') ?? 'Flow run') : (t?.('run.nodeSubject') ?? 'Node')
}

export function executionKey(event: RunEvent): string | undefined {
  if (!event.kind.startsWith('node.') || !('executionId' in event.payload)) return
  return JSON.stringify([event.payload.scopeId, event.payload.nodeId, event.payload.executionId])
}

export type ExecutionStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'unknown'

export function executionOverview(events: readonly RunEvent[], runStatus: string | undefined) {
  const counts = new Map<string, number>()
  return groupEvents(events)
    .filter((group) => group.node)
    .map((group) => {
      const first = group.events[0]!
      const identity = JSON.stringify([first.payload.scopeId, first.payload.nodeId])
      const count = (counts.get(identity) ?? 0) + 1
      counts.set(identity, count)
      const started = group.events.find((event) => event.kind == 'node.started')
      const terminal = group.events.findLast((event) => event.kind == 'node.completed' || event.kind == 'node.failed')
      const latest = group.events.findLast((event) => event.kind == 'node.log' || event.kind == 'node.progress')
      const lastLog = group.events.findLast((event) => event.kind == 'node.log')
      const agent = started?.payload.nodeKind == 'agent'
      const completedCalls = new Set(
        group.events.flatMap((event) => {
          const log = agentLog(event)
          return log?.kind == 'tool' && log.status == 'completed' ? [log.callId] : []
        }),
      ).size
      // Wait receipts have no execution identity. Never assign a run-level wait to a node instance.
      const status: ExecutionStatus =
        terminal?.kind == 'node.completed'
          ? 'completed'
          : terminal?.kind == 'node.failed'
            ? 'failed'
            : started == null || !['running', 'waiting'].includes(runStatus ?? '')
              ? 'unknown'
              : lastLog != null && agentLog(lastLog)?.status == 'approval'
                ? 'waiting'
                : runStatus == 'waiting' || started.payload.nodeKind == 'wait' || started.payload.nodeKind == 'approval'
                  ? 'unknown'
                  : 'running'
      return {
        key: group.key,
        events: group.events,
        count,
        started,
        terminal,
        latest,
        agent,
        completedCalls,
        status,
        toolResults: savedToolResults(group.events),
      }
    })
}

export function continuesLog(event: RunEvent, previous: RunEvent | undefined): boolean {
  return (
    event.kind == 'node.log' &&
    previous?.kind == 'node.log' &&
    agentLog(event) == null &&
    agentLog(previous) == null &&
    executionKey(event) == executionKey(previous) &&
    event.payload.level == previous.payload.level
  )
}

export function savedToolResults(events: readonly RunEvent[]): readonly ResultInfo[] {
  const results = new Map<string, ResultInfo>()
  for (const event of events) {
    const log = agentLog(event)
    if (log?.kind != 'tool' || log.status != 'completed') continue
    const output = log.output
    if (output == null || typeof output != 'object' || Array.isArray(output)) continue
    const stored = output as Record<string, unknown>
    if (stored.kind != 'stored-result') continue
    try {
      const result = decodeResultList({ version: 1, runId: '', results: [stored.result] }).results[0]!
      if (result.callId == log.callId && result.toolId == log.toolId) results.set(result.resultId, result)
    } catch {
      // Older or incomplete logs may not contain a usable saved-result reference.
    }
  }
  return [...results.values()]
}
