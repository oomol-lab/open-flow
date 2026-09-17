import type { FlowRunOptions, SchedulerEvent, WaitRequest } from '../src/execution/common/scheduler.ts'
import type { Graph, GraphNode, RevisionContent, WaitAction } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { currentEngineContract } from '../src/execution/common/runtime.ts'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { decodeRevision, encodeRevision } from '../src/flow/common/encoding.ts'
import { prepareFlow } from '../src/flow/common/semantics.ts'
import { advanceWaiting, waitHost } from './waitHost.ts'

const port = { jsonSchema: {}, nullable: true }
const counter: GraphNode = {
  kind: 'task',
  inputs: { previous: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'counter', output: 'count' }] } },
  task: { name: 'Counter', moduleId: 'counter', inputs: [{ ...port, handle: 'previous' }], outputs: [{ ...port, handle: 'count' }] },
}
const pause: GraphNode = { kind: 'wait', inputs: {}, input: { ...port, handle: 'value', value: 42 }, prompt: 'Continue?' }
function revision(graph: Graph): RevisionContent {
  return {
    modelVersion: 2,
    modules: { counter: { name: 'Counter', imports: [], source: 'export default () => ({ count: 1 })' } },
    document: { bindings: {}, tasks: {}, subflows: {}, graph },
  }
}
async function prepare(source: RevisionContent) {
  const result = await prepareFlow(source, currentEngineContract)
  if (result.kind != 'prepared') throw new Error(JSON.stringify(result))
  return result.flow
}
function options(events: SchedulerEvent[] = []) {
  let id = 0
  return {
    flowId: 'flow',
    runId: 'run',
    createId: () => `job-${++id}`,
    trigger: { nodeId: 'start', outputs: {} },
    emit: (event: SchedulerEvent) =>
      Effect.sync(() => {
        events.push(event)
      }),
    invokeTask: (call: Parameters<FlowRunOptions['invokeTask']>[0]) => Effect.succeed({ count: Number(call.input.previous ?? 0) + 1 }),
  }
}

