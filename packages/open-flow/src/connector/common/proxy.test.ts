import type { AuthoringHost } from '../../control/common/authoring.ts'
import type { InputMapping, RevisionContent } from '../../flow/common/change.ts'

import { expect, it } from 'vitest'
import { authoringNode, compileAuthoring } from '../../control/common/authoring.ts'
import { applyFlowChanges, currentFlowModelVersion } from '../../flow/common/change.ts'
import { decodeRevisionContent } from '../../flow/common/changeSchema.ts'
import { resetInputValues, setInputValue } from '../../flow/common/nodeChanges.ts'
import { requestInputMappings } from '../../flow/common/requestParameters.ts'
import { prepareFlow } from '../../flow/common/semantics.ts'
import { currentEngineContract } from '../../runtime/common/engineContract.ts'
import {
  buildConnectorProxyRequest,
  connectorProxyConfigSchema,
  connectorProxyTask,
  withConnectorProxyParameterFields,
  withConnectorProxyParameterSource,
} from './proxy.ts'

const config = (value: object = {}) => connectorProxyConfigSchema.parse({ providerId: 'example', ...value })
const empty: RevisionContent = { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, graph: { nodes: {}, edges: [] } } }
const unexpected = () => {
  throw new Error('Proxy authoring must not resolve an Action.')
}
const host: AuthoringHost = { id: (name) => name, action: unexpected, openapi: unexpected, workflow: unexpected, trigger: unexpected }

it('preserves scalar query values and text headers in both parameter modes, rejecting arrays', () => {
  const fields = config({ query: { names: ['zero', 'flag', 'empty', 'missing'] }, headers: { names: ['X-Test'] } })
  const built = buildConnectorProxyRequest(
    fields,
    { 'endpoint': '/unlisted', 'query.zero': 0, 'query.flag': false, 'query.empty': null, 'query.missing': null, 'header.X-Test': 'test' },
    {
      'query.zero': { kind: 'value', value: 0 },
      'query.flag': { kind: 'value', value: false },
      'query.empty': { kind: 'value', value: null },
      'query.missing': { kind: 'unset' },
      'header.X-Test': { kind: 'value', value: 'test' },
    },
  )
  expect(built).toEqual({ endpoint: '/unlisted', method: 'GET', query: { zero: 0, flag: false, empty: null }, headers: { 'X-Test': 'test' } })
  const object = config({ query: { mode: 'object' }, headers: { mode: 'object' } })
  expect(buildConnectorProxyRequest(object, { endpoint: '/unlisted', query: built.query!, headers: built.headers! })).toEqual(built)
  expect(() => buildConnectorProxyRequest(object, { endpoint: '/unlisted', query: { tag: ['a'] } })).toThrow('scalar')
  expect(() => buildConnectorProxyRequest(object, { endpoint: '/unlisted', headers: { X: 1 } })).toThrow('text')
  expect(() => buildConnectorProxyRequest(config(), { endpoint: '' })).toThrow('endpoint')
})

it('distinguishes no request body from JSON null, empty objects and strings', () => {
  const post = config({ method: 'POST' })
  expect(buildConnectorProxyRequest(post, { endpoint: '/items' })).not.toHaveProperty('body')
  for (const mappings of [{}, { body: { kind: 'unset' } }] as Readonly<Record<string, InputMapping>>[]) {
    expect(buildConnectorProxyRequest(post, { endpoint: '/items', body: null }, mappings)).not.toHaveProperty('body')
  }
  for (const body of [null, {}, 'message', '', false, 0]) {
    expect(buildConnectorProxyRequest(post, { endpoint: '/items', body })).toMatchObject({ body })
    expect(buildConnectorProxyRequest(post, { endpoint: '/items', body }, { body: { kind: 'value', value: body } })).toMatchObject({ body })
  }
  expect(buildConnectorProxyRequest(post, { endpoint: '/items', body: null }, {}, null)).toHaveProperty('body', null)
  expect(buildConnectorProxyRequest(post, { endpoint: '/items', body: null }, { body: { kind: 'unset' } }, null)).not.toHaveProperty('body')
  expect(buildConnectorProxyRequest(config({ bodyFormat: 'json' }), { endpoint: '/items', body: null }, {})).not.toHaveProperty('body')
  expect(() => buildConnectorProxyRequest(config({ bodyFormat: 'json' }), { endpoint: '/items', body: {} })).toThrow('configuration')
})

