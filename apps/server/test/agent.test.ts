import type { MastraModelConfig } from '@mastra/core/llm'
import type { JsonValue, ManagedTaskDefinition } from '@oomol-lab/open-flow/flow-change'
import type { AgentResult } from '@oomol-lab/open-flow/runtime-contract'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compactResults } from '../node/deployment/agent-results.ts'
import { createLlm } from '../node/deployment/llm.ts'
import { createServerApp } from '../node/transport/http.ts'
import { createConnectorHost } from './connectorHost.ts'
import { acceptRun } from './runFixture.ts'
import { openService, startService, closeService } from './serviceFixture.ts'

afterEach(() => vi.unstubAllGlobals())
import { createHash } from 'node:crypto'
import { afterAll } from 'vitest'
import { executeCode } from '../node/deployment/agent-code.ts'
import { IsolatedVmHost } from '../node/runtime/isolated-vm.ts'
const codeHost = new IsolatedVmHost()
afterAll(() => codeHost.close())
import { executeAgent as runAgent } from '../node/deployment/agent.ts'
import { ConnectorTaskError } from '../node/deployment/connector.ts'

const savedResults = new Map<string, { result: import('@oomol-lab/open-flow/control-api').ResultInfo; content: string }>()
afterEach(() => savedResults.clear())
function executeAgent(
  task: Parameters<typeof runAgent>[0],
  invocation: Parameters<typeof runAgent>[1],
  model: Parameters<typeof runAgent>[2],
  execute: Parameters<typeof runAgent>[3],
  report: Parameters<typeof runAgent>[4] = async () => {},
) {
  return runAgent(
    task,
    invocation,
    model,
    execute,
    report,
    {
      find: (callId) => savedResults.get(callId),
      save: (callId, tool, _input, value) => {
        const content = JSON.stringify(value)
        const result = {
          resultId: callId,
          callId,
          toolId: tool.id,
          source: tool.kind == 'code' ? { kind: 'code' as const } : { kind: 'connector' as const, action: tool.action },
          bytes: Buffer.byteLength(content),
          digest: createHash('sha256').update(content).digest('hex'),
          createdAt: new Date().toISOString(),
        }
        savedResults.set(callId, { result, content })
        return result
      },
      get: (id) => savedResults.get(id),
    },
    (code, input, callId, signal) => executeCode(codeHost, code, input, callId, signal),
  )
}

const task: ManagedTaskDefinition = {
  name: 'Agent',
  inputs: [],
  outputs: [{ handle: 'output', nullable: false, jsonSchema: { type: 'string', minLength: 1 } }],
  executor: {
    kind: 'agent',
    model: 'fixture',
    prompt: { kind: 'value', value: 'Send the messages.' },
    system: 'Help.',
    maxRounds: 3,
    tools: [
      {
        id: 'send',
        name: 'send',
        description: 'Send a message.',
        action: 'mail.send',
        approval: true,
        inputs: [{ handle: 'body', nullable: false, jsonSchema: { type: 'string' }, source: { kind: 'model' } }],
      },
    ],
  },
}

function fixture(batches: readonly (string | readonly { id: string; input: string; toolName?: string }[])[]) {
  const prompts: unknown[] = []
  const model: MastraModelConfig = {
    specificationVersion: 'v2',
    provider: 'fixture',
    modelId: 'fixture',
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error('Expected streaming.')
    },
    doStream: async ({ prompt }) => {
      const batch = batches[prompts.length]
      prompts.push(prompt)
      if (batch == null) throw new Error('Unexpected model request.')
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            if (typeof batch == 'string') {
              controller.enqueue({ type: 'text-start', id: 'text' })
              controller.enqueue({ type: 'text-delta', id: 'text', delta: batch })
              controller.enqueue({ type: 'text-end', id: 'text' })
            } else
              for (const call of batch) controller.enqueue({ type: 'tool-call', toolCallId: call.id, toolName: call.toolName ?? 'send', input: call.input })
            controller.enqueue({
              type: 'finish',
              finishReason: typeof batch == 'string' ? 'stop' : 'tool-calls',
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            })
            controller.close()
          },
        }),
      }
    },
  }
  return { model, prompts }
}

