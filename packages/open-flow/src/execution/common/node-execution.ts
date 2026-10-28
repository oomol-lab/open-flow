import type { AgentConfig } from '../../flow/common/agent.ts'
import type { Graph, GraphNode, InputMapping, InputPortDefinition, JsonValue, TriggerNode } from '../../flow/common/change.ts'
import type { WebhookResponseSnapshot } from '../../flow/common/webhookResponse.ts'
import type { FlowRunCheckpoint } from './checkpoint.ts'
import type { Dependencies } from './dependencies.ts'
import type { AgentCheckpoint, AgentResult } from './runtime.ts'
import type { FlowRunOptions, SchedulerEvent, SchedulerFailure, TaskInvocation } from './scheduler.ts'

import * as Effect from 'effect/Effect'
import { z } from 'zod'
import { agentInput } from '../../flow/common/agent.ts'
import { isTriggerNode, supportsNodeRetry, portsByHandle } from '../../flow/common/change.ts'
import { nodeInputMappings, selectConditionBranches } from '../../flow/common/condition.ts'
import { nodeInputPorts as nodePorts, isResolutionNode, nodeOutputPorts, resolutionOutputPorts } from '../../flow/common/graph.ts'
import { inputValue } from '../../flow/common/inputValue.ts'
import { matchesSchema } from '../../flow/common/schema.ts'
import { validWebhookStatus, webhookHeaderValues, encodeWebhookBody } from '../../flow/common/webhookResponse.ts'

interface NodeExecutionContext {
  readonly createId: FlowRunOptions['createId']
  readonly emit: (event: SchedulerEvent) => Effect.Effect<void, Error>
  readonly invokeTask: FlowRunOptions['invokeTask']
  readonly projectFailure: FlowRunOptions['projectFailure']
}

export class PortValidationError extends Error {}

export type ExecutableNode = Exclude<GraphNode, TriggerNode>

