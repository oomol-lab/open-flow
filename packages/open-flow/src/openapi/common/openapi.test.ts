import type { JsonValue, RevisionContent } from '../../flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { applyFlowChanges, currentFlowModelVersion } from '../../flow/common/change.ts'
import { decodeRevisionContent } from '../../flow/common/changeSchema.ts'
import { matchesSchema } from '../../flow/common/schema.ts'
import { sourceFields } from '../../flow/common/sourceField.ts'
import { buildRequest, openApiTask, parseResponse, securityOptions, selectOperation, snapshot, openApiIssues, openApiFieldIssues } from './openapi.ts'

const document = {
  openapi: '3.0.3',
  paths: {
    '/items/{id}': {
      get: {
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'tags', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
        ] as JsonValue[],
        responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } }, '204': { description: 'empty' } },
      },
    },
    '/unrelated': { get: { responses: {} } },
  },
  components: {
    schemas: {
      Item: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, next: { $ref: '#/components/schemas/Item', nullable: true } } },
      Unused: { type: 'number' },
    },
  },
}
const config = () => selectOperation(document, 'https://service.example/docs/spec.json', '/items/{id}', 'get')
describe('OpenAPI fixed operations', () => {
  it('stores only the selected operation and reachable dependencies including recursive schemas', () => {
    const saved = snapshot(document, '/items/{id}', 'get') as typeof document
    expect(Object.keys(saved.paths)).toEqual(['/items/{id}'])
    expect(Object.keys(saved.components.schemas)).toEqual(['Item'])
    expect(config().serverUrl).toBe('https://service.example/')
    expect(openApiIssues(openApiTask(config()))).toEqual([])
    expect(openApiIssues(JSON.parse(JSON.stringify(openApiTask(config()))))).toEqual([])
  })
  it('generates reference-backed selectable response fields and compiles response unions', () => {
    const one = structuredClone(document)
    delete (one.paths['/items/{id}'].get.responses as Record<string, unknown>)['204']
    const output = openApiTask(selectOperation(one, 'https://service.example/spec', '/items/{id}', 'get')).outputs[0]!
    if (!('handle' in output)) throw new Error('Expected port')
    expect(sourceFields(output).map((field) => field.field)).toEqual(['name', 'next'])
    const union = openApiTask(config()).outputs[0]!
    if (!('handle' in union)) throw new Error('Expected port')
    expect(matchesSchema({ name: 'one', next: { name: 'two', next: null } }, union.jsonSchema)).toBe(true)
    expect(matchesSchema({ name: 12 }, union.jsonSchema)).toBe(false)
  })
  it('encodes path and query values and omits absent optional parameters', () => {
    const request = buildRequest(config(), { 'path.id': 'a/b', 'query.tags': ['a b', 'c&d'] })
    const url = new URL(request.url)
    expect(url.pathname).toBe('/items/a%2Fb')
    expect(url.searchParams.getAll('tags')).toEqual(['a b', 'c&d'])
    expect(url.searchParams.has('limit')).toBe(false)
    expect(request.init.redirect).toBe('manual')
  })
  it('handles alternatives and combined authentication without silently replacing parameters', () => {
    const secured = {
      ...document,
      security: [{ bearer: [], key: [] }, {}] as JsonValue[],
      components: {
        ...document.components,
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer' }, key: { type: 'apiKey', in: 'query', name: 'api_key' } },
      },
    }
    const selected = selectOperation(secured, 'https://service.example/spec', '/items/{id}', 'get')
    expect(securityOptions(secured, '/items/{id}', 'get').map((v) => v.auth?.length)).toEqual([2, 0])
    const request = buildRequest(selected, { 'path.id': 'id', 'auth.bearer.token': 'secret', 'auth.key.token': 'key-secret' })
    expect(new Headers(request.init.headers).get('authorization')).toBe('Bearer secret')
    expect(new URL(request.url).searchParams.get('api_key')).toBe('key-secret')
    expect(() => openApiTask({ ...selected, auth: [{ id: 'collision', type: 'apiKey', name: 'limit', in: 'query' }] })).toThrow('conflicts')
  })
  it('supports JSON request null, Basic auth and safe response failures', () => {
    const doc = {
      openapi: '3.1.0',
      paths: {
        '/create': {
          post: {
            requestBody: { required: true, content: { 'application/json': { schema: { type: ['object', 'null'] } } } },
            responses: { '200': { content: { 'application/json': { schema: { type: 'string' } } } } },
          },
        },
      },
    }
    const selected = { ...selectOperation(doc, 'https://service.example/spec', '/create', 'post'), auth: [{ id: 'basic', type: 'basic' as const }] }
    const request = buildRequest(selected, { 'body': null, 'auth.basic.username': 'user', 'auth.basic.password': 'pass' })
    expect(request.init.body).toBe('null')
    expect(new Headers(request.init.headers).get('authorization')).toBe('Basic dXNlcjpwYXNz')
    expect(() => parseResponse(selected, 401, new Headers(), 'secret')).toThrow('HTTP 401')
    expect(() => parseResponse(selected, 200, new Headers({ 'content-type': 'application/json' }), '12')).toThrow('schema')
    expect(parseResponse(config(), 204, new Headers(), '').body).toBe(null)
  })
  it('rejects external references and unsupported request formats', () => {
    const doc = structuredClone(document)
    doc.paths['/items/{id}'].get.responses['200'].content['application/json'].schema.$ref = 'https://elsewhere.example/schema'
    expect(() => selectOperation(doc, 'https://service.example/spec', '/items/{id}', 'get')).toThrow('External')
  })
  it('updates atomically, rejects stale updates, and never persists literal credentials', () => {
    const task = openApiTask(config())
    const content: RevisionContent = {
      modelVersion: currentFlowModelVersion,
      document: {
        bindings: {},
        subflows: {},
        tasks: { api: task },
        graph: { nodes: { node: { kind: 'task' as const, taskId: 'api', name: 'API', inputs: {} } }, edges: [] },
      },
      modules: {},
    }
    const next = openApiTask({ ...config(), serverUrl: 'https://other.example' })
    const operation = { kind: 'task.openapi.set' as const, taskId: 'api', before: task, value: next }
    const updated = applyFlowChanges(content, [operation])
    expect(decodeRevisionContent(updated).document.tasks.api).toEqual(next)
    expect(() => applyFlowChanges(updated, [operation])).toThrow('changed')
    expect(() =>
      applyFlowChanges(content, [
        { kind: 'graph.node.input.set', target: { kind: 'flow' }, nodeId: 'node', handle: 'auth.manual.token', value: { kind: 'value', value: 'secret' } },
      ]),
    ).toThrow()
  })
})

