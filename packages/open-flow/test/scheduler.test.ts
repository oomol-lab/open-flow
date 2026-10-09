import type { FlowRunOptions, SchedulerEvent, TaskInvocation } from '../src/execution/common/scheduler.ts'
import type { WaitAction, ConditionOperator, JsonValue, RevisionContent } from '../src/flow/common/change.ts'
import type { PreparedFlow } from '../src/flow/common/semantics.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { describe, expect, it } from 'vitest'
import { currentEngineContract } from '../src/execution/common/runtime.ts'
import { decodeFlowRunCheckpoint, runFlow as scheduleFlow } from '../src/execution/common/scheduler.ts'
import { prepareFlow as prepareRevision } from '../src/flow/common/semantics.ts'
import { advanceWaiting, waitHost } from './waitHost.ts'

const port = { jsonSchema: {}, nullable: false } as const
const engine = currentEngineContract
const connectorConnectionRequired = 'connector.connection-required'
const connectorUnavailable = 'connector.unavailable'
let nextId = 0

async function runOutcome(prepared: PreparedFlow, options: Omit<FlowRunOptions, 'createId' | 'flowId'> & { readonly decision?: WaitAction }) {
  const { bindingValues, inputs, resume, trigger, decision, ...rest } = options
  const waits = resume == null ? waitHost() : waitHost({ [decodeFlowRunCheckpoint(resume.checkpoint).waits[0]!.waitId]: decision ?? 'continue' })
  const execute = Object.values(prepared.graph.nodes).some((node) => node.kind == 'approval' || node.kind == 'wait') ? advanceWaiting : Effect.runPromise
  return await execute(
    scheduleFlow(prepared, {
      createId: () => `scheduler-${++nextId}`,
      flowId: 'main',
      projectFailure: (error) => {
        if (error instanceof TaskError) return { code: error.code, message: error.message }
        return { code: 'node.failed', message: error instanceof Error ? error.message : String(error) }
      },
      waits,
      ...rest,
      ...(resume == null ? { bindingValues, inputs, trigger: trigger ?? { nodeId: 'start', outputs: {} } } : { resume }),
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
    document: {
      ...document,
      graph: {
        nodes: { start: { kind: 'manual', name: 'Start' }, ...document.graph.nodes },
        edges: [
          ...document.graph.edges,
          ...Object.entries(document.graph.nodes)
            .filter(([id, node]) => 'inputs' in node && !document.graph.edges.some((edge) => edge.target == id))
            .map(([target]) => ({ source: 'start', target })),
        ],
      },
    },
    modelVersion: currentFlowModelVersion,
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
  it('reads each direct arrival, including Trigger and independent branches', async () => {
    const source = revision(
      {
        bindings: {},

        graph: {
          nodes: {
            left: { name: 'Left', kind: 'task', inputs: {}, task: task('left', [], ['value']) },
            right: { name: 'Right', kind: 'task', inputs: {}, task: task('right', [], ['value']) },
            sink: { name: 'Sink', kind: 'task', inputs: {}, task: task('sink', [], []) },
          },
          edges: [
            { source: 'left', target: 'sink' },
            { source: 'right', target: 'sink' },
          ],
        },
      },
      ['run'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const seen: unknown[] = []
    await runFlow(prepared, {
      runId: 'previous',
      emit: () => Effect.void,
      invokeTask: (invocation) =>
        Effect.sync(() => {
          if (!('moduleId' in invocation)) throw new Error('Expected Code')
          const previous = invocation.getPrevious()
          if (invocation.nodeId === 'sink') seen.push(previous)
          else expect(previous).toEqual({ id: 'start', name: 'Start', outputs: {}, outputDefs: [] })
          return invocation.nodeId === 'sink' ? {} : { value: invocation.nodeId }
        }),
    })
    expect(seen).toHaveLength(2)
    for (const id of ['left', 'right'])
      expect(seen).toContainEqual({
        id,
        name: id === 'left' ? 'Left' : 'Right',
        outputs: { value: id },
        outputDefs: [{ handle: 'value', ...port }],
      })
  })

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
    await runFlow(prepared, {
      invokeTask: (call) => {
        expect(call.input).toEqual({ token: null })
        return Effect.succeed({})
      },
      runId: 'run-variable-missing',
    })
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
      },
      ['capture'],
    )
    const prepared = await prepareFlow(source, 'main', engine)

    await expect(
      runFlow(prepared, {
        invokeTask: () => Effect.fail(new Error('Invalid Trigger input must not invoke a Task.')),
        runId: `run-invalid-trigger-${nodeId}`,
        trigger: { nodeId, outputs: { payload: null } },
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
              inputs: { event: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'incoming', output: 'body' }] } },
              kind: 'task',
              task: task('capture', ['event'], ['event']),
            },
            ignored: {
              inputs: { event: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'scheduled', output: 'scheduledAt' }] } },
              kind: 'task',
              task: task('ignored', ['event'], ['event']),
            },
            incoming: {
              bodyFields: [{ handle: 'action', jsonSchema: { type: 'string' }, nullable: false }],
              kind: 'webhook',
              method: 'POST',
              name: 'Incoming',
            },
            scheduled: { cronTimes: [{ type: 'every', unit: 'minute', value: 1 }], kind: 'cron', name: 'Scheduled' },
          },
        },
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
      trigger: { nodeId: 'incoming', outputs: { headers: {}, query: {}, body: { action: 'opened' }, webhookUrl: 'http://example.com/webhook' } },
    })

    expect(invoked).toEqual(['capture'])
    expect(result.nodes).toEqual([{ status: 'completed', jobId: expect.any(String), outputs: { event: { action: 'opened' } }, nodeId: 'capture' }])
    expect(events.filter((event) => 'nodeId' in event).every((event) => event.nodeId == 'capture')).toBe(true)

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
    expect(manual.nodes).toEqual([])
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
              inputDefinitions: [{ handle: 'value', jsonSchema: {}, nullable: true, value: null }],
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
      },
      ['after'],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const events: SchedulerEvent[] = []
    const invocations: TaskInvocation[] = []
    const first = await runOutcome(prepared, {
      bindingValues: { token: '' },
      emit: (event) => Effect.sync(() => void events.push(event)),
      invokeTask: () => Effect.fail(new Error('Downstream must not run before the Wait resolves.')),
      runId: 'run-wait',
    })

    expect(first.kind).toBe('waiting')
    if (first.kind != 'waiting') throw new Error('Expected the Flow Run to wait.')
    expect(first.checkpoint.results.start?.outputs).toEqual({})
    expect(first.checkpoint.waits[0]!).toMatchObject({ nodeId: 'wait' })
    expect(first.checkpoint.waits[0]!.waitId).toMatch(/^[A-Za-z0-9_-]{21}$/)
    expect(invocations).toEqual([])
    expect(decodeFlowRunCheckpoint(JSON.parse(JSON.stringify(first.checkpoint)))).toEqual(first.checkpoint)

    for (const launch of [{ bindingValues: { token: 'changed' } }, { inputs: {} }, { trigger: { nodeId: 'start', outputs: {} } }]) {
      const invalid = {
        createId: () => 'unused',
        flowId: 'main',
        runId: 'run-wait',
        invokeTask: () => Effect.fail(new Error('Invalid resume must not invoke a Task.')),
        resume: { checkpoint: first.checkpoint },
        ...launch,
      }
      // @ts-expect-error A resumed Run cannot accept new launch values.
      await expect(Effect.runPromise(scheduleFlow(prepared, invalid))).rejects.toThrow('cannot accept launch inputs')
    }
    const completed = await runOutcome(prepared, {
      emit: (event) => Effect.sync(() => void events.push(event)),
      invokeTask: (invocation) =>
        Effect.sync(() => {
          invocations.push(invocation)
          if ('moduleId' in invocation) {
            const previous = invocation.getPrevious()
            expect(previous?.id).toBe('wait')
            expect(previous?.outputs.continue).toEqual(decisionOutput('continue', { id: 42 }))
            expect(previous?.outputDefs.map((definition) => definition.handle)).toContain('pending')
          }
          return { result: invocation.input }
        }),
      resume: { checkpoint: JSON.parse(JSON.stringify(first.checkpoint)) },
      runId: 'run-wait',
    })

    expect(completed).toEqual({
      kind: 'node-results',
      nodes: [
        { status: 'completed', jobId: expect.any(String), outputs: { result: { token: '', value: decisionOutput('continue', { id: 42 }) } }, nodeId: 'after' },
      ],
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
                inputDefinitions: [{ handle: 'value', jsonSchema: {}, nullable: true, value: null }],
                inputs: {},
                kind: 'wait',
                prompt: 'Continue?',
              },
            },
          },
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
    expect(first.checkpoint.waits[0]!).toEqual({
      jobId: first.checkpoint.waits[0]!.jobId,
      nodeId: 'wait',
      value: { value: null },
      waitId: first.checkpoint.waits[0]!.waitId,
    })

    const resumed = await runOutcome(prepared, {
      runId: 'parallel-wait',
      resume: { checkpoint: first.checkpoint },
      invokeTask: () => Effect.fail(new Error('Completed siblings must not run again.')),
    })
    expect(resumed).toMatchObject({
      kind: 'node-results',
      nodes: [
        { nodeId: 'a', status: 'completed', outputs: { result: 42 } },
        { nodeId: 'wait', status: 'completed', outputs: { continue: decisionOutput('continue', null) } },
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
              inputDefinitions: [{ handle: 'value', jsonSchema: {}, nullable: true, value: null }],
              inputs: { value: { kind: 'value', value: 'request-1' } },
              kind: 'approval',
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
      decision: action,
      resume: { checkpoint: first.checkpoint },
      runId: `run-${action}`,
    })

    expect(completed.kind).toBe('node-results')
    expect(invoked).toEqual([action == 'approve' ? 'approved' : 'rejected'])
    expect(events.filter((event) => event.type == 'node.completed' && event.nodeId == 'wait')).toEqual([
      expect.objectContaining({ outputs: { [action]: decisionOutput(action, 'request-1') } }),
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
              inputDefinitions: [{ handle: 'value', jsonSchema: {}, nullable: true, value: null }],
              inputs: { value: { kind: 'value', value: 1 } },
              kind: 'wait',
              prompt: 'First wait',
            },
            second: {
              inputDefinitions: [{ handle: 'value', jsonSchema: {}, nullable: true, value: null }],
              inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'first', output: 'continue' }] } },
              kind: 'wait',
              prompt: 'Second wait',
            },
          },
        },
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
      resume: { checkpoint: first.checkpoint },
      runId: 'run-two-waits',
    })
    if (second.kind != 'waiting') throw new Error('Expected the second Wait.')
    const completed = await runOutcome(prepared, {
      emit,
      invokeTask: () => Effect.succeed({}),
      resume: { checkpoint: second.checkpoint },
      runId: 'run-two-waits',
    })

    expect(second.checkpoint.waits[0]!.nodeId).toBe('second')
    expect(second.checkpoint.waits[0]!.waitId).not.toBe(first.checkpoint.waits[0]!.waitId)
    expect(completed).toEqual({
      kind: 'node-results',
      nodes: [
        { status: 'completed', jobId: expect.any(String), outputs: { continue: decisionOutput('continue', decisionOutput('continue', 1)) }, nodeId: 'second' },
      ],
    })
    expect(events.filter((event) => event.type == 'run.started')).toHaveLength(1)
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
  ] satisfies readonly (readonly [ConditionOperator, JsonValue, JsonValue | undefined, boolean])[])(
    'evaluates Condition operator %s',
    async (operator, left, right, matches) => {
      const source = revision(
        {
          bindings: {},
          graph: {
            edges: [
              { source: 'branch', sourceHandle: 'otherwise', target: 'fallback' },
              { source: 'branch', sourceHandle: 'matched', target: 'matched' },
            ],
            nodes: {
              branch: {
                kind: 'condition',
                cases: [
                  {
                    output: 'matched',
                    groups: [
                      {
                        expressions: [
                          {
                            left: { kind: 'value' as const, value: left },
                            operator,
                            ...(right === undefined ? {} : { right: { kind: 'value', value: right } }),
                          },
                        ],
                      },
                    ],
                  },
                ],
                inputs: {},
                matchMode: 'first' as const,
              },
              fallback: {
                inputs: {},
                kind: 'task',
                task: task('fallback', ['value'], []),
              },
              matched: {
                inputs: {},
                kind: 'task',
                task: task('matched', ['value'], []),
              },
            },
          },
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
              kind: 'condition',
              cases: [
                {
                  output: 'all',
                  groups: [
                    {
                      expressions: [
                        { left: { kind: 'value' as const, value: true }, operator: 'isTrue' },
                        { left: { kind: 'value' as const, value: true }, operator: 'isFalse' },
                      ],
                    },
                  ],
                },
                {
                  output: 'any',
                  groups: [
                    { expressions: [{ left: { kind: 'value' as const, value: true }, operator: 'isFalse' }] },
                    { expressions: [{ left: { kind: 'value' as const, value: true }, operator: 'isTrue' }] },
                  ],
                },
                { output: 'later', groups: [{ expressions: [{ left: { kind: 'value' as const, value: true }, operator: 'isTrue' }] }] },
              ],
              inputs: {},
              matchMode: 'first' as const,
            },
            all: {
              inputs: {},
              kind: 'task',
              task: task('all', ['value'], []),
            },
            any: {
              inputs: {},
              kind: 'task',
              task: task('any', ['value'], []),
            },
            later: {
              inputs: {},
              kind: 'task',
              task: task('later', ['value'], []),
            },
          },
        },
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
  ] as const)('executes once per arrival with isolated inputs when %s is slower', async (slow, delay) => {
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
          expect(finished.length).toBe(calls + 1)
          expect(invocation.input).toEqual(finished.at(-1) == 'a' ? { a: 'a', b: null } : { a: null, b: 'b' })
          calls++
          return { seen: [invocation.input.a, invocation.input.b] }
        }),
    })
    expect(calls).toBe(2)
    expect(result.nodes[0]).toMatchObject({ status: 'completed', outputs: { seen: slow == 'a' ? ['a', null] : [null, 'b'] } })
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

  it('discards undeclared Connector outputs', async () => {
    const source = revision(
      {
        bindings: {},
        graph: {
          edges: [],
          nodes: {
            news: {
              inputs: {},
              kind: 'task',
              task: {
                executor: { action: 'hacker-news.get-latest-posts', kind: 'connector' },
                inputs: [],
                name: 'Get Latest Posts',
                outputs: [{ handle: 'posts', jsonSchema: { type: 'array' }, nullable: false }],
              },
            },
          },
        },
      },
      [],
    )
    const prepared = await prepareFlow(source, 'main', engine)
    const result = await runFlow(prepared, {
      invokeTask: () => Effect.succeed({ exhaustive: true, posts: [] }),
      runId: 'connector-extra-output',
    })

    expect(result.nodes).toEqual([{ jobId: expect.any(String), nodeId: 'news', outputs: { posts: [] }, status: 'completed' }])
    await expect(
      runFlow(prepared, {
        invokeTask: () => Effect.succeed({ posts: false }),
        runId: 'connector-invalid-output',
      }),
    ).rejects.toThrow('output "posts" does not match its declaration')
  })

  it('enforces timeout and Fiber interruption for each Task invocation', async () => {
    const source = revision(
      {
        bindings: {},
        graph: { edges: [], nodes: { slow: { inputs: {}, kind: 'task', task: task('slow', [], []), timeoutMs: 10 } } },
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
        { ...prepared, graph: { ...prepared.graph, nodes: { ...prepared.graph.nodes, slow: { ...slow, timeoutMs: undefined } } } },
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
          trigger: { nodeId: 'start', outputs: {} },
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
        graph: {
          edges: [],
          nodes: {
            task: {
              inputs: {},
              kind: 'task',
              task: {
                executor: { kind: 'llm', mode: 'chat' },
                inputs: [],
                name: 'Managed',
                outputs: [],
              },
            },
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

describe('port null normalization', () => {
  it.each([{}, { value: undefined }, { value: null }, undefined])('normalizes missing output in %j before declaration validation', async (returned) => {
    for (const nullable of [true, false]) {
      const prepared = await prepareFlow(
        revision(
          {
            bindings: {},

            graph: {
              edges: [{ source: 'source', target: 'consumer' }],
              nodes: {
                source: {
                  kind: 'task',
                  inputs: {},
                  task: { ...task('source', [], []), outputs: [{ handle: 'value', jsonSchema: { type: 'string' }, nullable }] },
                },
                consumer: {
                  kind: 'task',
                  inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'value' }] } },
                  task: { ...task('consumer', [], []), inputs: [{ handle: 'value', jsonSchema: { type: 'string' }, nullable: true }] },
                },
              },
            },
          },
          ['source'],
        ),
        'main',
        engine,
      )
      const events: SchedulerEvent[] = []
      const calls: string[] = []
      const running = runFlow(prepared, {
        runId: 'null-output',
        emit: (event) => Effect.sync(() => void events.push(event)),
        invokeTask: (call) => {
          calls.push(call.nodeId)
          if (call.nodeId == 'consumer') {
            expect(call.input).toEqual({ value: null })
            return Effect.succeed({})
          }
          // Exercise an in-process host returning an explicit undefined port before JSON transport.
          return Effect.succeed(returned as Readonly<Record<string, JsonValue>> | undefined)
        },
      })
      if (nullable) {
        await running
        expect(calls).toEqual(['source', 'consumer'])
        expect(events).toContainEqual(expect.objectContaining({ type: 'node.completed', nodeId: 'source', outputs: { value: null } }))
      } else {
        await expect(running).rejects.toThrow('does not match its declaration')
        expect(calls).toEqual(['source'])
        expect(events.some((event) => event.type == 'node.completed')).toBe(false)
      }
    }
  })

  it.each([null, 42, [], { value: { nested: undefined } }])('rejects invalid output containers and nested undefined: %j', async (returned) => {
    const prepared = await prepareFlow(
      revision(
        {
          bindings: {},

          graph: {
            edges: [],
            nodes: {
              source: { kind: 'task', inputs: {}, task: task('source', [], ['value']) },
            },
          },
        },
        ['source'],
      ),
      'main',
      engine,
    )
    await expect(runFlow(prepared, { runId: 'invalid-output', invokeTask: () => Effect.succeed(returned as JsonValue) })).rejects.toThrow()
  })

  it.each([true, false])('validates absent branch input with nullable=%s', async (nullable) => {
    const prepared = await prepareFlow(
      revision(
        {
          bindings: {},

          graph: {
            edges: [
              { source: 'choice', sourceHandle: 'yes', target: 'consumer' },
              { source: 'choice', sourceHandle: 'otherwise', target: 'skipped' },
              { source: 'skipped', target: 'consumer' },
            ],
            nodes: {
              skipped: { kind: 'value', inputs: {}, values: [{ handle: 'value', jsonSchema: { type: 'string' }, nullable: false, value: 'unused' }] },
              choice: {
                kind: 'condition',
                cases: [
                  {
                    output: 'yes',
                    groups: [
                      { expressions: [{ left: { kind: 'value' as const, value: 'yes' }, operator: '==', right: { kind: 'value' as const, value: 'yes' } }] },
                    ],
                  },
                ],
                inputs: {},
                matchMode: 'first' as const,
              },
              consumer: {
                kind: 'task',
                inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'skipped', output: 'value' }] } },
                task: { ...task('consumer', [], []), inputs: [{ handle: 'value', jsonSchema: { type: 'string' }, nullable }] },
              },
            },
          },
        },
        ['consumer'],
      ),
      'main',
      engine,
    )
    let invoked = false
    const running = runFlow(prepared, {
      runId: 'absent-branch',
      invokeTask: (call) => {
        invoked = true
        expect(call.input).toEqual({ value: null })
        return Effect.succeed({})
      },
    })
    if (nullable) await running
    else await expect(running).rejects.toThrow('does not match its declared schema')
    expect(invoked).toBe(nullable)
  })
})

