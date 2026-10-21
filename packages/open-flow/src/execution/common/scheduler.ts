import type { AgentConfig } from '../../flow/common/agent.ts'
import type {
  ConnectorCapability,
  Graph,
  GraphNode,
  InputMapping,
  InputPortDefinition,
  JsonValue,
  TriggerNode,
  WaitAction,
  WaitAutoContinue,
} from '../../flow/common/change.ts'
import type { NodeErrorData } from '../../flow/common/errorHandling.ts'
import type { PreparedFlow } from '../../flow/common/semantics.ts'
import type { WebhookResponseSnapshot } from '../../flow/common/webhookResponse.ts'
import type { PreviousNode } from '../../types/index.ts'
import type { AgentCheckpoint, AgentResult } from './runtime.ts'

import * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as FiberSet from 'effect/FiberSet'
import * as Queue from 'effect/Queue'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { agentInput } from '../../flow/common/agent.ts'
import { isTriggerNode, supportsNodeRetry, portsByHandle } from '../../flow/common/change.ts'
import { nodeInputMappings, selectConditionBranches } from '../../flow/common/condition.ts'
import { nodeErrorSchema, nodeSystemOutputPorts, supportsNodeErrorHandling } from '../../flow/common/errorHandling.ts'
import { nodeInputPorts as nodePorts, isResolutionNode, nodeOutputPorts, resolutionActions, resolutionOutputPorts } from '../../flow/common/graph.ts'
import { inputValue } from '../../flow/common/inputValue.ts'
import { matchesSchema } from '../../flow/common/schema.ts'
import { waitAutoContinueAt as automaticDeadline } from '../../flow/common/wait.ts'
import { validWebhookStatus, webhookHeaderValues, encodeWebhookBody } from '../../flow/common/webhookResponse.ts'
import { matchesTriggerOutputs, normalizeTriggerOutputs } from '../../trigger/common/contract.ts'
import { Dependencies, dependenciesSchema, dependencyValues } from './dependencies.ts'
import { projectExecutionId, sanitizeRuntimeErrorMessage } from './events.ts'
import { normalizeWaitComment as normalizeComment, withWaitNotificationMessage as notificationMessage } from './wait.ts'

export const withWaitNotificationMessage: (value: JsonValue) => JsonValue = notificationMessage

export const normalizeWaitComment: (value?: string | null) => string | null = normalizeComment

export const waitAutoContinueAt: (config: WaitAutoContinue, waitingSince: number) => number = automaticDeadline

export interface WaitResolution {
  readonly action: WaitAction
  readonly resolvedAt: string
  readonly comment: string | null
}

export class PortValidationError extends Error {}

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

