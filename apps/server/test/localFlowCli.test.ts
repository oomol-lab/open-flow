import type { LlmHost } from '../node/deployment/llm.ts'

import { serve } from '@hono/node-server'
import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { OperatorSession } from '../node/deployment/operator.ts'
import { Database } from '../node/storage/database.ts'
import { OperatorStore } from '../node/storage/operator-store.ts'
import { createServerApp } from '../node/transport/http.ts'
import { workspaceRoot } from '../scripts/development-config.ts'
import { closeService, openService, startService } from './serviceFixture.ts'

const exec = promisify(execFile)

it('executes the skill examples through the repository CLI against an isolated Server', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'local-flow-cli-'))
  const file = path.join(directory, 'flow.sqlite')
  const modelCalls: Parameters<LlmHost>[0][] = []
  const llm: LlmHost = async (invocation) => {
    modelCalls.push(invocation)
    return { kind: 'completed', value: { output: { summary: 'Order A-1 totals 42.' } }, version: 1 }
  }
  // Agent readiness also needs deployment metadata; this test only edits its prompt.
  Object.assign(llm, { config: { origin: 'http://127.0.0.1:1', token: 'test-only' } })
  const service = await openService(file, { capabilities: { llm: () => llm } })
  const database = Database.open(file)
  const token = 'local-flow-cli-test-operator-token-0000001'
  const operator = new OperatorSession(new OperatorStore(database), token, false)
  const server = serve({ fetch: createServerApp(service, { operator }).fetch, hostname: '127.0.0.1', port: 0, overrideGlobalObjects: false })
  await once(server, 'listening')
  const address = server.address()
  if (address == null || typeof address == 'string') throw new Error('Missing Server address')
  await startService(service)
  const env = { ...process.env, OPEN_FLOW_URL: `http://127.0.0.1:${address.port}`, OPEN_FLOW_TOKEN: token }
  async function cli(args: string[]) {
    const { stdout } = await exec('bun', ['run', 'flow', '--', ...args, '--json'], { cwd: workspaceRoot, env })
    return JSON.parse(stdout)
  }
  try {
    const created = await cli(['create', 'Skill example'])
    const flowId = created.flow.flowId
    const before = await cli(['read', flowId])
    const source = await readFile(new URL(import.meta.resolve('@oomol-lab/open-flow/skills/open-flow/references/flow-authoring.md')), 'utf8')
    const examples = new Map(
      [...source.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => {
        const request = JSON.parse(match[1]!)
        return [request.requestId, request] as const
      }),
    )
    async function edit(flow: string, revision: string, edits: unknown[]) {
      const editPath = path.join(directory, 'edit.json')
      await writeFile(editPath, JSON.stringify({ baseRevision: revision, requestId: crypto.randomUUID(), edits }))
      const response = await cli(['edit', flow, '--file', editPath])
      expect(response.saved).toBe(true)
      expect(response.validation.status, JSON.stringify(response.validation)).toBe('valid')
      return response
    }
    async function example(name: string, flow: string, revision: string, replacements: Record<string, string> = {}) {
      const request = examples.get(name)
      if (request == null) throw new Error(`Missing executable example ${name}`)
      const edits = JSON.parse(JSON.stringify(request.edits), (_key, value) =>
        typeof value == 'string' && Object.hasOwn(replacements, value) ? replacements[value] : value,
      )
      return edit(flow, revision, edits)
    }
    async function run(flow: string, revision: string, trigger: string) {
      const response = await cli(['run', flow, '--trigger', trigger, '--expected-revision', revision, '--wait', '--timeout', '10000'])
      expect(response.run.status).toBe('completed')
      const result = await cli(['runs', 'result', response.run.runId])
      return result.result.result.nodes as { nodeId: string; outputs: Record<string, unknown> }[]
    }
    const edited = await example('example-code-and-data', flowId, before.revision)
    expect((await cli(['check', flowId, '--revision', edited.revision])).valid).toBe(true)
    expect(await run(flowId, edited.revision, edited.nodes.start)).toContainEqual(
      expect.objectContaining({
        nodeId: edited.nodes.format,
        outputs: { text: 'Total: 42' },
      }),
    )

    // Exercise both routes and the boundary using the documented gate, not a copy of it.
    let gated = await example('example-condition', flowId, edited.revision, {
      SOURCE_NODE: edited.nodes.calculate,
      TARGET_NODE: edited.nodes.format,
    })
    for (const total of [42, 100, 101]) {
      gated = await edit(flowId, gated.revision, [
        {
          op: 'input.set',
          node: edited.nodes.calculate,
          input: 'prices',
          source: { kind: 'value', value: [total] },
        },
      ])
      const nodes = await run(flowId, gated.revision, edited.nodes.start)
      const formatted = nodes.find((node) => node.nodeId == edited.nodes.format)
      if (total > 100) expect(formatted?.outputs).toEqual({ text: `Total: ${total}` })
      else expect(formatted).toBeUndefined()
    }

    const modelFlow = (await cli(['create', 'Model examples'])).flow.flowId
    const modelBefore = await cli(['read', modelFlow])
    const seeded = await edit(modelFlow, modelBefore.revision, [
      { op: 'node.add', as: 'start', type: 'manual', name: 'Start' },
      { op: 'node.add', as: 'order', type: 'value', name: 'Order', config: { values: { order: { id: 'A-1', total: 42 } } } },
      { op: 'edge.connect', source: '$start', target: '$order' },
    ])
    const structured = await example('example-structured-output', modelFlow, seeded.revision, {
      SOURCE_NODE: seeded.nodes.order,
      MODEL_ID: 'test-model',
    })
    expect(await run(modelFlow, structured.revision, seeded.nodes.start)).toContainEqual(
      expect.objectContaining({
        nodeId: structured.nodes.summary,
        outputs: { output: { summary: 'Order A-1 totals 42.' } },
      }),
    )
    expect(modelCalls).toHaveLength(1)
    expect(modelCalls[0]).toMatchObject({
      mode: 'json',
      input: {
        order: { id: 'A-1', total: 42 },
        model: { model: 'test-model' },
        template: [{ role: 'user', content: 'Summarize this order: {{order}}' }],
      },
    })

    const prompt = 'Summarize the order. Include customer email. Keep the total.'
    const agent = await edit(modelFlow, structured.revision, [
      { op: 'node.add', as: 'agent', type: 'agent', name: 'Customer summary', config: { model: 'test-model' }, prompt },
      { op: 'edge.connect', source: seeded.nodes.order, target: '$agent' },
    ])
    const agentBefore = await cli(['read', modelFlow, '--input', JSON.stringify({ nodes: [agent.nodes.agent] })])
    const patched = await example('example-prompt-edit', modelFlow, agent.revision, { AGENT_NODE: agent.nodes.agent })
    const agentAfter = await cli(['read', modelFlow, '--input', JSON.stringify({ revision: patched.revision, nodes: [agent.nodes.agent] })])
    expect(agentAfter.data.nodes[0].config).toEqual(agentBefore.data.nodes[0].config)
    const text = await cli(['read', modelFlow, '--input', JSON.stringify({ revision: patched.revision, text: { node: agent.nodes.agent, field: 'prompt' } })])
    expect(text.data.text.content).toBe('Summarize the order. Omit customer email. Keep the total.')

    const conversion = await readFile(new URL(import.meta.resolve('@oomol-lab/open-flow/skills/open-flow/references/flow-n8n-conversion.md')), 'utf8')
    const code = conversion.match(/```javascript\n([\s\S]*?)\n```/)?.[1]
    if (code == null) throw new Error('Missing conversion example')
    const aggregateFlow = (await cli(['create', 'Collection conversion'])).flow.flowId
    const aggregateBefore = await cli(['read', aggregateFlow])
    let aggregate = await edit(aggregateFlow, aggregateBefore.revision, [
      { op: 'node.add', as: 'start', type: 'manual', name: 'Start' },
      {
        op: 'node.add',
        as: 'aggregate',
        type: 'code',
        name: 'Paid orders',
        code,
        config: { outputs: { count: { schema: { type: 'number' } }, total: { schema: { type: 'number' } } } },
        inputs: { orders: { kind: 'value', value: [] } },
      },
      { op: 'edge.connect', source: '$start', target: '$aggregate' },
    ])
    const aggregateNodes = aggregate.nodes
    for (const [orders, expected] of [
      [
        [
          { status: 'paid', amount: 12 },
          { status: 'canceled', amount: 99 },
          { status: 'paid', amount: 30 },
        ],
        { count: 2, total: 42 },
      ],
      [[], { count: 0, total: 0 }],
    ]) {
      aggregate = await edit(aggregateFlow, aggregate.revision, [
        {
          op: 'input.set',
          node: aggregateNodes.aggregate,
          input: 'orders',
          source: { kind: 'value', value: orders },
        },
      ])
      expect(await run(aggregateFlow, aggregate.revision, aggregateNodes.start)).toContainEqual(
        expect.objectContaining({
          nodeId: aggregateNodes.aggregate,
          outputs: expected,
        }),
      )
    }
    const url = await cli(['workbench', flowId])
    expect(url.url).toBe(`${env.OPEN_FLOW_URL}/flows/${flowId}/design`)
    expect(JSON.stringify(url)).not.toContain(token)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error == null ? resolve() : reject(error))))
    await closeService(service)
    database.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)