function checkpoint(result: AgentResult) {
  if (result.kind != 'suspended') throw new Error('Expected approval.')
  return JSON.parse(JSON.stringify(result.checkpoint)) as typeof result.checkpoint
}

const invocation = { invocationId: 'invocation', input: {}, signal: new AbortController().signal }

describe('Agent streaming adapter', () => {
  it('restores separate approvals in one batch without repeating tools or requesting the model early', async () => {
    const { model, prompts } = fixture([
      [
        { id: 'a', input: '{"body":"hello"}' },
        { id: 'b', input: '{"body":"hello"}' },
      ],
      'done',
    ])
    const calls: string[] = []
    const execute = async (_tool: unknown, _input: unknown, id: string): Promise<JsonValue> => {
      calls.push(id)
      return { sent: true }
    }
    const first = checkpoint(await executeAgent(task, invocation, model, execute))
    expect(calls).toEqual([])
    expect(prompts).toHaveLength(1)
    const second = checkpoint(await executeAgent(task, { ...invocation, resume: { action: 'approve', checkpoint: first } }, model, execute))
    expect(calls).toEqual(['invocation:1:a'])
    expect(prompts).toHaveLength(1)
    expect(second.callId).toBe('invocation:1:b')
    expect(await executeAgent(task, { ...invocation, resume: { action: 'reject', checkpoint: second } }, model, execute)).toEqual({
      kind: 'completed',
      output: 'done',
    })
    expect(calls).toEqual(['invocation:1:a'])
    expect(prompts).toHaveLength(2)
    expect(JSON.stringify(prompts[1])).toContain('rejected')
  })

  it('feeds a proven input failure to the model and preserves distinct calls for equal arguments', async () => {
    const source = {
      ...task,
      executor: {
        ...task.executor,
        tools: task.executor.kind == 'agent' ? task.executor.tools.map((tool) => Object.assign({}, tool, { approval: false })) : [],
      },
    } as ManagedTaskDefinition
    const { model, prompts } = fixture([
      [
        { id: 'a', input: '{"body":"hello"}' },
        { id: 'b', input: '{"body":"hello"}' },
      ],
      'done',
    ])
    const calls: string[] = []
    const result = await executeAgent(source, invocation, model, async (_tool, _input, id) => {
      calls.push(id)
      if (id.endsWith(':a')) throw new ConnectorTaskError('connector.input-invalid', 'The recipient is invalid.')
      return { sent: true }
    })
    expect(result).toEqual({ kind: 'completed', output: 'done' })
    expect(calls).toEqual(['invocation:1:a', 'invocation:1:b'])
    expect(prompts).toHaveLength(2)
  })

  it('delivers a result above 2 KiB to the model with complete nested content', async () => {
    if (task.executor.kind != 'agent') throw new Error('Expected Agent.')
    const source: ManagedTaskDefinition = {
      ...task,
      executor: { ...task.executor, tools: task.executor.tools.map((tool) => ({ ...tool, approval: false })) },
    }
    const { model, prompts } = fixture([[{ id: 'fetch', input: '{"body":"fetch"}' }], 'done'])
    const output = { messages: Array.from({ length: 10 }, (_, id) => ({ id, body: `Message ${id}: ${'x'.repeat(500)}` })) }
    const execute = vi.fn(async () => output)
    await expect(executeAgent(source, invocation, model, execute)).resolves.toEqual({ kind: 'completed', output: 'done' })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(prompts).toHaveLength(2)
    const prompt = JSON.stringify(prompts[1])
    for (const message of output.messages) expect(prompt).toContain(message.body)
  })

  it('reads a large saved result without repeating its external action', async () => {
    const source = {
      ...task,
      executor: {
        ...task.executor,
        maxRounds: 4,
        tools: task.executor.kind == 'agent' ? task.executor.tools.map((tool) => ({ ...tool, approval: false })) : [],
      },
    } as ManagedTaskDefinition
    const { model, prompts } = fixture([
      [{ id: 'large', input: '{"body":"fetch"}' }],
      [{ id: 'read', toolName: 'read_result', input: JSON.stringify({ resultId: 'invocation:1:large', pointer: '/emails/0/body', offset: 8192 }) }],
      'done',
    ])
    let calls = 0
    const output = { emails: [{ body: 'x'.repeat(2 * 1024 * 1024) }] }
    await expect(
      executeAgent(source, invocation, model, async () => {
        calls++
        return output
      }),
    ).resolves.toEqual({ kind: 'completed', output: 'done' })
    expect(calls).toBe(1)
    expect(savedResults.get('invocation:1:large')?.content).toBe(JSON.stringify(output))
    expect(JSON.stringify(prompts).length).toBeLessThan(64000)
    expect(JSON.stringify(prompts)).toContain('nextOffset')
  })

  it('compacts saved previews across approval and reads an older result after resuming', async () => {
    if (task.executor.kind != 'agent') throw new Error('Expected Agent.')
    const source: ManagedTaskDefinition = {
      ...task,
      executor: {
        ...task.executor,
        tools: [
          { ...task.executor.tools[0]!, approval: false },
          { ...task.executor.tools[0]!, id: 'confirm', name: 'confirm', approval: true },
        ],
      },
    }
    const { model, prompts } = fixture([
      [
        ...Array.from({ length: 24 }, (_, index) => ({ id: String(index), input: '{"body":"fetch"}' })),
        { id: 'confirm', toolName: 'confirm', input: '{"body":"approve"}' },
      ],
      [{ id: 'read', toolName: 'read_result', input: '{"resultId":"invocation:1:0","offset":100}' }],
      'done',
    ])
    let calls = 0
    const execute = async () => {
      calls++
      return 'x'.repeat(17000)
    }
    const paused = checkpoint(await executeAgent(source, invocation, model, execute))
    expect(calls).toBe(24)
    const encoded = JSON.stringify(paused.state)
    expect(encoded).toContain('previewOmitted')
    expect((encoded.match(/x/g) ?? []).length).toBeLessThan(132000)
    await expect(executeAgent(source, { ...invocation, resume: { action: 'reject', checkpoint: paused } }, model, execute)).resolves.toEqual({
      kind: 'completed',
      output: 'done',
    })
    expect(calls).toBe(24)
    expect(JSON.stringify(prompts.at(-1))).toContain('nextOffset')
  })

  it('terminates an uncertain call without executing the rest of the batch or requesting another model round', async () => {
    const source = {
      ...task,
      executor: {
        ...task.executor,
        tools: task.executor.kind == 'agent' ? task.executor.tools.map((tool) => Object.assign({}, tool, { approval: false })) : [],
      },
    } as ManagedTaskDefinition
    const { model, prompts } = fixture([
      [
        { id: 'a', input: '{"body":"hello"}' },
        { id: 'b', input: '{"body":"hello"}' },
      ],
    ])
    const calls: string[] = []
    const events: Readonly<Record<string, JsonValue>>[] = []
    await expect(
      executeAgent(
        source,
        invocation,
        model,
        async (_tool, _input, id) => {
          calls.push(id)
          throw new ConnectorTaskError('connector.indeterminate', 'Outcome unknown.')
        },
        async (event) => {
          events.push(event)
        },
      ),
    ).rejects.toThrow()
    expect(calls).toEqual(['invocation:1:a'])
    expect(prompts).toHaveLength(1)
    expect(events.find((event) => event.status == 'failed')).toMatchObject({ executed: null, message: 'Outcome unknown.', code: 'connector.indeterminate' })
  })
})

