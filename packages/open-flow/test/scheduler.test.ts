import type { FlowRunOptions, SchedulerEvent, TaskInvocation } from '../src/execution/common/scheduler.ts'
import type { ConditionOperator, JsonValue, RevisionContent } from '../src/flow/common/change.ts'
import type { PreparedFlow } from '../src/flow/common/semantics.ts'

import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { describe, expect, it } from 'vitest'
import { currentEngineContract } from '../src/execution/common/runtime.ts'
import { decodeFlowRunCheckpoint, runFlow as scheduleFlow } from '../src/execution/common/scheduler.ts'
import { prepareFlow as prepareRevision } from '../src/flow/common/semantics.ts'

const port = { jsonSchema: {}, nullable: false } as const
const engine = currentEngineContract
const connectorConnectionRequired = 'connector.connection-required'
const connectorUnavailable = 'connector.unavailable'
let nextId = 0

async function runOutcome(prepared: PreparedFlow, options: Omit<FlowRunOptions, 'createId' | 'flowId'>) {
  return await Effect.runPromise(
    scheduleFlow(prepared, {
      createId: () => `scheduler-${++nextId}`,
      flowId: 'main',
      projectFailure: (error) => {
        if (error instanceof TaskError) return { code: error.code, message: error.message }
        return { code: 'node.failed', message: error instanceof Error ? error.message : String(error) }
      },
      ...options,
    }),
  )
}

async function runFlow(prepared: PreparedFlow, options: Omit<FlowRunOptions, 'createId' | 'flowId'>) {
  const outcome = await runOutcome(prepared, options)
  if (outcome.kind != 'node-results') throw new Error('Expected the Flow Run to complete.')
  return outcome
}

async function prepareFlow(source: RevisionContent, _flowId: string, contract: string): Promise<PreparedFlow> {
  const result = await prepareRevision(source, contract)
  if (result.kind != 'prepared') throw new Error(`Flow preparation failed: ${result.kind}.`)
  return result.flow
}

class TaskError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function task(name: string, inputs: readonly string[], outputs: readonly string[]) {
  return {
    inputs: inputs.map((handle) => ({ handle, ...port })),
    moduleId: 'module-main',
    name,
    outputs: outputs.map((handle) => ({ handle, ...port })),
  }
}

function revision(document: RevisionContent['document'], exports: readonly string[]): RevisionContent {
  return {
    document,
    modelVersion: 1,
    modules: {
      'module-main': {
        imports: [],
        name: 'Main',
        source: `export default function ${exports[0] ?? 'run'}() { return {} }`,
      },
    },
  }
}

function waitForever(_invocation: TaskInvocation): Effect.Effect<never> {
  return Effect.never
}

