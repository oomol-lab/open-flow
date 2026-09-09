import type { FlowRunOutcome, FlowRunOptions, TaskInvocation } from '../src/execution/common/scheduler.ts'
import type { AgentTool, JsonValue, ManagedTaskDefinition, RevisionContent } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { currentEngineContract, findEngineContract } from '../src/execution/common/engineContract.ts'
import { runFlow, decodeFlowRunCheckpoint } from '../src/execution/common/scheduler.ts'
import { agentConfigIssues, agentToolInput, agentToolSchema } from '../src/flow/common/agent.ts'
import { applyFlowChanges, decodeChangeOperations } from '../src/flow/common/change.ts'
import { decodeRevision, digestBytes, encodeRevision } from '../src/flow/common/encoding.ts'
import { matchesSchema } from '../src/flow/common/schema.ts'
import { prepareFlow } from '../src/flow/common/semantics.ts'
import { flowDependencies, validateFlow } from '../src/flow/common/semantics.ts'

const tool: AgentTool = {
  id: 'send',
  name: 'send_mail',
  description: 'Send an email.',
  action: 'mail.send',
  connectionId: 'work',
  approval: true,
  inputs: [
    { handle: 'to', jsonSchema: { type: 'string' }, nullable: false, source: { kind: 'input', input: 'email' } },
    { handle: 'subject', jsonSchema: { type: 'string', minLength: 1 }, nullable: false, source: { kind: 'model' } },
    { handle: 'tag', jsonSchema: { type: 'string' }, nullable: false, source: { kind: 'value', value: 'support' } },
  ],
}

function task(tools: readonly AgentTool[] = [tool]): ManagedTaskDefinition {
  return {
    name: 'Agent',
    inputs: [{ handle: 'email', jsonSchema: { type: 'string' }, nullable: false }],
    outputs: [{ handle: 'output', jsonSchema: { type: 'string' }, nullable: false }],
    executor: { kind: 'agent', model: 'test', prompt: { kind: 'value', value: 'Handle this request.' }, system: 'Help the customer.', maxRounds: 10, tools },
  }
}

function revision(agent = task()): RevisionContent {
  return {
    modelVersion: 1,
    modules: {},
    document: {
      bindings: {},
      subflows: {},
      tasks: { agent },
      graph: {
        edges: [{ source: 'trigger', target: 'agent' }],
        nodes: {
          trigger: { kind: 'manual', name: 'Start' },
          agent: { kind: 'task', name: 'Agent', taskId: 'agent', inputs: { email: { kind: 'value', value: 'customer@example.com' } } },
        },
      },
    },
  }
}