it('resumes a streamed gateway batch after restart and retains earlier receipts after the next wait and terminal', async () => {
  if (task.executor.kind != 'agent') throw new Error('Expected Agent.')
  const directory = await mkdtemp(path.join(tmpdir(), 'agent-run-'))
  const calls: string[] = []
  let savedResultId: string | undefined
  const requests: { token: string | null; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push({ token: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) })
      const delta =
        requests.length == 1
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'compute',
                  type: 'function',
                  function: { name: 'run_code', arguments: JSON.stringify({ code: 'export default () => 42', inputs: {} }) },
                },
                { index: 1, id: 'a', type: 'function', function: { name: 'send', arguments: '{"body":"hello"}' } },
                { index: 2, id: 'b', type: 'function', function: { name: 'send', arguments: '{"body":"bye"}' } },
              ],
            }
          : requests.length == 2
            ? {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'read',
                    type: 'function',
                    function: { name: 'read_result', arguments: JSON.stringify({ resultId: savedResultId, pointer: '/body', offset: 100 }) },
                  },
                ],
              }
            : { role: 'assistant', content: 'done' }
      const chunks = [
        { id: 'response', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] },
        {
          id: 'response',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'fixture',
          choices: [{ index: 0, delta: {}, finish_reason: requests.length <= 2 ? 'tool_calls' : 'stop' }],
        },
      ]
      return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    }),
  )
  let llm = createLlm('https://gateway.example.com', 'original')
  const connector = createConnectorHost({
    getAction: async () => ({
      actionId: 'mail.send',
      authenticated: false,
      description: 'Send.',
      serviceId: 'mail',
      serviceName: 'Mail',
      name: 'send',
      inputSchema: {},
      outputSchema: {},
      inputs: {},
      outputs: {},
    }),
    execute: async (_action, _connection, _input, callId) => {
      calls.push(callId)
      return { sent: true, body: 'x'.repeat(2 * 1024 * 1024) }
    },
  })
  const file = path.join(directory, 'store.sqlite')
  const options = { capabilities: { llm: () => llm, connector: () => connector } }
  let service = await openService(file, options)
  try {
    await startService(service)
    const accepted = await acceptRun(service, {
      flowId: 'flow',
      idempotencyKey: 'agent-run',
      revisionId: 'revision',
      revision: {
        modelVersion: 1,
        modules: {},
        document: {
          bindings: {},
          subflows: {},
          tasks: { agent: { ...task, executor: { ...task.executor, code: true } } },
          graph: {
            edges: [],
            nodes: { agent: { kind: 'task', name: 'Agent', taskId: 'agent', inputs: {} } },
          },
        },
      },
    })
    if (accepted.kind != 'accepted') throw new Error('Expected accepted Run.')
    await service.waitForIdle()
    const first = service.control.getRun(accepted.runId)
    expect(first.status).toBe('waiting')
    if (first.waiting == null) throw new Error(JSON.stringify(service.events(accepted.runId)))
    expect(calls).toEqual([])
    await closeService(service)
    llm = createLlm('https://new-gateway.example.com', 'changed')
    service = await openService(file, options)
    await startService(service)
    const decision = service.control.resolveRunWait(accepted.runId, first.waiting.waitId, 'approve')
    await service.waitForIdle()
    const second = service.control.getRun(accepted.runId)
    expect(second.status).toBe('waiting')
    if (second.waiting == null) throw new Error(JSON.stringify(service.events(accepted.runId)))
    expect(second.waiting.waitId).not.toBe(first.waiting.waitId)
    expect(calls).toHaveLength(1)
    savedResultId = service.control.listRunResults(accepted.runId).results.find((result) => result.source.kind == 'connector')?.resultId
    expect(savedResultId).toBeDefined()
    expect(requests).toHaveLength(1)
    expect(service.control.resolveRunWait(accepted.runId, first.waiting.waitId, 'reject')).toMatchObject({
      action: 'approve',
      resolvedAt: decision.resolvedAt,
      resolutionAccepted: false,
    })
    expect(service.control.getRun(accepted.runId).waiting?.waitId).toBe(second.waiting.waitId)
    await closeService(service)
    service = await openService(file, options)
    await startService(service)
    service.control.resolveRunWait(accepted.runId, second.waiting.waitId, 'reject')
    await service.waitForIdle()
    expect(service.control.getRun(accepted.runId).status).toBe('completed')
    expect(service.control.resolveRunWait(accepted.runId, first.waiting.waitId, 'approve')).toMatchObject({
      action: 'approve',
      resolvedAt: decision.resolvedAt,
      resolutionAccepted: true,
    })
    expect(calls).toHaveLength(1)
    expect(requests.map((request) => request.token)).toEqual(['Bearer original', 'Bearer original', 'Bearer original'])
    expect(service.events(accepted.runId).filter((event) => event.kind == 'node.started')).toHaveLength(1)
    expect(service.events(accepted.runId).filter((event) => event.kind == 'node.completed')).toHaveLength(1)
    const app = createServerApp(service, {
      resolveControlActor: (request) => (request.headers.get('authorization') == 'Bearer operator' ? 'server-operator' : undefined),
    })
    const client = new ControlClient(async (route, init) =>
      app.request(new Request(`http://server.local${route}`, { ...init, headers: { authorization: 'Bearer operator' } })),
    )
    const stored = await client.listRunResults(accepted.runId)
    expect(stored.results).toHaveLength(2)
    const computation = stored.results.find((result) => result.source.kind == 'code')!
    expect((await client.readRunResult(accepted.runId, computation.resultId)).page.value).toBe(42)
    expect(
      service
        .events(accepted.runId)
        .filter(
          (event) =>
            event.kind == 'node.log' &&
            JSON.parse(String(event.payload.message)).toolId == 'run_code' &&
            JSON.parse(String(event.payload.message)).status == 'started',
        ),
    ).toHaveLength(1)
    const info = stored.results.find((result) => result.source.kind == 'connector')!
    expect((await client.readRunResult(accepted.runId, info.resultId, { pointer: '/sent' })).page.value).toBe(true)
    expect(JSON.parse(await (await client.downloadRunResult(accepted.runId, info.resultId)).text()).body).toHaveLength(2 * 1024 * 1024)
    expect((await app.request(`http://server.local/v1/runs/${accepted.runId}/results`)).status).toBe(401)
    expect(JSON.stringify(requests).length).toBeLessThan(64000)
    const database = new DatabaseSync(file)
    try {
      database.prepare('DELETE FROM events WHERE run_id = ?').run(accepted.runId)
      expect((await client.listRunResults(accepted.runId)).results).toHaveLength(2)
      expect((await client.readRunResult(accepted.runId, info.resultId, { pointer: '/sent' })).page.value).toBe(true)
      await client.deleteFlow(service.control.getRun(accepted.runId).flowId)
      await service.tickMaintenance()
      expect(database.prepare('SELECT COUNT(*) AS count FROM run_results WHERE run_id = ?').get(accepted.runId)?.count).toBe(0)
    } finally {
      database.close()
    }
  } finally {
    await closeService(service)
    await rm(directory, { recursive: true, force: true })
  }
})

