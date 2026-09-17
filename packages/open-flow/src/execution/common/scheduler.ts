import type * as Cause from 'effect/Cause'
import type { AgentConfig } from '../../flow/common/agent.ts'
import type { ConnectorCapability, Graph, GraphNode, InputMapping, InputPortDefinition, JsonValue, TriggerNode, WaitAction } from '../../flow/common/change.ts'
import type { PreparedFlow } from '../../flow/common/semantics.ts'
import type { AgentCheckpoint, AgentResult } from './runtime.ts'

import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as FiberSet from 'effect/FiberSet'
import * as Queue from 'effect/Queue'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { agentInput } from '../../flow/common/agent.ts'
import { portsByHandle } from '../../flow/common/change.ts'
import { isResolutionNode, resolutionActions, resolutionOutputPorts } from '../../flow/common/graph.ts'
import { matchesSchema } from '../../flow/common/schema.ts'
import { matchesTriggerOutputs } from '../../trigger/common/contract.ts'

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
      readonly nodeKind: 'agent' | 'approval' | 'condition' | 'connector' | 'javascript' | 'llm' | 'subflow' | 'value' | 'wait'
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

function usesPending(graph: Graph, nodeId: string): boolean {
  return (
    graph.edges.some((edge) => edge.source == nodeId && edge.sourceHandle == 'pending') ||
    Object.values(graph.nodes).some(
      (node) =>
        'inputs' in node &&
        Object.values(node.inputs).some(
          (mapping) =>
            mapping.kind == 'sources' && mapping.sources.some((source) => source.kind == 'node' && source.nodeId == nodeId && source.output == 'pending'),
        ),
    )
  )
}

export interface PendingWait {
  readonly jobId: string
  readonly nodeId: string
  readonly value: JsonValue
  readonly waitId: string
  readonly pending?: JsonValue
}

export interface WaitRequest {
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
    readonly taskId: string
  }
}

export type WaitOperation =
  | { readonly kind: 'create'; readonly wait: WaitRequest }
  | { readonly kind: 'resolutions'; readonly waitIds: readonly string[]; readonly block: boolean }

export interface WaitHost {
  readonly create: (wait: WaitRequest) => Effect.Effect<JsonValue | undefined, Error>
  readonly resolutions: (waitIds: readonly string[], block: boolean) => Effect.Effect<Readonly<Record<string, WaitAction>>, Error>
}

export const waitRetentionMs = 120_000

export interface FlowRunCheckpoint {
  readonly bindingValues: Readonly<Record<string, string>>
  readonly inputs: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>
  readonly results: Readonly<Record<string, { readonly jobId: string; readonly outputs: Readonly<Record<string, JsonValue>> }>>
  readonly counts: Readonly<Record<string, Readonly<Record<string, number>>>>
  readonly frames: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, JsonValue>>>>>>
  readonly version: 5
  readonly waits: readonly PendingWait[]
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
}

export type FlowRunOutcome =
  | FlowRunResult
  | {
      readonly checkpoint: FlowRunCheckpoint
      readonly kind: 'waiting'
      readonly remainingMs?: number
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
  readonly outputs: Readonly<Record<string, JsonValue>>
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
    case 'approval':
    case 'wait':
      return { [node.input.handle]: node.input }
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
    case 'approval':
      return 'Approval'
    case 'wait':
      return 'Wait'
  }
}