function usesPending(graph: Graph, nodeId: string): boolean {
  return (
    graph.edges.some((edge) => edge.source == nodeId && edge.sourceHandle == 'pending') ||
    Object.values(graph.nodes).some(
      (node) =>
        !isTriggerNode(node) &&
        Object.values(nodeInputMappings(node)).some(
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

export interface DependenciesCheckpoint {
  nextId: number
  iterations: Record<string, number>
  nodes: Record<string, DependencyState>
}

interface DependencyState {
  id: number
  status: 'pending' | 'running' | 'completed' | 'skipped'
  input: Record<
    string,
    { readonly execution: number; readonly outputs: Readonly<Record<string, JsonValue>>; readonly systemOutputs?: Readonly<Record<string, JsonValue>> }
  >
  systemOutputs?: Readonly<Record<string, JsonValue>>
  output?: Readonly<Record<string, JsonValue>>
  previous: string[]
  released: string[]
  jobId?: string
  seeded: boolean
}

export interface PendingWorkflowCall {
  readonly jobId: string
  readonly nodeId: string
  readonly childRunId: string
  readonly input: Readonly<Record<string, JsonValue>>
}

export interface FlowRunCheckpoint {
  readonly calls?: readonly PendingWorkflowCall[]
  readonly bindingValues: Readonly<Record<string, string>>
  readonly inputs: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>
  readonly results: Readonly<
    Record<
      string,
      {
        readonly handled?: true
        readonly jobId: string
        readonly outputs: Readonly<Record<string, JsonValue>>
        readonly systemOutputs?: Readonly<Record<string, JsonValue>>
      }
    >
  >
  readonly counts: Readonly<Record<string, Readonly<Record<string, number>>>>
  readonly dependencies: DependenciesCheckpoint
  readonly version: 6
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
    | { readonly capabilities: readonly ConnectorCapability[]; readonly moduleId: string; readonly getPrevious: () => readonly PreviousNode[] }
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

class NodeValidationError extends PortValidationError {
  readonly code: 'node.input-invalid' | 'node.output-invalid' | 'webhook.response-status-invalid' | 'webhook.response-headers-invalid'
  constructor(code: NodeValidationError['code'], error: unknown) {
    super(error instanceof Error ? error.message : String(error))
    this.code = code
  }
}

function nodeFailure(error: unknown, project: FlowRunOptions['projectFailure']): SchedulerFailure {
  if (error instanceof NodeValidationError) return { code: error.code, message: error.message, catchable: true }
  return project?.(error) ?? { code: 'node.failed', message: error instanceof Error ? error.message : String(error) }
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

function invokeWithRetry(context: RunContext, node: ExecutableNode, invocation: TaskInvocation): Effect.Effect<unknown, Error> {
  const retry = supportsNodeRetry(node) ? node.retry : undefined
  const attempt = (index: number): Effect.Effect<unknown, Error> =>
    Effect.suspend(() =>
      context.invokeTask(index == 0 ? invocation : { ...invocation, invocationId: context.createId() }).pipe(
        Effect.catch((error) => {
          const failure = nodeFailure(error, context.projectFailure)
          if (retry == null || index >= retry.maxRetries || failure.retryable !== true) return Effect.fail(error)
          return Effect.gen(function* () {
            yield* context.emit({
              type: 'node.log',
              level: 'warn',
              runId: invocation.runId,
              nodeId: invocation.nodeId,
              jobId: invocation.jobId,
              message: `Attempt ${index + 1}/${retry.maxRetries + 1} failed (${failure.code}): ${failure.message}. Retrying attempt ${index + 2}/${retry.maxRetries + 1} in ${retry.intervalMs} ms.`,
            })
            yield* Effect.sleep(retry.intervalMs)
            return yield* attempt(index + 1)
          })
        }),
      ),
    )
  return attempt(0)
}

function nodeTitle(node: GraphNode): string | undefined {
  if (node.name != null) return node.name
  switch (node.kind) {
    case 'condition':
      return
    case 'outputs':
      return 'Workflow Outputs'
    case 'value':
      return 'Fixed Values'
    case 'task':
      return node.task.name
    case 'approval':
      return 'Approval'
    case 'wait':
      return 'Wait'
  }
}

function nodeKind(
  node: ExecutableNode,
):
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
  | 'webhook-response' {
  if (node.kind != 'task') return node.kind
  return 'moduleId' in node.task ? 'javascript' : node.task.executor.kind
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
  checkpointExact(
    source,
    ['agents', 'bindingValues', 'counts', 'dependencies', 'inputs', 'results', 'version', 'waits', ...(source.calls === undefined ? [] : ['calls'])],
    'Flow Run checkpoint',
  )
  if (source.version != 6) throw new Error('Flow Run checkpoint version is unsupported.')
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
      if (result.handled !== undefined && result.handled !== true) throw new Error('Checkpoint handled flag is invalid.')
      checkpointExact(
        result,
        ['jobId', 'outputs', ...(result.systemOutputs === undefined ? [] : ['systemOutputs']), ...(result.handled === undefined ? [] : ['handled'])],
        'Checkpoint result',
      )
      return [
        id,
        {
          jobId: checkpointString(result.jobId, 'Checkpoint job ID'),
          ...(result.systemOutputs === undefined ? {} : { systemOutputs: outputRecord(checkpointJson(result.systemOutputs, 'Checkpoint system outputs'), id) }),
          ...(result.handled === true ? { handled: true as const } : {}),
          outputs: Object.fromEntries(
            Object.entries(checkpointRecord(result.outputs, 'Checkpoint outputs')).map(([handle, item]) => [handle, checkpointJson(item, 'Checkpoint output')]),
          ),
        },
      ]
    }),
  )
  const counts = z.record(z.string(), z.record(z.string(), z.number().int().positive().max(Number.MAX_SAFE_INTEGER))).parse(source.counts)
  const dependencies = dependenciesSchema.parse(source.dependencies)
  const savedWaitFields = {
    jobId: z.string().min(1),
    nodeId: z.string().min(1),
    value: z.json(),
    waitId: z.string().min(1),
  }
  const savedWait = z.strictObject({ ...savedWaitFields, pending: z.json().optional() })
  const pendingWaits = z.array(savedWait).parse(source.waits)
  const calls = z
    .array(z.strictObject({ jobId: z.string().min(1), nodeId: z.string().min(1), childRunId: z.string().min(1), input: z.record(z.string(), z.json()) }))
    .parse(source.calls ?? [])
  if (pendingWaits.length + calls.length == 0) throw new Error('Checkpoint has no pending execution.')
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
      dependencies.nodes[pending.nodeId]?.status != 'running' ||
      dependencies.nodes[pending.nodeId]?.jobId != pending.jobId ||
      Object.values(results).some((result) => result.jobId == pending.jobId)
    ) {
      throw new Error('Checkpoint waiting execution states conflict.')
    }
    jobs.add(pending.jobId)
    waits.add(pending.waitId)
  }
  for (const call of calls) {
    if (
      jobs.has(call.jobId) ||
      dependencies.nodes[call.nodeId]?.status != 'running' ||
      dependencies.nodes[call.nodeId]?.jobId != call.jobId ||
      Object.values(results).some((result) => result.jobId == call.jobId)
    )
      throw new Error('Checkpoint call execution conflicts.')
    jobs.add(call.jobId)
  }
  if (Object.values(dependencies.nodes).some((state) => state.status == 'running' && !jobs.has(state.jobId!)))
    throw new Error('Checkpoint dependency has no waiting execution.')
  if (Object.keys(agents).some((id) => !jobs.has(id))) throw new Error('Checkpoint Agent has no waiting execution.')
  return { agents, bindingValues, counts, dependencies, inputs, results, version: 6, waits: pendingWaits, ...(source.calls === undefined ? {} : { calls }) }
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

function outputRecord(value: unknown, nodeId: string): Readonly<Record<string, JsonValue>> {
  if (value === undefined) return {}
  if (value == null || typeof value != 'object' || Array.isArray(value)) throw new Error(`Node "${nodeId}" must return an object.`)
  return value as Readonly<Record<string, JsonValue>>
}

function agentConfig(node: ExecutableNode): AgentConfig | undefined {
  const task = node.kind == 'task' && 'executor' in node.task ? node.task : undefined
  return task?.executor.kind == 'agent' ? task.executor : undefined
}

function agentNotice(node: ExecutableNode, values: Readonly<Record<string, JsonValue>>) {
  const notification = agentConfig(node)?.notification
  if (notification == null) return undefined
  return {
    messageHandle: notification.messageHandle,
    input: Object.fromEntries(
      notification.inputDefinitions.flatMap((port) => {
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

function validateOutputs(nodeId: string, node: ExecutableNode, value: unknown): Readonly<Record<string, JsonValue>> {
  const raw = outputRecord(value, nodeId)
  const discardUndeclared = node.kind == 'task' && 'executor' in node.task && (node.task.executor.kind == 'connector' || node.task.executor.kind == 'workflow')
  const ports =
    node.kind == 'outputs'
      ? nodePorts(node)
      : isResolutionNode(node)
        ? resolutionOutputPorts(node)
        : node.kind == 'task'
          ? portsByHandle(node.task.outputs)
          : node.kind == 'value'
            ? portsByHandle(node.values)
            : {}
  const outputs = outputRecord(
    checkpointJson(
      Object.fromEntries(Object.entries(raw).map(([handle, item]) => [handle, Object.hasOwn(ports, handle) && item === undefined ? null : item])),
      `Node "${nodeId}" outputs`,
    ),
    nodeId,
  )
  const complete =
    node.kind == 'condition' || isResolutionNode(node) ? outputs : { ...Object.fromEntries(Object.keys(ports).map((handle) => [handle, null])), ...outputs }
  const validated: [string, JsonValue][] = []
  for (const [handle, output] of Object.entries(complete)) {
    const port = ports[handle]
    if (port == null) {
      if (discardUndeclared) continue
      throw new PortValidationError(`Node "${nodeId}" output "${handle}" does not match its declaration.`)
    }
    if (!(output === null && port.nullable) && !matchesSchema(output, port.jsonSchema))
      throw new PortValidationError(`Node "${nodeId}" output "${handle}" does not match its declaration.`)
    validated.push([handle, output])
  }
  return Object.fromEntries(validated)
}

function validateCheckpoint(
  target: RunGraph,
  checkpoint: FlowRunCheckpoint,
  resolveInputs: (nodeId: string, node: ExecutableNode) => Readonly<Record<string, JsonValue>>,
): void {
  const launch = checkpoint.inputs
  const agents = checkpoint.agents
  if ([...Object.keys(checkpoint.results), ...Object.keys(launch)].some((id) => target.graph.nodes[id] == null))
    throw new Error('Checkpoint nodes do not match the prepared graph.')
  for (const [scope, counts] of Object.entries(checkpoint.counts)) {
    const graph = scope == '' ? target.graph : undefined
    if (graph == null) throw new Error('Checkpoint execution counts reference an unknown graph.')
    for (const [id, count] of Object.entries(counts)) {
      const node = graph.nodes[id]
      if (node == null || isTriggerNode(node) || count > (node.maxExecutions ?? 1000)) throw new Error('Checkpoint execution count is invalid.')
    }
  }
  const validateResults = (
    results: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>,
    frame = false,
    metadata: Readonly<Record<string, { readonly systemOutputs?: Readonly<Record<string, JsonValue>>; readonly handled?: true }>> = checkpoint.results,
  ) => {
    for (const [id, outputs] of Object.entries(results)) {
      const result = metadata[id]
      const node = target.graph.nodes[id]
      if (node == null) throw new Error('Checkpoint result node is missing.')
      const systemEnabled = nodeSystemOutputPorts(node).error != null
      if (systemEnabled && result?.systemOutputs == null) throw new Error('Checkpoint system output is missing.')
      if (!isTriggerNode(node) && checkpoint.counts['']?.[id] == null) throw new Error('Checkpoint execution count is missing.')
      if (result?.systemOutputs != null) {
        const error = result.systemOutputs.error
        if (
          !systemEnabled ||
          Object.keys(result.systemOutputs).length != 1 ||
          !Object.hasOwn(result.systemOutputs, 'error') ||
          (error !== null && (!matchesSchema(error!, nodeErrorSchema) || typeof error != 'object' || !('nodeId' in error) || error.nodeId != id))
        )
          throw new Error('Checkpoint system output is invalid.')
      }
      const handled = frame ? result?.systemOutputs?.error != null : result?.handled === true
      if (handled !== (result?.systemOutputs?.error != null)) throw new Error('Checkpoint failure status is inconsistent.')
      if (handled) {
        if (Object.keys(outputs).length || result.systemOutputs?.error == null) throw new Error('Checkpoint handled failure is invalid.')
        continue
      }
      if (isTriggerNode(node)) {
        if (!matchesTriggerOutputs(node, outputs)) throw new Error('Checkpoint Trigger output is invalid.')
      } else {
        if (!jsonEqual(validateOutputs(id, node, outputs), outputs)) throw new Error('Checkpoint node outputs are incomplete.')
        const count = Object.keys(outputs).length
        if (
          (node.kind == 'condition' && count != 0) ||
          (isResolutionNode(node) &&
            (resolutionActions(node).filter((action) => Object.hasOwn(outputs, action)).length > 1 ||
              (!resolutionActions(node).some((action) => Object.hasOwn(outputs, action)) && !(frame && Object.hasOwn(outputs, 'pending')))))
        )
          throw new Error('Checkpoint branch result is invalid.')
      }
    }
  }
  validateResults(Object.fromEntries(Object.entries(checkpoint.results).map(([id, result]) => [id, result.outputs])))
  const triggerIds = Object.keys(checkpoint.results).filter((id) => isTriggerNode(target.graph.nodes[id]!))
  if (triggerIds.length != 1) throw new Error('Checkpoint must contain exactly one selected Trigger.')
  const pendingCounts = new Map<string, number>()
  for (const waiting of [...checkpoint.waits, ...(checkpoint.calls ?? [])]) pendingCounts.set(waiting.nodeId, (pendingCounts.get(waiting.nodeId) ?? 0) + 1)
  for (const [id, count] of pendingCounts) {
    if ((checkpoint.counts['']?.[id] ?? 0) < count + (checkpoint.results[id] == null ? 0 : 1))
      throw new Error('Checkpoint waiting execution count is incomplete.')
  }
  for (const [id, values] of Object.entries(launch)) {
    const node = target.graph.nodes[id]!
    if (isTriggerNode(node) || Object.keys(values).some((handle) => nodePorts(node)[handle] == null))
      throw new Error('Checkpoint launch inputs do not match the prepared graph.')
  }

  for (const [nodeId, state] of Object.entries(checkpoint.dependencies.nodes)) {
    const frame = dependencyValues(state.input)
    validateResults(frame, true, state.input)
    if (!isTriggerNode(target.graph.nodes[nodeId]!) && (state.status == 'running' || state.status == 'completed')) {
      const triggers = Object.keys(frame).filter((id) => isTriggerNode(target.graph.nodes[id]!))
      if (triggers.length != 1 || triggers[0] != triggerIds[0] || !jsonEqual(frame[triggers[0]!]!, checkpoint.results[triggers[0]!]!.outputs))
        throw new Error('Checkpoint input Trigger does not match the Run.')
    }
    if (state.output != null) validateResults({ [nodeId]: state.output }, state.status == 'running')
    if (state.status == 'completed') {
      const result = checkpoint.results[nodeId]
      if (
        result == null ||
        (state.jobId != null && state.jobId != result.jobId) ||
        !jsonEqual(state.output!, result.outputs) ||
        !jsonEqual(state.systemOutputs ?? {}, result.systemOutputs ?? {})
      )
        throw new Error('Checkpoint completed dependency conflicts with its result.')
    }
  }
  for (const call of checkpoint.calls ?? []) {
    const node = target.graph.nodes[call.nodeId]
    if (
      node?.kind != 'task' ||
      !('executor' in node.task) ||
      node.task.executor.kind != 'workflow' ||
      !jsonEqual(resolveInputs(call.nodeId, node), call.input) ||
      checkpoint.agents[call.jobId] != null ||
      checkpoint.dependencies.nodes[call.nodeId]?.output != null
    )
      throw new Error('Checkpoint workflow call does not match its node.')
  }
  for (const waiting of checkpoint.waits) {
    const node = target.graph.nodes[waiting.nodeId]
    if (node == null || isTriggerNode(node)) throw new Error('Checkpoint waiting node is missing.')
    const state = checkpoint.dependencies.nodes[waiting.nodeId]!
    const expectedOutput = waiting.pending == null ? undefined : { pending: waiting.pending }
    if ((state.output == null) != (expectedOutput == null) || (state.output != null && !jsonEqual(state.output, expectedOutput!)))
      throw new Error('Checkpoint waiting dependency output is inconsistent.')
    const config = agentConfig(node)
    const saved = agents[waiting.jobId]
    if (!isResolutionNode(node) && config == null) throw new Error('Checkpoint waiting node cannot suspend.')
    if (config != null) {
      if (saved != null && saved.invocationId != waiting.jobId) throw new Error('Checkpoint Agent invocation identity changed.')
      if (saved == null || (node.timeoutMs == null) != (saved.remainingMs == null) || (saved.remainingMs != null && saved.remainingMs > node.timeoutMs!)) {
        throw new Error('Checkpoint Agent budget is invalid.')
      }
      const approval = agentApproval(config, saved.checkpoint, saved.input)
      if (!jsonEqual(waiting.value, approval)) throw new Error('Checkpoint Agent approval does not match its saved call.')
      if (!jsonEqual(resolveInputs(waiting.nodeId, node), saved.input)) throw new Error('Checkpoint Agent inputs changed.')
    } else {
      if (saved != null) throw new Error('Checkpoint Wait contains Agent state.')
      if (!isResolutionNode(node) || !jsonEqual(resolveInputs(waiting.nodeId, node), waiting.value)) throw new Error('Checkpoint resolution input changed.')
      const notify = usesPending(target.graph, waiting.nodeId)
      if (notify != (waiting.pending != null)) throw new Error('Checkpoint Wait pending output is missing or unexpected.')
      if (waiting.pending != null) validateOutputs(waiting.nodeId, node, { pending: waiting.pending })
    }
    if (checkpoint.counts['']?.[waiting.nodeId] == null) throw new Error('Checkpoint waiting execution count is missing.')
  }
}

type NodeResult =
  | { readonly kind: 'calling'; readonly childRunId: string; readonly input: Readonly<Record<string, JsonValue>> }
  | {
      readonly kind: 'completed'
      readonly releasedHandles?: readonly string[]
      readonly outputs: Readonly<Record<string, JsonValue>>
      readonly response?: WebhookResponseSnapshot
    }
  | { readonly kind: 'suspended'; readonly value: JsonValue; readonly agent: FlowRunCheckpoint['agents'][string] }

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
      const resolveInput = (
        mapping: InputMapping | undefined,
        port: InputPortDefinition,
        supplied: JsonValue | undefined,
        description: string,
        valuesByNode: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>,
        required = false,
        systemByNode: Readonly<Record<string, Readonly<Record<string, JsonValue>>>> = {},
      ): JsonValue => {
        let value = inputValue(mapping, supplied === undefined ? port.value : supplied)
        if (mapping?.kind == 'sources') {
          const values = mapping.sources.flatMap((source) => {
            if (source.kind == 'binding') return Object.hasOwn(context.bindingValues, source.bindingId) ? [context.bindingValues[source.bindingId]!] : []
            const outputs = (source.system ? systemByNode : valuesByNode)[source.nodeId]
            if (outputs == null || !Object.hasOwn(outputs, source.output)) return []
            const output = outputs[source.output]!
            if (source.field === undefined || output === null) return [output]
            return output != null && typeof output === 'object' && !Array.isArray(output) && Object.hasOwn(output, source.field)
              ? [(output as Readonly<Record<string, JsonValue>>)[source.field]!]
              : []
          })
          if (values.length > 1) throw new Error(`${description} has multiple available sources.`)
          if (required && values.length == 0) throw new Error(`${description} Source has no value.`)
          value = values[0] ?? null
        }
        if (required && value === undefined) throw new Error(`${description} is incomplete.`)
        if (value === undefined) value = null
        if (!(value === null && port.nullable) && !matchesSchema(value, port.jsonSchema))
          throw new PortValidationError(`${description} does not match its declared schema.`)
        return value
      }
      const resolveInputs = (nodeId: string, node: ExecutableNode): Readonly<Record<string, JsonValue>> => {
        const mappings = nodeInputMappings(node)
        const frame = dependencies.inputValues(nodeId)
        const systemFrame = dependencies.systemInputValues(nodeId)
        return Object.fromEntries(
          Object.entries(nodePorts(node)).map(([handle, port]) => [
            handle,
            resolveInput(mappings[handle], port, launch[nodeId]?.[handle], `Node "${nodeId}" input "${handle}"`, frame, node.kind == 'condition', systemFrame),
          ]),
        )
      }
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
      const executeNode = (
        nodeId: string,
        node: ExecutableNode,
        jobId: string,
        nodeInputs: Readonly<Record<string, JsonValue>>,
        resolution?: 'approve' | 'reject',
      ): Effect.Effect<NodeResult, Error> => {
        const config = agentConfig(node)
        const saved = agents[jobId]
        const nodeRemainingMs = saved?.remainingMs ?? node.timeoutMs
        const startedAt = performance.now()
        const execution = Effect.gen(function* () {
          const kind = nodeKind(node)
          const title = nodeTitle(node)
          const projectedInputs = Object.fromEntries(
            Object.entries(nodeInputs).filter(([handle]) => {
              if (node.kind == 'task' && 'executor' in node.task && node.task?.executor.kind == 'openapi' && handle.startsWith('auth.')) return false
              const mapping = nodeInputMappings(node)[handle]
              return mapping?.kind != 'sources' || mapping.sources.every((source) => source.kind != 'binding')
            }),
          )
          if (resolution == null && !pendingCalls.has(jobId))
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
            case 'webhook-response': {
              const status = nodeInputs.statusCode
              if (!validWebhookStatus(status))
                return yield* Effect.fail(new NodeValidationError('webhook.response-status-invalid', 'Invalid HTTP response status.'))
              const headers = webhookHeaderValues(nodeInputs.headers)
              if (headers == null) return yield* Effect.fail(new NodeValidationError('webhook.response-headers-invalid', 'Invalid HTTP response headers.'))
              return { kind: 'completed' as const, outputs: {}, response: { ...encodeWebhookBody(nodeInputs.body!), status, headers } }
            }
            case 'outputs': {
              outputs = nodeInputs
              break
            }
            case 'condition': {
              return { kind: 'completed' as const, outputs: {}, releasedHandles: selectConditionBranches(node, nodeInputs) }
            }
            case 'value': {
              outputs = Object.fromEntries(node.values.map((port) => [port.handle, port.value ?? null]))
              break
            }
            case 'task': {
              const frame = dependencies.inputValues(nodeId)
              const systemFrame = dependencies.systemInputValues(nodeId)
              const previousIds = dependencies.state.nodes[nodeId]!.previous
              const additional = new Set((node.additionalInputs ?? []).map((port) => port.handle))
              const result = yield* invokeWithRetry(context, node, {
                ...(pendingCalls.has(jobId) ? { workflowRunId: pendingCalls.get(jobId)!.childRunId } : {}),
                additionalInputs: Object.fromEntries(Object.entries(nodeInputs).filter(([handle]) => additional.has(handle))),
                blockId: 'moduleId' in node.task ? node.task.moduleId : nodeId,
                flowId: target.flowId,
                input: Object.fromEntries(
                  Object.entries(nodeInputs).filter(([handle]) => {
                    if (additional.has(handle)) return false
                    const task = 'executor' in node.task ? node.task : undefined
                    if (task?.executor.kind != 'openapi') return true
                    const mapping = node.inputs[handle]
                    return (
                      mapping?.kind != 'unset' &&
                      (mapping != null || task.inputs.some((port) => 'handle' in port && port.handle == handle && port.value !== undefined))
                    )
                  }),
                ),
                invocationId: saved?.invocationId ?? (config == null ? context.createId() : jobId),
                ...(resolution == null || saved == null ? {} : { agent: { action: resolution, checkpoint: saved.checkpoint } }),
                jobId,
                nodeId,
                runId,
                ...('moduleId' in node.task
                  ? {
                      capabilities: node.task.capabilities ?? [],
                      moduleId: node.task.moduleId,
                      getPrevious: () => {
                        return previousIds.map((previousId) => {
                          const previous = target.graph.nodes[previousId]!
                          const systemOutputs = systemFrame[previousId]
                          return Object.assign(
                            {
                              id: previousId,
                              name: nodeTitle(previous) ?? previousId,
                              outputs: frame[previousId]!,
                              outputDefs: Object.entries(nodeOutputPorts(previous)).map(([handle, definition]) =>
                                Object.assign(
                                  {
                                    handle,
                                    jsonSchema: definition.jsonSchema,
                                    nullable: definition.nullable,
                                  },
                                  definition.description == null ? {} : { description: definition.description },
                                ),
                              ),
                            },
                            systemOutputs == null ? {} : { systemOutputs },
                          )
                        })
                      },
                    }
                  : { kind: 'managed' as const }),
              })
              if ('executor' in node.task && node.task.executor.kind == 'workflow') {
                const response = z
                  .discriminatedUnion('kind', [
                    z.strictObject({ kind: z.literal('calling'), childRunId: z.string().min(1) }),
                    z.strictObject({ kind: z.literal('completed'), outputs: z.record(z.string(), z.json()) }),
                  ])
                  .parse(result)
                if (response.kind == 'calling') return { kind: 'calling' as const, childRunId: response.childRunId, input: nodeInputs }
                outputs = response.outputs
              } else if (config != null) {
                const response: AgentResult = agentResultSchema.parse(result)
                if (response.kind == 'suspended') {
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
              } else if ('executor' in node.task && node.task.executor.kind == 'connector' && node.task.executor.outputMode == 'value') {
                outputs = { output: checkpointJson(result, `Node "${nodeId}" output`) }
              } else
                outputs = yield* Effect.try({
                  try: () => outputRecord(result, nodeId),
                  catch: (error) => new NodeValidationError('node.output-invalid', error),
                })
              break
            }
            case 'approval':
            case 'wait':
              return yield* Effect.fail(new Error('Resolution jobs are handled by the Scheduler suspension boundary.'))
          }
          return yield* Effect.try({
            try: () => ({ kind: 'completed' as const, outputs: validateOutputs(nodeId, node, outputs) }),
            catch: (error) => new NodeValidationError('node.output-invalid', error),
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
                return yield* executeNode(nodeId, node, jobId, nodeInputs)
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
              const result = yield* executeNode(call.nodeId, target.graph.nodes[call.nodeId] as ExecutableNode, call.jobId, call.input)
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
