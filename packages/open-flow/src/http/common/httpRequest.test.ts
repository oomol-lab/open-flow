import type { AuthoringHost } from '../../control/common/authoring.ts'
import type { RevisionContent } from '../../flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import { compileAuthoring, authoringNode } from '../../control/common/authoring.ts'
import { runFlow } from '../../execution/common/scheduler.ts'
import { currentFlowModelVersion, applyFlowChanges } from '../../flow/common/change.ts'
import { decodeRevisionContent } from '../../flow/common/changeSchema.ts'
import { prepareFlow } from '../../flow/common/semantics.ts'
import { currentEngineContract } from '../../runtime/common/engineContract.ts'
import { buildHttpRequest, httpRequestConfigSchema, httpRequestTask, httpRequestInputs, parseHttpResponse } from './httpRequest.ts'

const config = (value: unknown = {}) => httpRequestConfigSchema.parse(value)
it('encodes dynamic query arrays and headers without merging existing values', () => {
  const built = buildHttpRequest(config({ query: { mode: 'object' }, headers: { mode: 'object' } }), {
    url: 'https://example.test/path?tag=old&keep=yes',
    query: { tag: ['a b', 'c&d'], zero: 0, enabled: false },
    headers: { 'X-Name': 'test' },
  })
  const url = new URL(built.url)
  expect(url.searchParams.getAll('tag')).toEqual(['a b', 'c&d'])
  expect(url.searchParams.get('keep')).toBe('yes')
  expect(url.searchParams.get('zero')).toBe('0')
  expect(url.searchParams.get('enabled')).toBe('false')
  expect(new Headers(built.init.headers).get('x-name')).toBe('test')
  expect(() => buildHttpRequest(config({ headers: { mode: 'object' } }), { url: url.href, headers: { X: '1', x: '2' } })).toThrow('Duplicate')
})
it('keeps body omission, JSON null and empty text distinct and rejects content-type conflicts', () => {
  const json = config({ method: 'POST', bodyFormat: 'json', headers: { mode: 'object' } })
  expect(() => buildHttpRequest(json, { url: 'https://example.test' })).toThrow('unset')
  expect(buildHttpRequest(json, { url: 'https://example.test', body: null }).init.body).toBe('null')
  expect(buildHttpRequest(config({ method: 'POST', bodyFormat: 'text' }), { url: 'https://example.test', body: '' }).init.body).toBe('')
  expect(
    buildHttpRequest(config({ method: 'POST', bodyFormat: 'form' }), { url: 'https://example.test', body: { tag: ['a b', 'c'], zero: 0 } }).init.body,
  ).toBe('tag=a+b&tag=c&zero=0')
  expect(() => buildHttpRequest(json, { url: 'https://example.test', body: {}, headers: { 'Content-Type': 'text/plain' } })).toThrow('Content-Type')
  expect(() => buildHttpRequest(config({ bodyFormat: 'json' }), { url: 'https://example.test', body: {} })).toThrow('configuration')
})
it('injects authentication and rejects parameter conflicts and embedded credentials', () => {
  const bearer = config({ authentication: { type: 'bearer' }, headers: { mode: 'object' } })
  expect(new Headers(buildHttpRequest(bearer, { 'url': 'https://example.test', 'auth.token': 'secret' }).init.headers).get('authorization')).toBe(
    'Bearer secret',
  )
  expect(() => buildHttpRequest(bearer, { 'url': 'https://example.test', 'auth.token': 'secret', 'headers': { Authorization: 'other' } })).toThrow('conflicts')
  expect(() => buildHttpRequest(config(), { url: 'https://user:secret@example.test' })).toThrow('credentials')
  expect(() => buildHttpRequest(config(), { url: 'file:///private' })).toThrow('HTTP(S)')
  const key = config({ authentication: { type: 'apiKey', name: 'key', in: 'query' } })
  expect(() => buildHttpRequest(key, { 'url': 'https://example.test?key=old', 'auth.token': 'secret' })).toThrow('conflicts')
})
it('preserves array results, rejects malformed JSON and supports explicit status handling', () => {
  const headers = new Headers({ 'content-type': 'application/problem+json', 'set-cookie': 'secret' })
  expect(parseHttpResponse(config(), 200, headers, '[1,2]')).toEqual({ body: [1, 2], statusCode: 200, headers: { 'content-type': 'application/problem+json' } })
  expect(() => parseHttpResponse(config(), 200, headers, 'invalid')).toThrow()
  expect(parseHttpResponse(config({ responseFormat: 'text' }), 200, headers, 'invalid').body).toBe('invalid')
  expect(() => parseHttpResponse(config(), 404, headers, '{}')).toThrow('404')
  expect(parseHttpResponse(config({ statusPolicy: 'all' }), 404, headers, '{}').body).toEqual({})
  expect(parseHttpResponse(config(), 204, new Headers(), '').body).toBe(null)
})
const empty: RevisionContent = { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, graph: { nodes: {}, edges: [] } } }
const host: AuthoringHost = {
  id: (name) => name,
  action: async () => {
    throw new Error('Unexpected action')
  },
  openapi: async () => {
    throw new Error('No document needed')
  },
  workflow: async () => {
    throw new Error('Unexpected workflow')
  },
  trigger: () => {
    throw new Error('Unexpected trigger')
  },
}
it('authors, reads, updates and executes using public inputs while hiding credentials from start events', async () => {
  const created = await compileAuthoring(
    empty,
    {
      baseRevision: 'base',
      requestId: 'create',
      edits: [
        { op: 'node.add', type: 'start', as: 'start', name: 'Start' },
        {
          op: 'node.add',
          type: 'http-request',
          as: 'http',
          name: 'HTTP',
          config: { method: 'POST', bodyFormat: 'json', authentication: { type: 'bearer' } },
          inputs: {
            'url': { kind: 'value', value: 'https://example.test' },
            'body': { kind: 'value', value: null },
            'auth.token': { kind: 'variable', name: 'TOKEN' },
          },
          retry: { maxRetries: 1, intervalMs: 1000 },
          onError: 'error',
        },
        { op: 'edge.connect', source: '$start', target: '$http' },
      ],
    },
    host,
  )
  const id = created.nodes.http!
  const read = authoringNode(created.content, id)
  expect(read).toMatchObject({ type: 'http-request', config: { method: 'POST', bodyFormat: 'json' }, inputs: { body: { kind: 'value', value: null } } })
  const updated = await compileAuthoring(
    created.content,
    { baseRevision: 'created', requestId: 'update', edits: [{ op: 'node.update', node: id, set: { name: 'Renamed', config: { responseFormat: 'text' } } }] },
    host,
  )
  expect(updated.content.document.graph.nodes[id]).toMatchObject({
    inputs: created.content.document.graph.nodes[id]!.kind == 'task' ? created.content.document.graph.nodes[id]!.inputs : {},
    retry: { maxRetries: 1 },
  })
  await expect(
    compileAuthoring(
      created.content,
      { baseRevision: 'created', requestId: 'bad', edits: [{ op: 'input.set', node: id, input: 'auth.token', source: { kind: 'value', value: 'secret' } }] },
      host,
    ),
  ).rejects.toThrow()
  const prepared = await prepareFlow(created.content, currentEngineContract)
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  const original = created.content.document.graph.nodes[id]!
  if (original.kind != 'task') throw new Error('Expected HTTP task')
  const incomplete = applyFlowChanges(created.content, [
    {
      kind: 'graph.node.input.set',
      nodeId: id,
      handle: 'url',
      before: original.inputs.url,
      value: { kind: 'value', value: 'https://user:secret@example.test' },
    },
    { kind: 'graph.node.input.set', nodeId: id, handle: 'body', before: original.inputs.body, value: { kind: 'unset' } },
  ])
  expect(await prepareFlow(incomplete, currentEngineContract)).toMatchObject({
    kind: 'flow-invalid',
    validation: {
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'http-request.url-invalid' }),
        expect.objectContaining({ code: 'http-request.body-required' }),
      ]),
    },
  })
  const events: unknown[] = []
  const values = Object.fromEntries(Object.keys(created.content.document.bindings).map((key) => [key, 'secret']))
  let serial = 0
  await Effect.runPromise(
    runFlow(prepared.flow, {
      createId: () => String(++serial),
      flowId: 'flow',
      runId: 'run',
      trigger: { nodeId: created.nodes.start!, outputs: {} },
      bindingValues: values,
      emit: (event) =>
        Effect.sync(() => {
          events.push(event)
        }),
      invokeTask: (invocation) =>
        Effect.sync(() => {
          expect(invocation.input.body).toBe(null)
          expect(invocation.input['auth.token']).toBe('secret')
          return { body: {}, statusCode: 200, headers: {} }
        }),
    }),
  )
  expect(JSON.stringify(events)).not.toContain('secret')
  expect(() => decodeRevisionContent({ ...created.content, modelVersion: 10 })).toThrow('version 11')
  expect(await prepareFlow(created.content, 'open-flow-engine/v7')).toEqual({ kind: 'engine-unsupported' })
  expect(() =>
    applyFlowChanges(created.content, [
      { kind: 'graph.node.input.set', nodeId: id, handle: 'auth.token', before: original.inputs['auth.token'], value: { kind: 'value', value: 'secret' } },
    ]),
  ).toThrow('authentication accepts deployment variables and upstream outputs only')
})
it('derives stable output contracts without a document', () => {
  expect(httpRequestTask().outputs.map((port) => ('handle' in port ? port.handle : ''))).toEqual(['body', 'statusCode', 'headers'])
})

it('preserves named input sources and metadata, without confusing mode switches with renames', () => {
  const previous = httpRequestTask(config({ query: { names: ['page'] } }))
  const decorated = {
    ...previous,
    inputs: [{ group: 'Request', collapsed: true }, ...previous.inputs.map((port) => ({ ...port, description: 'Saved metadata' }))],
  }
  const same = httpRequestTask(config({ query: { names: ['page'] }, responseFormat: 'text' }), 'Renamed', decorated)
  expect(same.inputs).toEqual(decorated.inputs)
  const mappings = {
    'url': { kind: 'value' as const, value: 'https://example.test' },
    'query.page': { kind: 'sources' as const, sources: [{ kind: 'node' as const, nodeId: 'start', output: 'page' }] },
  }
  const renamed = httpRequestTask(config({ query: { names: ['offset'] } }))
  expect(httpRequestInputs(mappings, previous, renamed)).toEqual({ 'url': mappings.url, 'query.offset': mappings['query.page'] })
  const objectMode = httpRequestTask(config({ query: { mode: 'object', names: ['page'] } }))
  expect(httpRequestInputs(mappings, previous, objectMode)).toEqual({ url: mappings.url })
})