it('shares parameter editing while preserving unrelated bindings, account and port metadata', () => {
  const task = connectorProxyTask(config({ connectionId: 'account', method: 'POST', bodyFormat: 'json', query: { names: ['page'] } }))
  const node = {
    task: { ...task, outputs: task.outputs.map((port) => ({ ...port, description: 'Saved output' })) },
    inputs: {
      'endpoint': { kind: 'value' as const, value: '/items' },
      'body': { kind: 'value' as const, value: null },
      'query.page': { kind: 'sources' as const, sources: [{ kind: 'node' as const, nodeId: 'start', output: 'page' }] },
    },
  }
  const renamed = withConnectorProxyParameterFields(node, 'query', { offset: 0 })
  expect(renamed.inputs).toEqual({ 'endpoint': node.inputs.endpoint, 'body': node.inputs.body, 'query.offset': node.inputs['query.page'] })
  expect(renamed.task.executor).toMatchObject({ connectionId: 'account', method: 'POST', bodyFormat: 'json' })
  expect(renamed.task.outputs).toEqual(node.task.outputs)
  const source = { kind: 'sources' as const, sources: [{ kind: 'binding' as const, bindingId: 'query' }] }
  const whole = withConnectorProxyParameterSource(renamed, 'query', source)
  expect(whole.inputs).toEqual({ endpoint: node.inputs.endpoint, body: node.inputs.body, query: source })
  expect(requestInputMappings(node.inputs, task, whole.task)).toEqual({ endpoint: node.inputs.endpoint, body: node.inputs.body })
})

