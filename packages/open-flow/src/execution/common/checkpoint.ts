import type { Graph, JsonValue } from '../../flow/common/change.ts'
import type { AgentCheckpoint } from '../../runtime/common/runtime.ts'
import type { DependenciesCheckpoint } from './dependencies.ts'
import type { ExecutableNode } from './node-execution.ts'

import { z } from 'zod'
import { isTriggerNode } from '../../flow/common/change.ts'
import { nodeErrorSchema, nodeSystemOutputPorts } from '../../flow/common/errorHandling.ts'
import { nodeInputPorts as nodePorts, isResolutionNode, resolutionActions } from '../../flow/common/graph.ts'
import { matchesSchema } from '../../flow/common/schema.ts'
import { matchesTriggerOutputs } from '../../trigger/common/contract.ts'
import { dependenciesSchema, dependencyValues } from './dependencies.ts'
import { agentCheckpointSchema, agentConfig, agentApproval, jsonEqual, jsonValue, outputRecord, usesPending, validateOutputs } from './node-execution.ts'

export interface PendingWait {
  readonly jobId: string
  readonly nodeId: string
  readonly value: JsonValue
  readonly waitId: string
  readonly pending?: JsonValue
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
        Object.entries(checkpointRecord(value, 'Checkpoint node inputs')).map(([handle, item]) => [handle, jsonValue(item, 'Checkpoint input')]),
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
          ...(result.systemOutputs === undefined ? {} : { systemOutputs: outputRecord(jsonValue(result.systemOutputs, 'Checkpoint system outputs'), id) }),
          ...(result.handled === true ? { handled: true as const } : {}),
          outputs: Object.fromEntries(
            Object.entries(checkpointRecord(result.outputs, 'Checkpoint outputs')).map(([handle, item]) => [handle, jsonValue(item, 'Checkpoint output')]),
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

export function validateCheckpoint(
  target: { readonly graph: Graph },
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
