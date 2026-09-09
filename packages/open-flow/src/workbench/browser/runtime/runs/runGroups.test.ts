import { describe, expect, it } from 'vitest'
import { decodeRunEvent } from '../../../../control/common/api.ts'
import { agentLog, groupEvents, nodeSummary, toolRows } from './runGroups.ts'

function log(sequence: number, executionId: string, message: string, scopeId = 'root') {
  return decodeRunEvent({
    sequence,
    createdAt: '2026-09-09T00:00:00Z',
    kind: 'node.log',
    payload: { flowId: 'flow', scopeId, nodeId: 'agent', executionId, level: 'info', message },
  })
}

describe('execution log grouping', () => {
  it('groups interleaved logs by execution and scope without mixing repeated nodes', () => {
    const events = [log(1, 'a', 'one'), log(2, 'b', 'two'), log(3, 'a', 'three'), log(4, 'a', 'nested', 'child')]
    expect(groupEvents(events).map((group) => group.events.map((event) => event.sequence))).toEqual([[1, 3], [2], [4]])
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4])
  })
  it('retains flow waits separately from node logs', () => {
    const event = decodeRunEvent({ sequence: 2, createdAt: '2026-09-09T00:00:00Z', kind: 'run.events-truncated', payload: {} })
    expect(groupEvents([log(1, 'a', 'before'), event, log(3, 'a', 'after')]).map((group) => [group.node, group.events.length])).toEqual([
      [true, 2],
      [false, 1],
    ])
  })
  it('merges one tool call while preserving distinct calls and original detail events', () => {
    const event = (sequence: number, callId: string, status: string) => log(sequence, 'a', JSON.stringify({ kind: 'tool', callId, toolId: 'mail', status }))
    const events = [event(1, 'one', 'started'), event(2, 'two', 'started'), event(3, 'one', 'completed'), event(4, 'two', 'failed')]
    expect(toolRows(events, true).map((row) => row.map((item) => item.sequence))).toEqual([
      [1, 3],
      [2, 4],
    ])
    expect(toolRows(events, false)).toHaveLength(4)
  })
  it('keeps node status and call counts when filtering steps, without inventing a missing call duration', () => {
    const payload = { flowId: 'flow', scopeId: 'root', nodeId: 'agent', executionId: 'a' }
    const started = decodeRunEvent({ sequence: 1, createdAt: '2026-09-09T00:00:00Z', kind: 'node.started', payload: { ...payload, nodeKind: 'agent' } })
    const call = (sequence: number, status: string, createdAt: string) => ({
      ...log(sequence, 'a', JSON.stringify({ kind: 'tool', callId: 'one', toolId: 'mail', status })),
      createdAt,
    })
    const completed = decodeRunEvent({ sequence: 4, createdAt: '2026-09-09T00:00:10Z', kind: 'node.completed', payload: { ...payload, outputs: {} } })
    const events = [started, call(2, 'started', '2026-09-09T00:00:02Z'), call(3, 'completed', '2026-09-09T00:00:05Z'), completed]
    const summary = nodeSummary(events, new Set([2, 3]))
    expect(summary.terminal).toBe(completed)
    expect(summary.agent).toBe(true)
    expect(summary.elapsed).toBe(10_000)
    expect(summary.completedCalls).toBe(1)
    expect(summary.rows).toHaveLength(1)
    expect(summary.rows[0]?.seconds).toBe(3)
    expect(summary.rows[0]?.events.map((event) => event.sequence)).toEqual([2, 3])
    const filtered = nodeSummary(events, new Set([3]))
    expect(filtered.terminal).toBe(completed)
    expect(filtered.completedCalls).toBe(1)
    expect(filtered.rows[0]?.seconds).toBeUndefined()
  })
  it('leaves unrecognized and malformed logs as ordinary messages', () => {
    for (const message of ['not json', 'null', '{"kind":"tool"}', '{"kind":"model","round":"x"}']) expect(agentLog(log(1, 'a', message))).toBeUndefined()
  })
})
