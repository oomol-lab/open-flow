import type { TaskCapability, Graph, JsonValue, WaitAction, WaitAutoContinue } from '../../flow/common/change.ts'
import type { NodeErrorData } from '../../flow/common/errorHandling.ts'
import type { PreparedFlow } from '../../flow/common/semantics.ts'
import type { WebhookResponseSnapshot } from '../../flow/common/webhookResponse.ts'
import type { PreviousNode } from '../../types/index.ts'
import type { FlowRunCheckpoint } from './checkpoint.ts'
import type { ExecutableNode, NodeResult } from './node-execution.ts'
import type { AgentCheckpoint } from './runtime.ts'

import * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as FiberSet from 'effect/FiberSet'
import * as Queue from 'effect/Queue'
import { nanoid } from 'nanoid'
import { isTriggerNode } from '../../flow/common/change.ts'
import { nodeInputMappings } from '../../flow/common/condition.ts'
import { nodeSystemOutputPorts, supportsNodeErrorHandling } from '../../flow/common/errorHandling.ts'
import { isResolutionNode, resolutionActions } from '../../flow/common/graph.ts'
import { waitAutoContinueAt as automaticDeadline } from '../../flow/common/wait.ts'
import { matchesTriggerOutputs, normalizeTriggerOutputs } from '../../trigger/common/contract.ts'
import { decodeFlowRunCheckpoint, validateCheckpoint } from './checkpoint.ts'
import { Dependencies } from './dependencies.ts'
import { projectExecutionId, sanitizeRuntimeErrorMessage } from './events.ts'
import { agentNotice, executeNode, NodeValidationError, nodeFailure, nodeTitle, resolveNodeInputs, usesPending, validateOutputs } from './node-execution.ts'
import { normalizeWaitComment as normalizeComment, withWaitNotificationMessage as notificationMessage } from './wait.ts'

export type { DependenciesCheckpoint } from './dependencies.ts'
export type { FlowRunCheckpoint, PendingWait, PendingWorkflowCall } from './checkpoint.ts'
export { decodeFlowRunCheckpoint } from './checkpoint.ts'
export { PortValidationError } from './node-execution.ts'

export const withWaitNotificationMessage: (value: JsonValue) => JsonValue = notificationMessage

export const normalizeWaitComment: (value?: string | null) => string | null = normalizeComment

export const waitAutoContinueAt: (config: WaitAutoContinue, waitingSince: number) => number = automaticDeadline

export interface WaitResolution {
  readonly action: WaitAction
  readonly resolvedAt: string
  readonly comment: string | null
}

export type SchedulerEvent =
  | {
      readonly flowId: string
      readonly parentJobId?: string
      readonly parentRunId?: string
      readonly runId: string
      readonly type: 'run.started'
    }
  | {
      readonly parentJobId?: string
      readonly parentRunId?: string
      readonly progress: number
      readonly runId: string
      readonly type: 'run.progress'
    }
  | {
      readonly inputs: Readonly<Record<string, JsonValue>>
      readonly jobId: string
      readonly nodeId: string
      readonly nodeKind:
        | 'agent'
        | 'approval'
        | 'condition'
        | 'connector'
        | 'decision'
        | 'javascript'
        | 'openapi'
        | 'llm'
        | 'value'
        | 'wait'
        | 'outputs'
        | 'workflow'
        | 'webhook-response'
      readonly nodeTitle?: string
      readonly runId: string
      readonly type: 'node.started'
    }
  | {
      readonly jobId: string
      readonly nodeId: string
      readonly outputs: Readonly<Record<string, JsonValue>>
      readonly runId: string
      readonly systemOutputs?: Readonly<Record<string, JsonValue>>
      readonly response?: WebhookResponseSnapshot
      readonly type: 'node.completed'
    }
  | {
      readonly code: string
      readonly jobId: string
      readonly message: string
      readonly nodeId: string
      readonly runId: string
      readonly handled?: true
      readonly systemOutputs?: Readonly<Record<string, JsonValue>>
      readonly type: 'node.failed'
    }
  | {
      readonly jobId: string
      readonly level: 'debug' | 'error' | 'info' | 'warn'
      readonly message: string
      readonly nodeId: string
      readonly runId: string
      readonly type: 'node.log'
    }
  | {
      readonly result: FlowRunResult
      readonly runId: string
      readonly type: 'run.completed'
    }
  | {
      readonly message: string
      readonly runId: string
      readonly type: 'run.failed'
      readonly failure?: Extract<SchedulerEvent, { readonly type: 'node.failed' }>
    }

