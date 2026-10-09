import type { RevisionContent, TaskDefinition } from '../../flow/common/change.ts'
import type { AuthoringHost, AuthoringRequest } from './authoring.ts'

import { describe, expect, it } from 'vitest'
import { applyFlowChanges, currentFlowModelVersion } from '../../flow/common/change.ts'
import { checkInputSource } from '../../flow/common/graph.ts'
import { authoringDiagnostics, compileAuthoring, readAuthoring, searchAuthoring } from './authoring.ts'
const empty: RevisionContent = {
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: { graph: { nodes: {}, edges: [] }, bindings: {} },
}
const host: AuthoringHost = {
  id: (label) => label,
  action: async (id) => ({
    actionId: id,
    name: id,
    serviceId: 'test',
    serviceName: 'Test',
    authenticated: false,
    description: '',
    inputs: { message: { jsonSchema: { type: 'string' }, nullable: true, value: 'default' } },
    outputs: {},
  }),
  trigger: () => {
    throw new Error('Unknown trigger')
  },
  openapi: async () => ({
    openapi: '3.0.0',
    info: { title: 'Test', version: '1' },
    paths: { '/items': { get: { responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'string' } } } } } } } },
  }),
}
let serial = 0
async function edit(base: RevisionContent, edits: AuthoringRequest['edits']) {
  const key = `r${serial++}`
  return compileAuthoring(base, { baseRevision: 'base', requestId: key, edits }, { ...host, id: (label) => `${key}-${label}` })
}
function taskAt(content: RevisionContent, ref: string): TaskDefinition {
  const node = content.document.graph.nodes[ref]
  if (node?.kind != 'task') throw new Error('Task expected')
  return node.task
}
describe('node authoring', () => {
  it('creates Code with only caller-provided input data and no sample defaults', async () => {
    const created = await edit(empty, [
      {
        op: 'node.add',
        type: 'code',
        as: 'code',
        name: 'Format',
        code: 'export default ({value}) => ({result: String(value)})',
        inputs: { value: { kind: 'value', value: 42 } },
      },
    ])
    expect(taskAt(created.content, created.nodes.code!).inputs).toEqual([{ handle: 'value', jsonSchema: {}, nullable: true }])
    expect(readAuthoring(created.content, { nodes: [created.nodes.code!] })).toMatchObject({ nodes: [{ inputs: { value: { kind: 'value', value: 42 } } }] })
  })
  it('assembles Agent tool inputs from the Action and round trips without refetching definitions', async () => {
    const created = await edit(empty, [
      {
        op: 'node.add',
        type: 'agent',
        as: 'agent',
        name: 'Summary',
        config: {
          model: 'test',
          tools: [{ name: 'send', action: 'test.send', description: 'Send summary', approval: true, inputs: { message: { kind: 'value', value: 'Hello' } } }],
        },
      },
    ])
    const ref = created.nodes.agent!
    const task = taskAt(created.content, ref)
    expect(task).toMatchObject({
      executor: {
        tools: [
          { inputs: [{ handle: 'message', jsonSchema: { type: 'string' }, nullable: true, value: 'default', source: { kind: 'value', value: 'Hello' } }] },
        ],
      },
    })
    const view = readAuthoring(created.content, { nodes: [ref] }) as unknown as { nodes: { config: Record<string, never> }[] }
    const saved = await compileAuthoring(
      created.content,
      { baseRevision: 'base', requestId: 'round-trip', edits: [{ op: 'node.update', node: ref, set: { config: view.nodes[0]!.config } }] },
      {
        ...host,
        action: async () => {
          throw new Error('Unnecessary catalog lookup')
        },
      },
    )
    expect(saved.content).toEqual(created.content)
    await expect(
      edit(created.content, [
        {
          op: 'node.update',
          node: ref,
          set: { config: { tools: [{ name: 'send', action: 'test.send', description: 'Send', approval: true, inputs: { typo: { kind: 'model' } } }] } },
        },
      ]),
    ).rejects.toMatchObject({ code: 'tool.input-not-found', details: { input: 'typo', choices: ['message'], editIndex: 0 } })
  })
  it('creates aliases, explicit execution and data links, and hides storage identities', async () => {
    const result = await edit(empty, [
      { op: 'node.add', type: 'manual', as: 'start', name: 'Start' },
      { op: 'node.add', type: 'code', as: 'format', name: 'Format', code: 'export default () => ({result:"hello"})' },
      { op: 'node.add', type: 'connector', as: 'send', name: 'Send', config: { action: 'test.send' } },
      { op: 'edge.connect', source: '$start', target: '$format' },
      { op: 'edge.connect', source: '$format', target: '$send' },
      { op: 'input.set', node: '$send', input: 'message', source: { kind: 'output', node: '$format', port: 'result' } },
    ])
    expect(result.content.document.graph.edges).toHaveLength(2)
    const details = JSON.stringify(readAuthoring(result.content, { nodes: [result.nodes.send!] }))
    expect(details).not.toMatch(/taskId|moduleId|bindingId/)
    expect(details).toContain('"port":"result"')
    expect(applyFlowChanges(empty, result.operations)).toEqual(result.content)
  })
  it('embeds Agent notification contracts while exposing only business settings', async () => {
    const created = await edit(empty, [
      {
        op: 'node.add',
        type: 'agent',
        as: 'agent',
        name: 'Review',
        config: { notification: { action: 'test.send', messageHandle: 'message', inputs: {} } },
      },
    ])
    const ref = created.nodes.agent!
    expect(taskAt(created.content, ref)).toMatchObject({
      executor: {
        notification: {
          action: 'test.send',
          messageHandle: 'message',
          inputs: {},
          inputDefinitions: [{ handle: 'message', jsonSchema: { type: 'string' }, nullable: true, value: 'default' }],
        },
      },
    })
    const view = readAuthoring(created.content, { nodes: [ref] }) as unknown as { nodes: { config: Record<string, never> }[] }
    expect(view.nodes[0]!.config.notification).toEqual({ action: 'test.send', messageHandle: 'message', inputs: {} })
    const saved = await compileAuthoring(
      created.content,
      {
        baseRevision: 'base',
        requestId: 'notification-roundtrip',
        edits: [{ op: 'node.update', node: ref, set: { config: view.nodes[0]!.config } }],
      },
      {
        ...host,
        action: async () => {
          throw new Error('Unnecessary catalog lookup')
        },
      },
    )
    expect(saved.content).toEqual(created.content)
    expect(saved.content.document).not.toHaveProperty('tasks')
  })
  it('edits the requested prompt while preserving another node with identical configuration', async () => {
    const created = await edit(empty, [
      { op: 'node.add', type: 'agent', as: 'customer', name: 'Customer', prompt: 'Before rule. Keep this.', config: { model: 'test' } },
    ])
    const id = created.nodes.customer!,
      node = created.content.document.graph.nodes[id]!
    const base = applyFlowChanges(created.content, [{ kind: 'graph.node.create', nodeId: 'internal', node: { ...node, name: 'Internal' } }])
    const result = await edit(base, [{ op: 'text.edit', node: id, field: 'prompt', oldText: 'Before rule.', newText: 'After rule.' }])
    expect(result.content.document.graph.nodes.internal).toEqual(base.document.graph.nodes.internal)
    expect(readAuthoring(result.content, { text: { node: id, field: 'prompt' } })).toMatchObject({ text: { content: 'After rule. Keep this.' } })
    expect(readAuthoring(result.content, { text: { node: 'internal', field: 'prompt' } })).toMatchObject({ text: { content: 'Before rule. Keep this.' } })
  })
  it('rejects ambiguous text, unknown fields and late batch failures without changing the input', async () => {
    const created = await edit(empty, [{ op: 'node.add', type: 'code', as: 'code', name: 'Code', code: 'same same' }])
    const before = structuredClone(created.content),
      ref = created.nodes.code!
    await expect(edit(before, [{ op: 'text.edit', node: ref, field: 'code', oldText: 'same', newText: 'new' }])).rejects.toMatchObject({
      code: 'text.match-count',
      details: { matches: 2, editIndex: 0 },
    })
    await expect(edit(before, [{ op: 'node.update', node: ref, set: { config: { unknown: true } } }])).rejects.toThrow()
    await expect(
      edit(before, [
        { op: 'text.set', node: ref, field: 'code', text: 'new' },
        { op: 'node.remove', node: 'missing' },
      ]),
    ).rejects.toMatchObject({ details: { editIndex: 1 } })
    expect(before).toEqual(created.content)
  })
  it('separates literal null, unset, default and variable sources', async () => {
    const created = await edit(empty, [{ op: 'node.add', type: 'connector', as: 'send', name: 'Send', config: { action: 'test.send' } }]),
      ref = created.nodes.send!
    let content = created.content
    for (const source of [{ kind: 'value', value: null }, { kind: 'unset' }, { kind: 'default' }, { kind: 'variable', name: 'TOKEN' }] as const) {
      content = (await edit(content, [{ op: 'input.set', node: ref, input: 'message', source }])).content
      const inputs = (readAuthoring(content, { nodes: [ref] }) as { nodes: { inputs: Record<string, unknown> }[] }).nodes[0]!.inputs
      expect(inputs.message).toEqual(source.kind == 'default' ? undefined : source.kind == 'variable' ? { kind: 'sources', sources: [source] } : source)
    }
  })
  it('preserves literal JSON that resembles references and provides bounded text reads', async () => {
    const created = await edit(empty, [{ op: 'node.add', type: 'code', as: 'code', name: 'Code', code: 'one\ntarget\nthree' }])
    expect(readAuthoring(created.content, { text: { node: created.nodes.code!, field: 'code', start: 2, lines: 1 } })).toMatchObject({
      text: { content: 'target', nextStart: 3, truncated: true },
    })
    expect(searchAuthoring(created.content, { query: 'target' })).toMatchObject({ matches: [{ node: created.nodes.code, field: 'code', line: 2 }] })
  })
  it('clears optional configuration and preserves omitted fields', async () => {
    const created = await edit(empty, [{ op: 'node.add', type: 'agent', as: 'agent', name: 'Agent', config: { model: 'test', code: true } }]),
      ref = created.nodes.agent!
    const result = await edit(created.content, [{ op: 'node.update', node: ref, set: { description: 'Changed' }, clear: [['config', 'code']] }])
    const view = (readAuthoring(result.content, { nodes: [ref] }) as { nodes: { config: Record<string, unknown> }[] }).nodes[0]!
    expect(view.config.model).toBe('test')
    expect(view.config).not.toHaveProperty('code')
  })
  it('accepts named business contracts and preserves grouped ports and explicit defaults through local updates', async () => {
    const created = await edit(empty, [
      {
        op: 'node.add',
        type: 'code',
        as: 'code',
        name: 'Code',
        config: {
          inputs: {
            payload: { schema: { type: 'object' }, nullable: true, default: null },
            label: { schema: { type: 'string' }, nullable: false, default: 'kept' },
          },
          outputs: { result: { schema: { type: 'number' }, nullable: false, description: 'Count' } },
        },
      },
    ])
    const ref = created.nodes.code!,
      node = created.content.document.graph.nodes[ref]!
    if (node.kind != 'task' || !('moduleId' in node.task)) throw new Error('Code expected')
    const base = applyFlowChanges(created.content, [
      {
        kind: 'graph.node.replace',
        nodeId: ref,
        before: node,
        node: {
          ...node,
          task: {
            ...node.task,
            inputs: [{ group: 'Business data', collapsed: true }, ...node.task.inputs],
            outputs: [{ group: 'Results' }, ...node.task.outputs],
          },
        },
      },
    ])
    const changed = await edit(base, [{ op: 'node.update', node: ref, set: { config: { inputs: { payload: { description: 'Order data' } } } } }])
    expect(taskAt(changed.content, ref).inputs).toEqual([
      { group: 'Business data', collapsed: true },
      ...node.task.inputs.map((port) => ('handle' in port && port.handle == 'payload' ? Object.assign({}, port, { description: 'Order data' }) : port)),
    ])
    expect(taskAt(changed.content, ref).outputs).toEqual(taskAt(base, ref).outputs)
    const cleared = await edit(changed.content, [{ op: 'node.update', node: ref, set: {}, clear: [['config', 'inputs', 'payload', 'default']] }])
    const payload = taskAt(cleared.content, ref).inputs.find((port) => 'handle' in port && port.handle == 'payload')!
    expect(payload).not.toHaveProperty('value')
    expect(payload).toMatchObject({ jsonSchema: { type: 'object' }, nullable: true, description: 'Order data' })
    expect(taskAt(cleared.content, ref).inputs.find((port) => 'handle' in port && port.handle == 'label')).toEqual(
      taskAt(base, ref).inputs.find((port) => 'handle' in port && port.handle == 'label'),
    )
    const view = (readAuthoring(cleared.content, { nodes: [ref] }) as { nodes: { config: Record<string, unknown> }[] }).nodes[0]!.config
    expect(view.inputs).toMatchObject({ payload: { schema: { type: 'object' }, nullable: true }, label: { default: 'kept' } })
    expect(JSON.stringify(view)).not.toMatch(/"handle"|"group"|"jsonSchema"/)
  })
  it('automatically assembles named Agent inputs and resolves a sole business output in node.add inputs', async () => {
    const created = await edit(empty, [
      {
        op: 'node.add',
        type: 'code',
        as: 'source',
        name: 'Orders',
        config: { outputs: { orders: { schema: { type: 'array', items: { type: 'object' } }, nullable: false } } },
      },
      {
        op: 'node.add',
        type: 'agent',
        as: 'agent',
        name: 'Summarize',
        prompt: '{{orders}} {{metadata}} {{empty}} {{token}}',
        inputs: {
          orders: { kind: 'output', node: '$source' },
          metadata: { kind: 'value', value: { batch: 'daily' } },
          empty: { kind: 'value', value: null },
          token: { kind: 'variable', name: 'TOKEN' },
        },
      },
      { op: 'edge.connect', source: '$source', target: '$agent' },
    ])
    const ref = created.nodes.agent!,
      task = taskAt(created.content, ref)
    expect(task.inputs).toHaveLength(4)
    for (const name of ['orders', 'metadata', 'empty', 'token'])
      expect(task.inputs.find((port) => 'handle' in port && port.handle == name)).toEqual({ handle: name, jsonSchema: {}, nullable: true })
    const node = created.content.document.graph.nodes[ref]!
    expect(node).toMatchObject({
      inputs: {
        orders: { kind: 'sources', sources: [{ kind: 'node', nodeId: created.nodes.source, output: 'orders' }] },
        metadata: { kind: 'value', value: { batch: 'daily' } },
        empty: { kind: 'value', value: null },
      },
    })
    expect(checkInputSource(created.content.document.graph, ref, 'orders', { nodeId: created.nodes.source!, output: 'orders' })).toEqual({ kind: 'available' })
  })
  it('retains explicit Agent input constraints when rebinding incompatible data', async () => {
    const created = await edit(empty, [
      { op: 'node.add', type: 'code', as: 'source', name: 'Source', config: { outputs: { result: { schema: { type: 'object' }, nullable: false } } } },
      { op: 'node.add', type: 'agent', as: 'agent', name: 'Agent', config: { inputs: { input: { schema: { type: 'string' }, nullable: false } } } },
      { op: 'edge.connect', source: '$source', target: '$agent' },
    ])
    const ref = created.nodes.agent!,
      before = taskAt(created.content, ref).inputs
    const changed = await edit(created.content, [{ op: 'input.set', node: ref, input: 'input', source: { kind: 'output', node: created.nodes.source! } }])
    expect(taskAt(changed.content, ref).inputs).toEqual(before)
    expect(checkInputSource(changed.content.document.graph, ref, 'input', { nodeId: created.nodes.source!, output: 'result' }).kind).toBe('schema')
  })
  it('adds an input only to the requested node when Agent configurations are identical', async () => {
    const created = await edit(empty, [{ op: 'node.add', type: 'agent', as: 'customer', name: 'Customer' }])
    const ref = created.nodes.customer!,
      node = created.content.document.graph.nodes[ref]!
    const base = applyFlowChanges(created.content, [{ kind: 'graph.node.create', nodeId: 'internal', node: { ...node, name: 'Internal' } }])
    const changed = await edit(base, [{ op: 'input.set', node: ref, input: 'orders', source: { kind: 'value', value: [{ id: 'A' }] } }])
    expect(taskAt(changed.content, ref).inputs).toContainEqual({ handle: 'orders', jsonSchema: {}, nullable: true })
    expect(taskAt(changed.content, 'internal')).toEqual(taskAt(base, 'internal'))
    expect(changed.content.document.graph.nodes.internal).toEqual(base.document.graph.nodes.internal)
    expect(changed.content.document.graph.edges).toEqual(base.document.graph.edges)
  })
  it('requires a business output selection when the source has zero or multiple outputs', async () => {
    const created = await edit(empty, [
      { op: 'node.add', type: 'manual', as: 'empty', name: 'Start' },
      { op: 'node.add', type: 'code', as: 'many', name: 'Many', config: { outputs: { first: {}, second: {} } } },
      { op: 'node.add', type: 'agent', as: 'target', name: 'Target' },
    ])
    for (const source of [created.nodes.empty!, created.nodes.many!])
      await expect(
        edit(created.content, [{ op: 'input.set', node: created.nodes.target!, input: 'data', source: { kind: 'output', node: source } }]),
      ).rejects.toMatchObject({
        code: 'source.port-required',
        details: { node: source, choices: source == created.nodes.empty ? [] : expect.arrayContaining(['first', 'second']) },
      })
    const selected = await edit(created.content, [
      { op: 'input.set', node: created.nodes.target!, input: 'data', source: { kind: 'output', node: created.nodes.many!, port: 'second' } },
    ])
    expect(selected.content.document.graph.nodes[created.nodes.target!]).toMatchObject({ inputs: { data: { sources: [{ output: 'second' }] } } })
  })
  it('preserves Agent groups, defaults and additional inputs when changing business settings', async () => {
    const created = await edit(empty, [
      {
        op: 'node.add',
        type: 'agent',
        as: 'agent',
        name: 'Agent',
        config: { inputs: { context: { schema: { type: 'object' }, nullable: true, default: null } } },
      },
    ])
    const ref = created.nodes.agent!,
      node = created.content.document.graph.nodes[ref]!
    if (node.kind != 'task' || !('executor' in node.task)) throw new Error('Managed task expected')
    const task = node.task
    const base: RevisionContent = {
      ...created.content,
      document: {
        ...created.content.document,
        graph: {
          ...created.content.document.graph,
          nodes: {
            ...created.content.document.graph.nodes,
            [ref]: {
              ...node,
              task: { ...task, inputs: [{ group: 'Context', collapsed: true }, ...task.inputs], outputs: [{ group: 'Response' }, ...task.outputs] },
              additionalInputs: [{ handle: 'extra', jsonSchema: { type: 'string' }, nullable: false, value: 'kept' }],
            },
          },
        },
      },
    }
    const changed = await edit(base, [
      { op: 'node.update', node: ref, set: { config: { model: 'new-model' } } },
      { op: 'text.set', node: ref, field: 'prompt', text: 'Use {{context}}.' },
    ])
    expect(taskAt(changed.content, ref).inputs).toEqual(taskAt(base, ref).inputs)
    expect(taskAt(changed.content, ref).outputs).toEqual(taskAt(base, ref).outputs)
    expect(changed.content.document.graph.nodes[ref]).toMatchObject({
      additionalInputs: [{ handle: 'extra', jsonSchema: { type: 'string' }, nullable: false, value: 'kept' }],
    })
  })
  it('assembles the Agent result wrapper and preserves existing LLM output metadata', async () => {
    const schema = { type: 'object', properties: { total: { type: 'number' } }, required: ['total'] }
    const created = await edit(empty, [
      { op: 'node.add', type: 'agent', as: 'agent', name: 'Agent', config: { resultSchema: schema } },
      { op: 'node.add', type: 'llm', as: 'llm', name: 'LLM' },
    ])
    expect(taskAt(created.content, created.nodes.agent!).outputs).toEqual([expect.objectContaining({ handle: 'output', nullable: false, jsonSchema: schema })])
    const ref = created.nodes.llm!,
      node = created.content.document.graph.nodes[ref]!
    if (node.kind != 'task' || !('executor' in node.task)) throw new Error('Managed task expected')
    const task = node.task
    const base: RevisionContent = {
      ...created.content,
      document: {
        ...created.content.document,
        graph: {
          ...created.content.document.graph,
          nodes: {
            ...created.content.document.graph.nodes,
            [ref]: {
              ...node,
              task: {
                ...task,
                outputs: [{ group: 'Response' }, { handle: 'output', nullable: true, jsonSchema: { type: 'string' }, description: 'Keep this' }],
              },
            },
          },
        },
      },
    }
    const changed = await edit(base, [{ op: 'node.update', node: ref, set: { config: { resultSchema: schema } } }])
    expect(taskAt(changed.content, ref).inputs).toEqual(task.inputs)
    expect(taskAt(changed.content, ref).outputs).toEqual([
      { group: 'Response' },
      { handle: 'output', nullable: true, jsonSchema: schema, description: 'Keep this' },
    ])
  })
  it.each(['manual', 'webhook', 'cron', 'error', 'code', 'agent', 'llm', 'decision', 'condition', 'value', 'wait', 'approval'] as const)(
    'round trips %s configuration',
    async (type) => {
      const created = await edit(empty, [{ op: 'node.add', type, as: 'node', name: 'Node' }])
      const node = (readAuthoring(created.content, { nodes: [created.nodes.node!] }) as unknown as { nodes: { config: Record<string, never> }[] }).nodes[0]!
      const result = await edit(created.content, [{ op: 'node.update', node: created.nodes.node!, set: { config: node.config } }])
      expect(result.content).toEqual(created.content)
    },
  )
})