export function usesPending(graph: Graph, nodeId: string): boolean {
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

export class NodeValidationError extends PortValidationError {
  readonly code: 'node.input-invalid' | 'node.output-invalid' | 'webhook.response-status-invalid' | 'webhook.response-headers-invalid'
  constructor(code: NodeValidationError['code'], error: unknown) {
    super(error instanceof Error ? error.message : String(error))
    this.code = code
  }
}

export function nodeFailure(error: unknown, project: FlowRunOptions['projectFailure']): SchedulerFailure {
  if (error instanceof NodeValidationError) return { code: error.code, message: error.message, catchable: true }
  return project?.(error) ?? { code: 'node.failed', message: error instanceof Error ? error.message : String(error) }
}

function invokeWithRetry(context: NodeExecutionContext, node: ExecutableNode, invocation: TaskInvocation): Effect.Effect<unknown, Error> {
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

export function nodeTitle(node: GraphNode): string | undefined {
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

export function jsonValue(value: unknown, description: string, depth = 0): JsonValue {
  if (depth > 64) throw new Error(`${description} exceeds the maximum JSON depth.`)
  if (value === null || typeof value == 'boolean' || typeof value == 'string') return value
  if (typeof value == 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map((item) => jsonValue(item, description, depth + 1))
  if (value == null || typeof value != 'object') throw new Error(`${description} must be an object.`)
  const source = value as Readonly<Record<string, unknown>>
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, jsonValue(item, description, depth + 1)]))
}

export const agentCheckpointSchema = z.strictObject({
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

export function jsonEqual(left: JsonValue, right: JsonValue): boolean {
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

export function outputRecord(value: unknown, nodeId: string): Readonly<Record<string, JsonValue>> {
  if (value === undefined) return {}
  if (value == null || typeof value != 'object' || Array.isArray(value)) throw new Error(`Node "${nodeId}" must return an object.`)
  return value as Readonly<Record<string, JsonValue>>
}

export function agentConfig(node: ExecutableNode): AgentConfig | undefined {
  const task = node.kind == 'task' && 'executor' in node.task ? node.task : undefined
  return task?.executor.kind == 'agent' ? task.executor : undefined
}

export function agentNotice(node: ExecutableNode, values: Readonly<Record<string, JsonValue>>) {
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

export function agentApproval(config: AgentConfig, checkpoint: AgentCheckpoint, inputs: Readonly<Record<string, JsonValue>>): JsonValue {
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

export function validateOutputs(nodeId: string, node: ExecutableNode, value: unknown): Readonly<Record<string, JsonValue>> {
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
    jsonValue(
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

export type NodeResult =
  | { readonly kind: 'calling'; readonly childRunId: string; readonly input: Readonly<Record<string, JsonValue>> }
  | {
      readonly kind: 'completed'
      readonly releasedHandles?: readonly string[]
      readonly outputs: Readonly<Record<string, JsonValue>>
      readonly response?: WebhookResponseSnapshot
    }
  | { readonly kind: 'suspended'; readonly value: JsonValue; readonly agent: FlowRunCheckpoint['agents'][string] }

export function resolveNodeInputs(
  nodeId: string,
  node: ExecutableNode,
  dependencies: Pick<Dependencies, 'input'>,
  bindingValues: Readonly<Record<string, string>>,
  launchInputs?: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, JsonValue>> {
  const resolveInput = (
    mapping: InputMapping | undefined,
    port: InputPortDefinition,
    supplied: JsonValue | undefined,
    description: string,
    required = false,
  ): JsonValue => {
    let value = inputValue(mapping, supplied === undefined ? port.value : supplied)
    if (mapping?.kind == 'sources') {
      const values = mapping.sources.flatMap((source) => {
        if (source.kind == 'binding') return Object.hasOwn(bindingValues, source.bindingId) ? [bindingValues[source.bindingId]!] : []
        const result = dependencies.input(nodeId, source.nodeId)
        const outputs = source.system ? result?.systemOutputs : result?.outputs
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

  const mappings = nodeInputMappings(node)
  return Object.fromEntries(
    Object.entries(nodePorts(node)).map(([handle, port]) => [
      handle,
      resolveInput(mappings[handle], port, launchInputs?.[handle], `Node "${nodeId}" input "${handle}"`, node.kind == 'condition'),
    ]),
  )
}

export function executeNode(
  context: NodeExecutionContext,
  input: {
    readonly nodeId: string
    readonly node: ExecutableNode
    readonly jobId: string
    readonly nodeInputs: Readonly<Record<string, JsonValue>>
    readonly flowId: string
    readonly runId: string
    readonly graph: Graph
    readonly dependencies: Pick<Dependencies, 'input'>
    readonly previousIds: readonly string[]
    readonly saved?: FlowRunCheckpoint['agents'][string]
    readonly workflowRunId?: string
    readonly resolution?: 'approve' | 'reject'
  },
): Effect.Effect<NodeResult, Error> {
  const { nodeId, node, jobId, nodeInputs, flowId, runId, graph, dependencies, previousIds, saved, workflowRunId, resolution } = input
  const config = agentConfig(node)
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
    if (resolution == null && workflowRunId == null)
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
        if (!validWebhookStatus(status)) return yield* Effect.fail(new NodeValidationError('webhook.response-status-invalid', 'Invalid HTTP response status.'))
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
        const additional = new Set((node.additionalInputs ?? []).map((port) => port.handle))
        const result = yield* invokeWithRetry(context, node, {
          ...(workflowRunId == null ? {} : { workflowRunId }),
          additionalInputs: Object.fromEntries(Object.entries(nodeInputs).filter(([handle]) => additional.has(handle))),
          blockId: 'moduleId' in node.task ? node.task.moduleId : nodeId,
          flowId,
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
                    const previous = graph.nodes[previousId]!
                    const previousResult = dependencies.input(nodeId, previousId)!
                    const systemOutputs = previousResult.systemOutputs
                    return Object.assign(
                      {
                        id: previousId,
                        name: nodeTitle(previous) ?? previousId,
                        outputs: previousResult.outputs,
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
          outputs = { output: jsonValue(result, `Node "${nodeId}" output`) }
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
