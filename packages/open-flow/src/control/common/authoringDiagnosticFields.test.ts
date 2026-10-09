import type { GraphNode, InputPort, ManagedTaskDefinition, RevisionContent, TaskNode } from '../../flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { currentFlowModelVersion } from '../../flow/common/change.ts'
import { authoringDiagnosticField } from './authoringDiagnosticFields.ts'

const amount: InputPort = { handle: 'amount', jsonSchema: { type: 'number' }, nullable: false, value: 0 }
const managed: TaskNode = {
  kind: 'task',
  task: { name: 'Calculate', inputs: [], outputs: [], executor: { kind: 'llm', mode: 'chat' } },
  name: 'Calculate',
  inputs: {},
}
const code: TaskNode = { kind: 'task', name: 'Calculate', inputs: {}, task: { moduleId: 'code', name: 'Calculate', inputs: [amount], outputs: [amount] } }
const content = (node: GraphNode, task?: ManagedTaskDefinition): RevisionContent => ({
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: { graph: { nodes: { node: task == null ? node : { ...managed, task } }, edges: [] }, bindings: {} },
})
const nodePath = (tail: string[]) => ['', 'document', 'graph', 'nodes', 'node', ...tail]
const taskPath = (tail: string[]) => nodePath(['task', ...tail])
const task = (executor: ManagedTaskDefinition['executor']): ManagedTaskDefinition => ({ name: 'Calculate', inputs: [amount], outputs: [amount], executor })