function nodeKind(
  prepared: PreparedFlow,
  node: ExecutableNode,
): 'agent' | 'approval' | 'condition' | 'connector' | 'javascript' | 'llm' | 'subflow' | 'value' | 'wait' {
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
  checkpointExact(source, ['agents', 'bindingValues', 'counts', 'frames', 'inputs', 'results', 'version', 'waits'], 'Flow Run checkpoint')
  if (source.version != 5) throw new Error('Flow Run checkpoint version is unsupported.')
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
  const counts = z.record(z.string(), z.record(z.string(), z.number().int().positive().max(Number.MAX_SAFE_INTEGER))).parse(source.counts)
  const frames = z.record(z.string(), z.record(z.string(), z.record(z.string(), z.json()))).parse(source.frames)
  const savedWait = z.strictObject({
    jobId: z.string().min(1),
    nodeId: z.string().min(1),
    value: z.json(),
    waitId: z.string().min(1),
    pending: z.json().optional(),
  })
  const pendingWaits = z.array(savedWait).min(1).parse(source.waits)
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
  const jobs = new Set<string>()
  const waits = new Set<string>()
  for (const pending of pendingWaits) {
    if (
      jobs.has(pending.jobId) ||
      waits.has(pending.waitId) ||
      frames[pending.jobId] == null ||
      Object.values(results).some((result) => result.jobId == pending.jobId)
    ) {
      throw new Error('Checkpoint waiting execution states conflict.')
    }
    jobs.add(pending.jobId)
    waits.add(pending.waitId)
  }
  if (Object.keys(frames).some((id) => !jobs.has(id))) throw new Error('Checkpoint frame has no waiting execution.')
  if (Object.keys(agents).some((id) => !jobs.has(id))) throw new Error('Checkpoint Agent has no waiting execution.')
  return { agents, bindingValues, counts, frames, inputs, results, version: 5, waits: pendingWaits }
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
  const raw = outputRecord(value, nodeId)
  const discardUndeclared = node.kind == 'task' && node.taskId != null && prepared.tasks[node.taskId]!.executor.kind == 'connector'
  const ports = isResolutionNode(node)
    ? resolutionOutputPorts(node)
    : node.kind == 'task'
      ? portsByHandle(node.task != null ? node.task.outputs : prepared.tasks[node.taskId]!.outputs)
      : node.kind == 'subflow'
        ? portsByHandle(prepared.subflows[node.subflowId]!.outputs)
        : node.kind == 'value'
          ? portsByHandle(node.values)
          : Object.fromEntries(
              [...node.cases.map((item) => item.output), ...(node.defaultOutput == null ? [] : [node.defaultOutput])].map((handle) => [handle, node.input]),
            )
  const outputs = outputRecord(
    checkpointJson(
      Object.fromEntries(Object.entries(raw).map(([handle, item]) => [handle, Object.hasOwn(ports, handle) && item === undefined ? null : item])),
      `Node "${nodeId}" outputs`,
    ),
    nodeId,
  )
  const complete =
    node.kind == 'condition' || isResolutionNode(node) ? outputs : { ...Object.fromEntries(Object.keys(ports).map((handle) => [handle, null])), ...outputs }
  const validated: Record<string, JsonValue> = {}
  for (const [handle, output] of Object.entries(complete)) {
    const port = ports[handle]
    if (port == null) {
      if (discardUndeclared) continue
      throw new Error(`Node "${nodeId}" output "${handle}" does not match its declaration.`)
    }
    if (!(output === null && port.nullable) && !matchesSchema(output, port.jsonSchema))
      throw new Error(`Node "${nodeId}" output "${handle}" does not match its declaration.`)
    validated[handle] = output
  }
  return validated
}

