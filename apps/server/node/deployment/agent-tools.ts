import type { ResultCall, ResultInfo } from '@oomol-lab/open-flow/control-api'
import type { AgentTool, JsonValue, ManagedTaskExecutor } from '@oomol-lab/open-flow/flow-change'
import type { AgentInvocation } from '@oomol-lab/open-flow/runtime-contract'

import { createTool } from '@mastra/core/tools'
import { readResult } from '@oomol-lab/open-flow/control-api'
import { canonicalJsonBytes } from '@oomol-lab/open-flow/flow-encoding'
import { agentToolInput, agentToolSchema } from '@oomol-lab/open-flow/flow-semantics'
import { z } from 'zod'
import { IsolatedVmError } from '../runtime/isolated-vm.ts'
import { ConnectorTaskError } from './connector.ts'

export interface ResultHost {
  find(callId: string, tool: ResultCall, input: Readonly<Record<string, JsonValue>>): { result: ResultInfo; content: string } | undefined
  save(callId: string, tool: ResultCall, input: Readonly<Record<string, JsonValue>>, output: JsonValue): ResultInfo
  get(resultId: string): { result: ResultInfo; content: string } | undefined
}

interface ToolHost {
  readonly signal: AbortSignal
  readonly references: Map<string, string>
  readonly results: ResultHost
  rounds(): number
  fail(error: unknown): never
  execute(tool: AgentTool, input: Readonly<Record<string, JsonValue>>, callId: string, signal: AbortSignal): Promise<JsonValue>
  compute(code: string, input: JsonValue, callId: string, signal: AbortSignal): Promise<JsonValue>
  report(event: Readonly<Record<string, JsonValue>>): Promise<void>
}

const codeSchema = z.strictObject({
  code: z.string().min(1).max(65536),
  inputs: z.record(
    z.string(),
    z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('value'), value: z.json() }),
      z.strictObject({ kind: z.literal('input'), input: z.string() }),
      z.strictObject({ kind: z.literal('result'), resultId: z.string() }),
    ]),
  ),
})

function codeInputs(
  sources: z.infer<typeof codeSchema>['inputs'],
  inputs: AgentInvocation['input'],
  results: ResultHost,
  references: ReadonlyMap<string, string>,
): Readonly<Record<string, JsonValue>> {
  const entries: [string, JsonValue][] = []
  let inputBytes = 2
  for (const [key, source] of Object.entries(sources)) {
    if (source.kind == 'value') entries.push([key, source.value])
    else if (source.kind == 'input') {
      if (!Object.hasOwn(inputs, source.input)) throw new IsolatedVmError('task-failed', 'The requested Agent input does not exist.')
      entries.push([key, inputs[source.input]!])
    } else {
      if (!references.has(source.resultId)) throw new IsolatedVmError('task-failed', 'This result is not available to the current Agent invocation.')
      const stored = results.get(source.resultId)
      if (stored == null || stored.result.digest != references.get(source.resultId)) throw new Error('The saved Agent tool result is missing or changed.')
      entries.push([key, JSON.parse(stored.content) as JsonValue])
    }
    inputBytes += Buffer.byteLength(JSON.stringify(entries.at(-1)))
    if (inputBytes > 32 * 1024 * 1024) throw new IsolatedVmError('limit-exceeded', 'Code input exceeds the 32 MiB aggregate limit.')
  }
  return Object.fromEntries(entries)
}