export interface FlowRunResult {
  readonly kind: 'node-results'
  readonly outputs?: Readonly<Record<string, JsonValue>>
  readonly nodes: readonly {
    readonly nodeId: string
    readonly status: 'completed' | 'error-handled'
    readonly systemOutputs?: Readonly<Record<string, JsonValue>>
    readonly jobId: string
    readonly outputs: Readonly<Record<string, JsonValue>>
  }[]
}

export interface WaitRequest {
  readonly autoContinue?: WaitAutoContinue
  readonly jobId: string
  readonly nodeId: string
  readonly value: JsonValue
  readonly waitId: string
  readonly actions: readonly ['continue'] | readonly ['approve', 'reject']
  readonly prompt: string
  readonly notify: boolean
  readonly notification?: {
    readonly input: Readonly<Record<string, JsonValue>>
    readonly messageHandle: string
  }
}

export type WaitOperation =
  | { readonly kind: 'create'; readonly wait: WaitRequest }
  | { readonly kind: 'resolutions'; readonly waitIds: readonly string[]; readonly block: boolean }

export interface WaitHost {
  readonly create: (wait: WaitRequest) => Effect.Effect<JsonValue | undefined, Error>
  readonly resolutions: (waitIds: readonly string[], block: boolean) => Effect.Effect<Readonly<Record<string, WaitResolution>>, Error>
}

export const waitRetentionMs = 120_000

export type FlowRunOutcome =
  | FlowRunResult
  | {
      readonly checkpoint: FlowRunCheckpoint
      readonly kind: 'waiting'
      readonly remainingMs?: number
    }

interface TaskInvocationBase {
  readonly workflowRunId?: string
  readonly agent?: { readonly action: 'approve' | 'reject'; readonly checkpoint: AgentCheckpoint }
  readonly additionalInputs: Readonly<Record<string, JsonValue>>
  readonly blockId: string
  readonly flowId: string
  readonly input: Readonly<Record<string, JsonValue>>
  readonly invocationId: string
  readonly jobId: string
  readonly nodeId: string
  readonly runId: string
}

export type TaskInvocation = TaskInvocationBase &
  (
    | { readonly capabilities: readonly TaskCapability[]; readonly moduleId: string; readonly getPrevious: () => readonly PreviousNode[] }
    | { readonly kind: 'managed' }
  )

export interface TriggerSeed {
  readonly nodeId: string
  readonly outputs: Readonly<Record<string, JsonValue>>
}

export interface SchedulerFailure {
  /** Trusted execution classification; absent means retries are forbidden. */
  readonly retryable?: boolean
  readonly catchable?: boolean
  readonly code: string
  readonly message: string
}

export type FlowRunOptions = {
  readonly createId: () => string
  readonly emit?: (event: SchedulerEvent) => Effect.Effect<void, Error>
  readonly flowId: string
  readonly invokeTask: (invocation: TaskInvocation) => Effect.Effect<unknown, Error>
  readonly projectFailure?: (error: unknown) => SchedulerFailure
  readonly runId: string
  readonly waits?: WaitHost
  readonly remainingMs?: number
} & RunLaunch

export type RunLaunch =
  | {
      readonly bindingValues?: Readonly<Record<string, string>>
      readonly inputs?: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>
      readonly trigger: TriggerSeed
      readonly resume?: never
    }
  | {
      readonly resume: { readonly checkpoint: unknown }
      readonly bindingValues?: never
      readonly inputs?: never
      readonly trigger?: never
    }

interface RunGraph {
  readonly inputDefs: PreparedFlow['inputDefs']
  readonly outputDefs: PreparedFlow['outputDefs']
  readonly outputMappings: PreparedFlow['outputMappings']
  readonly flowId: string
  readonly graph: Graph
}