function validateCheckpoint(
  prepared: PreparedFlow,
  target: GraphTarget,
  checkpoint: FlowRunCheckpoint,
  resolveInputs: (nodeId: string, node: ExecutableNode, jobId: string) => Readonly<Record<string, JsonValue>>,
): void {
  const launch = checkpoint.inputs
  const agents = checkpoint.agents
  if ([...Object.keys(checkpoint.results), ...Object.keys(launch)].some((id) => target.graph.nodes[id] == null))
    throw new Error('Checkpoint nodes do not match the prepared graph.')
  for (const [scope, counts] of Object.entries(checkpoint.counts)) {
    const graph = scope == '' ? target.graph : prepared.subflows[scope]?.graph
    if (graph == null) throw new Error('Checkpoint execution counts reference an unknown graph.')
    for (const [id, count] of Object.entries(counts)) {
      const node = graph.nodes[id]
      if (node == null || !('inputs' in node) || count > (node.maxExecutions ?? 1000)) throw new Error('Checkpoint execution count is invalid.')
    }
  }
  const validateResults = (results: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>, frame = false) => {
    for (const [id, outputs] of Object.entries(results)) {
      const node = target.graph.nodes[id]
      if (node == null) throw new Error('Checkpoint result node is missing.')
      if (!('inputs' in node)) {
        if (!matchesTriggerOutputs(node, outputs)) throw new Error('Checkpoint Trigger output is invalid.')
      } else {
        if (checkpoint.counts['']?.[id] == null) throw new Error('Checkpoint execution count is missing.')
        if (!jsonEqual(validateOutputs(prepared, id, node, outputs), outputs)) throw new Error('Checkpoint node outputs are incomplete.')
        const count = Object.keys(outputs).length
        if (
          (node.kind == 'condition' && (count > 1 || (node.defaultOutput != null && count != 1))) ||
          (isResolutionNode(node) &&
            (resolutionActions(node).filter((action) => Object.hasOwn(outputs, action)).length > 1 ||
              (!resolutionActions(node).some((action) => Object.hasOwn(outputs, action)) && !(frame && Object.hasOwn(outputs, 'pending')))))
        )
          throw new Error('Checkpoint branch result is invalid.')
      }
    }
  }
  validateResults(Object.fromEntries(Object.entries(checkpoint.results).map(([id, result]) => [id, result.outputs])))
  const triggerIds = Object.keys(checkpoint.results).filter((id) => !('inputs' in target.graph.nodes[id]!))
  if (triggerIds.length != 1) throw new Error('Checkpoint must contain exactly one selected Trigger.')
  for (const frame of Object.values(checkpoint.frames)) {
    validateResults(frame, true)
    const triggers = Object.keys(frame).filter((id) => !('inputs' in target.graph.nodes[id]!))
    if (triggers.length != 1 || triggers[0] != triggerIds[0] || !jsonEqual(frame[triggers[0]!]!, checkpoint.results[triggers[0]!]!.outputs))
      throw new Error('Checkpoint frame Trigger does not match the Run.')
  }
  const pendingCounts = new Map<string, number>()
  for (const waiting of checkpoint.waits) pendingCounts.set(waiting.nodeId, (pendingCounts.get(waiting.nodeId) ?? 0) + 1)
  for (const [id, count] of pendingCounts) {
    if ((checkpoint.counts['']?.[id] ?? 0) < count + (checkpoint.results[id] == null ? 0 : 1))
      throw new Error('Checkpoint waiting execution count is incomplete.')
  }
  for (const [id, values] of Object.entries(launch)) {
    const node = target.graph.nodes[id]!
    if (!('inputs' in node) || Object.keys(values).some((handle) => nodePorts(prepared, node)[handle] == null))
      throw new Error('Checkpoint launch inputs do not match the prepared graph.')
  }

  for (const waiting of checkpoint.waits) {
    const node = target.graph.nodes[waiting.nodeId]
    if (node == null || !('inputs' in node)) throw new Error('Checkpoint waiting node is missing.')
    const config = agentConfig(prepared, node)
    const saved = agents[waiting.jobId]
    if (!isResolutionNode(node) && config == null) throw new Error('Checkpoint waiting node cannot suspend.')
    if (config != null) {
      if (saved != null && saved.invocationId != waiting.jobId) throw new Error('Checkpoint Agent invocation identity changed.')
      if (saved == null || (node.timeoutMs == null) != (saved.remainingMs == null) || (saved.remainingMs != null && saved.remainingMs > node.timeoutMs!)) {
        throw new Error('Checkpoint Agent budget is invalid.')
      }
      const approval = agentApproval(config, saved.checkpoint, saved.input)
      if (!jsonEqual(waiting.value, approval)) throw new Error('Checkpoint Agent approval does not match its saved call.')
      if (!jsonEqual(resolveInputs(waiting.nodeId, node, waiting.jobId), saved.input)) throw new Error('Checkpoint Agent inputs changed.')
    } else {
      if (saved != null) throw new Error('Checkpoint Wait contains Agent state.')
      if (!isResolutionNode(node) || !jsonEqual(resolveInputs(waiting.nodeId, node, waiting.jobId)[node.input.handle]!, waiting.value))
        throw new Error('Checkpoint resolution input changed.')
      const notify = usesPending(target.graph, waiting.nodeId)
      if (notify != (waiting.pending != null)) throw new Error('Checkpoint Wait pending output is missing or unexpected.')
      if (waiting.pending != null) validateOutputs(prepared, waiting.nodeId, node, { pending: waiting.pending })
    }
    if (checkpoint.counts['']?.[waiting.nodeId] == null) throw new Error('Checkpoint waiting execution count is missing.')
  }
}

