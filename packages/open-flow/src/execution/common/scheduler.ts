import type * as Cause from 'effect/Cause'
import type { ConnectorCapability, Graph, GraphNode, InputPortDefinition, JsonValue, OutputMapping, TriggerNode } from '../../flow/common/change.ts'
import type { PreparedFlow } from '../../flow/common/semantics.ts'

import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FiberSet from 'effect/FiberSet'
import { portsByHandle } from '../../flow/common/change.ts'

type ExecutableNode = Exclude<GraphNode, TriggerNode>

interface ExecutableGraph {
  readonly nodes: Readonly<Record<string, ExecutableNode>>
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
      readonly nodeKind: 'condition' | 'connector' | 'javascript' | 'llm' | 'subflow' | 'value'
      readonly nodeTitle?: string
      readonly runId: string
      readonly type: 'node.started'
    }
  | {
      readonly handle: string
      readonly jobId: string
      readonly nodeId: string
      readonly runId: string
      readonly type: 'node.output'
      readonly value: JsonValue
    }
  | {
      readonly jobId: string
      readonly nodeId: string
      readonly runId: string
      readonly type: 'node.completed'
    }
  | {
      readonly code: string
      readonly jobId: string
      readonly message: string
      readonly nodeId: string
      readonly runId: string
      readonly type: 'node.failed'
    }
  | {
      readonly result: FlowRunResult | SubflowRunResult
      readonly runId: string
      readonly type: 'run.completed'
    }
  | {
      readonly message: string
      readonly runId: string
      readonly type: 'run.failed'
    }

export interface FlowRunResult {
  readonly kind: 'node-results'
  readonly nodes: readonly {
    readonly jobs: readonly {
      readonly jobId: string
      readonly outputs: Readonly<Record<string, JsonValue>>
    }[]
    readonly nodeId: string
  }[]
}

export interface SubflowRunResult {
  readonly kind: 'function-outputs'
  readonly outputs: Readonly<Record<string, JsonValue>>
  readonly target: 'subflow'
}

interface TaskInvocationBase {
  readonly input: Readonly<Record<string, JsonValue>>
  readonly invocationId: string
  readonly jobId: string
  readonly nodeId: string
  readonly runId: string
}

export type TaskInvocation = TaskInvocationBase &
  ({ readonly capabilities: readonly ConnectorCapability[]; readonly moduleId: string } | { readonly taskId: string })

export interface TriggerSeed {
  readonly nodeId: string
  readonly payload: JsonValue
}

export interface SchedulerFailure {
  readonly code: string
  readonly message: string
}

export interface FlowRunOptions {
  readonly createId: () => string
  readonly emit?: (event: SchedulerEvent) => Effect.Effect<void, Error>
  readonly flowId: string
  readonly inputs?: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>
  readonly invokeTask: (invocation: TaskInvocation) => Effect.Effect<unknown, Error>
  readonly projectFailure?: (error: unknown) => SchedulerFailure
  readonly runId: string
  readonly trigger?: TriggerSeed
}

interface NodeJob {
  readonly jobId: string
  readonly order: number
  readonly outputs: Readonly<Record<string, JsonValue>>
}

interface ParentRun {
  readonly jobId: string
  readonly runId: string
}

interface GraphTarget {
  readonly flowId: string
  readonly graph: ExecutableGraph
  readonly inputs: Readonly<Record<string, InputPortDefinition>>
  readonly kind: 'flow' | 'subflow'
  readonly outputs: Readonly<Record<string, OutputMapping>>
}

interface InputTarget {
  readonly handle: string
  readonly nodeId: string
}

function nodeFailure(error: unknown, project: FlowRunOptions['projectFailure']): SchedulerFailure {
  return project?.(error) ?? { code: 'node.failed', message: error instanceof Error ? error.message : String(error) }
}

interface RunContext {
  readonly createId: FlowRunOptions['createId']
  readonly emit: (event: SchedulerEvent) => Effect.Effect<void, Error>
  readonly invokeTask: FlowRunOptions['invokeTask']
  readonly prepared: PreparedFlow
  readonly projectFailure: FlowRunOptions['projectFailure']
}

class ValueQueue {
  readonly #values: JsonValue[] = []
  #head = 0

  get length(): number {
    return this.#values.length - this.#head
  }