describe('Agent tool contracts', () => {
  it('edits an Agent atomically and rejects a stale definition', () => {
    const before = task()
    const value = { ...before, executor: { ...before.executor, maxRounds: 5 } } as ManagedTaskDefinition
    const operations = decodeChangeOperations([{ kind: 'task.agent.set', taskId: 'agent', before, value }])
    const edited = applyFlowChanges(revision(before), operations)
    expect(edited.document.tasks.agent).toEqual(value)
    expect(() => applyFlowChanges(edited, operations)).toThrow(/changed/)
  })

  it('exposes only model fields and combines them with fixed invocation data', () => {
    expect(agentToolSchema(tool)).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: { subject: { type: 'string', minLength: 1 } },
      required: ['subject'],
    })
    expect(agentToolInput(tool, { email: 'customer@example.com' }, { subject: 'Hello' })).toEqual({
      to: 'customer@example.com',
      subject: 'Hello',
      tag: 'support',
    })
  })

  it.each([{ subject: 'Hi', to: 'attacker@example.com' }, { subject: 'Hi', tag: 'other' }, { subject: 42 }, {}, null, []])(
    'rejects invalid model arguments %j',
    (args) => {
      expect(() => agentToolInput(tool, { email: 'customer@example.com' }, args)).toThrow()
    },
  )

  it('rejects missing or invalid fixed inputs at the invocation boundary', () => {
    expect(() => agentToolInput(tool, {}, { subject: 'Hi' })).toThrow(/missing/)
    expect(() => agentToolInput(tool, { email: 42 }, { subject: 'Hi' })).toThrow(/invalid/)
  })

  it('rejects duplicate tools, invalid mappings and unsupported schema constraints', () => {
    expect(agentConfigIssues(task([tool, tool]), {})).toEqual(
      expect.arrayContaining(['Agent tool identities must be non-empty and unique.', 'Agent tool names must be unique provider-compatible names.']),
    )
    const invalid = {
      ...tool,
      inputs: [{ ...tool.inputs[0]!, source: { kind: 'input' as const, input: 'missing' }, jsonSchema: { type: 'string', customConstraint: true } }],
    }
    expect(agentConfigIssues(task([invalid]), {})).toEqual(
      expect.arrayContaining([
        'Tool send_mail input to has an invalid schema (unsupported keywords: customConstraint).',
        'Tool send_mail input to has an incompatible source.',
      ]),
    )
  })

  it('accepts Gmail defaults without changing the original schema or weakening argument validation', () => {
    const gmail: AgentTool = {
      ...tool,
      inputs: [
        {
          handle: 'detail',
          nullable: false,
          source: { kind: 'model' },
          jsonSchema: { type: 'string', enum: ['ids', 'summary', 'full'], default: 'summary', description: 'How much message detail to return.' },
        },
        { handle: 'maxResults', nullable: false, source: { kind: 'model' }, jsonSchema: { type: 'integer', minimum: 1, maximum: 500, default: 20 } },
      ],
    }
    const original = structuredClone(gmail)
    expect(agentConfigIssues(task([gmail]), {})).toEqual([])
    expect(agentToolSchema(gmail)).toMatchObject({
      properties: {
        detail: { type: 'string', enum: ['ids', 'summary', 'full'], description: 'How much message detail to return.' },
        maxResults: { type: 'integer', minimum: 1, maximum: 500 },
      },
    })
    expect(JSON.stringify(agentToolSchema(gmail))).not.toContain('default')
    expect(agentToolInput(gmail, {}, { detail: 'summary', maxResults: 20 })).toEqual({ detail: 'summary', maxResults: 20 })
    for (const args of [
      { detail: 'other', maxResults: 20 },
      { detail: 'ids', maxResults: 501 },
      { detail: 'full', maxResults: 0 },
      { detail: 'full', maxResults: 1.5 },
      {},
    ]) {
      expect(() => agentToolInput(gmail, {}, args)).toThrow()
    }
    expect(gmail).toEqual(original)
  })

  it('removes annotations recursively while preserving schema property names and fixed values', () => {
    const annotated: AgentTool = {
      ...tool,
      inputs: [
        {
          handle: 'data',
          nullable: false,
          source: { kind: 'model' },
          jsonSchema: {
            type: 'object',
            title: 'Request',
            examples: [],
            properties: {
              default: { type: 'string', default: 'example', readOnly: true },
              rows: { type: 'array', items: { type: 'integer', minimum: 1, deprecated: false, $comment: 'An item.' } },
            },
            required: ['default', 'rows'],
            additionalProperties: false,
          },
        },
        { handle: 'fixed', nullable: false, source: { kind: 'value', value: 'actual' }, jsonSchema: { type: 'string', default: 'metadata', writeOnly: true } },
      ],
    }
    expect(agentConfigIssues(task([annotated]), {})).toEqual([])
    expect(agentToolSchema(annotated)).toEqual({
      type: 'object',
      required: ['data'],
      additionalProperties: false,
      properties: {
        data: {
          type: 'object',
          properties: { default: { type: 'string' }, rows: { type: 'array', items: { type: 'integer', minimum: 1 } } },
          required: ['default', 'rows'],
          additionalProperties: false,
        },
      },
    })
    expect(agentToolInput(annotated, {}, { data: { default: 'hello', rows: [1] } })).toEqual({ data: { default: 'hello', rows: [1] }, fixed: 'actual' })
    expect(() => agentToolInput(annotated, {}, { data: { default: 'hello', rows: [0] } })).toThrow()
    const unsupported: AgentTool = {
      ...annotated,
      inputs: [{ ...annotated.inputs[0]!, jsonSchema: { type: 'object', properties: { ref: { $ref: '#/missing' } } } }],
    }
    expect(agentConfigIssues(task([unsupported]), {})).toContain('Tool send_mail input data has an invalid schema (Unresolved schema reference: #/missing).')
  })

  it('roundtrips the full declaration and includes authority changes in the digest', async () => {
    const value = revision()
    expect(decodeRevision(encodeRevision(value))).toEqual(value)
    expect(await digestBytes(encodeRevision(value))).not.toEqual(await digestBytes(encodeRevision(revision(task([{ ...tool, connectionId: 'other' }])))))
    expect(await digestBytes(encodeRevision(value))).not.toEqual(await digestBytes(encodeRevision(revision(task([{ ...tool, approval: false }])))))
  })

  it('includes notification Tasks in the closure and validates their independent inputs', () => {
    const value = revision()
    const original = value.document.tasks.agent!
    if (original.executor.kind != 'agent') throw new Error('Expected Agent fixture.')
    const agent: ManagedTaskDefinition = {
      ...original,
      executor: {
        ...original.executor,
        notification: {
          taskId: 'notice',
          messageHandle: 'text',
          inputs: { recipient: { kind: 'input', input: 'email' } },
        },
      },
    }
    const notice: ManagedTaskDefinition = {
      name: 'Notify',
      executor: { kind: 'connector', action: 'mail.send', connectionId: 'reviewer' },
      outputs: [],
      inputs: [
        { handle: 'text', jsonSchema: { type: 'string' }, nullable: false },
        { handle: 'recipient', jsonSchema: { type: 'string' }, nullable: false },
      ],
    }
    const document = { ...value.document, tasks: { agent, notice } }
    expect([...flowDependencies({ ...value, document }).tasks].toSorted()).toEqual(['agent', 'notice'])
    expect(agentConfigIssues(agent, document.tasks)).toEqual([])
    expect(agentConfigIssues(agent, { agent })).toContain('Agent notification must reference a Connector Task.')
  })

  it('accepts root Agents and rejects Agents in referenced Subflows', async () => {
    const engine = findEngineContract(currentEngineContract)!
    const value = revision()
    expect((await validateFlow(value, engine)).diagnostics).toEqual([])
    const nested: RevisionContent = {
      ...value,
      document: {
        ...value.document,
        graph: {
          edges: [{ source: 'trigger', target: 'child' }],
          nodes: {
            trigger: value.document.graph.nodes.trigger!,
            child: { kind: 'subflow', name: 'Child', subflowId: 'child', inputs: {} },
          },
        },
        subflows: { child: { name: 'Child', inputs: [], outputs: [], graph: { edges: [], nodes: { agent: value.document.graph.nodes.agent! } } } },
      },
    }
    expect((await validateFlow(nested, engine)).diagnostics.map((item) => item.code)).toContain('agent.subflow-unsupported')
  })
})