it('bounds old result previews without changing user messages or tool arguments', () => {
  const envelope = { kind: 'stored-result', result: { resultId: 'saved' }, page: { value: 'x'.repeat(16000) } }
  const messages = [
    { role: 'user', content: envelope },
    ...Array.from({ length: 30 }, () => ({ role: 'assistant', content: [{ args: envelope, result: envelope }] })),
  ]
  const bounded = compactResults(messages, new Set(['saved']))
  expect(bounded[0]).toEqual(messages[0])
  let previews = 0
  for (const message of bounded.slice(1)) {
    if (!Array.isArray(message.content)) throw new Error('Expected tool content.')
    expect(message.content[0]?.args).toEqual(envelope)
    previews += JSON.stringify(message.content[0]?.result).length
  }
  expect(previews).toBeLessThan(140000)
  expect(JSON.stringify(bounded.at(-1))).toContain('"page"')
})

it('computes over saved large results without copying them through the model and chains code results', async () => {
  if (task.executor.kind != 'agent') throw new Error('Expected Agent.')
  const source: ManagedTaskDefinition = {
    ...task,
    executor: { ...task.executor, code: true, maxRounds: 5, tools: task.executor.tools.map((tool) => ({ ...tool, approval: false })) },
  }
  const { model, prompts } = fixture([
    [{ id: 'fetch', input: '{"body":"fetch"}' }],
    [
      {
        id: 'count',
        toolName: 'run_code',
        input: JSON.stringify({
          code: 'export default inputs => inputs.mail.messages.length',
          inputs: { mail: { kind: 'result', resultId: 'invocation:1:fetch' } },
        }),
      },
    ],
    [
      {
        id: 'double',
        toolName: 'run_code',
        input: JSON.stringify({ code: 'export default inputs => inputs.count * 2', inputs: { count: { kind: 'result', resultId: 'invocation:2:count' } } }),
      },
    ],
    'done',
  ])
  const execute = vi.fn(async () => ({ messages: Array.from({ length: 1000 }, () => ({ body: 'x'.repeat(3000) })) }))
  await expect(executeAgent(source, invocation, model, execute)).resolves.toEqual({ kind: 'completed', output: 'done' })
  expect(execute).toHaveBeenCalledTimes(1)
  expect(savedResults.get('invocation:3:double')?.content).toBe('2000')
  expect(JSON.stringify(prompts).length).toBeLessThan(100000)
})