type NodeResult =
  | { readonly kind: 'completed'; readonly outputs: Readonly<Record<string, JsonValue>> }
  | { readonly kind: 'suspended'; readonly value: JsonValue; readonly agent: FlowRunCheckpoint['agents'][string] }

function runGraph(
  context: RunContext,
  target: GraphTarget,
  runId: string,
  inputs: Readonly<Record<string, JsonValue>>,
  parent?: ParentRun,
  launchInputs: Readonly<Record<string, Readonly<Record<string, JsonValue>>>> = {},
  trigger?: TriggerSeed,
  resume?: { readonly checkpoint: FlowRunCheckpoint },
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
      const order = Object.keys(target.graph.nodes).filter((id) => 'inputs' in target.graph.nodes[id]!)
      const incoming = new Set<string>()
      const outgoing = new Map<string, Graph['edges'][number][]>()
      for (const edge of target.graph.edges) {
        incoming.add(edge.target)
        const targets = outgoing.get(edge.source) ?? []
        targets.push(edge)
        outgoing.set(edge.source, targets)
      }
      const resultNodes = order.filter((id) => !outgoing.has(id)).toSorted()
      const completed = new Map(Object.entries(resume?.checkpoint.results ?? {}))
      const counts = (context.counts[target.kind == 'flow' ? '' : target.flowId] ??= {})
      const frames: Record<string, Readonly<Record<string, Readonly<Record<string, JsonValue>>>>> = { ...resume?.checkpoint.frames }
      const launch = resume?.checkpoint.inputs ?? launchInputs
      if (resume == null) {
        if (trigger != null) {
          const node = target.graph.nodes[trigger.nodeId]
          if (node == null || 'inputs' in node || !matchesTriggerOutputs(node, trigger.outputs)) throw new Error('Trigger outputs are invalid.')
        }
        for (const [id, node] of Object.entries(target.graph.nodes)) {
          if ('inputs' in node) continue
          if (trigger?.nodeId == id) completed.set(id, { jobId: id, outputs: trigger.outputs })
        }
      }
      const active = yield* FiberSet.make<void, Error>()
      const runNode = yield* FiberSet.runtime(active)()
      let firstCause: Cause.Cause<Error> | undefined
      let firstFailure: Error | undefined
      const pendingWaits = new Map((resume?.checkpoint.waits ?? []).map((wait) => [wait.jobId, wait]))
      const changes = yield* Queue.unbounded<void>()
      let remainingMs = context.remainingMs
      let measuredAt = yield* Clock.currentTimeMillis
      let idleSince: number | undefined
      const agents: Record<string, FlowRunCheckpoint['agents'][string]> = { ...resume?.checkpoint.agents }
      const resolveInput = (
        mapping: InputMapping | undefined,
        port: InputPortDefinition,
        supplied: JsonValue | undefined,
        description: string,
        valuesByNode: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>,
      ): JsonValue => {
        let value = mapping?.kind == 'value' ? mapping.value : supplied === undefined ? port.value : supplied
        if (mapping?.kind == 'sources') {
          const values = mapping.sources.flatMap((source) => {
            if (source.kind == 'binding') return Object.hasOwn(context.bindingValues, source.bindingId) ? [context.bindingValues[source.bindingId]!] : []
            if (source.kind == 'flow') return Object.hasOwn(inputs, source.input) ? [inputs[source.input]!] : []
            const outputs = valuesByNode[source.nodeId]
            return outputs != null && Object.hasOwn(outputs, source.output) ? [outputs[source.output]!] : []
          })
          if (values.length > 1) throw new Error(`${description} has multiple available sources.`)
          value = values[0] ?? null
        }
        if (value === undefined) value = null
        if (!(value === null && port.nullable) && !matchesSchema(value, port.jsonSchema)) throw new Error(`${description} does not match its declared schema.`)
        return value
      }
      const resolveInputs = (nodeId: string, node: ExecutableNode, jobId: string): Readonly<Record<string, JsonValue>> => {
        const mappings = node.inputs
        return Object.fromEntries(
          Object.entries(nodePorts(context.prepared, node)).map(([handle, port]) => [
            handle,
            resolveInput(mappings[handle], port, launch[nodeId]?.[handle], `Node "${nodeId}" input "${handle}"`, frames[jobId]!),
          ]),
        )
      }
      const commit = (nodeId: string, jobId: string, outputs: Readonly<Record<string, JsonValue>>, releasedHandles: readonly string[] = Object.keys(outputs)) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            yield* context.emit({ jobId, nodeId, outputs, runId, type: 'node.completed' })
            completed.set(nodeId, { jobId, outputs })
            const frame = { ...frames[jobId], [nodeId]: outputs }
            delete frames[jobId]
            dispatch(nodeId, releasedHandles, frame)
          }),
        )
      const ready: { nodeId: string; frame: Readonly<Record<string, Readonly<Record<string, JsonValue>>>> }[] = []
      const scheduleReady = (nodeId: string, frame: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>) => {
        ready.push({ nodeId, frame })
      }
      const dispatch = (nodeId: string, releasedHandles: readonly string[], frame: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>) => {
        for (const edge of outgoing.get(nodeId) ?? []) {
          if (edge.sourceHandle == null || releasedHandles.includes(edge.sourceHandle)) scheduleReady(edge.target, frame)
        }
      }
      const executeNode = (
        nodeId: string,
        node: ExecutableNode,
        jobId: string,
        nodeInputs: Readonly<Record<string, JsonValue>>,
        resolution?: 'approve' | 'reject',
      ): Effect.Effect<NodeResult, Error> => {
        const config = agentConfig(context.prepared, node)
        const saved = agents[jobId]
        const nodeRemainingMs = saved?.remainingMs ?? node.timeoutMs
        const startedAt = performance.now()
        const execution = Effect.gen(function* () {
          const kind = nodeKind(context.prepared, node)
          const title = nodeTitle(context.prepared, node)
          const projectedInputs = Object.fromEntries(
            Object.entries(nodeInputs).filter(([handle]) => {
              if (isResolutionNode(node)) return handle == node.input.handle
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
                  const left = nodeRemainingMs == null ? undefined : nodeRemainingMs - (performance.now() - startedAt)
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
            case 'approval':
            case 'wait':
              return yield* Effect.fail(new Error('Resolution jobs are handled by the Scheduler suspension boundary.'))
          }
          return yield* Effect.try({
            try: () => ({ kind: 'completed' as const, outputs: validateOutputs(context.prepared, nodeId, node, outputs) }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          })
        })
        return nodeRemainingMs == null
          ? execution
          : execution.pipe(
              Effect.timeoutOrElse({
                duration: nodeRemainingMs,
                orElse: () => Effect.fail(new Error(`Node "${nodeId}" timed out.`)),
              }),
            )
      }

      const createWait = (nodeId: string, jobId: string, value: JsonValue) =>
        Effect.gen(function* () {
          if (target.kind != 'flow' || context.waits == null) return yield* Effect.fail(new Error('Wait host is unavailable.'))
          const node = target.graph.nodes[nodeId] as ExecutableNode
          const waitId = nanoid()
          const notify = isResolutionNode(node) && usesPending(target.graph, nodeId)
          const pending = yield* context.waits.create({
            jobId,
            nodeId,
            value,
            waitId,
            notify,
            actions: isResolutionNode(node) ? resolutionActions(node) : ['approve', 'reject'],
            prompt: isResolutionNode(node) ? node.prompt : JSON.stringify(value, null, 2),
            ...(isResolutionNode(node) ? {} : { notification: agentNotice(context.prepared, node, agents[jobId]!.input) }),
          })
          if (notify) {
            validateOutputs(context.prepared, nodeId, node, { pending: pending! })
            const frame = { ...frames[jobId], [nodeId]: { pending: pending! } }
            dispatch(nodeId, ['pending'], frame)
          }
          pendingWaits.set(jobId, { jobId, nodeId, value, waitId, ...(notify ? { pending: pending! } : {}) })
          yield* Queue.offer(changes, undefined)
        })
      const settleNode = (nodeId: string, jobId: string, result: NodeResult): Effect.Effect<void, Error> => {
        if (result.kind == 'completed') {
          delete agents[jobId]
          return commit(nodeId, jobId, result.outputs)
        }
        agents[jobId] = result.agent
        return createWait(nodeId, jobId, result.value)
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
      const executeReady = (nodeId: string, frame: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>) => {
        if (firstCause != null) return
        const node = target.graph.nodes[nodeId]!
        if (!('inputs' in node)) return
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
        frames[jobId] = frame
        runNode(
          observe(
            nodeId,
            jobId,
            Effect.gen(function* () {
              const nodeInputs = yield* Effect.try({
                try: () => resolveInputs(nodeId, node, jobId),
                catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              })
              if (isResolutionNode(node)) {
                const mapping = node.inputs[node.input.handle]
                yield* context.emit({
                  inputs:
                    mapping?.kind == 'sources' && mapping.sources.some((source) => source.kind == 'binding')
                      ? {}
                      : { [node.input.handle]: nodeInputs[node.input.handle]! },
                  jobId,
                  nodeId,
                  nodeKind: node.kind,
                  ...(node.name == null ? {} : { nodeTitle: node.name }),
                  runId,
                  type: 'node.started',
                })
                yield* createWait(nodeId, jobId, nodeInputs[node.input.handle]!)
                return
              }
              const result = yield* executeNode(nodeId, node, jobId, nodeInputs)
              yield* settleNode(nodeId, jobId, result)
            }),
          ).pipe(Effect.ensuring(Queue.offer(changes, undefined))),
        )
      }
      if (resume != null) {
        yield* Effect.try({
          try: () => validateCheckpoint(context.prepared, target, resume.checkpoint, resolveInputs),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })
      }
      if (resume == null) {
        if (trigger != null) dispatch(trigger.nodeId, Object.keys(trigger.outputs), { [trigger.nodeId]: trigger.outputs })
        else for (const nodeId of order) if (!incoming.has(nodeId)) scheduleReady(nodeId, {})
      }

      const applyResolutions = (resolutions: Readonly<Record<string, WaitAction>>, now: number) => {
        for (const saved of pendingWaits.values()) {
          const action = resolutions[saved.waitId]
          if (action == null) continue
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
                    validateOutputs(context.prepared, saved.nodeId, node, {
                      ...(saved.pending == null ? {} : { pending: saved.pending }),
                      [action]: saved.value,
                    }),
                    [action],
                  )
                } else {
                  if (action == 'continue') return yield* Effect.fail(new Error('Agent requires approve or reject.'))
                  yield* settleNode(saved.nodeId, saved.jobId, yield* executeNode(saved.nodeId, node, saved.jobId, agents[saved.jobId]!.input, action))
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
          yield* context.emit({ message: firstFailure?.message ?? 'Execution failed.', runId, type: 'run.failed' }).pipe(Effect.ignore)
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
        for (const arrival of ready.splice(0)) executeReady(arrival.nodeId, arrival.frame)
        const running = yield* FiberSet.size(active)
        if (firstCause != null) continue
        if (running == 0 && pendingWaits.size == 0 && ready.length == 0) break
        if (running > 0 || ready.length > 0) idleSince = undefined
        else idleSince ??= now
        const left = idleSince == null ? remainingMs : waitRetentionMs - (now - idleSince)
        if (idleSince != null && left! <= 0) {
          const checkpoint: FlowRunCheckpoint = {
            bindingValues: context.bindingValues,
            inputs: launch,
            results: Object.fromEntries(completed),
            counts: context.counts,
            frames,
            version: 5,
            agents,
            waits: [...pendingWaits.values()],
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
        if (left != null) next = Effect.raceFirst(next, Effect.sleep(Math.max(0, left)).pipe(Effect.as({})))
        const resolutions = yield* next
        applyResolutions(resolutions, yield* Clock.currentTimeMillis)
      }
      yield* context.emit({ progress: 100, runId, type: 'run.progress' })
      if (target.kind == 'subflow') {
        const subflow = context.prepared.subflows[target.flowId]!
        const outputs = yield* Effect.try({
          try: () =>
            Object.fromEntries(
              subflow.outputs.map((port) => [
                port.handle,
                resolveInput(
                  { kind: 'sources', sources: port.sources },
                  port,
                  undefined,
                  `Subflow output "${port.handle}"`,
                  Object.fromEntries([...completed].map(([id, result]) => [id, result.outputs])),
                ),
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
      { flowId: options.flowId, graph: prepared.graph, kind: 'flow' },
      options.runId,
      {},
      undefined,
      options.inputs,
      options.trigger,
      checkpoint == null ? undefined : { checkpoint },
    )) as FlowRunOutcome
  })
  return program
}
