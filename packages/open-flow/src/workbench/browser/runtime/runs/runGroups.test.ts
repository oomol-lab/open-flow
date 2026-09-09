import { describe, expect, it } from 'vitest'
import { decodeRunEvent } from '../../../../control/common/api.ts'
import { agentLog, groupEvents, toolRows } from './runGroups.ts'

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
  it('leaves unrecognized and malformed logs as ordinary messages', () => {
    for (const message of ['not json', 'null', '{"kind":"tool"}', '{"kind":"model","round":"x"}']) expect(agentLog(log(1, 'a', message))).toBeUndefined()
  })
})