function pause(callId: string) {
  return {
    kind: 'suspended',
    checkpoint: {
      state: { callId },
      callId,
      toolId: tool.id,
      input: { to: 'customer@example.com', subject: 'Hello', tag: 'support' },
      rounds: 1,
      version: 1,
    },
  }
}

async function execute(
  source: RevisionContent,
  invokeTask: FlowRunOptions['invokeTask'],
  suspended?: Extract<FlowRunOutcome, { kind: 'waiting' }>,
  action: 'approve' | 'reject' = 'approve',
) {
  const prepared = await prepareFlow(source, currentEngineContract)
  if (prepared.kind != 'prepared') throw new Error(`Preparation failed: ${JSON.stringify(prepared)}`)
  let id = 0
  return Effect.runPromise(
    runFlow(prepared.flow, {
      flowId: 'flow',
      runId: 'run',
      createId: () => `${suspended?.wait.waitId ?? 'first'}-${++id}`,
      invokeTask,
      ...(suspended == null
        ? { trigger: { nodeId: 'trigger', payload: {} } }
        : { resume: { action, checkpoint: JSON.parse(JSON.stringify(suspended.checkpoint)) } }),
    }),
  )
}

function waiting(outcome: FlowRunOutcome): Extract<FlowRunOutcome, { kind: 'waiting' }> {
  if (outcome.kind != 'waiting') throw new Error('Expected waiting Run.')
  return outcome
}

