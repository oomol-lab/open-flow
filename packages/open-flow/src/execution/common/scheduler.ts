import type * as Cause from 'effect/Cause'
import type {
  ConnectorCapability,
  Graph,
  GraphNode,
  InputMapping,
  InputPortDefinition,
  JsonValue,
  OutputMapping,
  TriggerNode,
  WaitAction,
} from '../../flow/common/change.ts'
import type { PreparedFlow } from '../../flow/common/semantics.ts'

import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FiberSet from 'effect/FiberSet'
import { nanoid } from 'nanoid'
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
      readonly nodeKind: 'condition' | 'connector' | 'javascript' | 'llm' | 'subflow' | 'value' | 'wait'
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
      readonly jobId: string
      readonly level: 'debug' | 'error' | 'info' | 'warn'
      readonly message: string
      readonly nodeId: string
      readonly runId: string
      readonly type: 'node.log'
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

export interface FlowRunCheckpoint {
  readonly bindingValues: Readonly<Record<string, string>>
  readonly buffers: Readonly<
    Record<
      string,
      {
        readonly slots: Readonly<
          Record<
            string,
            {
              readonly provided: boolean
              readonly queue: readonly JsonValue[]
              readonly value: JsonValue
            }
          >
        >
        readonly staticTaken: boolean
      }
    >
  >
  readonly completedNodes: readonly string[]
  readonly nextJobs: Readonly<Record<string, number>>
  readonly outputs: Readonly<Record<string, JsonValue>>
  readonly results: readonly {
    readonly jobs: readonly {
      readonly jobId: string
      readonly order: number
      readonly outputs: Readonly<Record<string, JsonValue>>
    }[]
    readonly nodeId: string
  }[]
  readonly version: 1
  readonly wait: {
    readonly jobId: string
    readonly nodeId: string
    readonly order: number
    readonly value: JsonValue
    readonly waitId: string
  }
}

export type FlowRunOutcome =
  | FlowRunResult
  | {
      readonly checkpoint: FlowRunCheckpoint
      readonly kind: 'waiting'
      readonly notification?: {
        readonly input: Readonly<Record<string, JsonValue>>
        readonly messageHandle: string
        readonly taskId: string
      }
      readonly wait: {
        readonly actions: readonly ['continue'] | readonly ['approve', 'reject']
        readonly jobId: string
        readonly nodeId: string
        readonly order: number
        readonly waitId: string
      }
    }

export interface SubflowRunResult {
  readonly kind: 'function-outputs'
  readonly outputs: Readonly<Record<string, JsonValue>>
  readonly target: 'subflow'
}

interface TaskInvocationBase {
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
  readonly bindingValues?: Readonly<Record<string, string>>
  readonly createId: () => string
  readonly emit?: (event: SchedulerEvent) => Effect.Effect<void, Error>
  readonly flowId: string
  readonly inputs?: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>
  readonly invokeTask: (invocation: TaskInvocation, outputs: (value: unknown) => Effect.Effect<void, Error>) => Effect.Effect<unknown, Error>
  readonly projectFailure?: (error: unknown) => SchedulerFailure
  readonly resume?: { readonly action: WaitAction; readonly checkpoint: unknown }
  readonly runId: string
  readonly trigger?: TriggerSeed
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
  readonly bindingValues: Readonly<Record<string, string>>
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

  restore(values: readonly JsonValue[]): void {
    this.#values.push(...values)
  }

  snapshot(): readonly JsonValue[] {
    return this.#values.slice(this.#head)
  }
}

class InputSlot {
  readonly #dynamic: boolean
  readonly #queue = new ValueQueue()
  #provided: boolean
  #value: JsonValue