it('feeds code errors back to the model while rejecting access to unowned result IDs', async () => {
  if (task.executor.kind != 'agent') throw new Error('Expected Agent.')
  const source: ManagedTaskDefinition = { ...task, executor: { ...task.executor, code: true, tools: [], maxRounds: 4 } }
  const { model, prompts } = fixture([
    [
      {
        id: 'missing',
        toolName: 'run_code',
        input: JSON.stringify({ code: 'export default inputs => inputs.data', inputs: { data: { kind: 'result', resultId: 'other-invocation' } } }),
      },
    ],
    [{ id: 'bad', toolName: 'run_code', input: JSON.stringify({ code: 'export default () => ({oops: undefined})', inputs: {} }) }],
    [
      {
        id: 'fixed',
        toolName: 'run_code',
        input: JSON.stringify({ code: 'export default inputs => inputs.number + 1', inputs: { number: { kind: 'value', value: 2 } } }),
      },
    ],
    'done',
  ])
  const external = vi.fn(async () => null)
  await expect(executeAgent(source, invocation, model, external)).resolves.toEqual({ kind: 'completed', output: 'done' })
  expect(external).not.toHaveBeenCalled()
  expect(savedResults.size).toBe(1)
  expect(savedResults.get('invocation:3:fixed')?.content).toBe('3')
  expect(JSON.stringify(prompts)).toContain('not available to the current Agent invocation')
})

