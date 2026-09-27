import { describe, expect, it } from 'vitest'
import { decodeRunEvent } from '../../../../control/common/api.ts'
import { createI18n } from '../i18n.ts'
import { agentLog, agentSummary, groupEvents, executionOverview, continuesLog, savedToolResults } from './runGroups.ts'

function log(sequence: number, executionId: string, message: string, scopeId = 'root') {
  return decodeRunEvent({
    sequence,
    createdAt: '2026-09-09T00:00:00Z',
    kind: 'node.log',
    payload: { flowId: 'flow', scopeId, nodeId: 'agent', executionId, level: 'info', message },
  })
}

const node = (executionId: string, nodeId = 'agent', scopeId = 'root') => ({ executionId, nodeId, scopeId, flowId: 'flow' })

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
  it('keeps concurrent executions separate and prefers each terminal output', () => {
    const started = (sequence: number, executionId: string, scopeId = 'root') =>
      decodeRunEvent({
        sequence,
        createdAt: '2026-09-09T00:00:00Z',
        kind: 'node.started',
        payload: { ...node(executionId, 'agent', scopeId), nodeKind: 'agent' },
      })
    const completed = decodeRunEvent({
      sequence: 4,
      createdAt: '2026-09-09T00:00:01Z',
      kind: 'node.completed',
      payload: { ...node('b'), outputs: { answer: 42 } },
    })
    const events = [
      started(1, 'a'),
      started(2, 'b'),
      log(3, 'a', JSON.stringify({ kind: 'tool', callId: 'call', toolId: 'mail', status: 'completed' })),
      completed,
      started(5, 'a', 'child'),
    ]
    const overview = executionOverview(events, 'running')
    expect(overview.map(({ count, status }) => [count, status])).toEqual([
      [1, 'running'],
      [2, 'completed'],
      [1, 'running'],
    ])
    expect(overview[0]?.completedCalls).toBe(1)
    expect(overview[1]?.terminal).toBe(completed)
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5])
  })
  it('does not infer an instance wait from a receipt or a missing terminal event', () => {
    const started = decodeRunEvent({
      sequence: 1,
      createdAt: '2026-09-09T00:00:00Z',
      kind: 'node.started',
      payload: { executionId: 'a', nodeId: 'wait', scopeId: 'root', flowId: 'flow', nodeKind: 'wait' },
    })
    const waiting = decodeRunEvent({
      sequence: 2,
      createdAt: '2026-09-09T00:00:00Z',
      kind: 'wait.created',
      payload: { nodeId: 'wait', waitId: 'receipt', waitingSince: '2026-09-09T00:00:00Z', expiresAt: '2026-09-10T00:00:00Z' },
    })
    expect(executionOverview([started, waiting, log(3, 'notification', 'sending')], 'running').map((item) => item.status)).toEqual(['unknown', 'unknown'])
    expect(executionOverview([started], 'completed')[0]?.status).toBe('unknown')
    expect(executionOverview([log(1, 'a', 'history starts here')], 'running')[0]?.started).toBeUndefined()
  })
  it('only compacts consecutive ordinary logs with matching instance and severity', () => {
    const a = log(1, 'a', 'one')
    expect(continuesLog(log(2, 'a', 'two'), a)).toBe(true)
    expect(continuesLog(log(2, 'b', 'two'), a)).toBe(false)
    expect(continuesLog(log(2, 'a', 'two', 'child'), a)).toBe(false)
    expect(continuesLog(log(2, 'a', JSON.stringify({ kind: 'model', round: 1 })), a)).toBe(false)
    expect(continuesLog(a, undefined)).toBe(false)
  })
  it('leaves unrecognized and malformed logs as ordinary messages', () => {
    for (const message of [
      'not json',
      'null',
      '{"kind":"tool"}',
      '{"kind":"model","round":"x"}',
      '{"kind":"model-step","round":1,"finishReason":{}}',
      '{"kind":"model-tool","round":1,"status":"requested"}',
    ])
      expect(agentLog(log(1, 'a', message))).toBeUndefined()
  })
  it('explains model diagnostics while preserving unknown finish reasons and original details', () => {
    const t = createI18n('zh-CN').t
    const entries = [
      { kind: 'model-tool', round: 1, status: 'requested', callId: 'one', toolName: 'gmail.fetch_emails', input: '{}' },
      { kind: 'model-tool', round: 1, status: 'failed', callId: 'one', toolName: 'gmail.fetch_emails', error: 'Invalid arguments' },
      ...['tool-calls', 'stop', 'length', 'provider-specific', null].map((finishReason) => ({ kind: 'model-step', round: 1, finishReason })),
    ]
    const events = entries.map((entry, index) => log(index + 1, 'a', JSON.stringify(entry)))
    expect(events.map((event) => agentSummary(event, t))).toEqual([
      '模型请求调用 gmail.fetch_emails',
      'gmail.fetch_emails · 调用请求失败',
      '第 1 轮结束 · 工具调用',
      '第 1 轮结束 · 已返回回答',
      '第 1 轮结束 · 输出达到长度上限',
      '第 1 轮结束 · provider-specific',
      '第 1 轮结束',
    ])
    expect(events.map(agentLog)).toEqual(entries)
    const summary = executionOverview(events, 'running')[0]!
    expect(summary.completedCalls).toBe(0)
  })
})

it('keeps saved tool results attached to their exact execution and ignores invalid references', () => {
  const tool = (id: string, execution: string, scope = 'root', valid = true) =>
    log(
      1,
      execution,
      JSON.stringify({
        kind: 'tool',
        status: 'completed',
        callId: id,
        toolId: 'search',
        output: {
          kind: 'stored-result',
          result: {
            resultId: id,
            callId: valid ? id : 'mismatch',
            toolId: 'search',
            source: { kind: 'connector', action: 'search' },
            bytes: 20,
            digest: 'a'.repeat(64),
            createdAt: '2026-09-09T00:00:00Z',
          },
        },
      }),
      scope,
    )
  const first = tool('first', 'a')
  const events = [first, tool('second', 'b'), tool('nested', 'a', 'child'), first, tool('bad', 'a', 'root', false)]
  expect(executionOverview(events, 'running').map((group) => group.toolResults.map((result) => result.resultId))).toEqual([['first'], ['second'], ['nested']])
  expect(
    savedToolResults([log(1, 'a', '{"kind":"tool","status":"completed","callId":"x","toolId":"search","output":{"kind":"stored-result","result":{}}}')]),
  ).toEqual([])
})
