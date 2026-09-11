import type * as Cause from 'effect/Cause'
import type { AgentConfig } from '../../flow/common/agent.ts'
import type { ConnectorCapability, Graph, GraphNode, InputMapping, InputPortDefinition, JsonValue, TriggerNode, WaitAction } from '../../flow/common/change.ts'
import type { PreparedFlow } from '../../flow/common/semantics.ts'
import type { AgentCheckpoint, AgentResult } from './runtime.ts'

import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FiberSet from 'effect/FiberSet'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { agentInput } from '../../flow/common/agent.ts'
import { portsByHandle } from '../../flow/common/change.ts'
import { graphOrder } from '../../flow/common/graph.ts'
import { matchesSchema } from '../../flow/common/schema.ts'

type ExecutableNode = Exclude<GraphNode, TriggerNode>

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
      readonly nodeKind: 'agent' | 'condition' | 'connector' | 'javascript' | 'llm' | 'subflow' | 'value' | 'wait'
      readonly nodeTitle?: string
      readonly runId: string
      readonly type: 'node.started'
    }
  | {
      readonly jobId: string
      readonly nodeId: string
      readonly outputs: Readonly<Record<string, JsonValue>>
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
    readonly nodeId: string
    readonly status: 'completed'
    readonly jobId: string
    readonly outputs: Readonly<Record<string, JsonValue>>
  }[]
}

export interface FlowRunCheckpoint {
  readonly bindingValues: Readonly<Record<string, string>>
  readonly inputs: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>
  readonly results: Readonly<Record<string, { readonly jobId: string; readonly outputs: Readonly<Record<string, JsonValue>> }>>
  readonly skipped: readonly string[]
  readonly version: 2
  readonly queue: readonly FlowRunCheckpoint['wait'][]
  readonly agents: Readonly<
    Record<
      string,
      {
        readonly invocationId: string
        readonly input: Readonly<Record<string, JsonValue>>
        readonly remainingMs?: number
        readonly checkpoint: AgentCheckpoint
      }
    >
  >
  readonly wait: {
    readonly jobId: string
    readonly nodeId: string
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
        readonly prompt: string
        readonly jobId: string
        readonly nodeId: string
        readonly waitId: string
      }
    }

export interface SubflowRunResult {
  readonly kind: 'function-outputs'
  readonly outputs: Readonly<Record<string, JsonValue>>
  readonly target: 'subflow'
}

interface TaskInvocationBase {
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
  ({ readonly capabilities: readonly ConnectorCapability[]; readonly moduleId: string } | { readonly taskId: string })

export interface TriggerSeed {
  readonly nodeId: string
  readonly payload: JsonValue
}

export interface SchedulerFailure {
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
} & RunLaunch

export type RunLaunch =
  | {
      readonly bindingValues?: Readonly<Record<string, string>>
      readonly inputs?: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>
      readonly trigger: TriggerSeed
      readonly resume?: never
    }
  | {
      readonly resume: { readonly action: WaitAction; readonly checkpoint: unknown }
      readonly bindingValues?: never
      readonly inputs?: never
      readonly trigger?: never
    }

interface ParentRun {
  readonly jobId: string
  readonly runId: string
}

interface GraphTarget {
  readonly flowId: string
  readonly graph: Graph
  readonly kind: 'flow' | 'subflow'
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
      return 'Fixed Values'
    case 'subflow':
      return prepared.subflows[node.subflowId]!.name
    case 'task':
      return node.task != null ? node.task.name : prepared.tasks[node.taskId]!.name
    case 'wait':
      return 'Wait'
  }
}

function nodeKind(prepared: PreparedFlow, node: ExecutableNode): 'agent' | 'condition' | 'connector' | 'javascript' | 'llm' | 'subflow' | 'value' | 'wait' {
  if (node.kind != 'task') return node.kind
  return node.task != null ? 'javascript' : prepared.tasks[node.taskId]!.executor.kind
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

function checkpointJson(value: unknown, description: string, depth = 0): JsonValue {
  if (depth > 64) throw new Error(`${description} exceeds the maximum JSON depth.`)
  if (value === null || typeof value == 'boolean' || typeof value == 'string') return value
  if (typeof value == 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map((item) => checkpointJson(item, description, depth + 1))
  const source = checkpointRecord(value, description)
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, checkpointJson(item, description, depth + 1)]))
}