it('validates formed Webhook outputs at launch and checkpoint recovery without projection', async () => {
  const source = revision(
    {
      bindings: {},

      graph: {
        nodes: {
          start: { kind: 'webhook', method: 'POST', name: 'Webhook', bodyFields: [] },
          wait: {
            kind: 'wait',
            prompt: 'Continue?',
            inputs: {},
            inputDefinitions: [{ handle: 'value', jsonSchema: {}, nullable: true, value: null }],
          },
        },
        edges: [{ source: 'start', target: 'wait' }],
      },
    },
    [],
  )
  const prepared = await prepareFlow(source, 'main', engine)
  const outputs = { headers: { test: 'original' }, query: { tag: ['a', 'b'] }, body: {}, webhookUrl: 'https://example.com/webhook' }
  const first = await runOutcome(prepared, { runId: 'webhook-checkpoint', trigger: { nodeId: 'start', outputs }, invokeTask: () => Effect.succeed({}) })
  if (first.kind !== 'waiting') throw new Error('Expected a checkpoint.')
  expect(first.checkpoint.version).toBe(5)
  expect(first.checkpoint.results.start?.outputs).toEqual(outputs)
  expect(() => decodeFlowRunCheckpoint({ ...first.checkpoint, version: 3 })).toThrow(/version/)
  const invalidOutputs: readonly Readonly<Record<string, JsonValue>>[] = [{ payload: outputs }, { ...outputs, webhookUrl: 2 }, { ...outputs, extra: null }]
  for (const invalid of invalidOutputs) {
    await expect(
      runOutcome(prepared, { runId: 'invalid', trigger: { nodeId: 'start', outputs: invalid }, invokeTask: () => Effect.succeed({}) }),
    ).rejects.toThrow('Trigger outputs are invalid')
    const checkpoint = { ...first.checkpoint, results: { ...first.checkpoint.results, start: { ...first.checkpoint.results.start!, outputs: invalid } } }
    await expect(runOutcome(prepared, { runId: 'invalid-resume', resume: { checkpoint }, invokeTask: () => Effect.succeed({}) })).rejects.toThrow(
      'Checkpoint Trigger output is invalid',
    )
  }
  expect(
    (await runOutcome(prepared, { runId: 'webhook-checkpoint', resume: { checkpoint: first.checkpoint }, invokeTask: () => Effect.succeed({}) })).kind,
  ).toBe('node-results')
})

function decisionOutput(action: 'continue' | 'approve' | 'reject', value: unknown) {
  return { inputs: { value }, action, resolvedAt: '2026-09-18T08:30:00.000Z', comment: null }
}

it.each([true, false])('does not execute with a cleared collection default (nullable=%s)', async (nullable) => {
  const source = revision(
    {
      bindings: {},

      graph: {
        edges: [],
        nodes: {
          capture: {
            kind: 'task',
            inputs: { value: { kind: 'unset' } },
            task: {
              ...task('capture', ['value'], []),
              inputs: [{ handle: 'value', jsonSchema: { type: 'object' }, nullable, value: { model: 'default' } }],
            },
          },
        },
      },
    },
    ['capture'],
  )
  const prepared = await prepareFlow(source, 'main', engine)
  const received: Readonly<Record<string, JsonValue>>[] = []
  const result = runFlow(prepared, {
    emit: () => Effect.void,
    invokeTask: (invocation) =>
      Effect.sync(() => {
        received.push(invocation.input)
        return {}
      }),
    runId: 'run-cleared',
  })
  if (nullable) await result
  else await expect(result).rejects.toThrow('does not match its declared schema')
  expect(received).toEqual(nullable ? [{ value: null }] : [])
})
