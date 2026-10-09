import { compileAuthoring, controlRequests } from '@oomol-lab/open-flow/control-requests'
import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { validateFlow } from '@oomol-lab/open-flow/flow-semantics'
import { currentEngineContract, findEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { expect, it, vi } from 'vitest'
import { runCli } from './cli.ts'
import { isLabCliOffline } from './lab.ts'
const flow = { flowId: 'flow', name: 'Flow', draftRevisionId: 'r1', createdAt: '2026-01-01', updatedAt: '2026-01-01', status: 'active', version: 1 }
const edit = { baseRevision: 'r1', requestId: 'one', edits: [{ op: 'node.add', as: 'code', type: 'code', name: 'Code', code: 'export default () => ({})' }] }
const receipt = {
  flowId: 'flow',
  saved: true,
  revision: 'r2',
  nodes: { code: 'node-code' },
  changes: [{ index: 0, op: 'node.add' }],
  validation: { status: 'invalid', diagnostics: [{ code: 'input.missing', message: 'Input required', nodes: ['node-code'], field: 'input' }] },
  version: 1,
}
function io() {
  let stdout = '',
    stderr = ''
  return {
    stdout: () => stdout,
    stderr: () => stderr,
    value: {
      env: {},
      language: 'en' as const,
      openUrl: async () => {},
      readFile: async () => JSON.stringify(edit),
      readStdin: async () => JSON.stringify(edit),
      stdout: {
        write: (v: string) => {
          stdout += v
        },
      },
      stderr: {
        write: (v: string) => {
          stderr += v
        },
      },
      wait: async () => {},
    },
  }
}
it.each([
  ['--input', JSON.stringify(edit)],
  ['--input', '@edit.json'],
  ['--file', 'edit.json'],
  ['--input', '-'],
  ['--file', '-'],
])('submits the same atomic semantic request via %s %s', async (...input) => {
  const output = io(),
    writes: unknown[] = []
  const request = async (path: string, init?: RequestInit) => {
    if (path == '/v1/flows/flow') return Response.json(flow)
    expect(path).toBe('/v1/flows/flow/authoring/edit')
    writes.push(JSON.parse(String(init?.body)))
    expect(new Headers(init?.headers).get('idempotency-key')).toBe('one')
    return Response.json(receipt)
  }
  expect(await runCli(['edit', 'flow', ...input, '--json'], { request }, output.value), output.stderr()).toBe(0)
  expect(writes).toEqual([edit])
  expect(JSON.parse(output.stdout())).toEqual(receipt)
})
it('replays an identical request after the response is lost and the head advances', async () => {
  const writes: unknown[] = []
  const request = async (path: string, init?: RequestInit) => {
    if (path == '/v1/flows/flow') return Response.json({ ...flow, draftRevisionId: writes.length ? 'r3' : 'r1' })
    writes.push(JSON.parse(String(init?.body)))
    if (writes.length == 1) throw new Error('Response lost')
    return Response.json(receipt)
  }
  const first = io(),
    second = io(),
    args = ['edit', 'flow', '--file', '-', '--json']
  expect(await runCli(args, { request }, first.value)).toBe(1)
  expect(JSON.parse(first.stderr())).toMatchObject({ error: { code: 'flow.mutation-outcome-unknown', details: { idempotencyKey: 'one', request: edit } } })
  expect(await runCli(args, { request }, second.value), second.stderr()).toBe(0)
  expect(writes).toEqual([edit, edit])
  expect(JSON.parse(second.stdout())).toEqual(receipt)
})
it('keeps fixed revision errors and recoverable text edit details', async () => {
  const request = async (path: string) =>
    path == '/v1/flows/flow'
      ? Response.json(flow)
      : Response.json(
          { error: { code: 'flow.invalid', message: 'Expected one exact match', details: { reason: 'text.match-count', matches: 2, editIndex: 0 } } },
          { status: 400 },
        )
  const output = io()
  expect(await runCli(['edit', 'flow', '--file', '-', '--json'], { request }, output.value)).toBe(1)
  expect(JSON.parse(output.stderr())).toMatchObject({ error: { details: { reason: 'text.match-count', matches: 2 } } })
})
it('rejects obsolete storage-oriented commands and advertises only node authoring', async () => {
  const request = vi.fn()
  for (const args of [
    ['apply', 'flow'],
    ['code', 'show', 'flow', 'module'],
    ['node', 'show', 'flow', 'node'],
    ['schema', 'operations'],
  ])
    expect(await runCli([...args, '--json'], { request }, io().value)).toBe(1)
  const output = io()
  expect(await runCli(['schema', 'agent', '--json'], { request }, output.value)).toBe(0)
  expect(JSON.parse(output.stdout())).toMatchObject({ type: 'agent', texts: ['prompt'] })
  expect(output.stdout()).not.toContain('taskId')
  expect(request).not.toHaveBeenCalled()
})

it('makes read discoverable offline through help, runnable examples and the same request schema', async () => {
  const request = vi.fn(),
    help = io(),
    schema = io(),
    plain = io()
  expect(await runCli(['read', '--help', '--json'], { request }, help.value)).toBe(0)
  expect(await runCli(['schema', 'read', '--json'], { request }, schema.value)).toBe(0)
  expect(await runCli(['read', '--help'], { request }, plain.value)).toBe(0)
  const contract = JSON.parse(schema.stdout()),
    result = JSON.parse(help.stdout())
  expect(result.request).toEqual(contract.request)
  expect(result.request.not).toEqual({ required: ['nodes', 'text'] })
  expect(result.request.properties.text.required).toEqual(['node', 'field'])
  for (const example of contract.examples) expect(() => controlRequests.authoringRead(example)).not.toThrow()
  for (const command of result.examples) {
    const input = command.match(/--input '(.*)'/)?.[1]
    expect(() => controlRequests.authoringRead(input == null ? {} : JSON.parse(input))).not.toThrow()
    expect(plain.stdout()).toContain(command)
  }
  expect(plain.stdout()).toContain('nextStart')
  expect(plain.stdout()).toContain('mutually exclusive')
  expect(plain.stdout()).not.toContain('runs resolve')
  expect(request).not.toHaveBeenCalled()
})

it.each(['search', 'edit', 'check'])('exposes the %s request without contacting a host', async (name) => {
  const request = vi.fn(),
    output = io()
  expect(await runCli(['schema', name, '--json'], { request }, output.value)).toBe(0)
  expect(JSON.parse(output.stdout()).request.type).toBe('object')
  expect(request).not.toHaveBeenCalled()
})

it('teaches batch aliases in edit help and schema with an executable atomic creation example', async () => {
  const request = vi.fn(),
    help = io(),
    schema = io()
  expect(await runCli(['edit', '--help', '--json'], { request }, help.value)).toBe(0)
  expect(await runCli(['schema', 'edit', '--json'], { request }, schema.value)).toBe(0)
  const contract = JSON.parse(schema.stdout()),
    result = JSON.parse(help.stdout())
  expect(result.request).toEqual(contract.request)
  expect(contract.guidance).toContain('$alias')
  expect(contract.guidance).toContain('bare alias is not the node ID')
  expect(help.stdout()).toContain('$alias')
  const examples = contract.examples.map((example: unknown) => controlRequests.authoringEdit(example))
  const creation = examples.find((example: ReturnType<typeof controlRequests.authoringEdit>) => example.edits.some((operation) => operation.op == 'node.add'))
  expect(creation).toBeDefined()
  const compiled = await compileAuthoring(
    { modelVersion: currentFlowModelVersion, modules: {}, document: { graph: { nodes: {}, edges: [] }, bindings: {} } },
    creation!,
    {
      id: (label) => `example-${label}`,
      action: async () => {
        throw new Error('Example must not require an external Action')
      },
      trigger: () => {
        throw new Error('Example must not require a provider Trigger')
      },
      openapi: async () => {
        throw new Error('Example must not fetch an OpenAPI document')
      },
    },
  )
  expect(compiled.content.document.graph.edges).toEqual([{ source: compiled.nodes.start, target: compiled.nodes.step }])
  expect(compiled.content.document.graph.nodes[compiled.nodes.step!]?.description).toBe('Created and connected in one atomic edit.')
  for (const command of result.examples) {
    const input = command.match(/--input '(.*)'/)?.[1]
    expect(input).toBeDefined()
    expect(() => controlRequests.authoringEdit(JSON.parse(input!))).not.toThrow()
  }
  expect(request).not.toHaveBeenCalled()
})

it('creates an Agent from the advertised business configuration without declaring runtime ports', async () => {
  const request = vi.fn(),
    output = io()
  expect(await runCli(['schema', 'agent', '--json'], { request }, output.value)).toBe(0)
  const contract = JSON.parse(output.stdout())
  expect(contract.configuration.properties.outputs).toBeUndefined()
  expect(contract.configuration.properties.resultSchema).toBeDefined()
  expect(contract.example.config.outputs).toBeUndefined()
  expect(JSON.stringify(contract.configuration)).not.toContain('jsonSchema')
  const example = controlRequests.authoringEdit({
    baseRevision: 'base',
    requestId: 'agent-example',
    edits: [
      { op: 'node.add', as: 'start', type: 'manual', name: 'Start' },
      contract.example,
      { op: 'edge.connect', source: '$start', target: `$${contract.example.as}` },
    ],
  })
  const compiled = await compileAuthoring(
    { modelVersion: currentFlowModelVersion, modules: {}, document: { graph: { nodes: {}, edges: [] }, bindings: {} } },
    example,
    {
      id: (label) => `example-${label}`,
      action: async () => {
        throw new Error('Example must not require an external Action')
      },
      trigger: () => {
        throw new Error('Example must not require a provider Trigger')
      },
      openapi: async () => {
        throw new Error('Example must not fetch an OpenAPI document')
      },
    },
  )
  const validation = await validateFlow(compiled.content, findEngineContract(currentEngineContract)!)
  expect(validation.diagnostics).toEqual([])
  expect(request).not.toHaveBeenCalled()
})

it('accepts named data bindings and an implicit single result through the CLI adapter', async () => {
  const requestBody = {
    baseRevision: 'r1',
    requestId: 'business-data',
    edits: [
      {
        op: 'node.add',
        as: 'summary',
        type: 'agent',
        name: 'Summarize orders',
        prompt: 'Summarize {{orders}}.',
        inputs: { orders: { kind: 'value', value: [{ orderId: 'A-1', total: 42 }] } },
      },
      { op: 'input.set', node: 'notification', input: 'text', source: { kind: 'output', node: '$summary' } },
    ],
  }
  const output = io(),
    writes: unknown[] = []
  const request = async (path: string, init?: RequestInit) => {
    if (path == '/v1/flows/flow') return Response.json(flow)
    writes.push(JSON.parse(String(init?.body)))
    return Response.json(receipt)
  }
  expect(await runCli(['edit', 'flow', '--input', JSON.stringify(requestBody), '--json'], { request }, output.value), output.stderr()).toBe(0)
  expect(writes).toEqual([requestBody])
})

it('identifies only invocations guaranteed to stay offline for Lab admission', async () => {
  const request = vi.fn()
  for (const args of [[], ['read', '--help'], ['-h'], ['schema', 'read'], ['schema', 'agent'], ['schema', 'unknown']]) {
    expect(isLabCliOffline(args)).toBe(true)
    await runCli(args, { request }, io().value)
  }
  for (const args of [
    ['read', 'flow'],
    ['schema', '--flow', 'flow'],
    ['schema', '--flow=flow'],
    ['schema', '--flow'],
  ])
    expect(isLabCliOffline(args)).toBe(false)
  expect(request).not.toHaveBeenCalled()
})