describe('revision graph scheduler', () => {
  it('injects a Variable once without projecting it into node.started inputs', async () => {
    const source = revision(
      {
        bindings: { token: { kind: 'variable', target: 'TOKEN' } },
        graph: {
          edges: [],
          nodes: {
            capture: {
              inputs: { token: { kind: 'sources', sources: [{ bindingId: 'token', kind: 'binding' }] } },
              kind: 'task',
              task: task('capture', ['token'], []),
            },
          },
        },
        subflows: {},
        tasks: {},
      },
      ['capture'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const inputs: Readonly<Record<string, JsonValue>>[] = []
    const events: SchedulerEvent[] = []

    await runFlow(prepared, {
      bindingValues: { token: 'secret-value' },
      emit: (event) => Effect.sync(() => void events.push(event)),
      invokeTask: (invocation) =>
        Effect.sync(() => {
          inputs.push(invocation.input)
          return {}
        }),
      runId: 'run-variable',
    })

    expect(inputs).toEqual([{ token: 'secret-value' }])
    expect(events.find((event) => event.type == 'node.started')).toMatchObject({ inputs: {}, type: 'node.started' })
    await expect(runFlow(prepared, { invokeTask: () => Effect.succeed({}), runId: 'run-variable-missing' })).rejects.toThrow(
      'requires exactly one available source',
    )
  })

  it('injects the shared Run Variable snapshot into every Subflow invocation', async () => {
    const source = revision(
      {
        bindings: { token: { kind: 'variable', target: 'TOKEN' } },
        graph: {
          edges: [
            { source: 'first', target: 'worker' },
            { source: 'second', target: 'other' },
          ],
          nodes: {
            first: {
              inputs: {},
              kind: 'value',
              values: [{ handle: 'call', jsonSchema: {}, nullable: false, value: 1 }],
            },
            second: {
              inputs: {},
              kind: 'value',
              values: [{ handle: 'call', jsonSchema: {}, nullable: false, value: 2 }],
            },
            worker: {
              inputs: { call: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'first', output: 'call' }] } },
              kind: 'subflow',
              subflowId: 'worker',
            },
            other: {
              inputs: { call: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'second', output: 'call' }] } },
              kind: 'subflow',
              subflowId: 'worker',
            },
          },
        },
        subflows: {
          worker: {
            graph: {
              edges: [],
              nodes: {
                capture: {
                  inputs: {
                    call: { kind: 'sources', sources: [{ input: 'call', kind: 'flow' }] },
                    token: { kind: 'sources', sources: [{ bindingId: 'token', kind: 'binding' }] },
                  },
                  kind: 'task',
                  task: task('capture', ['call', 'token'], []),
                },
              },
            },
            inputs: [{ handle: 'call', jsonSchema: {}, nullable: false }],
            name: 'Worker',
            outputs: [],
          },
        },
        tasks: {},
      },
      ['capture'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const inputs: Readonly<Record<string, JsonValue>>[] = []

    await runFlow(prepared, {
      bindingValues: { token: 'shared' },
      invokeTask: (invocation) =>
        Effect.sync(() => {
          inputs.push(invocation.input)
          return {}
        }),
      runId: 'run-subflow-variable',
    })

    expect(inputs.toSorted((left, right) => Number(left.call) - Number(right.call))).toEqual([
      { call: 1, token: 'shared' },
      { call: 2, token: 'shared' },
    ])
  })

  it.each(['missing', 'capture'])('rejects Trigger input for non-Trigger node %s', async (nodeId) => {
    const source = revision(
      {
        bindings: {},
        graph: {
          edges: [],
          nodes: {
            capture: {
              inputs: {},
              kind: 'task',
              task: task('capture', [], []),
            },
          },
        },
        subflows: {},
        tasks: {},
      },
      ['capture'],
    )
    const prepared = await prepareFlow(source, 'main', engine)

    await expect(
      runFlow(prepared, {
        invokeTask: () => Effect.fail(new Error('Invalid Trigger input must not invoke a Task.')),
        runId: `run-invalid-trigger-${nodeId}`,
        trigger: { nodeId, payload: null },
      }),
    ).rejects.toThrow(`Node "${nodeId}" is not a TriggerNode`)
  })

  it('activates only the seeded Trigger downstream without scheduling Trigger nodes', async () => {
    const source = revision(
      {
        bindings: {},
        graph: {
          edges: [
            { source: 'incoming', target: 'capture' },
            { source: 'scheduled', target: 'ignored' },
          ],
          nodes: {
            capture: {
              inputs: { event: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'incoming', output: 'payload' }] } },
              kind: 'task',
              task: task('capture', ['event'], ['event']),
            },
            ignored: {
              inputs: { event: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'scheduled', output: 'payload' }] } },
              kind: 'task',
              task: task('ignored', ['event'], ['event']),
            },
            incoming: { inputsDef: [], kind: 'webhook', name: 'Incoming' },
            scheduled: { cronTimes: [{ type: 'every', unit: 'minute', value: 1 }], kind: 'cron', name: 'Scheduled' },
          },
        },
        subflows: {},
        tasks: {},
      },
      ['capture'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const invoked: string[] = []
    const events: SchedulerEvent[] = []
    const result = await runFlow(prepared, {
      emit: (event) => Effect.sync(() => void events.push(event)),
      invokeTask: (invocation) =>
        Effect.sync(() => {
          invoked.push(invocation.nodeId)
          return { event: invocation.input.event }
        }),
      runId: 'run-trigger',
      trigger: { nodeId: 'incoming', payload: { action: 'opened' } },
    })

    expect(invoked).toEqual(['capture'])
    expect(result.nodes).toEqual([
      { status: 'completed', jobId: expect.any(String), outputs: { event: { action: 'opened' } }, nodeId: 'capture' },
      { status: 'skipped', nodeId: 'ignored' },
    ])
    expect(events.some((event) => 'nodeId' in event && (event.nodeId == 'incoming' || event.nodeId == 'scheduled'))).toBe(false)

    invoked.length = 0
    const manual = await runFlow(prepared, {
      invokeTask: (invocation) =>
        Effect.sync(() => {
          invoked.push(invocation.nodeId)
          return { event: invocation.input.event }
        }),
      runId: 'run-manual',
    })
    expect(invoked).toEqual([])
    expect(manual.nodes).toEqual([
      { status: 'skipped', nodeId: 'capture' },
      { status: 'skipped', nodeId: 'ignored' },
    ])
  })

  it('emits Value node outputs without invoking a Task', async () => {
    const source = revision(
      {
        bindings: {},
        graph: {
          edges: [],
          nodes: {
            value: {
              inputs: {},
              kind: 'value',
              values: [
                { handle: 'count', jsonSchema: { type: 'number' }, nullable: false, value: 2 },
                { handle: 'label', jsonSchema: { type: 'string' }, nullable: false, value: 'ready' },
              ],
            },
          },
        },
        subflows: {},
        tasks: {},
      },
      [],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const events: SchedulerEvent[] = []
    const result = await runFlow(prepared, {
      emit: (event) => Effect.sync(() => void events.push(event)),
      invokeTask: () => Effect.fail(new Error('Value nodes must not invoke a Task.')),
      runId: 'run-value',
    })

    expect(result).toEqual({
      kind: 'node-results',
      nodes: [{ status: 'completed', jobId: expect.any(String), outputs: { count: 2, label: 'ready' }, nodeId: 'value' }],
    })
    expect(events).toContainEqual(expect.objectContaining({ nodeId: 'value', nodeKind: 'value', type: 'node.started' }))
  })

  it('pauses and resumes the same Run without replaying completed work', async () => {
    const source = revision(
      {
        bindings: { token: { kind: 'variable', target: 'TOKEN' } },
        graph: {
          edges: [
            { source: 'source', target: 'wait' },
            { source: 'wait', sourceHandle: 'continue', target: 'after' },
          ],
          nodes: {
            source: {
              inputs: {},
              kind: 'value',
              values: [{ handle: 'value', jsonSchema: {}, nullable: true, value: { id: 42 } }],
            },
            wait: {
              actions: ['continue'],

              input: { handle: 'value', jsonSchema: {}, nullable: true, value: null },
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'value' }] } },
              kind: 'wait',
              prompt: 'Continue processing?',
            },
            after: {
              inputs: {
                token: { kind: 'sources', sources: [{ bindingId: 'token', kind: 'binding' }] },
                value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'wait', output: 'continue' }] },
              },
              kind: 'task',
              task: task('after', ['token', 'value'], ['result']),
            },
          },
        },
        subflows: {},
        tasks: {},
      },
      ['after'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const events: SchedulerEvent[] = []
    const invocations: TaskInvocation[] = []
    const first = await runOutcome(prepared, {
      bindingValues: { token: '' },
      emit: (event) => Effect.sync(() => void events.push(event)),
      invokeTask: (invocation) =>
        Effect.sync(() => {
          invocations.push(invocation)
          return { result: invocation.input }
        }),
      runId: 'run-wait',
    })

    expect(first.kind).toBe('waiting')
    if (first.kind != 'waiting') throw new Error('Expected the Flow Run to wait.')
    expect(first.wait).toMatchObject({ actions: ['continue'], nodeId: 'wait' })
    expect(first.wait.waitId).toMatch(/^[A-Za-z0-9_-]{21}$/)
    expect(invocations).toEqual([])
    expect(decodeFlowRunCheckpoint(JSON.parse(JSON.stringify(first.checkpoint)))).toEqual(first.checkpoint)

    const completed = await runOutcome(prepared, {
      bindingValues: { token: 'changed' },
      emit: (event) => Effect.sync(() => void events.push(event)),
      invokeTask: (invocation) =>
        Effect.sync(() => {
          invocations.push(invocation)
          return { result: invocation.input }
        }),
      resume: { action: 'continue', checkpoint: JSON.parse(JSON.stringify(first.checkpoint)) },
      runId: 'run-wait',
    })

    expect(completed).toEqual({
      kind: 'node-results',
      nodes: [{ status: 'completed', jobId: expect.any(String), outputs: { result: { token: '', value: { id: 42 } } }, nodeId: 'after' }],
    })
    expect(invocations).toHaveLength(1)
    expect(events.filter((event) => event.type == 'run.started')).toHaveLength(1)
    expect(events.filter((event) => event.type == 'node.started' && event.nodeId == 'source')).toHaveLength(1)
    expect(events.filter((event) => event.type == 'node.started' && event.nodeId == 'wait')).toHaveLength(1)
    expect(events.filter((event) => event.type == 'node.completed' && event.nodeId == 'wait')).toHaveLength(1)
  })

  it('includes in-flight sibling results in the Wait checkpoint without replaying them', async () => {
    const prepared = await prepareFlow(
      revision(
        {
          bindings: {},
          graph: {
            edges: [],
            nodes: {
              a: { inputs: {}, kind: 'task', task: task('a', [], ['result']) },
              wait: {
                actions: ['continue'],
                input: { handle: 'value', jsonSchema: {}, nullable: true, value: null },
                inputs: {},
                kind: 'wait',
                prompt: 'Continue?',
              },
            },
          },
          subflows: {},
          tasks: {},
        },
        ['a'],
      ),
      'main',
      engine,
    )
    const waiting = await Effect.runPromise(Deferred.make<void>())
    const first = await runOutcome(prepared, {
      runId: 'parallel-wait',
      emit: (event) => (event.type == 'node.started' && event.nodeId == 'wait' ? Deferred.succeed(waiting, undefined).pipe(Effect.asVoid) : Effect.void),
      invokeTask: () => Deferred.await(waiting).pipe(Effect.as({ result: 42 })),
    })
    if (first.kind != 'waiting') throw new Error('Expected the Flow Run to wait.')
    expect(first.checkpoint.results.a).toEqual({ jobId: expect.any(String), outputs: { result: 42 } })
    expect(first.checkpoint.wait).toEqual({ jobId: first.wait.jobId, nodeId: 'wait', value: null, waitId: first.wait.waitId })

    const resumed = await runOutcome(prepared, {
      runId: 'parallel-wait',
      resume: { action: 'continue', checkpoint: first.checkpoint },
      invokeTask: () => Effect.fail(new Error('Completed siblings must not run again.')),
    })
    expect(resumed).toMatchObject({
      kind: 'node-results',
      nodes: [
        { nodeId: 'a', status: 'completed', outputs: { result: 42 } },
        { nodeId: 'wait', status: 'completed', outputs: { continue: null } },
      ],
    })
  })

  it.each(['approve', 'reject'] as const)('routes only the selected Approval action: %s', async (action) => {
    const source = revision(
      {
        bindings: {},
        graph: {
          edges: [
            { source: 'wait', sourceHandle: 'approve', target: 'approved' },
            { source: 'wait', sourceHandle: 'reject', target: 'rejected' },
          ],
          nodes: {
            wait: {
              actions: ['approve', 'reject'],

              input: { handle: 'value', jsonSchema: {}, nullable: true, value: null },
              inputs: { value: { kind: 'value', value: 'request-1' } },
              kind: 'wait',
              prompt: 'Approve this request?',
            },
            approved: {
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'wait', output: 'approve' }] } },
              kind: 'task',
              task: task('approved', ['value'], []),
            },
            rejected: {
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'wait', output: 'reject' }] } },
              kind: 'task',
              task: task('rejected', ['value'], []),
            },
          },
        },
        subflows: {},
        tasks: {},
      },
      ['approved', 'rejected'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const invoked: string[] = []
    const events: SchedulerEvent[] = []
    const first = await runOutcome(prepared, {
      emit: (event) => Effect.sync(() => void events.push(event)),
      invokeTask: () => Effect.fail(new Error('Approval branches must not run before resolution.')),
      runId: `run-${action}`,
    })
    if (first.kind != 'waiting') throw new Error('Expected the Flow Run to wait.')

    const completed = await runOutcome(prepared, {
      emit: (event) => Effect.sync(() => void events.push(event)),
      invokeTask: (invocation) =>
        Effect.sync(() => {
          invoked.push(invocation.nodeId)
          return {}
        }),
      resume: { action, checkpoint: first.checkpoint },
      runId: `run-${action}`,
    })

    expect(completed.kind).toBe('node-results')
    expect(invoked).toEqual([action == 'approve' ? 'approved' : 'rejected'])
    expect(events.filter((event) => event.type == 'node.completed' && event.nodeId == 'wait')).toEqual([
      expect.objectContaining({ outputs: { [action]: 'request-1' } }),
    ])
  })

  it('creates a new identity for each sequential Wait in one Run', async () => {
    const source = revision(
      {
        bindings: {},
        graph: {
          edges: [{ source: 'first', sourceHandle: 'continue', target: 'second' }],
          nodes: {
            first: {
              actions: ['continue'],

              input: { handle: 'value', jsonSchema: {}, nullable: true, value: null },
              inputs: { value: { kind: 'value', value: 1 } },
              kind: 'wait',
              prompt: 'First wait',
            },
            second: {
              actions: ['continue'],

              input: { handle: 'value', jsonSchema: {}, nullable: true, value: null },
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'first', output: 'continue' }] } },
              kind: 'wait',
              prompt: 'Second wait',
            },
          },
        },
        subflows: {},
        tasks: {},
      },
      [],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const events: SchedulerEvent[] = []
    const emit = (event: SchedulerEvent) => Effect.sync(() => void events.push(event))
    const first = await runOutcome(prepared, { emit, invokeTask: () => Effect.succeed({}), runId: 'run-two-waits' })
    if (first.kind != 'waiting') throw new Error('Expected the first Wait.')
    const second = await runOutcome(prepared, {
      emit,
      invokeTask: () => Effect.succeed({}),
      resume: { action: 'continue', checkpoint: first.checkpoint },
      runId: 'run-two-waits',
    })
    if (second.kind != 'waiting') throw new Error('Expected the second Wait.')
    const completed = await runOutcome(prepared, {
      emit,
      invokeTask: () => Effect.succeed({}),
      resume: { action: 'continue', checkpoint: second.checkpoint },
      runId: 'run-two-waits',
    })

    expect(second.wait.nodeId).toBe('second')
    expect(second.wait.waitId).not.toBe(first.wait.waitId)
    expect(completed).toEqual({ kind: 'node-results', nodes: [{ status: 'completed', jobId: expect.any(String), outputs: { continue: 1 }, nodeId: 'second' }] })
    expect(events.filter((event) => event.type == 'run.started')).toHaveLength(1)
  })

  it('routes first-match Conditions through nested Subflows and preserves empty branches', async () => {
    const source = revision(
      {
        bindings: {},
        graph: {
          edges: [
            { source: 'source', target: 'branch' },
            { source: 'branch', sourceHandle: 'high', target: 'nested' },
            { source: 'branch', sourceHandle: 'low', target: 'low' },
          ],
          nodes: {
            source: {
              inputs: {},
              kind: 'task',
              task: task('source', ['value'], ['value']),
            },
            branch: {
              cases: [{ expressions: [{ input: 'value', operator: '>', value: 5 }], output: 'high', relation: 'all' }],

              defaultOutput: 'low',
              input: { ...port, handle: 'value' },
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'value' }] } },
              kind: 'condition',
            },
            nested: {
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'branch', output: 'high' }] } },
              kind: 'subflow',
              subflowId: 'double-flow',
            },
            low: {
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'branch', output: 'low' }] } },
              kind: 'task',
              task: task('low', ['value'], ['value']),
            },
          },
        },
        subflows: {
          'double-flow': {
            graph: {
              edges: [],
              nodes: {
                double: {
                  inputs: { value: { kind: 'sources', sources: [{ input: 'value', kind: 'flow' }] } },
                  kind: 'task',
                  task: task('double', ['value'], ['value']),
                },
              },
            },
            inputs: [{ ...port, handle: 'value' }],
            name: 'Double',
            outputs: [{ ...port, handle: 'value', sources: [{ kind: 'node', nodeId: 'double', output: 'value' }] }],
          },
        },
        tasks: {},
      },
      ['double', 'low', 'source'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const events: SchedulerEvent[] = []
    const invoked: string[] = []
    const result = await runFlow(prepared, {
      emit: (event) => Effect.sync(() => void events.push(event)),
      inputs: { source: { value: 7 } },
      invokeTask(invocation) {
        return Effect.sync(() => {
          invoked.push(invocation.nodeId)
          if (invocation.nodeId == 'source') return { value: invocation.input.value }
          if (invocation.nodeId == 'double') return { value: (invocation.input.value as number) * 2 }
          return { value: 'low' }
        })
      },
      runId: 'run-condition',
    })

    expect(invoked).toEqual(['source', 'double'])
    expect(result).toEqual({
      kind: 'node-results',
      nodes: [
        { status: 'skipped', nodeId: 'low' },
        { status: 'completed', jobId: expect.any(String), outputs: { value: 14 }, nodeId: 'nested' },
      ],
    })
    expect(events.filter((event) => event.type == 'run.started').map((event) => event.flowId)).toEqual(['main', 'double-flow'])
    expect(events).toContainEqual(expect.objectContaining({ nodeId: 'branch', type: 'node.completed', outputs: { high: 7 } }))
  })

  it('passes a Subflow input directly to a Subflow output', async () => {
    const source = revision(
      {
        bindings: {},
        graph: {
          edges: [{ source: 'source', target: 'nested' }],
          nodes: {
            source: { inputs: {}, kind: 'task', task: task('source', [], ['value']) },
            nested: {
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'value' }] } },
              kind: 'subflow',
              subflowId: 'passthrough',
            },
          },
        },
        subflows: {
          passthrough: {
            graph: { edges: [], nodes: {} },
            inputs: [{ ...port, handle: 'value' }],
            name: 'Passthrough',
            outputs: [{ ...port, handle: 'value', sources: [{ input: 'value', kind: 'flow' }] }],
          },
        },
        tasks: {},
      },
      ['source'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const result = await runFlow(prepared, {
      invokeTask: () => Effect.succeed({ value: 42 }),
      runId: 'run-passthrough',
    })

    expect(result.nodes).toEqual([{ status: 'completed', jobId: expect.any(String), outputs: { value: 42 }, nodeId: 'nested' }])
  })

  it.each([
    ['==', { nested: [1] }, { nested: [1] }, true],
    ['==', { nested: [1] }, { nested: [2] }, false],
    ['!=', { nested: [1] }, { nested: [2] }, true],
    ['>', 2, 1, true],
    ['>=', 2, 2, true],
    ['<', 1, 2, true],
    ['<=', 2, 2, true],
    ['contains', 'open-flow', 'flow', true],
    ['contains', ['open', { value: 1 }], { value: 1 }, true],
    ['notContains', ['open'], 'closed', true],
    ['startsWith', 'open-flow', 'open', true],
    ['endsWith', 'open-flow', 'flow', true],
    ['hasKey', { present: null }, 'present', true],
    ['notHasKey', { present: null }, 'missing', true],
    ['hasValue', { present: { value: 1 } }, { value: 1 }, true],
    ['notHasValue', { present: 1 }, 2, true],
    ['isEmpty', {}, undefined, true],
    ['isNotEmpty', [1], undefined, true],
    ['isNull', null, undefined, true],
    ['isNotNull', 0, undefined, true],
    ['isTrue', true, undefined, true],
    ['isFalse', false, undefined, true],
    ['contains', 1, 1, false],
    ['hasKey', { present: true }, 1, false],
    ['isNotEmpty', 1, undefined, false],
  ] satisfies readonly (readonly [ConditionOperator, JsonValue, JsonValue | undefined, boolean])[])(
    'evaluates Condition operator %s',
    async (operator, left, right, matches) => {
      const source = revision(
        {
          bindings: {},
          graph: {
            edges: [
              { source: 'branch', sourceHandle: 'fallback', target: 'fallback' },
              { source: 'branch', sourceHandle: 'matched', target: 'matched' },
            ],
            nodes: {
              branch: {
                cases: [
                  {
                    expressions: [{ input: 'value', operator, ...(right === undefined ? {} : { value: right }) }],
                    output: 'matched',
                    relation: 'all',
                  },
                ],

                defaultOutput: 'fallback',
                input: { ...port, handle: 'value' },
                inputs: { value: { kind: 'value', value: left } },
                kind: 'condition',
              },
              fallback: {
                inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'branch', output: 'fallback' }] } },
                kind: 'task',
                task: task('fallback', ['value'], []),
              },
              matched: {
                inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'branch', output: 'matched' }] } },
                kind: 'task',
                task: task('matched', ['value'], []),
              },
            },
          },
          subflows: {},
          tasks: {},
        },
        ['fallback', 'matched'],
      )
      const prepared = await prepareFlow(source, 'main', engine)
      const invoked: string[] = []
      await runFlow(prepared, {
        invokeTask: (invocation) =>
          Effect.sync(() => {
            invoked.push(invocation.nodeId)
            return {}
          }),
        runId: `condition-${operator}`,
      })

      expect(invoked).toEqual([matches ? 'matched' : 'fallback'])
    },
  )

  it('uses all and any relations while selecting only the first matching Condition case', async () => {
    const source = revision(
      {
        bindings: {},
        graph: {
          edges: [
            { source: 'branch', sourceHandle: 'all', target: 'all' },
            { source: 'branch', sourceHandle: 'any', target: 'any' },
            { source: 'branch', sourceHandle: 'later', target: 'later' },
          ],
          nodes: {
            branch: {
              cases: [
                {
                  expressions: [
                    { input: 'value', operator: 'isTrue' },
                    { input: 'value', operator: 'isFalse' },
                  ],
                  output: 'all',
                  relation: 'all',
                },
                {
                  expressions: [
                    { input: 'value', operator: 'isFalse' },
                    { input: 'value', operator: 'isTrue' },
                  ],
                  output: 'any',
                  relation: 'any',
                },
                { expressions: [{ input: 'value', operator: 'isTrue' }], output: 'later', relation: 'all' },
              ],

              defaultOutput: 'fallback',
              input: { ...port, handle: 'value' },
              inputs: { value: { kind: 'value', value: true } },
              kind: 'condition',
            },
            all: {
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'branch', output: 'all' }] } },
              kind: 'task',
              task: task('all', ['value'], []),
            },
            any: {
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'branch', output: 'any' }] } },
              kind: 'task',
              task: task('any', ['value'], []),
            },
            later: {
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'branch', output: 'later' }] } },
              kind: 'task',
              task: task('later', ['value'], []),
            },
          },
        },
        subflows: {},
        tasks: {},
      },
      ['all', 'any', 'later'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const invoked: string[] = []
    await runFlow(prepared, {
      invokeTask: (invocation) =>
        Effect.sync(() => {
          invoked.push(invocation.nodeId)
          return {}
        }),
      runId: 'condition-relations',
    })

    expect(invoked).toEqual(['any'])
  })

  it.each([
    ['a', 20],
    ['b', 20],
  ] as const)('waits for both parallel predecessors when %s is slower', async (slow, delay) => {
    const source = revision(
      {
        bindings: {},
        graph: {
          edges: [
            { source: 'a', target: 'collect' },
            { source: 'b', target: 'collect' },
          ],
          nodes: {
            a: { inputs: {}, kind: 'task', task: task('a', [], ['item']) },
            b: { inputs: {}, kind: 'task', task: task('b', [], ['item']) },
            collect: {
              inputs: {
                a: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'a', output: 'item' }] },
                b: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'b', output: 'item' }] },
              },
              kind: 'task',
              task: task('collect', ['a', 'b'], ['seen']),
            },
          },
        },
        subflows: {},
        tasks: {},
      },
      ['a', 'b', 'collect'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const finished: string[] = []
    let calls = 0
    const result = await runFlow(prepared, {
      runId: 'parallel',
      invokeTask: (invocation) =>
        Effect.gen(function* () {
          if (invocation.nodeId != 'collect') {
            if (invocation.nodeId == slow) yield* Effect.sleep(delay)
            finished.push(invocation.nodeId)
            return { item: invocation.nodeId }
          }
          expect(finished.toSorted()).toEqual(['a', 'b'])
          calls++
          return { seen: [invocation.input.a, invocation.input.b] }
        }),
    })
    expect(calls).toBe(1)
    expect(result.nodes[0]).toMatchObject({ status: 'completed', outputs: { seen: ['a', 'b'] } })
  })

  it('publishes all final outputs in one completion before starting downstream work', async () => {
    const prepared = await prepareFlow(
      revision(
        {
          bindings: {},
          graph: {
            edges: [{ source: 'source', target: 'after' }],
            nodes: {
              source: { inputs: {}, kind: 'task', task: task('source', [], ['first', 'second']) },
              after: { inputs: {}, kind: 'task', task: task('after', [], []) },
            },
          },
          subflows: {},
          tasks: {},
        },
        ['source', 'after'],
      ),
      'main',
      engine,
    )
    const events: SchedulerEvent[] = []
    await runFlow(prepared, {
      runId: 'atomic-completion',
      emit: (event) => Effect.sync(() => void events.push(event)),
      invokeTask: (invocation) => Effect.succeed(invocation.nodeId == 'source' ? { first: 1, second: 2 } : {}),
    })
    const completed = events.filter((event) => event.type == 'node.completed')
    expect(completed).toEqual([
      expect.objectContaining({ nodeId: 'source', outputs: { first: 1, second: 2 } }),
      expect.objectContaining({ nodeId: 'after', outputs: {} }),
    ])
    expect(events.indexOf(completed[0]!)).toBeLessThan(events.findIndex((event) => event.type == 'node.started' && event.nodeId == 'after'))
  })

  it('rejects the entire final output before downstream execution if any field is invalid', async () => {
    const source = revision(
      {
        bindings: {},
        graph: {
          edges: [{ source: 'source', target: 'collect' }],
          nodes: {
            source: {
              inputs: {},
              kind: 'task',
              task: {
                ...task('source', [], ['item', 'count']),
                outputs: [
                  { ...port, handle: 'item' },
                  { handle: 'count', jsonSchema: { type: 'number' }, nullable: false },
                ],
              },
            },
            collect: { inputs: {}, kind: 'task', task: task('collect', [], []) },
          },
        },
        subflows: {},
        tasks: {},
      },
      ['source', 'collect'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const events: SchedulerEvent[] = []
    const calls: string[] = []
    await expect(
      runFlow(prepared, {
        runId: 'invalid-result',
        emit: (event) =>
          Effect.sync(() => {
            events.push(event)
          }),
        invokeTask: (invocation) =>
          Effect.sync(() => {
            calls.push(invocation.nodeId)
            return { item: 1, count: 'invalid' }
          }),
      }),
    ).rejects.toThrow('does not match its declaration')
    expect(calls).toEqual(['source'])
    expect(events.filter((event) => event.type == 'node.completed')).toEqual([])
  })

  it('enforces timeout and Fiber interruption for each Task invocation', async () => {
    const source = revision(
      {
        bindings: {},
        graph: { edges: [], nodes: { slow: { inputs: {}, kind: 'task', task: task('slow', [], []), timeoutMs: 10 } } },
        subflows: {},
        tasks: {},
      },
      ['slow'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const events: SchedulerEvent[] = []
    await expect(
      runFlow(prepared, {
        emit: (event) => Effect.sync(() => void events.push(event)),
        invokeTask: waitForever,
        runId: 'run-timeout',
      }),
    ).rejects.toThrow('timed out')
    expect(events.filter((event) => event.type == 'node.failed')).toHaveLength(1)
    expect(events.filter((event) => event.type == 'run.failed')).toHaveLength(1)

    const slow = prepared.graph.nodes.slow!
    if (!('inputs' in slow)) throw new Error('Fixture slow node must be executable.')
    let interrupted = false
    const canceled = Effect.runFork(
      scheduleFlow(
        { ...prepared, graph: { edges: [], nodes: { slow: { ...slow, timeoutMs: undefined } } } },
        {
          createId: () => `scheduler-${++nextId}`,
          flowId: 'main',
          invokeTask: () =>
            Effect.never.pipe(
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  interrupted = true
                }),
              ),
            ),
          runId: 'run-cancel',
        },
      ),
    )
    await Effect.runPromise(Fiber.interrupt(canceled))
    expect(interrupted).toBe(true)
  })

  it('interrupts sibling Tasks after the first Node failure', async () => {
    const source = revision(
      {
        bindings: {},
        graph: {
          edges: [],
          nodes: {
            fail: { inputs: {}, kind: 'task', task: task('fail', [], []) },
            slow: { inputs: {}, kind: 'task', task: task('slow', [], []) },
          },
        },
        subflows: {},
        tasks: {},
      },
      ['fail', 'slow'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const slowStarted = Deferred.makeUnsafe<void>()
    let slowAborted = false

    await expect(
      runFlow(prepared, {
        invokeTask: (invocation) =>
          invocation.nodeId == 'fail'
            ? Deferred.await(slowStarted).pipe(Effect.andThen(Effect.fail(new Error('first failed'))))
            : Effect.gen(function* () {
                yield* Deferred.succeed(slowStarted, undefined)
                return yield* Effect.never.pipe(
                  Effect.onInterrupt(() =>
                    Effect.sync(() => {
                      slowAborted = true
                    }),
                  ),
                )
              }),
        runId: 'run-sibling-failure',
      }),
    ).rejects.toThrow('first failed')
    expect(slowAborted).toBe(true)
  })

  it('fails the run when a Node fiber dies with a defect', async () => {
    const source = revision(
      {
        bindings: {},
        graph: { edges: [], nodes: { task: { inputs: {}, kind: 'task', task: task('task', [], []) } } },
        subflows: {},
        tasks: {},
      },
      ['task'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const events: SchedulerEvent[] = []

    await expect(
      runFlow(prepared, {
        emit: (event) => Effect.sync(() => void events.push(event)),
        invokeTask: () => Effect.die(new Error('Node fiber defect.')),
        runId: 'run-node-defect',
      }),
    ).rejects.toThrow('Node fiber defect.')
    expect(events.some((event) => event.type == 'run.completed')).toBe(false)
  })

  it.each([
    [connectorConnectionRequired, 'The selected Connector Connection must be reconnected or replaced.'],
    [connectorUnavailable, 'The Connector request could not be completed.'],
  ] as const)('preserves the managed Task failure category %s', async (code, message) => {
    const source = revision(
      {
        bindings: {},
        graph: { edges: [], nodes: { task: { inputs: {}, kind: 'task', taskId: 'task-main' } } },
        subflows: {},
        tasks: {
          'task-main': {
            executor: { kind: 'llm', mode: 'chat' },
            inputs: [],
            name: 'Managed',
            outputs: [],
          },
        },
      },
      ['run'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const events: SchedulerEvent[] = []

    await expect(
      runFlow(prepared, {
        emit: (event) => Effect.sync(() => void events.push(event)),
        invokeTask: () => Effect.fail(new TaskError(code, message)),
        runId: 'run-managed-failure',
      }),
    ).rejects.toMatchObject({ code })
    expect(events.find((event) => event.type == 'node.failed')).toMatchObject({ code, message, type: 'node.failed' })
  })
})