it('creates, reads, partially updates, saves and validates through the public authoring contract', async () => {
  const created = await compileAuthoring(
    empty,
    {
      baseRevision: 'base',
      requestId: 'create',
      edits: [
        { op: 'node.add', type: 'start', as: 'start', name: 'Start', config: { inputDefs: { endpoint: { schema: { type: 'string' }, nullable: false } } } },
        {
          op: 'node.add',
          type: 'connector-proxy',
          as: 'proxy',
          name: 'Provider request',
          onError: 'error',
          config: { providerId: 'example', connectionId: '', method: 'POST', query: { names: ['page'] }, headers: { mode: 'object' } },
          inputs: {
            'endpoint': { kind: 'output', node: '$start', port: 'endpoint' },
            'body': { kind: 'value', value: null },
            'query.page': { kind: 'variable', name: 'PAGE' },
            'headers': { kind: 'value', value: { Accept: 'application/json' } },
          },
        },
        { op: 'edge.connect', source: '$start', target: '$proxy' },
      ],
    },
    host,
  )
  const id = created.nodes.proxy!
  const before = authoringNode(created.content, id)
  expect(before).toMatchObject({
    type: 'connector-proxy',
    onError: 'error',
    config: { providerId: 'example', connectionId: '', method: 'POST' },
    inputs: { 'body': { kind: 'value', value: null }, 'query.page': { kind: 'sources', sources: [{ kind: 'variable', name: 'PAGE' }] } },
  })
  const updated = await compileAuthoring(
    created.content,
    { baseRevision: 'created', requestId: 'update', edits: [{ op: 'node.update', node: id, set: { name: 'Renamed', config: { connectionId: 'account' } } }] },
    host,
  )
  const reloaded = decodeRevisionContent(JSON.parse(JSON.stringify(updated.content)))
  expect(authoringNode(reloaded, id)).toEqual({
    ...before,
    name: 'Renamed',
    config: { ...(before.config as Record<string, unknown>), connectionId: 'account' },
  })
  const prepared = await prepareFlow(reloaded, currentEngineContract)
  if (prepared.kind !== 'prepared') throw new Error(JSON.stringify(prepared))
  expect(await prepareFlow(reloaded, 'open-flow-engine/v10')).toEqual({ kind: 'engine-unsupported' })
  const cleared = await compileAuthoring(
    reloaded,
    { baseRevision: 'updated', requestId: 'clear', edits: [{ op: 'input.set', node: id, input: 'body', source: { kind: 'unset' } }] },
    host,
  )
  expect(authoringNode(cleared.content, id)).toMatchObject({ inputs: { body: { kind: 'unset' } } })
  const restored = await compileAuthoring(
    cleared.content,
    { baseRevision: 'cleared', requestId: 'restore', edits: [{ op: 'input.set', node: id, input: 'body', source: { kind: 'value', value: {} } }] },
    host,
  )
  expect(authoringNode(restored.content, id)).toMatchObject({ config: { bodyFormat: 'json' }, inputs: { body: { kind: 'value', value: {} } } })
  const get = await compileAuthoring(
    restored.content,
    { baseRevision: 'restored', requestId: 'get', edits: [{ op: 'node.update', node: id, set: { config: { method: 'GET' } } }] },
    host,
  )
  expect(authoringNode(get.content, id)).toMatchObject({
    config: { providerId: 'example', connectionId: 'account', method: 'GET' },
    inputs: {
      'body': { kind: 'unset' },
      'query.page': { kind: 'sources', sources: [{ kind: 'variable', name: 'PAGE' }] },
      'headers': { kind: 'value', value: { Accept: 'application/json' } },
    },
  })
  expect(await prepareFlow(get.content, currentEngineContract)).toMatchObject({ kind: 'prepared' })
  expect(() => decodeRevisionContent({ ...reloaded, modelVersion: 13 })).toThrow('v14')
  expect(await prepareFlow(decodeRevisionContent({ ...empty, modelVersion: 13 }), 'open-flow-engine/v10')).not.toMatchObject({ kind: 'engine-unsupported' })
  await expect(
    compileAuthoring(
      empty,
      {
        baseRevision: 'base',
        requestId: 'retry',
        edits: [
          {
            op: 'node.add',
            type: 'connector-proxy',
            as: 'proxy',
            name: 'Proxy',
            config: { providerId: 'example' },
            retry: { maxRetries: 1, intervalMs: 1000 },
          },
        ],
      },
      host,
    ),
  ).rejects.toThrow()
})

it('clears a body without losing its definition or inherited default and can restore inheritance', () => {
  const task = connectorProxyTask(config({ method: 'POST', bodyFormat: 'json' }))
  const originalTask = {
    ...task,
    inputs: task.inputs.map((port) =>
      'handle' in port && port.handle === 'body' ? Object.assign({}, port, { value: 'default', description: 'Saved' }) : port,
    ),
  }
  const content: RevisionContent = {
    ...empty,
    document: {
      ...empty.document,
      graph: {
        edges: [],
        nodes: {
          request: {
            kind: 'task',
            task: originalTask,
            inputs: { endpoint: { kind: 'value', value: '/items' }, body: { kind: 'value', value: null } },
          },
        },
      },
    },
  }
  const cleared = applyFlowChanges(content, setInputValue(content, 'request', 'body', undefined)!)
  const node = cleared.document.graph.nodes.request!
  if (node.kind !== 'task' || !('executor' in node.task) || node.task.executor.kind !== 'connector-proxy') throw new Error('Expected a Provider request.')
  expect(node.task).toEqual(originalTask)
  expect(node.inputs.body).toEqual({ kind: 'unset' })
  expect(buildConnectorProxyRequest(node.task.executor, { endpoint: '/items', body: null }, node.inputs, 'default')).not.toHaveProperty('body')
  const reset = applyFlowChanges(cleared, resetInputValues(cleared, 'request', ['body']))
  const inherited = reset.document.graph.nodes.request!
  if (inherited.kind !== 'task') throw new Error('Expected a Provider request.')
  expect(inherited.inputs).not.toHaveProperty('body')
  expect(inherited.task).toEqual(node.task)
  expect(buildConnectorProxyRequest(node.task.executor, { endpoint: '/items', body: 'default' }, inherited.inputs, 'default')).toHaveProperty('body', 'default')
})