const agentCheckpointSchema = z.strictObject({
  state: z.json(),
  callId: z.string().min(1),
  toolId: z.string().min(1),
  input: z.record(z.string(), z.json()),
  rounds: z.number().int().nonnegative(),
  version: z.literal(1),
})
const agentResultSchema = z.union([
  z.strictObject({ kind: z.literal('completed'), output: z.json() }),
  z.strictObject({ kind: z.literal('suspended'), checkpoint: agentCheckpointSchema }),
])

export function decodeFlowRunCheckpoint(input: unknown): FlowRunCheckpoint {
  const source = checkpointRecord(input, 'Flow Run checkpoint')
  checkpointExact(source, ['agents', 'bindingValues', 'inputs', 'queue', 'results', 'skipped', 'version', 'wait'], 'Flow Run checkpoint')
  if (source.version != 2) throw new Error('Flow Run checkpoint version is unsupported.')
  const bindingValues = Object.fromEntries(
    Object.entries(checkpointRecord(source.bindingValues, 'Checkpoint bindings')).map(([id, value]) => {
      if (typeof value != 'string') throw new Error('Checkpoint binding must be a string.')
      return [id, value]
    }),
  )
  const inputs = Object.fromEntries(
    Object.entries(checkpointRecord(source.inputs, 'Checkpoint inputs')).map(([id, value]) => [
      id,
      Object.fromEntries(
        Object.entries(checkpointRecord(value, 'Checkpoint node inputs')).map(([handle, item]) => [handle, checkpointJson(item, 'Checkpoint input')]),
      ),
    ]),
  )
  const results = Object.fromEntries(
    Object.entries(checkpointRecord(source.results, 'Checkpoint results')).map(([id, value]) => {
      const result = checkpointRecord(value, 'Checkpoint result')
      checkpointExact(result, ['jobId', 'outputs'], 'Checkpoint result')
      return [
        id,
        {
          jobId: checkpointString(result.jobId, 'Checkpoint job ID'),
          outputs: Object.fromEntries(
            Object.entries(checkpointRecord(result.outputs, 'Checkpoint outputs')).map(([handle, item]) => [handle, checkpointJson(item, 'Checkpoint output')]),
          ),
        },
      ]
    }),
  )
  if (!Array.isArray(source.skipped)) throw new Error('Checkpoint skipped nodes must be an array.')
  const skipped = source.skipped.map((id) => checkpointString(id, 'Checkpoint skipped node'))
  if (new Set(skipped).size != skipped.length || skipped.some((id) => results[id] != null)) throw new Error('Checkpoint node states conflict.')
  const savedWait = z.strictObject({ jobId: z.string().min(1), nodeId: z.string().min(1), value: z.json(), waitId: z.string().min(1) })
  const wait = savedWait.parse(source.wait)
  const queue = z.array(savedWait).parse(source.queue)
  const agents = z
    .record(
      z.string(),
      z.strictObject({
        invocationId: z.string().min(1),
        input: z.record(z.string(), z.json()),
        remainingMs: z.number().positive().optional(),
        checkpoint: agentCheckpointSchema,
      }),
    )
    .parse(source.agents)
  const nodes = new Set<string>()
  const waits = new Set<string>()
  for (const pending of [wait, ...queue]) {
    if (results[pending.nodeId] != null || skipped.includes(pending.nodeId) || nodes.has(pending.nodeId) || waits.has(pending.waitId)) {
      throw new Error('Checkpoint waiting node states conflict.')
    }
    nodes.add(pending.nodeId)
    waits.add(pending.waitId)
  }
  if (Object.keys(agents).some((id) => !nodes.has(id))) throw new Error('Checkpoint Agent has no waiting node.')
  return { agents, bindingValues, inputs, queue, results, skipped, version: 2, wait }
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

function agentConfig(prepared: PreparedFlow, node: ExecutableNode): AgentConfig | undefined {
  const task = node.kind == 'task' && node.taskId != null ? prepared.tasks[node.taskId] : undefined
  return task?.executor.kind == 'agent' ? task.executor : undefined
}

function agentNotice(prepared: PreparedFlow, node: ExecutableNode, values: Readonly<Record<string, JsonValue>>) {
  const notification = agentConfig(prepared, node)?.notification
  if (notification == null) return undefined
  const task = prepared.tasks[notification.taskId]!
  return {
    taskId: notification.taskId,
    messageHandle: notification.messageHandle,
    input: Object.fromEntries(
      task.inputs.flatMap((port) => {
        if (!('handle' in port) || port.handle == notification.messageHandle) return []
        const source = notification.inputs[port.handle]
        return [[port.handle, source == null ? (port.value ?? null) : agentInput(source, values)]]
      }),
    ),
  }
}

function agentApproval(config: AgentConfig, checkpoint: AgentCheckpoint, inputs: Readonly<Record<string, JsonValue>>): JsonValue {
  const tool = config.tools.find((item) => item.id == checkpoint.toolId)
  if (tool == null || !tool.approval || checkpoint.rounds > config.maxRounds) throw new Error('Agent pause does not match its tool declaration.')
  for (const port of tool.inputs) {
    const value = checkpoint.input[port.handle]
    if (value === undefined || (!(value === null && port.nullable) && !matchesSchema(value, port.jsonSchema)))
      throw new Error('Agent pause arguments are invalid.')
    if (port.source.kind != 'model' && !jsonEqual(value, agentInput(port.source, inputs))) throw new Error('Agent pause changed fixed arguments.')
  }
  if (Object.keys(checkpoint.input).length != tool.inputs.length) throw new Error('Agent pause contains undeclared arguments.')
  return {
    callId: checkpoint.callId,
    toolId: tool.id,
    action: tool.action,
    ...(tool.connectionId == null ? {} : { connectionId: tool.connectionId }),
    input: checkpoint.input,
  }
}

function validateOutputs(prepared: PreparedFlow, nodeId: string, node: ExecutableNode, value: unknown): Readonly<Record<string, JsonValue>> {
  const outputs = outputRecord(checkpointJson(value === undefined ? {} : value, `Node "${nodeId}" outputs`), nodeId)
  const ports =
    node.kind == 'task'
      ? portsByHandle(node.task != null ? node.task.outputs : prepared.tasks[node.taskId]!.outputs)
      : node.kind == 'subflow'
        ? portsByHandle(prepared.subflows[node.subflowId]!.outputs)
        : node.kind == 'value'
          ? portsByHandle(node.values)
          : Object.fromEntries(
              (node.kind == 'wait'
                ? node.actions
                : [...node.cases.map((item) => item.output), ...(node.defaultOutput == null ? [] : [node.defaultOutput])]
              ).map((handle) => [handle, node.input]),
            )
  for (const [handle, output] of Object.entries(outputs)) {
    const port = ports[handle]
    if (port == null || (!(output === null && port.nullable) && !matchesSchema(output, port.jsonSchema)))
      throw new Error(`Node "${nodeId}" output "${handle}" does not match its declaration.`)
  }
  if (node.kind != 'condition' && node.kind != 'wait') {
    for (const handle of Object.keys(ports)) if (!Object.hasOwn(outputs, handle)) throw new Error(`Node "${nodeId}" did not return output "${handle}".`)
  }
  return outputs
}

function validateCheckpoint(
  prepared: PreparedFlow,
  target: GraphTarget,
  checkpoint: FlowRunCheckpoint,
  incoming: ReadonlyMap<string, readonly Graph['edges'][number][]>,
  resolveInputs: (nodeId: string, node: ExecutableNode) => Readonly<Record<string, JsonValue>>,
): void {
  const completed = new Map(Object.entries(checkpoint.results))
  const skipped = new Set(checkpoint.skipped)
  const launch = checkpoint.inputs
  const agents = checkpoint.agents
  const settled = (id: string) => completed.has(id) || skipped.has(id)
  const selected = (edge: Graph['edges'][number]) => {
    const result = completed.get(edge.source)
    return result != null && (edge.sourceHandle == null || Object.hasOwn(result.outputs, edge.sourceHandle))
  }
  if ([...completed.keys(), ...skipped, ...Object.keys(launch)].some((id) => target.graph.nodes[id] == null))
    throw new Error('Checkpoint nodes do not match the prepared graph.')
  let triggers = 0
  for (const [id, node] of Object.entries(target.graph.nodes)) {
    if (!('inputs' in node)) {
      if (!settled(id)) throw new Error('Checkpoint Trigger state is missing.')
      const result = completed.get(id)
      if (result != null) {
        triggers++
        if (Object.keys(result.outputs).length != 1 || !Object.hasOwn(result.outputs, 'payload')) throw new Error('Checkpoint Trigger output is invalid.')
      }
      continue
    }
    if (!settled(id)) continue
    const edges = incoming.get(id) ?? []
    if (!edges.every((edge) => settled(edge.source))) throw new Error('Checkpoint node dependencies are incomplete.')
    const runnable = (edges.length == 0 && target.kind == 'subflow') || edges.some(selected)
    if (completed.has(id) != runnable) throw new Error('Checkpoint node state conflicts with its execution branches.')
    const result = completed.get(id)
    if (result != null) {
      validateOutputs(prepared, id, node, result.outputs)
      const count = Object.keys(result.outputs).length
      if ((node.kind == 'condition' && (count > 1 || (node.defaultOutput != null && count != 1))) || (node.kind == 'wait' && count != 1))
        throw new Error('Checkpoint branch result is invalid.')
    }
  }
  if (target.kind == 'flow' && triggers != 1) throw new Error('Checkpoint must contain exactly one selected Trigger.')
  for (const [id, values] of Object.entries(launch)) {
    const node = target.graph.nodes[id]!
    if (!('inputs' in node) || Object.keys(values).some((handle) => nodePorts(prepared, node)[handle] == null))
      throw new Error('Checkpoint launch inputs do not match the prepared graph.')
  }

  for (const waiting of [checkpoint.wait, ...checkpoint.queue]) {
    const node = target.graph.nodes[waiting.nodeId]
    if (node == null || !('inputs' in node)) throw new Error('Checkpoint waiting node is missing.')
    const config = agentConfig(prepared, node)
    const saved = agents[waiting.nodeId]
    if (node.kind != 'wait' && config == null) throw new Error('Checkpoint waiting node cannot suspend.')
    if (config != null) {
      if (saved != null && saved.invocationId != waiting.jobId) throw new Error('Checkpoint Agent invocation identity changed.')
      if (saved == null || (node.timeoutMs == null) != (saved.remainingMs == null) || (saved.remainingMs != null && saved.remainingMs > node.timeoutMs!)) {
        throw new Error('Checkpoint Agent budget is invalid.')
      }
      const approval = agentApproval(config, saved.checkpoint, saved.input)
      if (!jsonEqual(waiting.value, approval)) throw new Error('Checkpoint Agent approval does not match its saved call.')
      if (!jsonEqual(resolveInputs(waiting.nodeId, node), saved.input)) throw new Error('Checkpoint Agent inputs changed.')
    } else if (saved != null) throw new Error('Checkpoint Wait contains Agent state.')
    const waitEdges = incoming.get(waiting.nodeId) ?? []
    if (!waitEdges.every((edge) => settled(edge.source)) || waitEdges.length == 0 || !waitEdges.some(selected)) {
      throw new Error('Flow Run checkpoint Wait dependencies are incomplete.')
    }
  }
}

type NodeResult =
  | { readonly kind: 'completed'; readonly outputs: Readonly<Record<string, JsonValue>> }
  | { readonly kind: 'suspended'; readonly value: JsonValue; readonly agent: FlowRunCheckpoint['agents'][string] }

function suspendGraph(
  context: RunContext,
  target: GraphTarget,
  runId: string,
  checkpoint: FlowRunCheckpoint,
  notification: Extract<FlowRunOutcome, { readonly kind: 'waiting' }>['notification'],
): Effect.Effect<FlowRunOutcome, Error> {
  return Effect.gen(function* () {
    const { jobId, nodeId, waitId, value } = checkpoint.wait
    const node = target.graph.nodes[nodeId] as ExecutableNode
    const encoded = JSON.stringify(checkpoint)
    if (new TextEncoder().encode(encoded).byteLength > 16 * 1024 * 1024) {
      const message = 'Flow Run checkpoint exceeds 16 MiB.'
      yield* context.emit({ code: 'run.checkpoint-too-large', jobId, message, nodeId, runId, type: 'node.failed' })
      yield* context.emit({ message, runId, type: 'run.failed' })
      return yield* Effect.fail(new Error(`run.checkpoint-too-large: ${message}`))
    }
    return {
      kind: 'waiting',
      wait: {
        actions: node.kind == 'wait' ? node.actions : ['approve', 'reject'],
        prompt: node.kind == 'wait' ? node.prompt : JSON.stringify(value, null, 2),
        jobId,
        nodeId,
        waitId,
      },
      ...(notification == null ? {} : { notification }),
      checkpoint: decodeFlowRunCheckpoint(JSON.parse(encoded)),
    }
  })
}

function runGraph(
  context: RunContext,
  target: GraphTarget,
  runId: string,
  inputs: Readonly<Record<string, JsonValue>>,
  parent?: ParentRun,
  launchInputs: Readonly<Record<string, Readonly<Record<string, JsonValue>>>> = {},
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
      const order = graphOrder(target.graph).filter((id) => 'inputs' in target.graph.nodes[id]!)
      const incoming = new Map<string, Graph['edges'][number][]>()
      const children = new Map<string, Set<string>>()
      for (const edge of target.graph.edges) {
        const edges = incoming.get(edge.target) ?? []
        edges.push(edge)
        incoming.set(edge.target, edges)
        const targets = children.get(edge.source) ?? new Set<string>()
        targets.add(edge.target)
        children.set(edge.source, targets)
      }
      const resultNodes = order.filter((id) => !children.has(id)).toSorted()
      const completed = new Map(Object.entries(resume?.checkpoint.results ?? {}))
      const skipped = new Set(resume?.checkpoint.skipped ?? [])
      const started = new Set(completed.keys())
      const launch = resume?.checkpoint.inputs ?? launchInputs
      if (resume == null) {
        for (const [id, node] of Object.entries(target.graph.nodes)) {
          if ('inputs' in node) continue
          if (trigger?.nodeId == id) completed.set(id, { jobId: id, outputs: { payload: trigger.payload } })
          else skipped.add(id)
        }
      }
      const active = yield* FiberSet.make<void, Error>()
      const runNode = yield* FiberSet.runtime(active)()
      let firstCause: Cause.Cause<Error> | undefined
      let firstFailure: Error | undefined
      let suspending = resume != null
      const pendingWaits: FlowRunCheckpoint['wait'][] = resume == null ? [] : [...resume.checkpoint.queue]
      const agents: Record<string, FlowRunCheckpoint['agents'][string]> = { ...resume?.checkpoint.agents }
      for (const pending of resume == null ? [] : [resume.checkpoint.wait, ...resume.checkpoint.queue]) started.add(pending.nodeId)
      const settled = (id: string) => completed.has(id) || skipped.has(id)
      const selected = (edge: Graph['edges'][number]) => {
        const result = completed.get(edge.source)
        return result != null && (edge.sourceHandle == null || Object.hasOwn(result.outputs, edge.sourceHandle))
      }
      const resolveInput = (mapping: InputMapping | undefined, port: InputPortDefinition, supplied: JsonValue | undefined, description: string): JsonValue => {
        let value = mapping?.kind == 'value' ? mapping.value : supplied === undefined ? port.value : supplied
        if (mapping?.kind == 'sources') {
          const values = mapping.sources.flatMap((source) => {
            if (source.kind == 'binding') return Object.hasOwn(context.bindingValues, source.bindingId) ? [context.bindingValues[source.bindingId]!] : []
            if (source.kind == 'flow') return Object.hasOwn(inputs, source.input) ? [inputs[source.input]!] : []
            const outputs = completed.get(source.nodeId)?.outputs
            return outputs != null && Object.hasOwn(outputs, source.output) ? [outputs[source.output]!] : []
          })
          if (values.length != 1) throw new Error(`${description} requires exactly one available source.`)
          value = values[0]
        }
        if (value === undefined && port.nullable) value = null
        if (value === undefined || (!(value === null && port.nullable) && !matchesSchema(value, port.jsonSchema)))
          throw new Error(`${description} does not match its declared schema.`)
        return value
      }
      const resolveInputs = (nodeId: string, node: ExecutableNode): Readonly<Record<string, JsonValue>> => {
        const mappings = nodeMappings(node)
        return Object.fromEntries(
          Object.entries(nodePorts(context.prepared, node)).map(([handle, port]) => [
            handle,
            resolveInput(mappings[handle], port, launch[nodeId]?.[handle], `Node "${nodeId}" input "${handle}"`),
          ]),
        )
      }
      const commit = (nodeId: string, jobId: string, outputs: Readonly<Record<string, JsonValue>>) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            yield* context.emit({ jobId, nodeId, outputs, runId, type: 'node.completed' })
            completed.set(nodeId, { jobId, outputs })
            yield* context.emit({ progress: order.length == 0 ? 100 : (order.filter(settled).length / order.length) * 100, runId, type: 'run.progress' })
          }),
        )
      let scheduleReady: (nodeId: string) => void
      const executeNode = (
        nodeId: string,
        node: ExecutableNode,
        jobId: string,
        nodeInputs: Readonly<Record<string, JsonValue>>,
        resolution?: 'approve' | 'reject',
      ): Effect.Effect<NodeResult, Error> => {
        const config = agentConfig(context.prepared, node)
        const saved = agents[nodeId]
        const remainingMs = saved?.remainingMs ?? node.timeoutMs
        const startedAt = performance.now()
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
          if (resolution == null)
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
              break
            }
            case 'value': {
              outputs = Object.fromEntries(node.values.map((port) => [port.handle, port.value ?? null]))
              break
            }
            case 'subflow': {
              const subflow = context.prepared.subflows[node.subflowId]!
              const result = yield* runGraph(
                context,
                {
                  flowId: node.subflowId,
                  graph: subflow.graph,
                  kind: 'subflow',
                },
                context.createId(),
                nodeInputs,
                { jobId, runId },
              )
              outputs = result as Readonly<Record<string, JsonValue>>
              break
            }
            case 'task': {
              const additional = new Set((node.additionalInputs ?? []).map((port) => port.handle))
              const result = yield* context.invokeTask({
                additionalInputs: Object.fromEntries(Object.entries(nodeInputs).filter(([handle]) => additional.has(handle))),
                blockId: node.task != null ? node.task.moduleId : node.taskId,
                flowId: target.flowId,
                input: Object.fromEntries(Object.entries(nodeInputs).filter(([handle]) => !additional.has(handle))),
                invocationId: saved?.invocationId ?? (config == null ? context.createId() : jobId),
                ...(resolution == null || saved == null ? {} : { agent: { action: resolution, checkpoint: saved.checkpoint } }),
                jobId,
                nodeId,
                runId,
                ...(node.task != null ? { capabilities: node.task.capabilities ?? [], moduleId: node.task.moduleId } : { taskId: node.taskId }),
              })
              if (config != null) {
                const response: AgentResult = agentResultSchema.parse(result)
                if (response.kind == 'suspended') {
                  if (target.kind != 'flow') return yield* Effect.fail(new Error('Subflow Agent is not supported.'))
                  const checkpoint = response.checkpoint
                  const value = agentApproval(config, checkpoint, nodeInputs)
                  const left = remainingMs == null ? undefined : remainingMs - (performance.now() - startedAt)
                  if (left != null && left <= 0) throw new Error(`Node "${nodeId}" timed out.`)
                  return {
                    kind: 'suspended' as const,
                    value,
                    agent: {
                      invocationId: saved?.invocationId ?? jobId,
                      input: nodeInputs,
                      ...(left == null ? {} : { remainingMs: left }),
                      checkpoint,
                    },
                  }
                }
                outputs = { output: response.output }
              } else outputs = outputRecord(result, nodeId)
              break
            }
            case 'wait':
              return yield* Effect.fail(new Error('Wait jobs are handled by the Scheduler suspension boundary.'))
          }
          return yield* Effect.try({
            try: () => ({ kind: 'completed' as const, outputs: validateOutputs(context.prepared, nodeId, node, outputs) }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          })
        })
        return remainingMs == null
          ? execution
          : execution.pipe(
              Effect.timeoutOrElse({
                duration: remainingMs,
                orElse: () => Effect.fail(new Error(`Node "${nodeId}" timed out.`)),
              }),
            )
      }

      const settleNode = (nodeId: string, jobId: string, result: NodeResult): Effect.Effect<void, Error> => {
        if (result.kind == 'completed') {
          delete agents[nodeId]
          return commit(nodeId, jobId, result.outputs)
        }
        agents[nodeId] = result.agent
        pendingWaits.push({ jobId, nodeId, waitId: context.createId(), value: result.value })
        suspending = true
        return Effect.void
      }

      const observe = (nodeId: string, jobId: string, effect: Effect.Effect<void, Error>) =>
        effect.pipe(
          Effect.catchDefect((error) => Effect.fail(error instanceof Error ? error : new Error(String(error)))),
          Effect.tapError((error) =>
            Effect.gen(function* () {
              if (firstCause == null) firstFailure ??= error
              yield* context.emit({ ...nodeFailure(error, context.projectFailure), jobId, nodeId, runId, type: 'node.failed' }).pipe(Effect.ignore)
            }),
          ),
          Effect.tapCause((cause) =>
            Effect.sync(() => {
              firstCause ??= cause
            }),
          ),
        )
      scheduleReady = (nodeId) => {
        if (firstCause != null || suspending || started.has(nodeId) || skipped.has(nodeId)) return
        const node = target.graph.nodes[nodeId]!
        if (!('inputs' in node)) return
        const edges = incoming.get(nodeId) ?? []
        if (!edges.every((edge) => settled(edge.source))) return
        if ((edges.length == 0 && target.kind == 'flow') || (edges.length > 0 && !edges.some(selected))) {
          skipped.add(nodeId)
          runNode(
            Effect.sync(() => {
              for (const child of children.get(nodeId) ?? []) scheduleReady(child)
            }),
          )
          return
        }
        started.add(nodeId)
        const jobId = context.createId()
        if (node.kind == 'wait') suspending = true
        runNode(
          observe(
            nodeId,
            jobId,
            Effect.gen(function* () {
              const nodeInputs = yield* Effect.try({
                try: () => resolveInputs(nodeId, node),
                catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              })
              if (node.kind == 'wait') {
                const mapping = node.inputs[node.input.handle]
                yield* context.emit({
                  inputs:
                    mapping?.kind == 'sources' && mapping.sources.some((source) => source.kind == 'binding')
                      ? {}
                      : { [node.input.handle]: nodeInputs[node.input.handle]! },
                  jobId,
                  nodeId,
                  nodeKind: 'wait',
                  ...(node.name == null ? {} : { nodeTitle: node.name }),
                  runId,
                  type: 'node.started',
                })
                const waitId = nanoid()
                pendingWaits.push({ jobId, nodeId, waitId, value: nodeInputs[node.input.handle]! })
                return
              }
              const result = yield* executeNode(nodeId, node, jobId, nodeInputs)
              yield* settleNode(nodeId, jobId, result)
              if (result.kind == 'completed') {
                for (const child of children.get(nodeId) ?? []) scheduleReady(child)
              }
            }),
          ),
        )
      }
      if (resume != null) {
        yield* Effect.try({
          try: () => validateCheckpoint(context.prepared, target, resume.checkpoint, incoming, resolveInputs),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })
        const saved = resume.checkpoint.wait
        const node = target.graph.nodes[saved.nodeId] as ExecutableNode
        yield* observe(
          saved.nodeId,
          saved.jobId,
          Effect.gen(function* () {
            if (node.kind == 'wait') {
              if (!node.actions.some((action) => action == resume.action))
                return yield* Effect.fail(new Error('Checkpoint resolution does not match Wait actions.'))
              yield* commit(saved.nodeId, saved.jobId, validateOutputs(context.prepared, saved.nodeId, node, { [resume.action]: saved.value }))
            } else {
              if (resume.action == 'continue') return yield* Effect.fail(new Error('Agent requires approve or reject.'))
              const result = yield* executeNode(saved.nodeId, node, saved.jobId, agents[saved.nodeId]!.input, resume.action)
              yield* settleNode(saved.nodeId, saved.jobId, result)
            }
          }),
        ).pipe(Effect.exit)
        suspending = pendingWaits.length > 0
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
      if (pendingWaits.length > 0) {
        if (target.kind != 'flow') return yield* Effect.fail(new Error('Subflow Wait is not supported.'))
        if (resume == null) pendingWaits.sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0))
        const [pendingWait, ...queue] = pendingWaits
        const { jobId, nodeId, waitId, value } = pendingWait!
        const node = target.graph.nodes[nodeId] as ExecutableNode
        let notification =
          node.kind == 'wait' && node.notification != null
            ? {
                taskId: node.notification.taskId,
                messageHandle: node.notification.messageHandle,
                input: Object.fromEntries(
                  Object.entries(nodePorts(context.prepared, node))
                    .filter(([handle]) => handle.startsWith(notificationPrefix))
                    .map(([handle, port]) => [
                      handle.slice(notificationPrefix.length),
                      resolveInput(nodeMappings(node)[handle], port, launch[nodeId]?.[handle], `Wait notification ${handle}`),
                    ]),
                ),
              }
            : undefined
        if (agents[nodeId] != null) notification = agentNotice(context.prepared, node, agents[nodeId]!.input)
        const checkpointSource: FlowRunCheckpoint = {
          bindingValues: context.bindingValues,
          inputs: launch,
          results: Object.fromEntries(completed),
          skipped: [...skipped].toSorted(),
          version: 2,
          agents,
          queue,
          wait: { jobId, nodeId, value, waitId },
        }
        return yield* suspendGraph(context, target, runId, checkpointSource, notification)
      }
      if (!order.every(settled)) return yield* Effect.fail(new Error('Execution graph contains unresolved dependencies.'))
      if (target.kind == 'subflow') {
        const subflow = context.prepared.subflows[target.flowId]!
        const outputs = yield* Effect.try({
          try: () =>
            Object.fromEntries(
              subflow.outputs.map((port) => [
                port.handle,
                resolveInput({ kind: 'sources', sources: port.sources }, port, undefined, `Subflow output "${port.handle}"`),
              ]),
            ),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })
        yield* context.emit({ result: { kind: 'function-outputs', outputs, target: 'subflow' }, runId, type: 'run.completed' })
        return outputs
      }
      const result: FlowRunResult = {
        kind: 'node-results',
        nodes: resultNodes.flatMap((nodeId) => {
          const saved = completed.get(nodeId)
          return saved == null ? [] : [{ nodeId, status: 'completed' as const, jobId: saved.jobId, outputs: saved.outputs }]
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
    const checkpoint = options.resume == null ? undefined : decodeFlowRunCheckpoint(options.resume.checkpoint)
    if (checkpoint != null && new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength > 16 * 1024 * 1024) {
      return yield* Effect.fail(new Error('Flow Run checkpoint exceeds 16 MiB.'))
    }
    if (checkpoint == null && options.trigger == null) {
      return yield* Effect.fail(new Error('A Flow Run requires a Trigger seed.'))
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
      { flowId: options.flowId, graph: prepared.graph, kind: 'flow' },
      options.runId,
      {},
      undefined,
      options.inputs,
      options.trigger,
      checkpoint == null ? undefined : { action: options.resume!.action, checkpoint },
    )) as FlowRunOutcome
  })
  return program
}