it.each(['poll', 'integration', 'connector', 'openapi'] as const)('round trips resolved %s without exposing definitions', async (type) => {
  const config: Record<string, string> =
    type == 'connector'
      ? { action: 'test.send' }
      : type == 'openapi'
        ? { sourceUrl: 'https://example.test/spec', path: '/items', method: 'get' }
        : { key: 'test.key' }
  const definition = {
    key: 'test.key',
    definitionVersion: 2,
    description: 'Test',
    displayName: 'Test',
    name: 'Test',
    provider: 'test',
    configInputs: [],
    outputs: [],
  }
  const trigger: AuthoringHost['trigger'] = () =>
    type == 'integration'
      ? {
          ...definition,
          type: 'integration',
          endpoint: { body: { allowArray: false, allowEmpty: true, formats: ['json'] }, methods: ['POST'], successStatus: 200 },
        }
      : { ...definition, type: 'poll' }
  const request = { baseRevision: 'base', requestId: 'create', edits: [{ op: 'node.add' as const, as: 'node', name: 'Node', type, config }] }
  const created = await compileAuthoring(empty, request, { ...host, trigger })
  const ref = created.nodes.node!,
    view = readAuthoring(created.content, { nodes: [ref] }) as unknown as { nodes: { config: Record<string, never> }[] }
  const result = await compileAuthoring(
    created.content,
    { baseRevision: 'next', requestId: 'update', edits: [{ op: 'node.update', node: ref, set: { config: view.nodes[0]!.config } }] },
    { ...host, trigger },
  )
  expect(result.content).toEqual(created.content)
  expect(JSON.stringify(view)).not.toMatch(/taskId|moduleId|definitionVersion/)
})
it('forks shared code while retaining imports, node identity and all other definitions', async () => {
  const created = await edit(empty, [{ op: 'node.add', as: 'a', type: 'code', name: 'A', code: 'export default () => ({value:1})' }])
  const ref = created.nodes.a!,
    node = created.content.document.graph.nodes[ref]!
  const base = applyFlowChanges(created.content, [{ kind: 'graph.node.create', nodeId: 'b', node: { ...node, name: 'B' } }])
  const result = await edit(base, [{ op: 'text.edit', node: ref, field: 'code', oldText: 'value:1', newText: 'value:2' }])
  expect(result.content.document.graph.nodes.b).toEqual(base.document.graph.nodes.b)
  expect(readAuthoring(result.content, { text: { node: 'b', field: 'code' } })).toMatchObject({ text: { content: 'export default () => ({value:1})' } })
  expect(Object.keys(result.content.document.graph.nodes)).toEqual(Object.keys(base.document.graph.nodes))
})
it('rejects retired Subflow creation at the public authoring boundary', async () => {
  const retired = [{ op: 'node.add', as: 'child', type: 'subflow', name: 'Child' }] as unknown as AuthoringRequest['edits']
  await expect(edit(empty, retired)).rejects.toThrow()
})
it('preserves literal JSON and supports multiple sources without connecting execution', async () => {
  const created = await edit(empty, [
    { op: 'node.add', as: 'a', type: 'code', name: 'A' },
    { op: 'node.add', as: 'b', type: 'code', name: 'B' },
    { op: 'input.set', node: '$a', input: 'value', source: { kind: 'value', value: { kind: 'node', nodeId: 'literal', output: 'literal' } } },
    {
      op: 'input.set',
      node: '$b',
      input: 'value',
      source: {
        kind: 'sources',
        sources: [
          { kind: 'output', node: '$a', port: 'value', field: 'name' },
          { kind: 'variable', name: 'EXTRA' },
        ],
      },
    },
  ])
  const view = readAuthoring(created.content, { nodes: [created.nodes.a!, created.nodes.b!] }) as { nodes: { inputs: unknown }[] }
  expect(view.nodes[0]!.inputs).toEqual({ value: { kind: 'value', value: { kind: 'node', nodeId: 'literal', output: 'literal' } } })
  expect(view.nodes[1]!.inputs).toEqual({
    value: {
      kind: 'sources',
      sources: [
        { kind: 'output', node: created.nodes.a, port: 'value', field: 'name' },
        { kind: 'variable', name: 'EXTRA' },
      ],
    },
  })
  expect(created.content.document.graph.edges).toEqual([])
  await expect(edit(created.content, [{ op: 'node.update', node: 'constructor', set: { name: 'Bad' } }])).rejects.toMatchObject({ code: 'node.not-found' })
  await expect(edit(empty, [{ op: 'node.remove', node: '$constructor' }])).rejects.toMatchObject({ code: 'node.alias-missing' })
})
it('maps source diagnostics onto nodes and code lines without storage IDs', async () => {
  const created = await edit(empty, [{ op: 'node.add', type: 'code', as: 'code', name: 'Formatter' }]),
    ref = created.nodes.code!,
    n = created.content.document.graph.nodes[ref]!
  if (n.kind != 'task' || !('moduleId' in n.task)) throw new Error('Code expected')
  const diagnostics = authoringDiagnostics(created.content, [
    {
      code: 'module.syntax',
      message: `CodeModule "${n.task.moduleId}" contains invalid JavaScript syntax.`,
      path: `/modules/${n.task.moduleId}/source`,
      line: 2,
      column: 7,
      values: {},
    },
  ])
  expect(diagnostics).toEqual([
    { code: 'module.syntax', message: 'Code for "Formatter" contains invalid JavaScript syntax.', nodes: [ref], field: 'code', line: 2, column: 7 },
  ])
})