interface RunContext {
  readonly failures: WeakMap<Error, Extract<SchedulerEvent, { readonly type: 'node.failed' }>>
  readonly counts: Record<string, Record<string, number>>
  readonly bindingValues: Readonly<Record<string, string>>
  readonly createId: FlowRunOptions['createId']
  readonly emit: (event: SchedulerEvent) => Effect.Effect<void, Error>
  readonly invokeTask: FlowRunOptions['invokeTask']
  readonly prepared: PreparedFlow
  readonly projectFailure: FlowRunOptions['projectFailure']
  readonly waits: WaitHost | undefined
  readonly remainingMs: number | undefined
}

function runGraph(
  context: RunContext,
  target: RunGraph,
  runId: string,
  launchInputs: Readonly<Record<string, Readonly<Record<string, JsonValue>>>> = {},
  trigger?: TriggerSeed,
  resume?: { readonly checkpoint: FlowRunCheckpoint },
): Effect.Effect<FlowRunOutcome, Error> {
  return Effect.scoped(
    Effect.gen(function* () {
      if (resume == null) {
        yield* context.emit({
          flowId: target.flowId,
          runId,
          type: 'run.started',
        })
      }
      const order = Object.keys(target.graph.nodes).filter((id) => !isTriggerNode(target.graph.nodes[id]!))
      const outgoing = new Map<string, Graph['edges'][number][]>()
      for (const edge of target.graph.edges) {
        const targets = outgoing.get(edge.source) ?? []
        targets.push(edge)
        outgoing.set(edge.source, targets)
      }
      const resultNodes = order.filter((id) => !outgoing.has(id)).toSorted()
      const completed = new Map(Object.entries(resume?.checkpoint.results ?? {}))
      const counts = (context.counts[''] ??= {})
      const dependencies = new Dependencies(target.graph, resume?.checkpoint.dependencies)
      const launch = resume?.checkpoint.inputs ?? launchInputs
      if (resume == null) {
        if (trigger != null) {
          const node = target.graph.nodes[trigger.nodeId]
          if (node == null || !isTriggerNode(node) || !matchesTriggerOutputs(node, trigger.outputs)) throw new Error('Trigger outputs are invalid.')
        }
        for (const [id, node] of Object.entries(target.graph.nodes)) {
          if (!isTriggerNode(node)) continue
          if (trigger?.nodeId == id) completed.set(id, { jobId: id, outputs: trigger.outputs })
        }
      }
      const active = yield* FiberSet.make<void, Error>()
      const runNode = yield* FiberSet.runtime(active)()
      let firstCause: Cause.Cause<Error> | undefined
      let firstFailure: Error | undefined
      const pendingCalls = new Map((resume?.checkpoint.calls ?? []).map((call) => [call.jobId, call]))
      const pendingWaits = new Map((resume?.checkpoint.waits ?? []).map((wait) => [wait.jobId, wait]))
      const changes = yield* Queue.unbounded<void>()
      let remainingMs = context.remainingMs
      let measuredAt = yield* Clock.currentTimeMillis
      let idleSince: number | undefined
      const agents: Record<string, FlowRunCheckpoint['agents'][string]> = { ...resume?.checkpoint.agents }
      const resolveInputs = (nodeId: string, node: ExecutableNode) => resolveNodeInputs(nodeId, node, dependencies, context.bindingValues, launch[nodeId])
      const commit = (
        nodeId: string,
        jobId: string,
        outputs: Readonly<Record<string, JsonValue>>,
        releasedHandles: readonly string[] = Object.keys(outputs),
        failure?: SchedulerFailure,
        response?: WebhookResponseSnapshot,
      ) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            const node = target.graph.nodes[nodeId]!
            const systemOutputs =
              nodeSystemOutputPorts(node).error == null
                ? undefined
                : {
                    error:
                      failure == null
                        ? null
                        : ({
                            code: failure.code,
                            message: sanitizeRuntimeErrorMessage(failure.message),
                            nodeId,
                            nodeName: nodeTitle(node) ?? nodeId,
                            runId,
                            executionId: yield* Effect.tryPromise(() => projectExecutionId(runId, runId, jobId)),
                          } satisfies NodeErrorData),
                  }
            const system = systemOutputs == null ? {} : { systemOutputs }
            const handled = failure == null ? {} : { handled: true as const }
            yield* context.emit(
              failure == null
                ? { jobId, nodeId, outputs, runId, ...system, ...(response == null ? {} : { response }), type: 'node.completed' }
                : { ...failure, jobId, nodeId, runId, ...system, handled: true, type: 'node.failed' },
            )
            completed.set(nodeId, { jobId, outputs, ...system, ...handled })
            dependencies.release(nodeId, outputs, releasedHandles, true, systemOutputs)
          }),
        )
      const execute = (
        nodeId: string,
        node: ExecutableNode,
        jobId: string,
        nodeInputs: Readonly<Record<string, JsonValue>>,
        resolution?: 'approve' | 'reject',
      ) =>
        executeNode(context, {
          nodeId,
          node,
          jobId,
          nodeInputs,
          resolution,
          flowId: target.flowId,
          runId,
          graph: target.graph,
          dependencies,
          previousIds: dependencies.state.nodes[nodeId]!.previous,
          saved: agents[jobId],
          workflowRunId: pendingCalls.get(jobId)?.childRunId,
        })

      const createWait = (nodeId: string, jobId: string, value: JsonValue) =>
        Effect.gen(function* () {
          if (context.waits == null) return yield* Effect.fail(new Error('Wait host is unavailable.'))
          const node = target.graph.nodes[nodeId] as ExecutableNode
          const waitId = nanoid()
          const notify = isResolutionNode(node) && usesPending(target.graph, nodeId)
          const notification = yield* context.waits.create({
            jobId,
            nodeId,
            value,
            waitId,
            notify,
            ...(node.kind == 'wait' && node.autoContinue != null ? { autoContinue: node.autoContinue } : {}),
            actions: isResolutionNode(node) ? resolutionActions(node) : ['approve', 'reject'],
            prompt: isResolutionNode(node) ? node.prompt : JSON.stringify(value, null, 2),
            ...(isResolutionNode(node) ? {} : { notification: agentNotice(node, agents[jobId]!.input) }),
          })
          const pending = notification == null ? notification : withWaitNotificationMessage(notification)
          if (notify) {
            validateOutputs(nodeId, node, { pending: pending! })
            dependencies.release(nodeId, { pending: pending! }, ['pending'], false)
          }
          pendingWaits.set(jobId, { jobId, nodeId, value, waitId, ...(notify ? { pending: pending! } : {}) })
          yield* Queue.offer(changes, undefined)
        })
      const settleNode = (nodeId: string, jobId: string, result: NodeResult): Effect.Effect<void, Error> => {
        if (result.kind == 'calling') {
          pendingCalls.set(jobId, { jobId, nodeId, childRunId: result.childRunId, input: result.input })
          return Effect.void
        }
        pendingCalls.delete(jobId)
        if (result.kind == 'completed') {
          delete agents[jobId]
          return commit(nodeId, jobId, result.outputs, result.releasedHandles, undefined, result.response)
        }
        agents[jobId] = result.agent
        return createWait(nodeId, jobId, result.value)
      }

      const observe = (nodeId: string, jobId: string, effect: Effect.Effect<void, Error>) =>
        effect.pipe(
          Effect.catchDefect((error) => Effect.fail(error instanceof Error ? error : new Error(String(error)))),
          Effect.tapError((error) =>
            Effect.gen(function* () {
              const failure = { ...nodeFailure(error, context.projectFailure), jobId, nodeId, runId, type: 'node.failed' as const }
              if (!context.failures.has(error)) context.failures.set(error, failure)
              if (firstCause == null) {
                firstFailure = error
                firstCause = Cause.fail(error)
              }
              yield* context.emit(failure).pipe(Effect.ignore)
            }),
          ),
          Effect.tapCause((cause) =>
            Effect.sync(() => {
              firstCause ??= cause
            }),
          ),
        )
      const executeReady = (nodeId: string) => {
        if (firstCause != null) return
        const node = target.graph.nodes[nodeId]!
        if (isTriggerNode(node)) return
        const jobId = context.createId()
        const count = counts[nodeId] ?? 0
        const limit = node.maxExecutions ?? 1000
        if (count >= limit) {
          runNode(
            observe(nodeId, jobId, Effect.fail(new Error(`Node "${nodeId}" exceeded its maximum execution count (${limit}).`))).pipe(
              Effect.ensuring(Queue.offer(changes, undefined)),
            ),
          )
          return
        }
        counts[nodeId] = count + 1
        dependencies.begin(nodeId, jobId)
        runNode(
          observe(
            nodeId,
            jobId,
            Effect.gen(function* () {
              const compute = Effect.gen(function* () {
                const nodeInputs = yield* Effect.try({
                  try: () => resolveInputs(nodeId, node),
                  catch: (error) => new NodeValidationError('node.input-invalid', error),
                })
                if (isResolutionNode(node)) {
                  yield* context.emit({
                    inputs: Object.fromEntries(
                      Object.entries(nodeInputs).filter(([handle]) => {
                        const mapping = nodeInputMappings(node)[handle]
                        return mapping?.kind != 'sources' || mapping.sources.every((source) => source.kind != 'binding')
                      }),
                    ),
                    jobId,
                    nodeId,
                    nodeKind: node.kind,
                    ...(node.name == null ? {} : { nodeTitle: node.name }),
                    runId,
                    type: 'node.started',
                  })
                  yield* createWait(nodeId, jobId, nodeInputs)
                  return
                }
                return yield* execute(nodeId, node, jobId, nodeInputs)
              })
              const result = yield* compute.pipe(
                Effect.catch((error) => {
                  const failure = nodeFailure(error, context.projectFailure)
                  if (!supportsNodeErrorHandling(node) || node.onError != 'error' || failure.catchable !== true) return Effect.fail(error)
                  return commit(nodeId, jobId, {}, [], failure)
                }),
              )
              if (result != null) yield* settleNode(nodeId, jobId, result)
            }),
          ).pipe(Effect.ensuring(Queue.offer(changes, undefined))),
        )
      }
      if (resume != null) {
        yield* Effect.try({
          try: () => validateCheckpoint(target, resume.checkpoint, resolveInputs),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })
      }
      if (resume == null) {
        if (trigger != null) dependencies.start(trigger.nodeId, trigger.outputs)
      }

      const applyResolutions = (resolutions: Readonly<Record<string, WaitResolution>>, now: number) => {
        for (const saved of pendingWaits.values()) {
          const resolution = resolutions[saved.waitId]
          if (resolution == null) continue
          const { action, resolvedAt, comment } = resolution
          if (idleSince != null) {
            idleSince = undefined
            measuredAt = now
          }
          pendingWaits.delete(saved.jobId)
          const node = target.graph.nodes[saved.nodeId] as ExecutableNode
          runNode(
            observe(
              saved.nodeId,
              saved.jobId,
              Effect.gen(function* () {
                if (isResolutionNode(node)) {
                  if (!resolutionActions(node).some((candidate) => candidate == action))
                    return yield* Effect.fail(new Error('Resolution does not match node actions.'))
                  yield* commit(
                    saved.nodeId,
                    saved.jobId,
                    validateOutputs(saved.nodeId, node, {
                      ...(saved.pending == null ? {} : { pending: saved.pending }),
                      [action]: { inputs: saved.value, action, resolvedAt, comment },
                    }),
                    [action],
                  )
                } else {
                  if (action == 'continue') return yield* Effect.fail(new Error('Agent requires approve or reject.'))
                  yield* settleNode(saved.nodeId, saved.jobId, yield* execute(saved.nodeId, node, saved.jobId, agents[saved.jobId]!.input, action))
                }
              }),
            ).pipe(Effect.ensuring(Queue.offer(changes, undefined))),
          )
        }
      }
      while (true) {
        const now = yield* Clock.currentTimeMillis
        if (idleSince == null && remainingMs != null) remainingMs -= now - measuredAt
        measuredAt = now
        if (remainingMs != null && remainingMs <= 0) return yield* Effect.fail(new Error('Run exceeded its execution deadline.'))
        if (firstCause != null) {
          yield* FiberSet.clear(active)
          yield* context
            .emit({
              message: firstFailure?.message ?? 'Execution failed.',
              runId,
              type: 'run.failed',
              ...(firstFailure == null ? {} : { failure: context.failures.get(firstFailure) }),
            })
            .pipe(Effect.ignore)
          return yield* Effect.failCause(firstCause)
        }
        if (pendingWaits.size > 0 && context.waits != null)
          applyResolutions(
            yield* context.waits.resolutions(
              [...pendingWaits.values()].map((wait) => wait.waitId),
              false,
            ),
            now,
          )
        for (const call of pendingCalls.values()) {
          yield* observe(
            call.nodeId,
            call.jobId,
            Effect.gen(function* () {
              const result = yield* execute(call.nodeId, target.graph.nodes[call.nodeId] as ExecutableNode, call.jobId, call.input)
              yield* settleNode(call.nodeId, call.jobId, result)
            }),
          ).pipe(Effect.catch(() => Effect.void))
        }
        const ready = dependencies.ready()
        for (const nodeId of ready) executeReady(nodeId)
        const running = yield* FiberSet.size(active)
        if (firstCause != null) continue
        if (running == 0 && pendingWaits.size == 0 && pendingCalls.size == 0 && ready.length == 0) {
          if (dependencies.incomplete) return yield* Effect.fail(new Error('Execution graph contains unresolved dependencies.'))
          break
        }
        if (running > 0 || ready.length > 0) idleSince = undefined
        else idleSince ??= now
        const left = idleSince == null ? remainingMs : waitRetentionMs - (now - idleSince)
        if (idleSince != null && (left! <= 0 || pendingCalls.size > 0)) {
          const checkpoint: FlowRunCheckpoint = {
            bindingValues: context.bindingValues,
            inputs: launch,
            results: Object.fromEntries(completed),
            counts: context.counts,
            dependencies: dependencies.state,
            version: 6,
            agents,
            waits: [...pendingWaits.values()],
            ...(pendingCalls.size == 0 ? {} : { calls: [...pendingCalls.values()] }),
          }
          const encoded = JSON.stringify(checkpoint)
          if (new TextEncoder().encode(encoded).byteLength > 16 * 1024 * 1024) return yield* Effect.fail(new Error('Flow Run checkpoint exceeds 16 MiB.'))
          return { kind: 'waiting', checkpoint: decodeFlowRunCheckpoint(JSON.parse(encoded)), ...(remainingMs == null ? {} : { remainingMs }) }
        }
        const activity = Queue.take(changes).pipe(Effect.as({}))
        const decision =
          pendingWaits.size == 0 || context.waits == null
            ? Effect.never
            : context.waits.resolutions(
                [...pendingWaits.values()].map((wait) => wait.waitId),
                true,
              )
        let next = Effect.raceFirst(activity, decision)
        if (pendingCalls.size > 0) next = Effect.raceFirst(next, Effect.sleep(1000).pipe(Effect.as({})))
        if (left != null) next = Effect.raceFirst(next, Effect.sleep(Math.max(0, left)).pipe(Effect.as({})))
        const resolutions = yield* next
        applyResolutions(resolutions, yield* Clock.currentTimeMillis)
      }
      yield* context.emit({ progress: 100, runId, type: 'run.progress' })
      const outputNodeId = order.find((nodeId) => target.graph.nodes[nodeId]?.kind == 'outputs')
      const businessOutputs = outputNodeId == null ? undefined : completed.get(outputNodeId)?.outputs
      const result: FlowRunResult = {
        kind: 'node-results',
        ...(businessOutputs == null ? {} : { outputs: businessOutputs }),
        nodes: resultNodes.flatMap((nodeId) => {
          const saved = completed.get(nodeId)
          return saved == null
            ? []
            : [
                {
                  nodeId,
                  status: saved.handled ? ('error-handled' as const) : ('completed' as const),
                  jobId: saved.jobId,
                  outputs: saved.outputs,
                  ...(saved.systemOutputs == null ? {} : { systemOutputs: saved.systemOutputs }),
                },
              ]
        }),
      }
      yield* context.emit({ result, runId, type: 'run.completed' })
      return result
    }),
  )
}

