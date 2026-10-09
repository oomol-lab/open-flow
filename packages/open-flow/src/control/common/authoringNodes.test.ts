import type { JsonValue, ManagedTaskDefinition, RevisionContent, TriggerKeySnapshot } from '../../flow/common/change.ts'
import type { AuthoringHost, AuthoringRequest } from './authoring.ts'

import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { findEngineContract } from '../../execution/common/engineContract.ts'
import { currentEngineContract } from '../../execution/common/runtime.ts'
import { runFlow } from '../../execution/common/scheduler.ts'
import { currentFlowModelVersion } from '../../flow/common/change.ts'
import { nodeInputPorts } from '../../flow/common/graph.ts'
import { prepareFlow, validateFlow } from '../../flow/common/semantics.ts'
import { authoringNode, authoringSchema, authoringTypes, compileAuthoring, readAuthoring } from './authoring.ts'

const empty: RevisionContent = {
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: { graph: { nodes: {}, edges: [] }, bindings: {} },
}
const response = { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'string' } } } } }
const document: JsonValue = {
  openapi: '3.1.0',
  info: { title: 'Test API', version: '1' },
  servers: [{ url: 'https://api.example/default' }],
  paths: {
    '/items': { get: { security: [{ bearer: [] }, { basic: [] }], responses: response } },
    '/public': { get: { security: [], servers: [{ url: 'https://public.example/' }], responses: response } },
  },
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' }, basic: { type: 'http', scheme: 'basic' } } },
}
function trigger(type: 'poll' | 'integration', key: string = type): TriggerKeySnapshot {
  const common = {
    key,
    name: type,
    displayName: type,
    description: 'Deterministic trigger',
    provider: 'test',
    definitionVersion: 2,
    configInputs: [{ handle: 'account', jsonSchema: { type: 'string' }, nullable: true, value: 'default-account' }],
    outputs: [{ handle: 'item', jsonSchema: { type: 'object' }, nullable: false }],
  } as const
  return type == 'poll'
    ? { ...common, type }
    : { ...common, type, endpoint: { methods: ['POST'], successStatus: 200, body: { allowArray: false, allowEmpty: false, formats: ['json'] } } }
}
const host: AuthoringHost = {
  id: (name) => name,
  action: async (id) => ({
    actionId: id,
    name: 'Send',
    serviceId: 'test',
    serviceName: 'Test',
    authenticated: false,
    description: '',
    inputs: { message: { jsonSchema: { type: 'string' }, nullable: true } },
    outputs: {},
  }),
  trigger: (key) => trigger(key == 'integration' ? 'integration' : 'poll', key),
  openapi: async () => document,
}
let serial = 0
async function edit(base: RevisionContent, edits: AuthoringRequest['edits'], override: Partial<AuthoringHost> = {}) {
  const requestId = `business-${serial++}`
  return compileAuthoring(base, { baseRevision: 'base', requestId, edits }, { ...host, id: (name) => `${requestId}-${name}`, ...override })
}
function task(content: RevisionContent, ref: string): ManagedTaskDefinition {
  const node = content.document.graph.nodes[ref]
  if (node?.kind != 'task' || !('executor' in node.task)) throw new Error('Expected managed task')
  return node.task
}
async function roundTrip(content: RevisionContent, ref: string) {
  const view = authoringNode(content, ref)
  expect(readAuthoring(content, { nodes: [ref] })).toEqual({ nodes: [view] })
  const updated = await edit(content, [{ op: 'node.update', node: ref, set: { config: JSON.parse(JSON.stringify(view.config)) } }])
  expect(updated.content).toEqual(content)
  return view
}