describe('public authoring diagnostic fields', () => {
  it('maps inline contracts by business name and renames only the definition wrapper', () => {
    expect(authoringDiagnosticField(content(code), code, nodePath(['task', 'inputs', '0', 'jsonSchema', 'properties', 'jsonSchema']))).toBe(
      'config.inputs.amount.schema.properties.jsonSchema',
    )
    expect(authoringDiagnosticField(content(code), code, nodePath(['task', 'inputs', '0', 'value']))).toBe('config.inputs.amount.default')
    expect(authoringDiagnosticField(content(code), code, nodePath(['task', 'outputs', '0', 'description']))).toBe('config.outputs.amount.description')
    expect(authoringDiagnosticField(content(code), code, nodePath(['task', 'outputs', '0', 'handle']))).toBe('config.outputs.amount')
  })

  it('uses public parents for missing ports and nonsemantic presentation groups', () => {
    const grouped: TaskNode = { ...code, task: { ...code.task!, inputs: [{ group: 'Heading' }, amount] } }
    expect(authoringDiagnosticField(content(grouped), grouped, nodePath(['task', 'inputs', '0']))).toBe('config.inputs')
    expect(authoringDiagnosticField(content(code), code, nodePath(['task', 'inputs', '7', 'jsonSchema']))).toBe('config.inputs')
    expect(authoringDiagnosticField(content(code), code, nodePath(['task', 'moduleId']))).toBe('config')
  })

  it('keeps root metadata, bindings, and source code separate from configuration', () => {
    expect(authoringDiagnosticField(content(code), code, nodePath(['name']))).toBe('name')
    expect(authoringDiagnosticField(content(code), code, nodePath(['timeoutMs']))).toBe('timeoutMs')
    expect(authoringDiagnosticField(content(code), code, nodePath(['inputs', 'amount', 'sources', '0', 'nodeId']))).toBe('inputs.amount')
    expect(authoringDiagnosticField(content(code), code, ['', 'modules', 'code', 'source'])).toBe('code')
  })

  it('maps Agent output schemas and executor settings without exposing fixed port names', () => {
    const revision = content(managed, task({ kind: 'agent', model: 'model', prompt: 'Text', maxRounds: 10, tools: [] }))
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['inputs', '0', 'nullable']))).toBe('config.inputs.amount.nullable')
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['outputs', '0', 'jsonSchema', 'properties', 'output']))).toBe(
      'config.resultSchema.properties.output',
    )
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['outputs', '0', 'handle']))).toBe('config.resultSchema')
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['executor', 'prompt']))).toBe('prompt')
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['executor', 'model']))).toBe('config.model')
  })

  it('locates derived Agent tool definitions at the advertised parameter source', () => {
    const revision = content(
      managed,
      task({
        kind: 'agent',
        model: 'model',
        prompt: '',
        maxRounds: 10,
        notification: { action: 'billing.notify', inputDefinitions: [amount], messageHandle: 'amount', inputs: {} },
        tools: [
          {
            id: 'private',
            name: 'charge',
            action: 'billing.charge',
            description: 'Charge',
            approval: true,
            inputs: [{ ...amount, source: { kind: 'value', value: 3 } }],
          },
        ],
      }),
    )
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['executor', 'tools', '0', 'id']))).toBe('config.tools.0')
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['executor', 'tools', '0', 'inputs', '0', 'jsonSchema']))).toBe(
      'config.tools.0.inputs.amount',
    )
    expect(
      authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['executor', 'tools', '0', 'inputs', '0', 'source', 'value'])),
    ).toBe('config.tools.0.inputs.amount.value')
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['executor', 'notification', 'action']))).toBe(
      'config.notification.action',
    )
    expect(
      authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['executor', 'notification', 'inputDefinitions', '0', 'jsonSchema'])),
    ).toBe('config.notification.inputs')
  })

  it('maps LLM fixed defaults to business settings and custom input definitions separately', () => {
    const llm = {
      ...task({ kind: 'llm', mode: 'chat' }),
      inputs: [{ ...amount, handle: 'model' }, { ...amount, handle: 'template' }, { ...amount, handle: 'messages' }, amount],
    }
    const revision = content(managed, llm)
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['inputs', '0', 'value', 'model']))).toBe('config.model.model')
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['inputs', '1', 'value', '0', 'content']))).toBe(
      'config.template.0.content',
    )
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['inputs', '2', 'jsonSchema']))).toBe('config.messages')
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['inputs', '3', 'jsonSchema']))).toBe('config.inputs.amount.schema')
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, nodePath(['inputs', 'model']))).toBe('inputs.model')
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['outputs', '0', 'jsonSchema']))).toBe('config.resultSchema')
  })

  it.each(['wait', 'approval'] as const)('maps %s data contracts and prompt', (kind) => {
    const node: GraphNode = { kind, inputDefinitions: [amount], inputs: {}, prompt: '' }
    expect(authoringDiagnosticField(content(node), node, nodePath(['inputDefinitions', '0', 'jsonSchema']))).toBe('config.inputs.amount.schema')
    expect(authoringDiagnosticField(content(node), node, nodePath(['prompt']))).toBe('prompt')
  })

  it('maps webhook fields and Value definitions separately from literal data', () => {
    const webhook: GraphNode = { kind: 'webhook', name: 'Receive', method: 'POST', bodyFields: [amount] }
    expect(authoringDiagnosticField(content(webhook), webhook, nodePath(['bodyFields', '0', 'value']))).toBe('config.body.amount.default')
    const value: GraphNode = { kind: 'value', inputs: {}, values: [amount] }
    expect(authoringDiagnosticField(content(value), value, nodePath(['values', '0', 'value', 'jsonSchema']))).toBe('config.values.amount.jsonSchema')
    expect(authoringDiagnosticField(content(value), value, nodePath(['values', '0', 'jsonSchema', 'properties', 'value']))).toBe(
      'config.outputs.amount.schema.properties.value',
    )
  })

  it('maps trigger fixed configuration to input sources and keeps capability identities hidden', () => {
    const poll: GraphNode = {
      kind: 'poll',
      name: 'Poll',
      config: {},
      pollTimes: [],
      definition: {
        type: 'poll',
        key: 'orders.changed',
        provider: 'orders',
        name: 'orders',
        displayName: 'Orders',
        description: '',
        definitionVersion: 1,
        configInputs: [amount],
        outputs: [],
      },
    }
    expect(authoringDiagnosticField(content(poll), poll, nodePath(['config', 'amount', 'value']))).toBe('inputs.amount')
    expect(authoringDiagnosticField(content(poll), poll, nodePath(['definition', 'configInputs', '0', 'jsonSchema']))).toBe('inputPorts.amount.schema')
    expect(authoringDiagnosticField(content(poll), poll, nodePath(['definition', 'definitionVersion']))).toBe('config.key')
    expect(authoringDiagnosticField(content(poll), poll, nodePath(['pollTimes', '0', 'value']))).toBe('config.schedule.0.value')
  })

  it('maps OpenAPI selection and authentication while hiding the operation snapshot', () => {
    const revision = content(
      managed,
      task({
        kind: 'openapi',
        document: {},
        auth: [],
        method: 'get',
        path: '/items',
        serverUrl: 'https://example.com',
        sourceUrl: 'https://example.com/api.json',
      }),
    )
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['executor', 'auth', '0', 'id']))).toBe('config.authentication')
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['executor', 'document', 'paths']))).toBe('config')
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['executor', 'path']))).toBe('config.path')
    expect(authoringDiagnosticField(revision, revision.document.graph.nodes.node!, taskPath(['inputs', '0', 'jsonSchema']))).toBe('inputPorts.amount.schema')
  })

  it('maps Condition expressions and synthetic input handles to the same public operand', () => {
    const node: GraphNode = {
      kind: 'condition',
      inputs: {},
      matchMode: 'first',
      cases: [{ output: 'yes', groups: [{ expressions: [{ left: { kind: 'value', value: true }, operator: 'isTrue' }] }] }],
    }
    const revision = content(node)
    expect(authoringDiagnosticField(revision, node, nodePath(['cases', '0', 'groups', '0', 'expressions', '0', 'left', 'jsonSchema']))).toBe(
      'config.branches.0.when.left.schema',
    )
    expect(authoringDiagnosticField(revision, node, nodePath(['inputs', '0/0/0/left']))).toBe('config.branches.0.when.left')
    expect(authoringDiagnosticField(revision, node, nodePath(['cases', '0', 'output']))).toBe('config.branches.0.name')
  })
})
