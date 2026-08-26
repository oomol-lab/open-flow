import type { FlowRunOptions, SchedulerEvent, TaskInvocation } from '../src/execution/common/scheduler.ts'
import type { ConditionOperator, JsonValue, RevisionContent } from '../src/flow/common/change.ts'
import type { PreparedFlow } from '../src/flow/common/semantics.ts'

import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { describe, expect, it } from 'vitest'
import { currentEngineContract } from '../src/execution/common/runtime.ts'
import { runFlow as scheduleFlow } from '../src/execution/common/scheduler.ts'
import { prepareFlow as prepareRevision } from '../src/flow/common/semantics.ts'

const port = { jsonSchema: {}, nullable: false } as const
const engine = currentEngineContract
const connectorConnectionRequired = 'connector.connection-required'
const connectorUnavailable = 'connector.unavailable'
let nextId = 0

function runFlow(prepared: PreparedFlow, options: Omit<FlowRunOptions, 'createId' | 'flowId'>) {
  return Effect.runPromise(
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
  it.each(['missing', 'capture'])('rejects Trigger input for non-Trigger node %s', async (nodeId) => {
    const source = revision(
      {
        bindings: {},
        graph: {
          nodes: {
            capture: {
              concurrency: 1,
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
          nodes: {
            capture: {
              concurrency: 1,
              inputs: { event: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'incoming', output: 'payload' }] } },
              kind: 'task',
              task: task('capture', ['event'], ['event']),
            },
            ignored: {
              concurrency: 1,
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
      { jobs: [{ jobId: expect.any(String), outputs: { event: { action: 'opened' } } }], nodeId: 'capture' },
      { jobs: [], nodeId: 'ignored' },
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
      { jobs: [], nodeId: 'capture' },
      { jobs: [], nodeId: 'ignored' },
    ])
  })

  it('emits Value node outputs without invoking a Task', async () => {
    const source = revision(
      {
        bindings: {},
        graph: {
          nodes: {
            value: {
              concurrency: 1,
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
      nodes: [{ jobs: [{ jobId: expect.any(String), outputs: { count: 2, label: 'ready' } }], nodeId: 'value' }],
    })
    expect(events).toContainEqual(expect.objectContaining({ nodeId: 'value', nodeKind: 'value', type: 'node.started' }))
  })

  it('routes first-match Conditions through nested Subflows and preserves empty branches', async () => {
    const source = revision(
      {
        bindings: {},
        graph: {
          nodes: {
            source: {
              concurrency: 1,
              inputs: { value: { kind: 'value', value: 1 } },
              kind: 'task',
              task: task('source', ['value'], ['value']),
            },
            branch: {
              cases: [{ expressions: [{ input: 'value', operator: '>', value: 5 }], output: 'high', relation: 'all' }],
              concurrency: 1,
              defaultOutput: 'low',
              input: { ...port, handle: 'value' },
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'value' }] } },
              kind: 'condition',
            },
            nested: {
              concurrency: 1,
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'branch', output: 'high' }] } },
              kind: 'subflow',
              subflowId: 'double-flow',
            },
            low: {
              concurrency: 1,
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'branch', output: 'low' }] } },
              kind: 'task',
              task: task('low', ['value'], ['value']),
            },
          },
        },
        subflows: {
          'double-flow': {
            graph: {
              nodes: {
                double: {
                  concurrency: 1,
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
        { jobs: [], nodeId: 'low' },
        { jobs: [{ jobId: expect.any(String), outputs: { value: 14 } }], nodeId: 'nested' },
      ],
    })
    expect(events.filter((event) => event.type == 'run.started').map((event) => event.flowId)).toEqual(['main', 'double-flow'])
    expect(events).toContainEqual(expect.objectContaining({ handle: 'high', nodeId: 'branch', type: 'node.output', value: 7 }))
  })

  it('passes a Subflow input directly to a Subflow output', async () => {
    const source = revision(
      {
        bindings: {},
        graph: {
          nodes: {
            source: { concurrency: 1, inputs: {}, kind: 'task', task: task('source', [], ['value']) },
            nested: {
              concurrency: 1,
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'value' }] } },
              kind: 'subflow',
              subflowId: 'passthrough',
            },
          },
        },
        subflows: {
          passthrough: {
            graph: { nodes: {} },
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

    expect(result.nodes).toEqual([{ jobs: [{ jobId: expect.any(String), outputs: { value: 42 } }], nodeId: 'nested' }])
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
            nodes: {
              branch: {
                cases: [
                  {
                    expressions: [{ input: 'value', operator, ...(right === undefined ? {} : { value: right }) }],
                    output: 'matched',
                    relation: 'all',
                  },
                ],
                concurrency: 1,
                defaultOutput: 'fallback',
                input: { ...port, handle: 'value' },
                inputs: { value: { kind: 'value', value: left } },
                kind: 'condition',
              },
              fallback: {
                concurrency: 1,
                inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'branch', output: 'fallback' }] } },
                kind: 'task',
                task: task('fallback', ['value'], []),
              },
              matched: {
                concurrency: 1,
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
              concurrency: 1,
              defaultOutput: 'fallback',
              input: { ...port, handle: 'value' },
              inputs: { value: { kind: 'value', value: true } },
              kind: 'condition',
            },
            all: {
              concurrency: 1,
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'branch', output: 'all' }] } },
              kind: 'task',
              task: task('all', ['value'], []),
            },
            any: {
              concurrency: 1,
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'branch', output: 'any' }] } },
              kind: 'task',
              task: task('any', ['value'], []),
            },
            later: {
              concurrency: 1,
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

  it('queues multiple sources in delivery order while enforcing node concurrency', async () => {
    const source = revision(
      {
        bindings: {},
        graph: {
          nodes: {
            a: { concurrency: 1, inputs: {}, kind: 'task', task: task('a', [], ['item']) },
            b: { concurrency: 1, inputs: {}, kind: 'task', task: task('b', [], ['item']) },
            collect: {
              concurrency: 1,
              inputs: {
                item: {
                  kind: 'sources',
                  sources: [
                    { kind: 'node', nodeId: 'a', output: 'item' },
                    { kind: 'node', nodeId: 'b', output: 'item' },
                  ],
                },
              },
              kind: 'task',
              task: task('collect', ['item'], ['seen']),
            },
          },
        },
        subflows: {},
        tasks: {},
      },
      ['a', 'b', 'collect'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    let activeCollectors = 0
    let maximumCollectors = 0
    const seen: JsonValue[] = []
    const result = await runFlow(prepared, {
      invokeTask(invocation) {
        return Effect.gen(function* () {
          if (invocation.nodeId == 'a') {
            yield* Effect.sleep(20)
            return { item: 'a' }
          }
          if (invocation.nodeId == 'b') return { item: 'b' }
          activeCollectors += 1
          maximumCollectors = Math.max(maximumCollectors, activeCollectors)
          seen.push(invocation.input.item)
          yield* Effect.sleep(5)
          activeCollectors -= 1
          return { seen: invocation.input.item }
        })
      },
      runId: 'run-fifo',
    })

    expect(seen).toEqual(['b', 'a'])
    expect(maximumCollectors).toBe(1)
    expect(result.nodes).toEqual([
      {
        jobs: [
          { jobId: expect.any(String), outputs: { seen: 'b' } },
          { jobId: expect.any(String), outputs: { seen: 'a' } },
        ],
        nodeId: 'collect',
      },
    ])
  })

  it('enforces timeout and Fiber interruption for each Task invocation', async () => {
    const source = revision(
      {
        bindings: {},
        graph: { nodes: { slow: { concurrency: 1, inputs: {}, kind: 'task', task: task('slow', [], []), timeoutMs: 10 } } },
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
        { ...prepared, graph: { nodes: { slow: { ...slow, timeoutMs: undefined } } } },
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
          nodes: {
            fail: { concurrency: 1, inputs: {}, kind: 'task', task: task('fail', [], []) },
            slow: { concurrency: 1, inputs: {}, kind: 'task', task: task('slow', [], []) },
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
        graph: { nodes: { task: { concurrency: 1, inputs: {}, kind: 'task', task: task('task', [], []) } } },
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
        graph: { nodes: { task: { concurrency: 1, inputs: {}, kind: 'task', taskId: 'task-main' } } },
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