describe('Agent Scheduler continuation', () => {
  it('preserves parallel pauses and resumes A1, B1, A2 without rerunning a sibling', async () => {
    const source = revision()
    const node = source.document.graph.nodes.agent!
    const value: RevisionContent = {
      ...source,
      document: {
        ...source.document,
        graph: {
          edges: [
            { source: 'trigger', target: 'A' },
            { source: 'trigger', target: 'B' },
            { source: 'trigger', target: 'sibling' },
          ],
          nodes: { trigger: source.document.graph.nodes.trigger!, A: { ...node, name: 'A' }, B: { ...node, name: 'B' }, sibling: { ...node, name: 'Sibling' } },
        },
      },
    }
    const calls: string[] = []
    const identities = new Map<string, string>()
    const invoke = (invocation: TaskInvocation) =>
      Effect.gen(function* () {
        const { nodeId, agent } = invocation
        if (agent == null) {
          identities.set(nodeId, invocation.invocationId)
          calls.push(`${nodeId}:start`)
          yield* Effect.sleep(5)
          return nodeId == 'sibling' ? { kind: 'completed', output: 'sibling' } : pause(`${nodeId}1`)
        }
        expect(invocation.invocationId).toBe(identities.get(nodeId))
        calls.push(`${agent.checkpoint.callId}:${agent.action}`)
        return agent.checkpoint.callId == 'A1' ? pause('A2') : { kind: 'completed', output: nodeId }
      })
    const first = waiting(await execute(value, invoke))
    expect(first.wait.nodeId).toBe('A')
    expect(first.checkpoint.queue.map((item) => item.nodeId)).toEqual(['B'])
    expect(Object.keys(first.checkpoint.results)).toContain('sibling')
    const second = waiting(await execute(value, invoke, first))
    expect(second.wait.nodeId).toBe('B')
    expect(second.checkpoint.queue.map((item) => item.nodeId)).toEqual(['A'])
    const third = waiting(await execute(value, invoke, second, 'reject'))
    expect(third.wait.nodeId).toBe('A')
    const result = await execute(value, invoke, third)
    expect(result.kind).toBe('node-results')
    expect(calls).toEqual(['A:start', 'B:start', 'sibling:start', 'A1:approve', 'B1:reject', 'A2:approve'])
  })

  it('does not execute a successor until the suspended Agent completes', async () => {
    const source = revision()
    const value: RevisionContent = {
      ...source,
      document: {
        ...source.document,
        graph: {
          edges: [...source.document.graph.edges, { source: 'agent', target: 'after' }],
          nodes: { ...source.document.graph.nodes, after: { ...source.document.graph.nodes.agent!, name: 'After' } },
        },
      },
    }
    const calls: string[] = []
    const invoke = (invocation: TaskInvocation) =>
      Effect.sync(() => {
        calls.push(invocation.nodeId)
        return invocation.nodeId == 'agent' && invocation.agent == null ? pause('call') : { kind: 'completed', output: 'done' }
      })
    const first = waiting(await execute(value, invoke))
    expect(calls).toEqual(['agent'])
    expect((await execute(value, invoke, first)).kind).toBe('node-results')
    expect(calls).toEqual(['agent', 'agent', 'after'])
  })

  it('carries the node budget across waits and rejects missing budgets before invoking the adapter', async () => {
    const source = revision()
    const node = source.document.graph.nodes.agent
    if (node?.kind != 'task') throw new Error('Expected Agent Task.')
    const value: RevisionContent = {
      ...source,
      document: {
        ...source.document,
        graph: {
          ...source.document.graph,
          nodes: { ...source.document.graph.nodes, agent: { ...node, timeoutMs: 150 } },
        },
      },
    }
    let calls = 0
    const invoke = () =>
      Effect.gen(function* () {
        calls++
        yield* Effect.sleep(90)
        return pause(`call-${calls}`)
      })
    const first = waiting(await execute(value, invoke))
    expect(first.checkpoint.agents.agent!.remainingMs).toBeLessThan(100)
    const corrupt = {
      ...first,
      checkpoint: {
        ...first.checkpoint,
        agents: {
          agent: { ...first.checkpoint.agents.agent!, remainingMs: undefined },
        },
      },
    }
    await expect(execute(value, invoke, corrupt)).rejects.toThrow(/budget/)
    expect(calls).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 160))
    await expect(execute(value, invoke, first)).rejects.toThrow(/timed out/)
    expect(calls).toBe(2)
  })

  it.each<Record<string, JsonValue>>([
    { to: 'attacker@example.com', subject: 'Hello', tag: 'support' },
    { to: 'customer@example.com', subject: '', tag: 'support' },
    { to: 'customer@example.com', subject: 'Hello', tag: 'support', extra: true },
  ])('rejects invalid saved arguments even when the approval value agrees: %j', async (input) => {
    const first = waiting(await execute(revision(), () => Effect.succeed(pause('call'))))
    const saved = first.checkpoint.agents.agent!
    let calls = 0
    await expect(
      execute(
        revision(),
        () =>
          Effect.sync(() => {
            calls++
            return { kind: 'completed', output: 'unexpected' }
          }),
        {
          ...first,
          checkpoint: {
            ...first.checkpoint,
            agents: { agent: { ...saved, checkpoint: { ...saved.checkpoint, input } } },
            wait: {
              ...first.checkpoint.wait,
              value: {
                callId: saved.checkpoint.callId,
                toolId: tool.id,
                action: tool.action,
                connectionId: tool.connectionId!,
                input,
              },
            },
          },
        },
      ),
    ).rejects.toThrow(/arguments/)
    expect(calls).toBe(0)
  })

  it('rejects duplicate waiting identities and modified approved parameters', async () => {
    const first = waiting(await execute(revision(), () => Effect.succeed(pause('call'))))
    expect(() => decodeFlowRunCheckpoint({ ...first.checkpoint, queue: [first.checkpoint.wait] })).toThrow(/conflict/)
    let invoked = false
    await expect(
      execute(
        revision(),
        () =>
          Effect.sync(() => {
            invoked = true
            return { kind: 'completed', output: 'bad' }
          }),
        {
          ...first,
          checkpoint: { ...first.checkpoint, wait: { ...first.checkpoint.wait, value: {} } },
        },
      ),
    ).rejects.toThrow(/saved call/)
    expect(invoked).toBe(false)
  })
})