  constructor(mapping: InputMapping | undefined, port: InputPortDefinition) {
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

  restore(state: { readonly provided: boolean; readonly queue: readonly JsonValue[]; readonly value: JsonValue }): void {
    this.#provided = state.provided
    this.#value = state.value
    this.#queue.restore(state.queue)
  }

  snapshot(): { readonly provided: boolean; readonly queue: readonly JsonValue[]; readonly value: JsonValue } {
    return { provided: this.#provided, queue: this.#queue.snapshot(), value: this.#value }
  }
}

class InputBuffer {
  readonly #dynamic: boolean
  readonly #nodeId: string
  readonly #slots: ReadonlyMap<string, InputSlot>
  #staticTaken = false

  constructor(
    nodeId: string,
    mappings: Readonly<Record<string, InputMapping>>,
    ports: Readonly<Record<string, InputPortDefinition>>,
    state?: FlowRunCheckpoint['buffers'][string],
  ) {
    this.#nodeId = nodeId
    this.#slots = new Map(
      Object.entries(ports).map(([handle, port]) => {
        const slot = new InputSlot(mappings[handle], port)
        const saved = state?.slots[handle]
        if (saved != null) slot.restore(saved)
        return [handle, slot]
      }),
    )
    this.#dynamic = [...this.#slots.values()].some((slot) => slot.dynamic)
    this.#staticTaken = state?.staticTaken ?? false
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

  snapshot(): FlowRunCheckpoint['buffers'][string] {
    return { slots: Object.fromEntries([...this.#slots].map(([handle, slot]) => [handle, slot.snapshot()])), staticTaken: this.#staticTaken }
  }
}

const notificationPrefix = 'notification:'

function notificationInput(handle: string): string {
  return `${notificationPrefix}${handle}`
}

function nodeMappings(node: ExecutableNode): Readonly<Record<string, InputMapping>> {
  if (node.kind != 'wait' || node.notification == null) return node.inputs
  return {
    ...node.inputs,
    ...Object.fromEntries(Object.entries(node.notification.inputs).map(([handle, mapping]) => [notificationInput(handle), mapping])),
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
      return portsByHandle([...(node.task != null ? node.task.inputs : prepared.tasks[node.taskId]!.inputs), ...(node.additionalInputs ?? [])])
    case 'wait': {
      const notification = node.notification
      const task = notification == null ? undefined : prepared.tasks[notification.taskId]
      return {
        [node.input.handle]: node.input,
        ...(notification == null || task == null
          ? {}
          : Object.fromEntries(
              task.inputs.flatMap((port) => ('handle' in port && port.handle != notification.messageHandle ? [[notificationInput(port.handle), port]] : [])),
            )),
      }
    }
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
    case 'wait':
      return 'Wait'
  }
}

function nodeKind(prepared: PreparedFlow, node: ExecutableNode): 'condition' | 'connector' | 'javascript' | 'llm' | 'subflow' | 'value' | 'wait' {
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
        Object.values(nodeMappings(node)).flatMap((mapping) =>
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

function resultNodeIds(graph: ExecutableGraph, order: readonly string[]): readonly string[] {
  const dependencies = new Set(
    Object.values(graph.nodes).flatMap((node) =>
      Object.values(nodeMappings(node)).flatMap((mapping) =>
        mapping.kind == 'sources' ? mapping.sources.filter((source) => source.kind == 'node').map((source) => source.nodeId) : [],
      ),
    ),
  )
  return order.filter((nodeId) => !dependencies.has(nodeId))
}

function checkpointRecord(value: unknown, description: string): Readonly<Record<string, unknown>> {
  if (value == null || typeof value != 'object' || Array.isArray(value)) throw new Error(`${description} must be an object.`)
  return value as Readonly<Record<string, unknown>>
}

function checkpointExact(value: Readonly<Record<string, unknown>>, fields: readonly string[], description: string): void {
  const keys = Object.keys(value)
  if (keys.length != fields.length || keys.some((key) => !fields.includes(key))) throw new Error(`${description} contains unsupported fields.`)
}

function checkpointString(value: unknown, description: string): string {
  if (typeof value != 'string' || value.length == 0) throw new Error(`${description} must be a non-empty string.`)
  return value
}

function checkpointInteger(value: unknown, description: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${description} must be a non-negative integer.`)
  return Number(value)
}

function checkpointJson(value: unknown, description: string, depth = 0): JsonValue {
  if (depth > 64) throw new Error(`${description} exceeds the maximum JSON depth.`)
  if (value === null || typeof value == 'boolean' || typeof value == 'string') return value
  if (typeof value == 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map((item) => checkpointJson(item, description, depth + 1))
  const source = checkpointRecord(value, description)
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, checkpointJson(item, description, depth + 1)]))
}

export function decodeFlowRunCheckpoint(value: unknown): FlowRunCheckpoint {
  const source = checkpointRecord(value, 'Flow Run checkpoint')
  checkpointExact(source, ['bindingValues', 'buffers', 'completedNodes', 'nextJobs', 'outputs', 'results', 'version', 'wait'], 'Flow Run checkpoint')
  if (source.version != 1) throw new Error('Flow Run checkpoint version is unsupported.')

  const bindingSource = checkpointRecord(source.bindingValues, 'Flow Run checkpoint bindings')
  const bindingValues = Object.fromEntries(
    Object.entries(bindingSource).map(([bindingId, item]) => {
      if (typeof item != 'string') throw new Error(`Flow Run checkpoint binding "${bindingId}" must be a string.`)
      return [bindingId, item]
    }),
  )
  const bufferSource = checkpointRecord(source.buffers, 'Flow Run checkpoint buffers')
  const buffers = Object.fromEntries(
    Object.entries(bufferSource).map(([nodeId, item]) => {
      const buffer = checkpointRecord(item, `Flow Run checkpoint buffer "${nodeId}"`)
      checkpointExact(buffer, ['slots', 'staticTaken'], `Flow Run checkpoint buffer "${nodeId}"`)
      if (typeof buffer.staticTaken != 'boolean') throw new Error(`Flow Run checkpoint buffer "${nodeId}" staticTaken must be boolean.`)
      const slotSource = checkpointRecord(buffer.slots, `Flow Run checkpoint buffer "${nodeId}" slots`)
      const slots = Object.fromEntries(
        Object.entries(slotSource).map(([handle, slotItem]) => {
          const slot = checkpointRecord(slotItem, `Flow Run checkpoint slot "${nodeId}/${handle}"`)
          checkpointExact(slot, ['provided', 'queue', 'value'], `Flow Run checkpoint slot "${nodeId}/${handle}"`)
          if (typeof slot.provided != 'boolean' || !Array.isArray(slot.queue)) {
            throw new Error(`Flow Run checkpoint slot "${nodeId}/${handle}" is invalid.`)
          }
          return [
            handle,
            {
              provided: slot.provided,
              queue: slot.queue.map((queued) => checkpointJson(queued, `Flow Run checkpoint slot "${nodeId}/${handle}" queue`)),
              value: checkpointJson(slot.value, `Flow Run checkpoint slot "${nodeId}/${handle}" value`),
            },
          ]
        }),
      )
      return [nodeId, { slots, staticTaken: buffer.staticTaken }]
    }),
  )
  if (!Array.isArray(source.completedNodes) || !Array.isArray(source.results)) throw new Error('Flow Run checkpoint result state is invalid.')
  const completedNodes = source.completedNodes.map((nodeId) => checkpointString(nodeId, 'Flow Run checkpoint completed node'))
  const nextJobs = Object.fromEntries(
    Object.entries(checkpointRecord(source.nextJobs, 'Flow Run checkpoint next jobs')).map(([nodeId, item]) => [
      nodeId,
      checkpointInteger(item, `Flow Run checkpoint next job "${nodeId}"`),
    ]),
  )
  const outputs = Object.fromEntries(
    Object.entries(checkpointRecord(source.outputs, 'Flow Run checkpoint outputs')).map(([handle, item]) => [
      handle,
      checkpointJson(item, `Flow Run checkpoint output "${handle}"`),
    ]),
  )
  const results = source.results.map((item, index) => {
    const result = checkpointRecord(item, `Flow Run checkpoint result ${index}`)
    checkpointExact(result, ['jobs', 'nodeId'], `Flow Run checkpoint result ${index}`)
    if (!Array.isArray(result.jobs)) throw new Error(`Flow Run checkpoint result ${index} jobs must be an array.`)
    return {
      jobs: result.jobs.map((jobItem, jobIndex) => {
        const job = checkpointRecord(jobItem, `Flow Run checkpoint result ${index} job ${jobIndex}`)
        checkpointExact(job, ['jobId', 'order', 'outputs'], `Flow Run checkpoint result ${index} job ${jobIndex}`)
        return {
          jobId: checkpointString(job.jobId, `Flow Run checkpoint result ${index} job ${jobIndex} ID`),
          order: checkpointInteger(job.order, `Flow Run checkpoint result ${index} job ${jobIndex} order`),
          outputs: Object.fromEntries(
            Object.entries(checkpointRecord(job.outputs, `Flow Run checkpoint result ${index} job ${jobIndex} outputs`)).map(([handle, output]) => [
              handle,
              checkpointJson(output, `Flow Run checkpoint result ${index} job ${jobIndex} output "${handle}"`),
            ]),
          ),
        }
      }),
      nodeId: checkpointString(result.nodeId, `Flow Run checkpoint result ${index} node ID`),
    }
  })
  const wait = checkpointRecord(source.wait, 'Flow Run checkpoint wait')
  checkpointExact(wait, ['jobId', 'nodeId', 'order', 'value', 'waitId'], 'Flow Run checkpoint wait')
  return {
    bindingValues,
    buffers,
    completedNodes,
    nextJobs,
    outputs,
    results,
    version: 1,
    wait: {
      jobId: checkpointString(wait.jobId, 'Flow Run checkpoint wait job ID'),
      nodeId: checkpointString(wait.nodeId, 'Flow Run checkpoint wait node ID'),
      order: checkpointInteger(wait.order, 'Flow Run checkpoint wait order'),
      value: checkpointJson(wait.value, 'Flow Run checkpoint wait value'),
      waitId: checkpointString(wait.waitId, 'Flow Run checkpoint wait ID'),
    },
  }
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
  if (value === undefined) return {}
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
  resume?: { readonly action: WaitAction; readonly checkpoint: FlowRunCheckpoint },
): Effect.Effect<FlowRunOutcome | Readonly<Record<string, JsonValue>>, Error> {
  return Effect.scoped(
    Effect.gen(function* () {
      if (resume == null) {
        yield* context.emit({
          flowId: target.flowId,
          ...(parent == null ? {} : { parentJobId: parent.jobId, parentRunId: parent.runId }),
          runId,
          type: 'run.started',
        })
      }
      const order = graphOrder(target.graph)
      const resultNodes = resultNodeIds(target.graph, order)
      const nodeCount = order.length
      const inputBuffers = new Map(
        Object.entries(target.graph.nodes).map(([nodeId, node]) => [
          nodeId,
          new InputBuffer(nodeId, nodeMappings(node), nodePorts(context.prepared, node), resume?.checkpoint.buffers[nodeId]),
        ]),
      )
      if (resume != null) {
        const bufferIds = Object.keys(resume.checkpoint.buffers).toSorted()
        if (bufferIds.length != order.length || bufferIds.some((nodeId, index) => nodeId != [...order].toSorted()[index])) {
          return yield* Effect.fail(new Error('Flow Run checkpoint buffers do not match the prepared graph.'))
        }
        for (const [nodeId, node] of Object.entries(target.graph.nodes)) {
          const expected = Object.keys(nodePorts(context.prepared, node)).toSorted()
          const actual = Object.keys(resume.checkpoint.buffers[nodeId]!.slots).toSorted()
          if (expected.length != actual.length || expected.some((handle, index) => handle != actual[index])) {
            return yield* Effect.fail(new Error(`Flow Run checkpoint inputs do not match node "${nodeId}".`))
          }
        }
      }
      const flowInputTargets = new Map<string, InputTarget[]>()
      const bindingInputTargets = new Map<string, InputTarget[]>()
      const nodeInputTargets = new Map<string, Map<string, InputTarget[]>>()
      const runOutputTargets = new Map<string, Map<string, string[]>>()
      for (const [nodeId, node] of Object.entries(target.graph.nodes)) {
        for (const [handle, mapping] of Object.entries(nodeMappings(node))) {
          if (mapping.kind != 'sources') continue
          for (const source of mapping.sources) {
            if (source.kind == 'binding') {
              const targets = bindingInputTargets.get(source.bindingId) ?? []
              targets.push({ handle, nodeId })
              bindingInputTargets.set(source.bindingId, targets)
            } else if (source.kind == 'flow') {
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
      const completed = new Map(resume?.checkpoint.results.map((result) => [result.nodeId, [...result.jobs]]) ?? [])
      const scheduled = new Map(Object.entries(resume?.checkpoint.nextJobs ?? {}))
      const runOutputs = new Map(Object.entries(resume?.checkpoint.outputs ?? {}))
      const completedNodes = new Set(resume?.checkpoint.completedNodes ?? [])
      let firstCause: Cause.Cause<Error> | undefined
      let firstFailure: Error | undefined
      let suspending = resume != null
      let pendingWait:
        | {
            readonly actions: readonly ['continue'] | readonly ['approve', 'reject']
            readonly jobId: string
            readonly nodeId: string
            readonly notification?: { readonly input: Readonly<Record<string, JsonValue>>; readonly messageHandle: string; readonly taskId: string }
            readonly order: number
            readonly value: JsonValue
            readonly waitId: string
          }
        | undefined

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
          const projectedInputs = Object.fromEntries(
            Object.entries(nodeInputs).filter(([handle]) => {
              if (node.kind == 'wait') return handle == node.input.handle
              const mapping = node.inputs[handle]
              return mapping?.kind != 'sources' || mapping.sources.every((source) => source.kind != 'binding')
            }),
          )
          yield* context.emit({
            inputs: projectedInputs,
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
              const additional = new Set((node.additionalInputs ?? []).map((port) => port.handle))
              const emitted = new Map<string, JsonValue>()
              const emitOutputs = (value: unknown): Effect.Effect<void, Error> =>
                Effect.gen(function* () {
                  const record = yield* Effect.try({
                    try: () => outputRecord(value, nodeId),
                    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
                  })
                  for (const [handle, output] of Object.entries(record)) {
                    yield* emitNodeOutput(nodeId, jobId, handle, output)
                    emitted.set(handle, output)
                  }
                })
              const result = yield* context.invokeTask(
                {
                  additionalInputs: Object.fromEntries(Object.entries(nodeInputs).filter(([handle]) => additional.has(handle))),
                  blockId: node.task != null ? node.task.moduleId : node.taskId,
                  flowId: target.flowId,
                  input: Object.fromEntries(Object.entries(nodeInputs).filter(([handle]) => !additional.has(handle))),
                  invocationId: context.createId(),
                  jobId,
                  nodeId,
                  runId,
                  ...(node.task != null ? { capabilities: node.task.capabilities ?? [], moduleId: node.task.moduleId } : { taskId: node.taskId }),
                },
                emitOutputs,
              )
              yield* emitOutputs(result)
              outputs = Object.fromEntries(emitted)
              break
            }
            case 'wait':
              return yield* Effect.fail(new Error('Wait jobs are handled by the Scheduler suspension boundary.'))
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
        if (node.kind == 'wait') {
          suspending = true
          pendingWait = {
            actions: node.actions,
            jobId,
            nodeId,
            ...(node.notification == null
              ? {}
              : {
                  notification: {
                    input: Object.fromEntries(
                      Object.entries(nodeInputs).flatMap(([handle, value]) =>
                        handle.startsWith(notificationPrefix) ? [[handle.slice(notificationPrefix.length), value]] : [],
                      ),
                    ),
                    messageHandle: node.notification.messageHandle,
                    taskId: node.notification.taskId,
                  },
                }),
            order: jobOrder,
            value: nodeInputs[node.input.handle] ?? null,
            waitId: nanoid(),
          }
          const mapping = node.inputs[node.input.handle]
          const projectedInputs: Readonly<Record<string, JsonValue>> =
            mapping?.kind == 'sources' && mapping.sources.some((source) => source.kind == 'binding')
              ? {}
              : { [node.input.handle]: nodeInputs[node.input.handle] ?? null }
          runNode(
            context.emit({
              inputs: projectedInputs,
              jobId,
              nodeId,
              nodeKind: 'wait',
              ...(node.name == null ? {} : { nodeTitle: node.name }),
              runId,
              type: 'node.started',
            }),
          )
          return
        }
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
        if (firstCause != null || suspending) return
        const node = target.graph.nodes[nodeId]!
        const buffer = inputBuffers.get(nodeId)!
        while (buffer.ready && (activeCounts.get(nodeId) ?? 0) < node.concurrency) {
          startNode(nodeId)
          if (suspending) return
        }
      }

      if (resume == null) {
        for (const [nodeId, values] of Object.entries(launchInputs)) {
          const buffer = inputBuffers.get(nodeId)
          if (buffer == null) continue
          for (const [handle, value] of Object.entries(values)) buffer.launch(handle, value)
        }
        for (const [bindingId, targets] of bindingInputTargets) {
          if (!Object.hasOwn(context.bindingValues, bindingId)) {
            return yield* Effect.fail(new Error(`Variable binding "${bindingId}" is unresolved.`))
          }
          for (const targetInput of targets) deliverInput(targetInput, context.bindingValues[bindingId]!)
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
      } else {
        const saved = resume.checkpoint.wait
        const node = target.graph.nodes[saved.nodeId]
        if (node?.kind != 'wait' || !node.actions.some((action) => action == resume.action)) {
          return yield* Effect.fail(new Error('Flow Run checkpoint resolution does not match the prepared Wait node.'))
        }
        if (Object.keys(resume.checkpoint.nextJobs).some((nodeId) => target.graph.nodes[nodeId] == null)) {
          return yield* Effect.fail(new Error('Flow Run checkpoint job state does not match the prepared graph.'))
        }
        const outputs = { [resume.action]: saved.value }
        yield* emitNodeOutput(saved.nodeId, saved.jobId, resume.action, saved.value)
        const jobs = completed.get(saved.nodeId) ?? []
        jobs.push({ jobId: saved.jobId, order: saved.order, outputs })
        completed.set(saved.nodeId, jobs)
        if (!completedNodes.has(saved.nodeId)) {
          completedNodes.add(saved.nodeId)
          yield* context.emit({ progress: (completedNodes.size / nodeCount) * 100, runId, type: 'run.progress' })
        }
        yield* context.emit({ jobId: saved.jobId, nodeId: saved.nodeId, runId, type: 'node.completed' })
        suspending = false
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
      if (pendingWait != null) {
        if (target.kind != 'flow') return yield* Effect.fail(new Error('Subflow Wait is not supported.'))
        const checkpointSource: FlowRunCheckpoint = {
          bindingValues: context.bindingValues,
          buffers: Object.fromEntries([...inputBuffers].map(([nodeId, buffer]) => [nodeId, buffer.snapshot()])),
          completedNodes: [...completedNodes].toSorted(),
          nextJobs: Object.fromEntries(scheduled),
          outputs: Object.fromEntries(runOutputs),
          results: resultNodes.map((nodeId) => ({
            jobs: (completed.get(nodeId) ?? []).toSorted((left, right) => left.order - right.order),
            nodeId,
          })),
          version: 1,
          wait: {
            jobId: pendingWait.jobId,
            nodeId: pendingWait.nodeId,
            order: pendingWait.order,
            value: pendingWait.value,
            waitId: pendingWait.waitId,
          },
        }
        const encoded = JSON.stringify(checkpointSource)
        if (new TextEncoder().encode(encoded).byteLength > 16 * 1024 * 1024) {
          const message = 'Flow Run checkpoint exceeds 16 MiB.'
          yield* context.emit({ code: 'run.checkpoint-too-large', jobId: pendingWait.jobId, message, nodeId: pendingWait.nodeId, runId, type: 'node.failed' })
          yield* context.emit({ message, runId, type: 'run.failed' })
          return yield* Effect.fail(new Error(`run.checkpoint-too-large: ${message}`))
        }
        const checkpoint = decodeFlowRunCheckpoint(JSON.parse(encoded))
        return {
          checkpoint,
          kind: 'waiting',
          ...(pendingWait.notification == null ? {} : { notification: pendingWait.notification }),
          wait: {
            actions: pendingWait.actions,
            jobId: pendingWait.jobId,
            nodeId: pendingWait.nodeId,
            order: pendingWait.order,
            waitId: pendingWait.waitId,
          },
        }
      }
      if (target.kind == 'subflow') {
        const outputs = Object.fromEntries(runOutputs)
        yield* context.emit({ result: { kind: 'function-outputs', outputs, target: 'subflow' }, runId, type: 'run.completed' })
        return outputs
      }
      const result: FlowRunResult = {
        kind: 'node-results',
        nodes: resultNodes.map((nodeId) => ({
          jobs: (completed.get(nodeId) ?? []).toSorted((left, right) => left.order - right.order).map(({ jobId, outputs }) => ({ jobId, outputs })),
          nodeId,
        })),
      }
      yield* context.emit({ result, runId, type: 'run.completed' })
      return result
    }),
  )
}

export function runFlow(prepared: PreparedFlow, options: FlowRunOptions): Effect.Effect<FlowRunOutcome, Error> {
  const emit = options.emit ?? (() => Effect.void)
  const program = Effect.gen(function* () {
    if (options.resume != null && (options.inputs != null || options.trigger != null)) {
      return yield* Effect.fail(new Error('A resumed Flow Run cannot accept launch inputs or a Trigger seed.'))
    }
    const checkpoint = options.resume == null ? undefined : decodeFlowRunCheckpoint(options.resume.checkpoint)
    if (checkpoint != null && new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength > 16 * 1024 * 1024) {
      return yield* Effect.fail(new Error('Flow Run checkpoint exceeds 16 MiB.'))
    }
    const triggerNode = options.trigger == null ? undefined : prepared.graph.nodes[options.trigger.nodeId]
    if (options.trigger != null && (triggerNode == null || 'inputs' in triggerNode)) {
      return yield* Effect.fail(new Error(`Node "${options.trigger.nodeId}" is not a TriggerNode in Flow "${options.flowId}".`))
    }
    return (yield* runGraph(
      {
        bindingValues: checkpoint?.bindingValues ?? options.bindingValues ?? {},
        createId: options.createId,
        emit,
        invokeTask: options.invokeTask,
        prepared,
        projectFailure: options.projectFailure,
      },
      { flowId: options.flowId, graph: executableGraph(prepared.graph), inputs: {}, kind: 'flow', outputs: {} },
      options.runId,
      {},
      undefined,
      options.inputs,
      undefined,
      options.trigger,
      checkpoint == null ? undefined : { action: options.resume!.action, checkpoint },
    )) as FlowRunOutcome
  })
  return program
}

function executableGraph(graph: Graph): ExecutableGraph {
  return { nodes: Object.fromEntries(Object.entries(graph.nodes).filter((entry): entry is [string, ExecutableNode] => 'inputs' in entry[1])) }
}