  push(value: JsonValue): void {
    this.#values.push(value)
  }

  shift(): JsonValue {
    const value = this.#values[this.#head]!
    this.#head += 1
    if (this.#head >= 64 && this.#head * 2 >= this.#values.length) {
      this.#values.splice(0, this.#head)
      this.#head = 0
    }
    return value
  }
}

class InputSlot {
  readonly #dynamic: boolean
  readonly #queue = new ValueQueue()
  #provided: boolean
  #value: JsonValue

  constructor(node: ExecutableNode, handle: string, port: InputPortDefinition) {
    const mapping = node.inputs[handle]
    this.#dynamic = mapping?.kind == 'sources'
    this.#provided = !this.#dynamic && (mapping?.kind == 'value' || Object.hasOwn(port, 'value'))
    this.#value = mapping?.kind == 'value' ? mapping.value : (port.value ?? null)
  }

  get ready(): boolean {
    return this.#queue.length > 0 || this.#provided
  }

  get dynamic(): boolean {
    return this.#dynamic
  }

  provide(value: JsonValue): void {
    if (this.#dynamic) return
    this.#provided = true
    this.#value = value
  }

  push(value: JsonValue): void {
    this.#queue.push(value)
  }

  take(): JsonValue {
    return this.#queue.length > 0 ? this.#queue.shift() : this.#value
  }
}

class InputBuffer {
  readonly #dynamic: boolean
  readonly #nodeId: string
  readonly #slots: ReadonlyMap<string, InputSlot>
  #staticTaken = false

  constructor(nodeId: string, node: ExecutableNode, ports: Readonly<Record<string, InputPortDefinition>>) {
    this.#nodeId = nodeId
    this.#slots = new Map(Object.entries(ports).map(([handle, port]) => [handle, new InputSlot(node, handle, port)]))
    this.#dynamic = [...this.#slots.values()].some((slot) => slot.dynamic)
  }