describe('Agent JSON Schema compatibility', () => {
  it.each([
    [{ type: ['string', 'null'], minLength: 2 }, 'hi', 'x'],
    [{ anyOf: [{ const: 'yes' }, { type: 'integer', minimum: 1 }] }, 2, 0],
    [{ oneOf: [{ type: 'number' }, { type: 'integer' }] }, 1.5, 1],
    [{ allOf: [{ type: 'number' }, { multipleOf: 2 }], not: { const: 4 } }, 6, 4],
    [{ const: null }, null, 'null'],
    [{ type: 'string', format: 'email' }, 'a@example.com', 'not an email'],
    [{ type: 'string', pattern: '^[A-Z]+$' }, 'OK', 'wrong'],
    [{ type: 'array', items: { type: 'integer' }, uniqueItems: true }, [1, 2], [1, 1]],
    [{ type: 'array', contains: { const: 'ok' }, minContains: 1, maxContains: 1 }, ['ok', 'other'], ['ok', 'ok']],
    [{ type: 'object', patternProperties: { '^n': { type: 'number' } }, additionalProperties: false }, { n1: 2 }, { bad: 2 }],
    [{ type: 'object', dependentRequired: { card: ['address'] } }, { card: '123', address: 'Home' }, { card: '123' }],
    [{ type: 'object', propertyNames: { minLength: 2 }, minProperties: 1, maxProperties: 2 }, { name: 1 }, { n: 1 }],
    [
      {
        type: 'object',
        if: { required: ['kind'], properties: { kind: { const: 'mail' } } }, // eslint-disable-next-line unicorn/no-thenable -- This fixture uses the JSON Schema conditional keyword.
        then: { required: ['to'] },
        else: { required: ['other'] },
      },
      { kind: 'mail', to: 'a' },
      { kind: 'mail' },
    ],
    [{ type: 'array', prefixItems: [{ type: 'string' }, { type: 'integer' }], items: false }, ['a', 1], ['a', 1, true]],
    [{ type: 'object', allOf: [{ properties: { allowed: { type: 'boolean' } } }], unevaluatedProperties: false }, { allowed: true }, { extra: true }],
  ] as readonly (readonly [JsonValue, JsonValue, JsonValue])[])('enforces %j rather than merely accepting its keywords', (jsonSchema, valid, invalid) => {
    const declaration: AgentTool = { ...tool, inputs: [{ handle: 'value', jsonSchema, nullable: false, source: { kind: 'model' } }] }
    expect(agentConfigIssues(task([declaration]), {})).toEqual([])
    expect(agentToolInput(declaration, {}, { value: valid })).toEqual({ value: valid })
    expect(() => agentToolInput(declaration, {}, { value: invalid })).toThrow()
    expect(matchesSchema({ value: valid }, agentToolSchema(declaration))).toBe(true)
    expect(matchesSchema({ value: invalid }, agentToolSchema(declaration))).toBe(false)
    expect(matchesSchema(valid, jsonSchema)).toBe(true)
    expect(matchesSchema(invalid, jsonSchema)).toBe(false)
  })

  it('expands local references per parameter without changing the saved schema', () => {
    const jsonSchema = {
      $defs: { limit: { type: 'integer', minimum: 1, maximum: 20 } },
      type: 'object',
      properties: { count: { $ref: '#/$defs/limit' } },
      required: ['count'],
    }
    const declaration: AgentTool = { ...tool, inputs: [{ handle: 'request', jsonSchema, nullable: false, source: { kind: 'model' } }] }
    const before = structuredClone(declaration)
    expect(agentConfigIssues(task([declaration]), {})).toEqual([])
    expect(JSON.stringify(agentToolSchema(declaration))).not.toContain('$ref')
    expect(agentToolInput(declaration, {}, { request: { count: 10 } })).toEqual({ request: { count: 10 } })
    expect(() => agentToolInput(declaration, {}, { request: { count: 21 } })).toThrow()
    expect(declaration).toEqual(before)
    expect(Object.getOwnPropertyNames(jsonSchema)).not.toContain('__absolute_uri__')
  })

  it('preserves ref sibling semantics for draft 7 and newer schemas', () => {
    for (const draft of ['http://json-schema.org/draft-07/schema#', 'https://json-schema.org/draft/2020-12/schema']) {
      const jsonSchema = { $schema: draft, $defs: { value: { type: 'integer' } }, $ref: '#/$defs/value', minimum: 10 }
      const declaration: AgentTool = { ...tool, inputs: [{ handle: 'n', jsonSchema, nullable: false, source: { kind: 'model' } }] }
      if (draft.includes('draft-07')) expect(agentToolInput(declaration, {}, { n: 1 })).toEqual({ n: 1 })
      else expect(() => agentToolInput(declaration, {}, { n: 1 })).toThrow()
      expect(matchesSchema({ n: 1 }, agentToolSchema(declaration))).toBe(draft.includes('draft-07'))
    }
  })

  it('allows recursive fixed data but explains references that cannot be sent to a model', () => {
    const jsonSchema = { type: 'object', properties: { next: { $ref: '#' } }, additionalProperties: false }
    const fixed: AgentTool = { ...tool, inputs: [{ handle: 'chain', jsonSchema, nullable: false, source: { kind: 'value', value: { next: {} } } }] }
    expect(agentConfigIssues(task([fixed]), {})).toEqual([])
    expect(agentToolInput(fixed, {}, {})).toEqual({ chain: { next: {} } })
    const generated: AgentTool = { ...fixed, inputs: [{ ...fixed.inputs[0]!, source: { kind: 'model' } }] }
    expect(agentConfigIssues(task([generated]), {}).join(' ')).toContain('Recursive reference')
    const external: AgentTool = { ...generated, inputs: [{ ...generated.inputs[0]!, jsonSchema: { $ref: 'https://example.com/schema' } }] }
    expect(agentConfigIssues(task([external]), {}).join(' ')).toContain('External or anchor reference')
  })
})

it('reserves the saved result reader name for the host', () => {
  expect(agentConfigIssues(task([{ ...tool, name: 'read_result' }]), {}).join(' ')).toContain('reserved')
})

it('round trips code capability and permits an Agent without Connector tools', () => {
  const agent = task([])
  if (agent.executor.kind != 'agent') throw new Error('Expected Agent.')
  expect(agentConfigIssues(agent, {})).not.toEqual([])
  const enabled = { ...agent, executor: { ...agent.executor, code: true } }
  expect(agentConfigIssues(enabled, {})).toEqual([])
  const value = revision(enabled)
  expect(decodeRevision(encodeRevision(value))).toEqual(value)
  expect(agentConfigIssues(task([{ ...tool, name: 'run_code' }]), {}).join(' ')).toContain('reserved')
})
