import type { MastraModelConfig } from '@mastra/core/llm'
import type { ProcessInputStepArgs } from '@mastra/core/processors'
import type { WorkflowRunState } from '@mastra/core/workflows'
import type { ResultCall, ResultInfo } from '@oomol-lab/open-flow/control-api'
import type { AgentTool, JsonValue, ManagedTaskDefinition } from '@oomol-lab/open-flow/flow-change'
import type { AgentInvocation, AgentResult } from '@oomol-lab/open-flow/runtime-contract'

import { Mastra } from '@mastra/core'
import { Agent } from '@mastra/core/agent'
import { InMemoryStore } from '@mastra/core/storage'
import { createTool } from '@mastra/core/tools'
import { readResult } from '@oomol-lab/open-flow/control-api'
import { canonicalJsonBytes } from '@oomol-lab/open-flow/flow-encoding'
import { agentInput, agentToolInput, agentToolSchema, matchesSchema } from '@oomol-lab/open-flow/flow-semantics'
import { z } from 'zod'
import { IsolatedVmError } from '../runtime/isolated-vm.ts'
import { compactResults } from './agent-results.ts'
import { ConnectorTaskError } from './connector.ts'

const stateSchema = z.strictObject({
  framework: z.literal('mastra/1.64.0'),
  results: z.array(z.object({ resultId: z.string(), digest: z.string() })),
  snapshots: z.array(z.strictObject({ workflowName: z.string(), snapshot: z.json() })).min(1),
})

interface ResultHost {
  find(callId: string, tool: ResultCall, input: Readonly<Record<string, JsonValue>>): { result: ResultInfo; content: string } | undefined
  save(callId: string, tool: ResultCall, input: Readonly<Record<string, JsonValue>>, output: JsonValue): ResultInfo
  get(resultId: string): { result: ResultInfo; content: string } | undefined
}