describe('Repeated node executions', () => {
  it.each([3, undefined])('stops self-feedback before exceeding the limit %s, with independent invocation identities', async (limit) => {
    const prepared = await prepare(
      revision({
        nodes: { start: { kind: 'manual', name: 'Start' }, counter: { ...counter, ...(limit == null ? {} : { maxExecutions: limit }) } },
        edges: [
          { source: 'start', target: 'counter' },
          { source: 'counter', target: 'counter' },
        ],
      }),
    )
    const events: SchedulerEvent[] = []
    await expect(Effect.runPromise(runFlow(prepared, options(events)))).rejects.toThrow(`maximum execution count (${limit ?? 1000})`)
    const completed = events.filter((event) => event.type == 'node.completed')
    expect(completed).toHaveLength(limit ?? 1000)
    expect(completed.at(-1)?.outputs).toEqual({ count: limit ?? 1000 })
    expect(new Set(completed.map((event) => event.jobId)).size).toBe(completed.length)
    expect(events.filter((event) => event.type == 'node.started')).toHaveLength(completed.length)
    expect(events.at(-1)?.type).toBe('run.failed')
  })

  it('follows a back edge with the preceding iteration value and exits through a condition', async () => {
    const prepared = await prepare(
      revision({
        nodes: {
          start: { kind: 'manual', name: 'Start' },
          counter,
          choose: {
            kind: 'condition',
            inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'counter', output: 'count' }] } },
            input: { ...port, handle: 'value' },
            cases: [{ output: 'again', relation: 'all', expressions: [{ input: 'value', operator: '<', value: 3 }] }],
            defaultOutput: 'done',
          },
          end: { kind: 'value', inputs: {}, values: [] },
        },
        edges: [
          { source: 'start', target: 'counter' },
          { source: 'counter', target: 'choose' },
          { source: 'choose', sourceHandle: 'again', target: 'counter' },
          { source: 'choose', sourceHandle: 'done', target: 'end' },
        ],
      }),
    )
    const events: SchedulerEvent[] = []
    const result = await Effect.runPromise(runFlow(prepared, options(events)))
    expect(
      events
        .filter((event) => event.type == 'node.completed')
        .filter((event) => event.nodeId == 'counter')
        .map((event) => event.outputs.count),
    ).toEqual([1, 2, 3])
    expect(result).toMatchObject({ kind: 'node-results', nodes: [{ nodeId: 'end' }] })
  })

  it('retains execution counts across repeated Wait checkpoints without counting resolutions again', async () => {
    const prepared = await prepare(
      revision({
        nodes: { start: { kind: 'manual', name: 'Start' }, pause: { ...pause, maxExecutions: 2 } },
        edges: [
          { source: 'start', target: 'pause' },
          { source: 'pause', sourceHandle: 'continue', target: 'pause' },
        ],
      }),
    )
    const config = options()
    const first = await advanceWaiting(runFlow(prepared, { ...config, waits: waitHost() }))
    if (first.kind != 'waiting') throw new Error('Expected first wait')
    expect(first.checkpoint.counts['']?.pause).toBe(1)
    const { trigger: _, ...resume } = config
    const second = await advanceWaiting(
      runFlow(prepared, {
        ...resume,
        resume: { checkpoint: JSON.parse(JSON.stringify(first.checkpoint)) },
        waits: waitHost({ [first.checkpoint.waits[0]!.waitId]: 'continue' }),
      }),
    )
    if (second.kind != 'waiting') throw new Error('Expected second wait')
    expect(second.checkpoint.counts['']?.pause).toBe(2)
    expect(second.checkpoint.waits[0]!.jobId).not.toBe(first.checkpoint.waits[0]!.jobId)
    await expect(
      Effect.runPromise(
        runFlow(prepared, { ...resume, resume: { checkpoint: second.checkpoint }, waits: waitHost({ [second.checkpoint.waits[0]!.waitId]: 'continue' }) }),
      ),
    ).rejects.toThrow('maximum execution count (2)')
    await expect(
      Effect.runPromise(runFlow(prepared, { ...resume, resume: { checkpoint: { ...second.checkpoint, counts: { '': { pause: 3 } } } }, waits: waitHost() })),
    ).rejects.toThrow('execution count')
  })

  it('restores two pending executions of one Wait independently with their original inputs', async () => {
    const prepared = await prepare(
      revision({
        nodes: {
          start: { kind: 'manual', name: 'Start' },
          a: { kind: 'value', inputs: {}, values: [{ ...port, handle: 'value', value: 'a' }] },
          b: { kind: 'value', inputs: {}, values: [{ ...port, handle: 'value', value: 'b' }] },
          pause: {
            ...pause,
            inputs: {
              value: {
                kind: 'sources',
                sources: [
                  { kind: 'node', nodeId: 'a', output: 'value' },
                  { kind: 'node', nodeId: 'b', output: 'value' },
                ],
              },
            },
          },
        },
        edges: [
          { source: 'start', target: 'a' },
          { source: 'start', target: 'b' },
          { source: 'a', target: 'pause' },
          { source: 'b', target: 'pause' },
        ],
      }),
    )
    const events: SchedulerEvent[] = []
    const config = options(events)
    const first = await advanceWaiting(runFlow(prepared, { ...config, waits: waitHost() }))
    if (first.kind != 'waiting') throw new Error('Expected waiting')
    expect(first.checkpoint.waits.map((wait) => wait.value).toSorted()).toEqual(['a', 'b'])
    const { trigger: _, ...resume } = config
    const [a, b] = first.checkpoint.waits
    const second = await advanceWaiting(
      runFlow(prepared, { ...resume, resume: { checkpoint: first.checkpoint }, waits: waitHost({ [a!.waitId]: 'continue' }) }),
    )
    if (second.kind != 'waiting') throw new Error('Expected remaining wait')
    expect(second.checkpoint.waits).toEqual([b])
    expect(second.checkpoint.counts['']?.pause).toBe(2)
    await Effect.runPromise(runFlow(prepared, { ...resume, resume: { checkpoint: second.checkpoint }, waits: waitHost({ [b!.waitId]: 'continue' }) }))
    const completed = events.filter((event) => event.type == 'node.completed').filter((event) => event.nodeId == 'pause')
    expect(completed.map((event) => event.outputs.continue).toSorted()).toEqual(['a', 'b'])
    expect(new Set(completed.map((event) => event.jobId)).size).toBe(2)
  })

  it('notifies once per Wait entry, never again on checkpoint recovery or resolution', async () => {
    const prepared = await prepare(
      revision({
        nodes: {
          start: { kind: 'manual', name: 'Start' },
          pause: { ...pause, kind: 'approval', maxExecutions: 2 },
          send: { kind: 'task', inputs: {}, task: { name: 'Send notification', moduleId: 'counter', inputs: [], outputs: [] } },
        },
        edges: [
          { source: 'start', target: 'pause' },
          { source: 'pause', sourceHandle: 'pending', target: 'send' },
          { source: 'pause', sourceHandle: 'approve', target: 'pause' },
        ],
      }),
    )
    const events: SchedulerEvent[] = []
    const requests: WaitRequest[] = []
    const decisions: Record<string, WaitAction> = {}
    const config = {
      ...options(events),
      invokeTask: () => Effect.succeed({}),
      waits: {
        ...waitHost(decisions),
        create: (request: WaitRequest) =>
          Effect.sync(() => {
            requests.push(request)
            return {
              value: request.value,
              prompt: request.prompt,
              actions: request.actions.map((action) => ({ action, url: `https://example.com/${request.waitId}/${action}` })),
              expiresAt: '2030-01-01T00:00:00.000Z',
            }
          }),
      },
    }
    const notifications = () => events.filter((event) => event.type == 'node.completed' && event.nodeId == 'send')
    const first = await advanceWaiting(runFlow(prepared, config))
    if (first.kind != 'waiting') throw new Error('Expected first wait')
    expect(requests).toHaveLength(1)
    expect(notifications()).toHaveLength(1)

    const { trigger: _, ...resume } = config
    const recovered = await advanceWaiting(runFlow(prepared, { ...resume, resume: { checkpoint: JSON.parse(JSON.stringify(first.checkpoint)) } }))
    if (recovered.kind != 'waiting') throw new Error('Expected recovered wait')
    expect(recovered.checkpoint.waits).toEqual(first.checkpoint.waits)
    expect(requests).toHaveLength(1)
    expect(notifications()).toHaveLength(1)

    decisions[requests[0]!.waitId] = 'approve'
    const second = await advanceWaiting(runFlow(prepared, { ...resume, resume: { checkpoint: recovered.checkpoint } }))
    if (second.kind != 'waiting') throw new Error('Expected next loop entry')
    expect(requests).toHaveLength(2)
    expect(requests[1]!.waitId).not.toBe(requests[0]!.waitId)
    expect(notifications()).toHaveLength(2)

    decisions[requests[1]!.waitId] = 'reject'
    const result = await Effect.runPromise(runFlow(prepared, { ...resume, resume: { checkpoint: second.checkpoint } }))
    expect(result.kind).toBe('node-results')
    expect(requests).toHaveLength(2)
    expect(notifications()).toHaveLength(2)
    expect(events.filter((event) => event.type == 'node.completed' && event.nodeId == 'pause')).toHaveLength(2)
  })

  it('shares the per-node budget across repeated calls of a Subflow in one Run', async () => {
    const source = revision({
      nodes: {
        start: { kind: 'manual', name: 'Start' },
        a: { kind: 'subflow', inputs: {}, subflowId: 'sub' },
        b: { kind: 'subflow', inputs: {}, subflowId: 'sub' },
      },
      edges: [
        { source: 'start', target: 'a' },
        { source: 'start', target: 'b' },
      ],
    })
    const prepared = await prepare({
      ...source,
      document: {
        ...source.document,
        subflows: {
          sub: { name: 'Sub', inputs: [], outputs: [], graph: { edges: [], nodes: { limited: { kind: 'value', inputs: {}, values: [], maxExecutions: 1 } } } },
        },
      },
    })
    await expect(Effect.runPromise(runFlow(prepared, options()))).rejects.toThrow('maximum execution count (1)')
  })
})

it('persists node limits and rejects invalid values at the revision boundary', () => {
  const source = revision({ edges: [], nodes: { pause: { ...pause, maxExecutions: 25 } } })
  expect(decodeRevision(encodeRevision(source))).toEqual(source)
  for (const maxExecutions of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => decodeRevision(encodeRevision(revision({ edges: [], nodes: { pause: { ...pause, maxExecutions } } })))).toThrow()
  }
})
