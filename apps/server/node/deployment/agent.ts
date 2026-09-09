import type { MastraModelConfig } from '@mastra/core/llm'
import type { ProcessInputStepArgs } from '@mastra/core/processors'
import type { ChunkType, LLMStepResult } from '@mastra/core/stream'
import type { WorkflowRunState } from '@mastra/core/workflows'
import type { AgentTool, JsonValue, ManagedTaskDefinition } from '@oomol-lab/open-flow/flow-change'
import type { AgentInvocation, AgentResult } from '@oomol-lab/open-flow/runtime-contract'
import type { ResultHost } from './agent-tools.ts'

import { Mastra } from '@mastra/core'
import { Agent } from '@mastra/core/agent'
import { InMemoryStore } from '@mastra/core/storage'
import { agentInput, agentToolInput, matchesSchema } from '@oomol-lab/open-flow/flow-semantics'
import { z } from 'zod'
import { compactResults } from './agent-results.ts'
import { createAgentTools } from './agent-tools.ts'

const stateSchema = z.strictObject({
  framework: z.literal('mastra/1.64.0'),
  results: z.array(z.object({ resultId: z.string(), digest: z.string() })),
  snapshots: z.array(z.strictObject({ workflowName: z.string(), snapshot: z.json() })).min(1),
})

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
  const tools = createAgentTools(config, invocation, {
    signal,
    references,
    results,
    execute,
    compute,
    report,
    rounds: () => rounds,
    fail: (error) => {
      fatal = error
      controller.abort(error)
      throw error
    },
  })

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
    instructions: `${instructions}${config.code == true ? '\nUse run_code with result references for deterministic data processing instead of reading individual records. The code receives only its inputs and must return JSON.' : ''}\nPreserve JSON types in tool arguments: use actual null for absent nullable values, never the string "null". Use pagination tokens only when returned by the tool; if no token is returned, keep it null.\nTool results are saved by the host. Use page.value and page.entries directly: a value marked complete already contains all data at that pointer, including nested fields. Do not reread it. A page marked incomplete may still contain complete entries. Read only missing content needed for the task with read_result and result.resultId. Prefer reading an array page over reading its items one by one. To fetch more entries or string content, use nextOffset with the same pointer. Read a child pointer only if its value was omitted; if previewOmitted is true, retrieve only the needed paths. Stop reading once you have enough information to answer. Never repeat an external action merely to retrieve omitted result content.`,
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
    onStepFinish: async (step: LLMStepResult<unknown>) => {
      await report({
        kind: 'model-step',
        round: rounds,
        finishReason: step.finishReason ?? null,
        textLength: step.text.length,
        toolCalls: step.toolCalls.map(({ payload }) => ({ callId: payload.toolCallId, toolName: payload.toolName })),
        usage: { inputTokens: step.usage.inputTokens ?? null, outputTokens: step.usage.outputTokens ?? null },
      })
    },
    onChunk: async (chunk: ChunkType | ChunkType<unknown>) => {
      if (chunk.type != 'tool-call' && chunk.type != 'tool-error' && chunk.type != 'tool-result') return
      let error: unknown
      if (chunk.type == 'tool-error') error = chunk.payload.error
      if (chunk.type == 'tool-result') {
        const result = chunk.payload.result
        if (!chunk.payload.isError && !(result != null && typeof result == 'object' && 'error' in result && result.error)) return
        error = result
      }
      await report({
        kind: 'model-tool',
        round: rounds,
        status: chunk.type == 'tool-call' ? 'requested' : 'failed',
        callId: chunk.payload.toolCallId,
        toolName: chunk.payload.toolName,
        input: JSON.stringify(chunk.payload.args) ?? null,
        ...(chunk.type == 'tool-call' ? {} : { error: error instanceof Error ? error.message : (JSON.stringify(error) ?? String(error)) }),
      })
    },
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
  let stream: Awaited<ReturnType<typeof agent.stream>>
  if (invocation.resume == null) {
    stream = await agent.stream(String(agentInput(config.prompt, invocation.input)), options)
  } else if (invocation.resume.action == 'approve') {
    stream = await agent.approveToolCall<undefined>({ ...options, toolCallId: providerId })
  } else {
    stream = await agent.declineToolCall<undefined>({
      ...options,
      toolCallId: providerId,
      reason: 'The reviewer rejected this call. Do not report it as executed.',
    })
  }
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