describe('business configuration authoring contracts', () => {
  it('creates named values without port definitions, preserves null, and executes their values', async () => {
    const created = await edit(empty, [
      { op: 'node.add', type: 'manual', as: 'start', name: 'Start' },
      { op: 'node.add', type: 'value', as: 'constants', name: 'Constants', config: { values: { amount: 42, optional: null, order: { id: 'A-1' } } } },
      { op: 'edge.connect', source: '$start', target: '$constants' },
    ])
    const ref = created.nodes.constants!
    const view = await roundTrip(created.content, ref)
    expect(view.config).toMatchObject({ values: { amount: 42, optional: null, order: { id: 'A-1' } } })
    const prepared = await prepareFlow(created.content, currentEngineContract)
    expect(prepared.kind).toBe('prepared')
    if (prepared.kind != 'prepared') throw new Error('Expected prepared flow')
    const outputs: unknown[] = []
    const result = await Effect.runPromise(
      runFlow(prepared.flow, {
        createId: () => crypto.randomUUID(),
        flowId: 'flow',
        runId: 'run',
        trigger: { nodeId: created.nodes.start!, outputs: {} },
        invokeTask: () => Effect.fail(new Error('Value does not invoke a task')),
        emit: (event) =>
          Effect.sync(() => {
            if (event.type == 'node.completed') outputs.push(event.outputs)
          }),
      }),
    )
    expect(result.kind).toBe('node-results')
    expect(outputs).toContainEqual({ amount: 42, optional: null, order: { id: 'A-1' } })
    const updated = await edit(created.content, [
      {
        op: 'node.update',
        node: ref,
        set: { config: { values: { amount: 0 }, outputs: { amount: { schema: { type: 'number' }, nullable: false, description: 'Total' } } } },
      },
    ])
    expect(authoringNode(updated.content, ref).config).toMatchObject({
      values: { amount: 0, optional: null },
      outputs: { amount: { schema: { type: 'number' }, nullable: false, description: 'Total' } },
    })
  })

  it.each(['wait', 'approval'] as const)('automatically declares %s business input data and preserves explicit constraints', async (type) => {
    const created = await edit(empty, [
      { op: 'node.add', type: 'manual', as: 'start', name: 'Start' },
      {
        op: 'node.add',
        type,
        as: 'review',
        name: 'Review',
        prompt: 'Review {{order}}',
        config: { inputs: { order: { schema: { type: 'object' }, nullable: false } } },
        inputs: { order: { kind: 'value', value: { id: 'A-1' } }, note: { kind: 'value', value: null } },
      },
      { op: 'edge.connect', source: '$start', target: '$review' },
    ])
    const ref = created.nodes.review!
    const node = created.content.document.graph.nodes[ref]!
    expect(nodeInputPorts(node)).toMatchObject({
      order: { jsonSchema: { type: 'object' }, nullable: false },
      note: { jsonSchema: {}, nullable: true },
    })
    const view = await roundTrip(created.content, ref)
    expect(view.inputs).toMatchObject({ note: { kind: 'value', value: null } })
    const checked = await validateFlow(created.content, findEngineContract(currentEngineContract)!)
    expect(checked.diagnostics).toEqual([])
    const changed = await edit(created.content, [{ op: 'input.set', node: ref, input: 'memo', source: { kind: 'value', value: 'extra' } }])
    expect(authoringNode(changed.content, ref).config).toMatchObject({ inputs: { memo: { schema: {}, nullable: true } } })
  })

  it('describes webhook request fields by name with optional defaults and retains their contracts', async () => {
    const created = await edit(empty, [
      {
        op: 'node.add',
        type: 'webhook',
        as: 'entry',
        name: 'Orders',
        config: {
          method: 'POST',
          body: { order: { schema: { type: 'object' }, nullable: false }, memo: { schema: { type: 'string' }, nullable: true, default: null } },
        },
      },
    ])
    const ref = created.nodes.entry!
    const view = await roundTrip(created.content, ref)
    expect(view.config).toMatchObject({ body: { memo: { default: null } } })
    expect(view.config).not.toHaveProperty('bodyFields')
    const checked = await validateFlow(created.content, findEngineContract(currentEngineContract)!)
    expect(checked.diagnostics).toEqual([])
    const updated = await edit(created.content, [{ op: 'node.update', node: ref, clear: [['config', 'body', 'memo', 'default']] }])
    expect(authoringNode(updated.content, ref).config).not.toHaveProperty('body.memo.default')
  })

  it.each(['poll', 'integration'] as const)('uses the ordinary input API for %s fixed configuration and rejects dynamic sources', async (type) => {
    const created = await edit(empty, [
      { op: 'node.add', type, as: 'entry', name: 'Orders', config: { key: type }, inputs: { account: { kind: 'value', value: null } } },
    ])
    const ref = created.nodes.entry!
    const view = await roundTrip(created.content, ref)
    expect(view.inputs).toEqual({ account: { kind: 'value', value: null } })
    expect(view.inputPorts).toMatchObject({ account: { schema: { type: 'string' }, nullable: true, default: 'default-account' } })
    expect(view.config).not.toHaveProperty('values')
    const unset = await edit(created.content, [{ op: 'input.set', node: ref, input: 'account', source: { kind: 'unset' } }])
    expect(authoringNode(unset.content, ref).inputs).toEqual({ account: { kind: 'unset' } })
    const inherited = await edit(unset.content, [{ op: 'input.set', node: ref, input: 'account', source: { kind: 'default' } }])
    expect(authoringNode(inherited.content, ref).inputs).toEqual({})
    await expect(edit(created.content, [{ op: 'input.set', node: ref, input: 'account', source: { kind: 'variable', name: 'account' } }])).rejects.toThrow()
    await expect(edit(created.content, [{ op: 'input.set', node: ref, input: 'unknown', source: { kind: 'value', value: 'x' } }])).rejects.toThrow()
  })

  it('configures LLM business defaults, automatically declares template data, and passes real inputs to execution', async () => {
    const created = await edit(empty, [
      { op: 'node.add', type: 'manual', as: 'start', name: 'Start' },
      {
        op: 'node.add',
        type: 'llm',
        as: 'summary',
        name: 'Summary',
        config: { model: { model: 'test-model', temperature: 0.2 }, template: [{ role: 'user', content: 'Summarize {{order}}' }] },
        inputs: { order: { kind: 'value', value: { id: 'A-1' } } },
      },
      { op: 'edge.connect', source: '$start', target: '$summary' },
    ])
    const ref = created.nodes.summary!
    await roundTrip(created.content, ref)
    expect(JSON.stringify(task(created.content, ref))).not.toMatch(/Alex|Hello/)
    expect(task(created.content, ref).inputs.some((input) => 'handle' in input && input.handle == 'input')).toBe(false)
    const prepared = await prepareFlow(created.content, currentEngineContract)
    expect(prepared.kind).toBe('prepared')
    if (prepared.kind != 'prepared') throw new Error('Expected prepared flow')
    const calls: unknown[] = []
    const result = await Effect.runPromise(
      runFlow(prepared.flow, {
        createId: () => crypto.randomUUID(),
        flowId: 'flow',
        runId: 'run',
        trigger: { nodeId: created.nodes.start!, outputs: {} },
        invokeTask: (invocation) =>
          Effect.sync(() => {
            calls.push(invocation.input)
            return { output: 'Summary' }
          }),
      }),
    )
    expect(result.kind).toBe('node-results')
    expect(calls).toEqual([
      expect.objectContaining({
        model: { model: 'test-model', temperature: 0.2 },
        template: [{ role: 'user', content: 'Summarize {{order}}' }],
        order: { id: 'A-1' },
      }),
    ])
  })

  it('keeps LLM bindings separate from defaults and preserves existing additional input definitions', async () => {
    const created = await edit(empty, [
      { op: 'node.add', type: 'value', as: 'settings', name: 'Settings', config: { values: { model: { model: 'dynamic-model' } } } },
      { op: 'node.add', type: 'llm', as: 'summary', name: 'Summary', inputs: { model: { kind: 'output', node: '$settings' }, messages: { kind: 'unset' } } },
    ])
    const ref = created.nodes.summary!,
      node = created.content.document.graph.nodes[ref]!
    if (node.kind != 'task') throw new Error('Expected task')
    const content: RevisionContent = {
      ...created.content,
      document: {
        ...created.content.document,
        graph: {
          ...created.content.document.graph,
          nodes: {
            ...created.content.document.graph.nodes,
            [ref]: { ...node, additionalInputs: [{ handle: 'customer', jsonSchema: { type: 'object' }, nullable: false, description: 'Customer' }] },
          },
        },
      },
    }
    await roundTrip(content, ref)
    const changed = await edit(content, [{ op: 'node.update', node: ref, set: { config: { model: { model: 'fallback-model' }, messages: null } } }])
    const after = changed.content.document.graph.nodes[ref]!
    expect(after).toMatchObject({
      inputs: node.inputs,
      additionalInputs: [{ handle: 'customer', jsonSchema: { type: 'object' }, nullable: false, description: 'Customer' }],
    })
    expect(authoringNode(changed.content, ref).config).toMatchObject({ model: { model: 'fallback-model' }, messages: null })
    expect(nodeInputPorts(after).model).toMatchObject({ jsonSchema: { type: 'object' }, nullable: false })
  })

  it('replaces OpenAPI authentication selections atomically, resets defaults, and reports advertised choices', async () => {
    const created = await edit(empty, [
      {
        op: 'node.add',
        type: 'openapi',
        as: 'api',
        name: 'Orders',
        config: { sourceUrl: 'https://api.example/spec.json', path: '/items', method: 'get', authentication: { schemes: ['basic'] } },
      },
    ])
    const ref = created.nodes.api!
    await roundTrip(created.content, ref)
    const manual = await edit(created.content, [
      { op: 'node.update', node: ref, set: { config: { authentication: { type: 'bearer' }, serverUrl: 'https://proxy.example/' } } },
    ])
    expect(authoringNode(manual.content, ref).config).toMatchObject({ authentication: { type: 'bearer' } })
    const reset = await edit(manual.content, [
      {
        op: 'node.update',
        node: ref,
        clear: [
          ['config', 'authentication'],
          ['config', 'serverUrl'],
        ],
      },
    ])
    expect(authoringNode(reset.content, ref).config).toMatchObject({ authentication: { schemes: ['bearer'] }, serverUrl: 'https://api.example/default' })
    await expect(edit(reset.content, [{ op: 'node.update', node: ref, set: { config: { authentication: { schemes: ['missing'] } } } }])).rejects.toMatchObject({
      code: 'openapi.authentication-invalid',
      details: {
        editIndex: 0,
        field: 'config.authentication',
        choices: [
          { label: 'bearer', authentication: { schemes: ['bearer'] } },
          { label: 'basic', authentication: { schemes: ['basic'] } },
        ],
      },
    })
  })

  it.each(authoringTypes)('compiles and round trips the advertised %s creation example', async (type) => {
    const contract = authoringSchema(type)
    if (!('example' in contract)) throw new Error('Missing creation example')
    const example = contract.example as AuthoringRequest['edits'][number]
    const created = await edit(empty, [example], { trigger: (key) => trigger(type == 'integration' ? 'integration' : 'poll', key) })
    await roundTrip(created.content, created.nodes.step!)
  })
})