export function runFlow(prepared: PreparedFlow, options: FlowRunOptions): Effect.Effect<FlowRunOutcome, Error> {
  const emit = options.emit ?? (() => Effect.void)
  const program = Effect.gen(function* () {
    if (options.resume != null && (options.inputs != null || options.trigger != null || options.bindingValues != null)) {
      return yield* Effect.fail(new Error('A resumed Flow Run cannot accept launch inputs, binding values, or a Trigger seed.'))
    }
    const decoded = options.resume == null ? undefined : decodeFlowRunCheckpoint(options.resume.checkpoint)
    const outputs = (nodeId: string, value: Readonly<Record<string, JsonValue>>) =>
      isResolutionNode(prepared.graph.nodes[nodeId]) && value.pending != null ? { ...value, pending: withWaitNotificationMessage(value.pending) } : value
    const checkpoint =
      decoded == null
        ? undefined
        : {
            ...decoded,
            results: Object.fromEntries(Object.entries(decoded.results).map(([id, result]) => [id, { ...result, outputs: outputs(id, result.outputs) }])),
            dependencies: {
              ...decoded.dependencies,
              nodes: Object.fromEntries(
                Object.entries(decoded.dependencies.nodes).map(([id, state]) => [
                  id,
                  {
                    ...state,
                    ...(state.output == null ? {} : { output: outputs(id, state.output) }),
                    input: Object.fromEntries(
                      Object.entries(state.input).map(([source, result]) => [source, { ...result, outputs: outputs(source, result.outputs) }]),
                    ),
                  },
                ]),
              ),
            },
            waits: decoded.waits.map((wait) => (wait.pending == null ? wait : Object.assign({}, wait, { pending: withWaitNotificationMessage(wait.pending) }))),
          }
    if (checkpoint != null && new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength > 16 * 1024 * 1024) {
      return yield* Effect.fail(new Error('Flow Run checkpoint exceeds 16 MiB.'))
    }
    if (checkpoint == null && options.trigger == null) {
      return yield* Effect.fail(new Error('A Flow Run requires a Trigger seed.'))
    }
    const triggerNode = options.trigger == null ? undefined : prepared.graph.nodes[options.trigger.nodeId]
    if (options.trigger != null && (triggerNode == null || !isTriggerNode(triggerNode))) {
      return yield* Effect.fail(new Error(`Node "${options.trigger.nodeId}" is not a TriggerNode in Flow "${options.flowId}".`))
    }
    const triggerOutputs = triggerNode == null || !isTriggerNode(triggerNode) ? undefined : normalizeTriggerOutputs(triggerNode, options.trigger!.outputs)
    if (options.trigger != null && triggerOutputs == null) return yield* Effect.fail(new Error('Trigger outputs are invalid.'))
    const trigger = options.trigger == null ? undefined : { nodeId: options.trigger.nodeId, outputs: triggerOutputs! }
    return yield* runGraph(
      {
        failures: new WeakMap(),
        counts: Object.fromEntries(Object.entries(checkpoint?.counts ?? {}).map(([scope, counts]) => [scope, { ...counts }])),
        bindingValues: checkpoint?.bindingValues ?? options.bindingValues ?? {},
        createId: options.createId,
        emit,
        invokeTask: options.invokeTask,
        prepared,
        projectFailure: options.projectFailure,
        waits: options.waits,
        remainingMs: options.remainingMs,
      },
      {
        flowId: options.flowId,
        graph: prepared.graph,
        inputDefs: prepared.inputDefs,
        outputDefs: prepared.outputDefs,
        outputMappings: prepared.outputMappings,
      },
      options.runId,
      options.inputs,
      trigger,
      checkpoint == null ? undefined : { checkpoint },
    )
  })
  return program
}
