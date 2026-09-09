import type { TFunction } from 'val-i18n'
import type { RunEvent } from '../api.ts'

export interface EventGroup {
  readonly key: string
  readonly node: boolean
  readonly events: RunEvent[]
}

export function groupEvents(events: readonly RunEvent[]): readonly EventGroup[] {
  const groups: EventGroup[] = []
  const nodes = new Map<string, EventGroup>()
  for (const event of events) {
    if (!event.kind.startsWith('node.') || !('executionId' in event.payload)) {
      groups.push({ key: `event:${event.sequence}`, node: false, events: [event] })
      continue
    }
    const key = JSON.stringify([event.payload.scopeId, event.payload.nodeId, event.payload.executionId])
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

export function toolRows(events: readonly RunEvent[], agent: boolean): readonly (readonly RunEvent[])[] {
  const rows: RunEvent[][] = []
  const calls = new Map<string, RunEvent[]>()
  for (const event of events) {
    const log = agent ? agentLog(event) : undefined
    if (log?.kind != 'tool') {
      rows.push([event])
      continue
    }
    const id = String(log.callId)
    let row = calls.get(id)
    if (row == null) {
      row = []
      calls.set(id, row)
      rows.push(row)
    }
    row.push(event)
  }
  return rows
}

export function agentSummary(event: RunEvent, t: TFunction): string | undefined {
  const log = agentLog(event)
  if (log == null) return
  if (log.kind == 'model') return t('run.agentRound', { round: Number(log.round) })
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