export function createAgentTools(config: Extract<ManagedTaskExecutor, { readonly kind: 'agent' }>, invocation: AgentInvocation, host: ToolHost) {
  const { signal, references, results, rounds, fail, execute, compute, report } = host

  async function complete(callId: string, tool: ResultCall, input: Readonly<Record<string, JsonValue>>, output: JsonValue, previous?: ResultInfo) {
    const resultInfo = previous ?? results.save(callId, tool, input, output)
    references.set(resultInfo.resultId, resultInfo.digest)
    const stored = { kind: 'stored-result', result: resultInfo, page: readResult(output) }
    await report({
      kind: 'tool',
      status: 'completed',
      callId,
      toolId: tool.id,
      ...(tool.kind == 'code' ? { source: { kind: 'code' } } : {}),
      output: stored as unknown as JsonValue,
    })
    return stored
  }
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
          const callId = `${invocation.invocationId}:${rounds()}:${providerId}`
          if (
            invocation.resume?.checkpoint.callId == callId &&
            Buffer.compare(canonicalJsonBytes(input), canonicalJsonBytes(invocation.resume.checkpoint.input)) != 0
          ) {
            return fail(new Error('Approved Agent arguments changed.'))
          }
          await report({ kind: 'tool', status: 'started', callId, toolId: tool.id, input })
          const call: ResultCall = {
            id: tool.id,
            kind: 'connector',
            action: tool.action,
            ...(tool.connectionId == null ? {} : { connectionId: tool.connectionId }),
          }
          let executed = false
          try {
            const previous = results.find(callId, call, input)
            const result = previous == null ? await execute(tool, input, callId, signal) : JSON.parse(previous.content)
            executed = true
            const output = z.json().parse(result)
            signal.throwIfAborted()
            return await complete(callId, call, input, output, previous?.result)
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
            return fail(error)
          }
        },
      }),
    ]),
  )
  const readTool = createTool({
    id: 'read_result',
    description:
      'Read only missing content needed for the task from a saved tool result, without repeating the external action. Values marked complete are already available; do not read their pointers again. For arrays, read the array pointer to get multiple full items per page, then use nextOffset with the same pointer if more items are needed. Read an individual item only when its content was omitted. Missing preview content is not missing data. Pages default to 15000 bytes; request maxBytes up to 65536 only when more content is needed.',
    inputSchema: z.object({
      resultId: z.string(),
      pointer: z.string().max(4096).default(''),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(100).default(20),
      maxBytes: z
        .number()
        .int()
        .min(1)
        .max(64 * 1024)
        .default(15000),
    }),
    execute: async ({ resultId, ...query }) => {
      signal.throwIfAborted()
      if (!references.has(resultId)) return { error: 'This result is not available to the current Agent invocation.' }
      const stored = results.get(resultId)
      if (stored == null || stored.result.digest != references.get(resultId)) {
        return fail(new Error('The saved Agent tool result is missing or changed.'))
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
    inputSchema: codeSchema,
    execute: async (args, context) => {
      signal.throwIfAborted()
      if (config.code != true) throw new Error('Code computation is not enabled.')
      const providerId = context.agent?.toolCallId
      if (providerId == null) throw new Error('Agent tool call identity is missing.')
      const callId = `${invocation.invocationId}:${rounds()}:${providerId}`
      const tool: ResultCall = { id: 'run_code', kind: 'code' }
      await report({ kind: 'tool', status: 'started', callId, toolId: tool.id, source: { kind: 'code' }, input: args })
      let phase: 'executing' | 'returned' | 'saving' = 'executing'
      try {
        const input = codeInputs(args.inputs, invocation.input, results, references)
        const previous = results.find(callId, tool, args)
        const output = previous == null ? await compute(args.code, input, callId, signal) : (JSON.parse(previous.content) as JsonValue)
        phase = 'returned'
        signal.throwIfAborted()
        phase = 'saving'
        return await complete(callId, tool, args, output, previous?.result)
      } catch (error) {
        const recoverable =
          phase != 'saving' && !signal.aborted && error instanceof IsolatedVmError && (error.code == 'invalid-program' || error.code == 'task-failed')
        const message = (error instanceof Error ? error.message : 'Code computation failed.').slice(0, 2000)
        await report({
          kind: 'tool',
          status: 'failed',
          callId,
          toolId: tool.id,
          source: { kind: 'code' },
          executed: phase != 'executing',
          code: 'agent.code-failed',
          message,
        })
        if (recoverable) return { error: message }
        return fail(error)
      }
    },
  })
  return { ...actionTools, read_result: readTool, ...(config.code == true ? { run_code: codeTool } : {}) }
}