it('resumes after approval without repeating completed code computation', async () => {
  if (task.executor.kind != 'agent') throw new Error('Expected Agent.')
  const source: ManagedTaskDefinition = { ...task, executor: { ...task.executor, code: true } }
  const { model } = fixture([
    [
      { id: 'compute', toolName: 'run_code', input: JSON.stringify({ code: 'export default () => 42', inputs: {} }) },
      { id: 'send', input: '{"body":"answer"}' },
    ],
    [{ id: 'read', toolName: 'read_result', input: JSON.stringify({ resultId: 'invocation:1:compute' }) }],
    'done',
  ])
  const reports: Readonly<Record<string, JsonValue>>[] = []
  const report = async (event: Readonly<Record<string, JsonValue>>) => {
    reports.push(event)
  }
  const paused = checkpoint(await executeAgent(source, invocation, model, async () => null, report))
  await expect(executeAgent(source, { ...invocation, resume: { action: 'approve', checkpoint: paused } }, model, async () => null, report)).resolves.toEqual({
    kind: 'completed',
    output: 'done',
  })
  expect(reports.filter((event) => event.toolId == 'run_code' && event.status == 'started')).toHaveLength(1)
  expect(savedResults.get('invocation:1:compute')?.content).toBe('42')
})

it('runs a code-only Agent through the service without a Connector deployment', async () => {
  if (task.executor.kind != 'agent') throw new Error('Expected Agent.')
  const source: ManagedTaskDefinition = { ...task, executor: { ...task.executor, code: true, tools: [] } }
  const directory = await mkdtemp(path.join(tmpdir(), 'code-only-run-'))
  let requests = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      requests++
      const delta =
        requests == 1
          ? {
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'compute',
                  type: 'function',
                  function: { name: 'run_code', arguments: JSON.stringify({ code: 'export default () => ({ count: 42 })', inputs: {} }) },
                },
              ],
            }
          : { role: 'assistant', content: 'done' }
      const chunk = (value: unknown, finish: string | null) =>
        `data: ${JSON.stringify({ id: String(requests), object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`
      return new Response(chunk(delta, null) + chunk({}, requests == 1 ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    }),
  )
  const service = await openService(path.join(directory, 'store.sqlite'), {
    capabilities: { llm: () => createLlm('https://gateway.example.com', 'test'), connector: () => undefined },
  })
  try {
    await startService(service)
    const accepted = await acceptRun(service, {
      flowId: 'flow',
      idempotencyKey: 'code-run',
      revisionId: 'revision',
      revision: {
        modelVersion: 1,
        modules: {},
        document: {
          bindings: {},
          subflows: {},
          tasks: { agent: source },
          graph: { edges: [], nodes: { agent: { kind: 'task', name: 'Agent', taskId: 'agent', inputs: {} } } },
        },
      },
    })
    if (accepted.kind != 'accepted') throw new Error('Expected accepted Run.')
    await service.waitForIdle()
    expect(service.control.getRun(accepted.runId).status).toBe('completed')
    expect(requests).toBe(2)
    const app = createServerApp(service, { resolveControlActor: () => 'server-operator' })
    const client = new ControlClient(async (route, init) => app.request(new Request(`http://local${route}`, init)))
    const results = await client.listRunResults(accepted.runId)
    expect(results.results[0]?.source).toEqual({ kind: 'code' })
  } finally {
    await closeService(service)
    await rm(directory, { recursive: true, force: true })
  }
})

it('does not expose code when disabled and does not recover from a CPU limit', async () => {
  const args = JSON.stringify({ code: 'export default () => { while (true) {} }', inputs: {} })
  const disabled = fixture([[{ id: 'denied', toolName: 'run_code', input: args }], 'done'])
  const external = vi.fn(async () => null)
  await executeAgent(task, invocation, disabled.model, external)
  expect(savedResults.size).toBe(0)
  expect(external).not.toHaveBeenCalled()
  if (task.executor.kind != 'agent') throw new Error('Expected Agent.')
  const enabled = fixture([[{ id: 'loop', toolName: 'run_code', input: args }], 'must not continue'])
  await expect(executeAgent({ ...task, executor: { ...task.executor, code: true, tools: [] } }, invocation, enabled.model, external)).rejects.toMatchObject({
    code: 'limit-exceeded',
  })
  expect(enabled.prompts).toHaveLength(1)
  expect(savedResults.size).toBe(0)
})