it('supports boolean schemas, vendor JSON media and schema defaults behind references', () => {
  const documentValue = {
    openapi: '3.1.0',
    components: { schemas: { Limit: { type: 'integer', default: 5 } } },
    paths: {
      '/items': {
        post: {
          parameters: [
            { name: 'limit', in: 'query', schema: { $ref: '#/components/schemas/Limit' } },
            { name: 'any', in: 'query', schema: true },
          ] as JsonValue[],
          requestBody: { content: { 'application/vnd.example+json': { schema: true } } },
          responses: {
            '200': { content: { 'application/json': { schema: { type: 'string' } }, 'application/vnd.example+json': { schema: { type: 'integer' } } } },
          },
        },
      },
    },
  }
  const configValue = selectOperation(documentValue, 'https://api.example.test/spec', '/items', 'post')
  const task = openApiTask(configValue)
  expect(task.inputs[0]).toMatchObject({ value: 5 })
  const request = buildRequest(configValue, { body: { value: true } })
  expect(new Headers(request.init.headers).get('content-type')).toBe('application/vnd.example+json')
  const response = parseResponse(configValue, 200, new Headers({ 'content-type': 'application/vnd.example+json' }), '12')
  const bodyPort = task.outputs[0]!
  if (!('handle' in bodyPort)) throw new Error('Expected body port')
  expect(matchesSchema(response.body!, bodyPort.jsonSchema)).toBe(true)
})

it('locates configuration errors at the blocking field shared with node validation', () => {
  const task = openApiTask(config())
  for (const [patch, field] of [
    [{ sourceUrl: '', path: '' }, 'sourceUrl'],
    [{ sourceUrl: 'invalid', path: '' }, 'sourceUrl'],
    [{ path: '' }, 'operation'],
    [{ serverUrl: 'invalid' }, 'serverUrl'],
  ] as const) {
    const invalid = { ...task, executor: { ...config(), ...patch } }
    const issues = openApiFieldIssues(invalid)
    expect(issues[0]?.field).toBe(field)
    expect(openApiIssues(invalid)).toEqual(issues.map((issue) => issue.message))
  }
})