  get ready(): boolean {
    return (!this.#staticTaken || this.#dynamic) && [...this.#slots.values()].every((slot) => slot.ready)
  }

  launch(handle: string, value: JsonValue): void {
    const slot = this.#slots.get(handle)
    if (slot?.dynamic) slot.push(value)
    else slot?.provide(value)
  }

  push(handle: string, value: JsonValue): void {
    const slot = this.#slots.get(handle)
    if (slot == null) throw new Error(`Node "${this.#nodeId}" has no input "${handle}".`)
    slot.push(value)
  }

  take(): Readonly<Record<string, JsonValue>> {
    if (!this.ready) throw new Error(`Node "${this.#nodeId}" inputs are not ready.`)
    if (!this.#dynamic) this.#staticTaken = true
    return Object.fromEntries([...this.#slots].map(([handle, slot]) => [handle, slot.take()]))
  }
}

function nodePorts(prepared: PreparedFlow, node: ExecutableNode): Readonly<Record<string, InputPortDefinition>> {
  switch (node.kind) {
    case 'condition':
      return { [node.input.handle]: node.input }
    case 'value':
      return {}
    case 'subflow':
      return portsByHandle(prepared.subflows[node.subflowId]!.inputs)
    case 'task':
      return portsByHandle(node.task != null ? node.task.inputs : prepared.tasks[node.taskId]!.inputs)
  }
}

function nodeTitle(prepared: PreparedFlow, node: ExecutableNode): string | undefined {
  if (node.name != null) return node.name
  switch (node.kind) {
    case 'condition':
      return
    case 'value':
      return 'Value'
    case 'subflow':
      return prepared.subflows[node.subflowId]!.name
    case 'task':
      return node.task != null ? node.task.name : prepared.tasks[node.taskId]!.name
  }
}

function nodeKind(prepared: PreparedFlow, node: ExecutableNode): 'condition' | 'connector' | 'javascript' | 'llm' | 'subflow' | 'value' {
  if (node.kind != 'task') return node.kind
  return node.task != null ? 'javascript' : prepared.tasks[node.taskId]!.executor.kind
}

function addTarget<T>(targets: Map<string, Map<string, T[]>>, nodeId: string, handle: string, target: T): void {
  const nodeTargets = targets.get(nodeId) ?? new Map<string, T[]>()
  const handleTargets = nodeTargets.get(handle) ?? []
  handleTargets.push(target)
  nodeTargets.set(handle, handleTargets)
  targets.set(nodeId, nodeTargets)
}

function targetsFor<T>(targets: ReadonlyMap<string, ReadonlyMap<string, readonly T[]>>, nodeId: string, handle: string): readonly T[] {
  return targets.get(nodeId)?.get(handle) ?? []
}

function graphOrder(graph: ExecutableGraph): readonly string[] {
  const dependencies = new Map(
    Object.entries(graph.nodes).map(([nodeId, node]) => [
      nodeId,
      new Set(
        Object.values(node.inputs).flatMap((mapping) =>
          mapping.kind == 'sources'
            ? mapping.sources.flatMap((source) => (source.kind == 'node' && graph.nodes[source.nodeId] != null ? [source.nodeId] : []))
            : [],
        ),
      ),
    ]),
  )
  const order: string[] = []
  while (dependencies.size > 0) {
    const ready = [...dependencies]
      .filter(([, sources]) => sources.size == 0)
      .map(([nodeId]) => nodeId)
      .toSorted()
    if (ready.length == 0) throw new Error('Prepared graph contains a dependency cycle.')
    for (const nodeId of ready) {
      dependencies.delete(nodeId)
      order.push(nodeId)
    }
    for (const sources of dependencies.values()) for (const nodeId of ready) sources.delete(nodeId)
  }
  return order
}

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true
  if (left == null || right == null || typeof left != 'object' || typeof right != 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length == right.length && left.every((value, index) => jsonEqual(value, right[index]!))
  }
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  const rightRecord = right as Readonly<Record<string, JsonValue>>
  return (
    leftEntries.length == rightEntries.length && leftEntries.every(([key, value]) => Object.hasOwn(rightRecord, key) && jsonEqual(value, rightRecord[key]!))
  )
}

function conditionMatches(
  node: Extract<GraphNode, { readonly kind: 'condition' }>,
  expression: (typeof node.cases)[number]['expressions'][number],
  inputs: Readonly<Record<string, JsonValue>>,
): boolean {
  const left = Object.hasOwn(inputs, expression.input) ? inputs[expression.input]! : null
  const right = expression.value
  switch (expression.operator) {
    case '==':
      return right !== undefined && jsonEqual(left, right)
    case '!=':
      return right !== undefined && !jsonEqual(left, right)
    case '>':
      return typeof left == 'number' && typeof right == 'number' && left > right
    case '>=':
      return typeof left == 'number' && typeof right == 'number' && left >= right
    case '<':
      return typeof left == 'number' && typeof right == 'number' && left < right
    case '<=':
      return typeof left == 'number' && typeof right == 'number' && left <= right
    case 'contains':
    case 'notContains': {
      let contains: boolean | undefined
      if (typeof left == 'string' && typeof right == 'string') contains = left.includes(right)
      else if (Array.isArray(left) && right !== undefined) contains = left.some((value) => jsonEqual(value, right))
      return contains == null ? false : expression.operator == 'contains' ? contains : !contains
    }
    case 'startsWith':
      return typeof left == 'string' && typeof right == 'string' && left.startsWith(right)
    case 'endsWith':
      return typeof left == 'string' && typeof right == 'string' && left.endsWith(right)
    case 'hasKey':
    case 'notHasKey': {
      if (left == null || Array.isArray(left) || typeof left != 'object' || typeof right != 'string') return false
      const hasKey = Object.hasOwn(left, right)
      return expression.operator == 'hasKey' ? hasKey : !hasKey
    }
    case 'hasValue':
    case 'notHasValue': {
      if (left == null || Array.isArray(left) || typeof left != 'object' || right === undefined) return false
      const hasValue = Object.values(left).some((value) => jsonEqual(value, right))
      return expression.operator == 'hasValue' ? hasValue : !hasValue
    }
    case 'isEmpty':
    case 'isNotEmpty': {
      const empty =
        left === null ||
        (typeof left == 'string' && left.length == 0) ||
        (Array.isArray(left) && left.length == 0) ||
        (typeof left == 'object' && !Array.isArray(left) && Object.keys(left).length == 0)
      const comparable = left === null || typeof left == 'string' || typeof left == 'object'
      return comparable && (expression.operator == 'isEmpty' ? empty : !empty)
    }
    case 'isNull':
      return left === null
    case 'isNotNull':
      return left !== null
    case 'isTrue':
      return left === true
    case 'isFalse':
      return left === false
  }
}

function outputRecord(value: unknown, nodeId: string): Readonly<Record<string, JsonValue>> {
  if (value == null || typeof value != 'object' || Array.isArray(value)) throw new Error(`Node "${nodeId}" must return an object.`)
  return value as Readonly<Record<string, JsonValue>>
}

function runGraph(
  context: RunContext,
  target: GraphTarget,
  runId: string,
  inputs: Readonly<Record<string, JsonValue>>,
  parent?: ParentRun,
  launchInputs: Readonly<Record<string, Readonly<Record<string, JsonValue>>>> = {},
  onOutput?: (handle: string, value: JsonValue) => Effect.Effect<void, Error>,
  trigger?: TriggerSeed,
): Effect.Effect<FlowRunResult | Readonly<Record<string, JsonValue>>, Error> {
  return Effect.scoped(
    Effect.gen(function* () {
      yield* context.emit({
        flowId: target.flowId,
        ...(parent == null ? {} : { parentJobId: parent.jobId, parentRunId: parent.runId }),
        runId,
        type: 'run.started',
      })
      const order = graphOrder(target.graph)
      const nodeCount = order.length
      const inputBuffers = new Map(
        Object.entries(target.graph.nodes).map(([nodeId, node]) => [nodeId, new InputBuffer(nodeId, node, nodePorts(context.prepared, node))]),
      )
      const flowInputTargets = new Map<string, InputTarget[]>()
      const nodeInputTargets = new Map<string, Map<string, InputTarget[]>>()
      const runOutputTargets = new Map<string, Map<string, string[]>>()
      for (const [nodeId, node] of Object.entries(target.graph.nodes)) {
        for (const [handle, mapping] of Object.entries(node.inputs)) {
          if (mapping.kind != 'sources') continue
          for (const source of mapping.sources) {
            if (source.kind == 'flow') {
              const targets = flowInputTargets.get(source.input) ?? []
              targets.push({ handle, nodeId })
              flowInputTargets.set(source.input, targets)
            } else if (source.kind == 'node') {
              addTarget(nodeInputTargets, source.nodeId, source.output, { handle, nodeId })
            }
          }
        }
      }
      for (const [handle, output] of Object.entries(target.outputs)) {
        for (const source of output.sources) if (source.kind == 'node') addTarget(runOutputTargets, source.nodeId, source.output, handle)
      }

      const activeCounts = new Map<string, number>()
      const active = yield* FiberSet.make<void, Error>()
      const runNode = yield* FiberSet.runtime(active)()
      const completed = new Map<string, NodeJob[]>()
      const scheduled = new Map<string, number>()
      const runOutputs = new Map<string, JsonValue>()
      const completedNodes = new Set<string>()
      let firstCause: Cause.Cause<Error> | undefined
      let firstFailure: Error | undefined

      let scheduleReady: (nodeId: string) => void
      const deliverInput = (targetInput: InputTarget, value: JsonValue): void => {
        if (firstCause != null) return
        const buffer = inputBuffers.get(targetInput.nodeId)!
        buffer.push(targetInput.handle, value)
        scheduleReady(targetInput.nodeId)
      }
      const emitNodeOutput = (nodeId: string, jobId: string, handle: string, value: JsonValue): Effect.Effect<void, Error> =>
        Effect.gen(function* () {
          yield* context.emit({ handle, jobId, nodeId, runId, type: 'node.output', value })
          for (const targetInput of targetsFor(nodeInputTargets, nodeId, handle)) deliverInput(targetInput, value)
          for (const outputHandle of targetsFor(runOutputTargets, nodeId, handle)) {
            runOutputs.set(outputHandle, value)
            if (onOutput != null) yield* onOutput(outputHandle, value)
          }
        })

      const executeNode = (
        nodeId: string,
        node: ExecutableNode,
        jobId: string,
        nodeInputs: Readonly<Record<string, JsonValue>>,
      ): Effect.Effect<Readonly<Record<string, JsonValue>>, Error> => {
        const execution = Effect.gen(function* () {
          const kind = nodeKind(context.prepared, node)
          const title = nodeTitle(context.prepared, node)
          yield* context.emit({
            inputs: nodeInputs,
            jobId,
            nodeId,
            nodeKind: kind,
            ...(title == null ? {} : { nodeTitle: title }),
            runId,
            type: 'node.started',
          })
          let outputs: Readonly<Record<string, JsonValue>>
          switch (node.kind) {
            case 'condition': {
              const matched = node.cases.find((condition) => {
                if (condition.expressions.length == 0) return false
                const matches = condition.expressions.map((expression) => conditionMatches(node, expression, nodeInputs))
                return condition.relation == 'all' ? matches.every(Boolean) : matches.some(Boolean)
              })
              const handle = matched?.output ?? node.defaultOutput
              outputs = handle == null ? {} : { [handle]: nodeInputs[node.input.handle] ?? null }
              if (handle != null) yield* emitNodeOutput(nodeId, jobId, handle, outputs[handle]!)
              break
            }
            case 'value': {
              outputs = Object.fromEntries(node.values.map((port) => [port.handle, port.value ?? null]))
              for (const [handle, value] of Object.entries(outputs)) yield* emitNodeOutput(nodeId, jobId, handle, value)
              break
            }
            case 'subflow': {
              const subflow = context.prepared.subflows[node.subflowId]!
              const result = yield* runGraph(
                context,
                {
                  flowId: node.subflowId,
                  graph: executableGraph(subflow.graph),
                  inputs: portsByHandle(subflow.inputs),
                  kind: 'subflow',
                  outputs: portsByHandle(subflow.outputs),
                },
                context.createId(),
                nodeInputs,
                { jobId, runId },
                {},
                (handle, value) => emitNodeOutput(nodeId, jobId, handle, value),
              )
              outputs = result as Readonly<Record<string, JsonValue>>
              break
            }
            case 'task': {
              const result = yield* context.invokeTask({
                input: nodeInputs,
                invocationId: context.createId(),
                jobId,
                nodeId,
                runId,
                ...(node.task != null ? { capabilities: node.task.capabilities ?? [], moduleId: node.task.moduleId } : { taskId: node.taskId }),
              })
              outputs = yield* Effect.try({
                try: () => outputRecord(result, nodeId),
                catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              })
              for (const [handle, value] of Object.entries(outputs)) yield* emitNodeOutput(nodeId, jobId, handle, value)
              break
            }
          }
          yield* context.emit({ jobId, nodeId, runId, type: 'node.completed' })
          return outputs
        })
        return node.timeoutMs == null
          ? execution
          : execution.pipe(
              Effect.timeoutOrElse({
                duration: node.timeoutMs,
                orElse: () => Effect.fail(new Error(`Node "${nodeId}" timed out.`)),
              }),
            )
      }

      const startNode = (nodeId: string): void => {
        const node = target.graph.nodes[nodeId]!
        const buffer = inputBuffers.get(nodeId)!
        const nodeInputs = buffer.take()
        const jobId = context.createId()
        const jobOrder = scheduled.get(nodeId) ?? 0
        scheduled.set(nodeId, jobOrder + 1)
        activeCounts.set(nodeId, (activeCounts.get(nodeId) ?? 0) + 1)
        runNode(
          executeNode(nodeId, node, jobId, nodeInputs).pipe(
            Effect.tap((outputs) =>
              Effect.gen(function* () {
                const jobs = completed.get(nodeId) ?? []
                jobs.push({ jobId, order: jobOrder, outputs })
                completed.set(nodeId, jobs)
                if (!completedNodes.has(nodeId)) {
                  completedNodes.add(nodeId)
                  yield* context.emit({
                    ...(parent == null ? {} : { parentJobId: parent.jobId, parentRunId: parent.runId }),
                    progress: (completedNodes.size / nodeCount) * 100,
                    runId,
                    type: 'run.progress',
                  })
                }
              }),
            ),
            Effect.tapError((error) =>
              Effect.gen(function* () {
                if (firstCause == null) firstFailure ??= error
                const projected = nodeFailure(error, context.projectFailure)
                yield* context.emit({ ...projected, jobId, nodeId, runId, type: 'node.failed' }).pipe(Effect.ignore)
              }),
            ),
            Effect.tapCause((cause) =>
              Effect.sync(() => {
                firstCause ??= cause
              }),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                activeCounts.set(nodeId, (activeCounts.get(nodeId) ?? 1) - 1)
                scheduleReady(nodeId)
              }),
            ),
          ),
        )
      }

      scheduleReady = (nodeId) => {
        if (firstCause != null) return
        const node = target.graph.nodes[nodeId]!
        const buffer = inputBuffers.get(nodeId)!
        while (buffer.ready && (activeCounts.get(nodeId) ?? 0) < node.concurrency) startNode(nodeId)
      }

      for (const [nodeId, values] of Object.entries(launchInputs)) {
        const buffer = inputBuffers.get(nodeId)
        if (buffer == null) continue
        for (const [handle, value] of Object.entries(values)) buffer.launch(handle, value)
      }
      for (const [handle, port] of Object.entries(target.inputs)) {
        const provided = Object.hasOwn(inputs, handle) ? inputs[handle] : port.value
        if (provided === undefined) continue
        for (const output of Object.entries(target.outputs)) {
          if (output[1].sources.some((source) => source.kind == 'flow' && source.input == handle)) {
            runOutputs.set(output[0], provided)
            if (onOutput != null) yield* onOutput(output[0], provided)
          }
        }
        for (const targetInput of flowInputTargets.get(handle) ?? []) deliverInput(targetInput, provided)
      }
      if (trigger != null) {
        for (const targetInput of targetsFor(nodeInputTargets, trigger.nodeId, 'payload')) deliverInput(targetInput, trigger.payload)
      }
      for (const nodeId of order) scheduleReady(nodeId)

      const activeExit = yield* Effect.raceFirst(FiberSet.awaitEmpty(active), FiberSet.join(active)).pipe(Effect.exit)
      if (firstFailure != null) {
        yield* FiberSet.clear(active)
        yield* context.emit({ message: firstFailure.message, runId, type: 'run.failed' }).pipe(Effect.ignore)
        return yield* Effect.fail(firstFailure)
      }
      if (firstCause != null) {
        yield* FiberSet.clear(active)
        return yield* Effect.failCause(firstCause)
      }
      if (Exit.isFailure(activeExit)) return yield* Effect.failCause(activeExit.cause)
      if (target.kind == 'subflow') {
        const outputs = Object.fromEntries(runOutputs)
        yield* context.emit({ result: { kind: 'function-outputs', outputs, target: 'subflow' }, runId, type: 'run.completed' })
        return outputs
      }
      const dependencies = new Set(
        Object.values(target.graph.nodes).flatMap((node) =>
          Object.values(node.inputs).flatMap((mapping) =>
            mapping.kind == 'sources' ? mapping.sources.filter((source) => source.kind == 'node').map((source) => source.nodeId) : [],
          ),
        ),
      )
      const result: FlowRunResult = {
        kind: 'node-results',
        nodes: order
          .filter((nodeId) => !dependencies.has(nodeId))
          .map((nodeId) => ({
            jobs: (completed.get(nodeId) ?? []).toSorted((left, right) => left.order - right.order).map(({ jobId, outputs }) => ({ jobId, outputs })),
            nodeId,
          })),
      }
      yield* context.emit({ result, runId, type: 'run.completed' })
      return result
    }),
  )
}

export function runFlow(prepared: PreparedFlow, options: FlowRunOptions): Effect.Effect<FlowRunResult, Error> {
  const emit = options.emit ?? (() => Effect.void)
  const program = Effect.gen(function* () {
    const triggerNode = options.trigger == null ? undefined : prepared.graph.nodes[options.trigger.nodeId]
    if (options.trigger != null && (triggerNode == null || 'inputs' in triggerNode)) {
      return yield* Effect.fail(new Error(`Node "${options.trigger.nodeId}" is not a TriggerNode in Flow "${options.flowId}".`))
    }
    return (yield* runGraph(
      { createId: options.createId, emit, invokeTask: options.invokeTask, prepared, projectFailure: options.projectFailure },
      { flowId: options.flowId, graph: executableGraph(prepared.graph), inputs: {}, kind: 'flow', outputs: {} },
      options.runId,
      {},
      undefined,
      options.inputs,
      undefined,
      options.trigger,
    )) as FlowRunResult
  })
  return program
}

function executableGraph(graph: Graph): ExecutableGraph {
  return { nodes: Object.fromEntries(Object.entries(graph.nodes).filter((entry): entry is [string, ExecutableNode] => 'inputs' in entry[1])) }
}