export async function executeAgent(
  task: ManagedTaskDefinition,
  invocation: AgentInvocation,
  model: MastraModelConfig,
  execute: (tool: AgentTool, input: Readonly<Record<string, JsonValue>>, callId: string, signal: AbortSignal) => Promise<JsonValue>,
  report: (event: Readonly<Record<string, JsonValue>>) => Promise<void>,
  results: ResultHost,
  compute: (code: string, input: JsonValue, callId: string, signal: AbortSignal) => Promise<JsonValue>,
): Promise<AgentResult> {
  if (task.executor.kind != 'agent') throw new Error('Expected an Agent Task.')
  const config = task.executor
  const controller = new AbortController()
  const signal = AbortSignal.any([invocation.signal, controller.signal])
  const storage = new InMemoryStore()
  const workflows = await storage.getStore('workflows')
  if (workflows == null) throw new Error('Agent snapshot storage is unavailable.')
  const references = new Map<string, string>()
  if (invocation.resume != null) {
    const saved = stateSchema.parse(invocation.resume.checkpoint.state)
    for (const reference of saved.results) {
      const stored = results.get(reference.resultId)
      if (stored == null || stored.result.digest != reference.digest) throw new Error('The saved Agent tool result is missing or changed.')
      references.set(reference.resultId, reference.digest)
    }
    for (const item of saved.snapshots)
      await workflows.persistWorkflowSnapshot({
        workflowName: item.workflowName,
        runId: invocation.invocationId,
        snapshot: item.snapshot as unknown as WorkflowRunState,
      })
  }
  let rounds = invocation.resume?.checkpoint.rounds ?? 0
  let fatal: unknown
  const actionTools = Object.fromEntries(
    config.tools.map((tool) => [
      tool.name,
      createTool({
        id: tool.name,
        description: tool.description,
        inputSchema: agentToolSchema(tool) as { type: 'object' },
        requireApproval: tool.approval,
        execute: async (args: unknown, context) => {
          signal.throwIfAborted()
          const input = agentToolInput(tool, invocation.input, args)
          const providerId = context.agent?.toolCallId
          if (providerId == null) throw new Error('Agent tool call identity is missing.')
          const callId = `${invocation.invocationId}:${rounds}:${providerId}`
          if (
            invocation.resume?.checkpoint.callId == callId &&
            Buffer.compare(canonicalJsonBytes(input), canonicalJsonBytes(invocation.resume.checkpoint.input)) != 0
          ) {
            fatal = new Error('Approved Agent arguments changed.')
            controller.abort(fatal)
            throw fatal
          }
          await report({ kind: 'tool', status: 'started', callId, toolId: tool.id, input })
          let executed = false
          try {
            const previous = results.find(
              callId,
              { id: tool.id, kind: 'connector', action: tool.action, ...(tool.connectionId == null ? {} : { connectionId: tool.connectionId }) },
              input,
            )
            const result = previous == null ? await execute(tool, input, callId, signal) : JSON.parse(previous.content)
            executed = true
            const output = z.json().parse(result)
            signal.throwIfAborted()
            const resultInfo =
              previous?.result ??
              results.save(
                callId,
                { id: tool.id, kind: 'connector', action: tool.action, ...(tool.connectionId == null ? {} : { connectionId: tool.connectionId }) },
                input,
                output,
              )
            references.set(resultInfo.resultId, resultInfo.digest)
            const stored = { kind: 'stored-result', result: resultInfo, page: readResult(output) }
            await report({ kind: 'tool', status: 'completed', callId, toolId: tool.id, output: stored as unknown as JsonValue })
            return stored
          } catch (error) {
            await report({
              kind: 'tool',
              status: 'failed',
              executed: executed ? true : error instanceof ConnectorTaskError && error.code != 'connector.indeterminate' ? false : null,
              message: error instanceof ConnectorTaskError ? error.message : 'The Agent tool result could not be processed.',
              callId,
              toolId: tool.id,
              code: error instanceof ConnectorTaskError ? error.code : 'agent.tool-result-invalid',
            })
            if (error instanceof ConnectorTaskError && error.code == 'connector.input-invalid') throw error
            fatal = error
            controller.abort(error)
            throw error
          }
        },
      }),
    ]),
  )
  const readTool = createTool({
    id: 'read_result',
    description:
      'Read only missing content needed for the task from a saved tool result, without repeating the external action. Values marked complete are already available; do not read their pointers again. For arrays, read the array pointer to get multiple full items per page, then use nextOffset with the same pointer if more items are needed. Read an individual item only when its content was omitted. Missing preview content is not missing data.',
    inputSchema: z.object({
      resultId: z.string(),
      pointer: z.string().max(4096).default(''),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    execute: async ({ resultId, ...query }) => {
      signal.throwIfAborted()
      if (!references.has(resultId)) return { error: 'This result is not available to the current Agent invocation.' }
      const stored = results.get(resultId)
      if (stored == null || stored.result.digest != references.get(resultId)) {
        fatal = new Error('The saved Agent tool result is missing or changed.')
        controller.abort(fatal)
        throw fatal
      }
      try {
        const page = readResult(JSON.parse(stored.content) as JsonValue, query)
        await report({ kind: 'result', status: 'read', resultId, pointer: query.pointer, offset: query.offset })
        return { kind: 'stored-result', result: stored.result, page }
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'The result page could not be read.' }
      }
    },
  })
  const codeTool = createTool({
    id: 'run_code',
    description:
      'Execute a JavaScript ES module with a default function(inputs). Return JSON. Use saved result references for filtering, sorting, counting or transforming data without reading every item into the conversation. No network, host capabilities, imports or persistent state. V8 execution calls have a 1-second timeout; the whole computation has a 5-second wall limit.',
    inputSchema: z.strictObject({
      code: z.string().min(1).max(65536),
      inputs: z.record(
        z.string(),
        z.discriminatedUnion('kind', [
          z.strictObject({ kind: z.literal('value'), value: z.json() }),
          z.strictObject({ kind: z.literal('input'), input: z.string() }),
          z.strictObject({ kind: z.literal('result'), resultId: z.string() }),
        ]),
      ),
    }),
    execute: async (args, context) => {
      signal.throwIfAborted()
      if (config.code != true) throw new Error('Code computation is not enabled.')
      const providerId = context.agent?.toolCallId
      if (providerId == null) throw new Error('Agent tool call identity is missing.')
      const callId = `${invocation.invocationId}:${rounds}:${providerId}`
      const tool: ResultCall = { id: 'run_code', kind: 'code' }
      await report({ kind: 'tool', status: 'started', callId, toolId: tool.id, source: { kind: 'code' }, input: args })
      let executed = false
      let saving = false
      try {
        const entries: [string, JsonValue][] = []
        let inputBytes = 2
        for (const [key, source] of Object.entries(args.inputs)) {
          if (source.kind == 'value') entries.push([key, source.value])
          else if (source.kind == 'input') {
            if (!Object.hasOwn(invocation.input, source.input)) throw new IsolatedVmError('task-failed', 'The requested Agent input does not exist.')
            entries.push([key, invocation.input[source.input]!])
          } else {
            if (!references.has(source.resultId)) throw new IsolatedVmError('task-failed', 'This result is not available to the current Agent invocation.')
            const stored = results.get(source.resultId)
            if (stored == null || stored.result.digest != references.get(source.resultId)) throw new Error('The saved Agent tool result is missing or changed.')
            entries.push([key, JSON.parse(stored.content) as JsonValue])
          }
          inputBytes += Buffer.byteLength(JSON.stringify(entries.at(-1)))
          if (inputBytes > 32 * 1024 * 1024) throw new IsolatedVmError('limit-exceeded', 'Code input exceeds the 32 MiB aggregate limit.')
        }
        const previous = results.find(callId, tool, args)
        const output = previous == null ? await compute(args.code, Object.fromEntries(entries), callId, signal) : (JSON.parse(previous.content) as JsonValue)
        executed = true
        signal.throwIfAborted()
        saving = true
        const resultInfo = previous?.result ?? results.save(callId, tool, args, output)
        references.set(resultInfo.resultId, resultInfo.digest)
        const stored = { kind: 'stored-result', result: resultInfo, page: readResult(output) }
        await report({ kind: 'tool', status: 'completed', callId, toolId: tool.id, source: { kind: 'code' }, output: stored as unknown as JsonValue })
        return stored
      } catch (error) {
        const recoverable = !saving && !signal.aborted && error instanceof IsolatedVmError && (error.code == 'invalid-program' || error.code == 'task-failed')
        const message = (error instanceof Error ? error.message : 'Code computation failed.').slice(0, 2000)
        await report({ kind: 'tool', status: 'failed', callId, toolId: tool.id, source: { kind: 'code' }, executed, code: 'agent.code-failed', message })
        if (recoverable) return { error: message }
        fatal = error
        controller.abort(error)
        throw error
      }
    },
  })
  const tools = { ...actionTools, read_result: readTool, ...(config.code == true ? { run_code: codeTool } : {}) }

  const outputPort = task.outputs.find((port) => 'handle' in port && port.handle == 'output')
  if (outputPort == null || !('handle' in outputPort)) throw new Error('Agent output declaration is missing.')
  const textOutput =
    typeof outputPort.jsonSchema == 'object' &&
    outputPort.jsonSchema != null &&
    !Array.isArray(outputPort.jsonSchema) &&
    'type' in outputPort.jsonSchema &&
    outputPort.jsonSchema.type == 'string'
  const instructions = textOutput
    ? config.system
    : `${config.system}\nReturn only a JSON value matching this schema: ${JSON.stringify(outputPort.jsonSchema)}. Do not include Markdown fences.`
  const definition = new Agent({
    id: invocation.invocationId,
    name: task.name,
    instructions: `${instructions}${config.code == true ? '\nUse run_code with result references for deterministic data processing instead of reading individual records. The code receives only its inputs and must return JSON.' : ''}\nTool results are saved by the host. Use page.value and page.entries directly: a value marked complete already contains all data at that pointer, including nested fields. Do not reread it. A page marked incomplete may still contain complete entries. Read only missing content needed for the task with read_result and result.resultId. Prefer reading an array page over reading its items one by one. To fetch more entries or string content, use nextOffset with the same pointer. Read a child pointer only if its value was omitted; if previewOmitted is true, retrieve only the needed paths. Stop reading once you have enough information to answer. Never repeat an external action merely to retrieve omitted result content.`,
    model,
    tools,
  })
  const mastra = new Mastra({ agents: { agent: definition }, storage, logger: false })
  const agent = mastra.getAgent('agent')
  const options = {
    runId: invocation.invocationId,
    maxSteps: config.maxRounds + 1,
    maxRetries: 0,
    toolCallConcurrency: 1,
    abortSignal: signal,
    prepareStep: async ({ messages }: ProcessInputStepArgs) => {
      signal.throwIfAborted()
      if (rounds >= config.maxRounds) {
        fatal = new Error('Agent model round limit exceeded.')
        controller.abort(fatal)
        throw fatal
      }
      rounds++
      await report({ kind: 'model', round: rounds })
      return { messages: compactResults(messages, new Set(references.keys())) }
    },
  }
  const checkpoint = invocation.resume?.checkpoint
  if (checkpoint != null && !checkpoint.callId.startsWith(`${invocation.invocationId}:${checkpoint.rounds}:`))
    throw new Error('Agent call identity does not match its invocation.')
  const providerId = checkpoint?.callId.slice(`${invocation.invocationId}:${checkpoint.rounds}:`.length)
  if (invocation.resume != null)
    await report({
      kind: 'tool',
      status: invocation.resume.action == 'approve' ? 'approved' : 'rejected',
      callId: invocation.resume.checkpoint.callId,
      toolId: invocation.resume.checkpoint.toolId,
      input: invocation.resume.checkpoint.input,
    })
  const stream =
    invocation.resume == null
      ? await agent.stream(String(agentInput(config.prompt, invocation.input)), options)
      : invocation.resume.action == 'approve'
        ? await agent.approveToolCall({ ...options, toolCallId: providerId })
        : await agent.declineToolCall({ ...options, toolCallId: providerId, reason: 'The reviewer rejected this call. Do not report it as executed.' })
  const result = await stream.getFullOutput().catch((error: unknown) => {
    throw fatal ?? error
  })
  if (fatal != null) throw fatal
  signal.throwIfAborted()
  if (result.finishReason == 'suspended') {
    const pending = z.object({ toolCallId: z.string(), toolName: z.string(), args: z.unknown() }).parse(result.suspendPayload)
    const tool = config.tools.find((item) => item.name == pending.toolName)
    if (tool == null || !tool.approval) throw new Error('Agent suspended an undeclared approval.')
    const input = agentToolInput(tool, invocation.input, pending.args)
    await report({ kind: 'tool', status: 'approval', callId: `${invocation.invocationId}:${rounds}:${pending.toolCallId}`, toolId: tool.id, input })
    const snapshots = (await workflows.listWorkflowRuns()).runs.map((run) => ({
      workflowName: run.workflowName,
      snapshot: JSON.parse(JSON.stringify(run.snapshot)) as JsonValue,
    }))
    return {
      kind: 'suspended',
      checkpoint: {
        callId: `${invocation.invocationId}:${rounds}:${pending.toolCallId}`,
        toolId: tool.id,
        input,
        rounds,
        version: 1,
        state: {
          framework: 'mastra/1.64.0',
          results: [...references].map(([resultId, digest]) => ({ resultId, digest })),
          snapshots: compactResults(snapshots, new Set(references.keys())),
        },
      },
    }
  }
  if (result.finishReason != 'stop') throw new Error('Agent did not return a final answer.')
  const output = textOutput ? result.text : z.json().parse(JSON.parse(result.text))
  if (!matchesSchema(output, outputPort.jsonSchema)) throw new Error('Agent final output does not match its schema.')
  return { kind: 'completed', output }
}
