import type { JsonValue, ManagedTaskDefinition } from '../../flow/common/change.ts'
import type { OpenApiExecutor } from '../../openapi/common/openapi.ts'

import { describe, expect, it, vi } from 'vitest'
import { buildRequest, openApiTask, selectOperation } from '../../openapi/common/openapi.ts'
import { authoringOpenApiSchema, openApiAuthenticationChoices, openApiConfigView, prepareOpenApiTask } from './authoringOpenApi.ts'

const response = { '200': { content: { 'application/json': { schema: { type: 'string' } } } } }
const document: JsonValue = {
  openapi: '3.1.0',
  servers: [{ url: 'https://api.example/v1' }],
  paths: {
    '/orders': {
      get: {
        security: [{ bearer: [], key: [] }, { basic: [] }],
        parameters: [{ in: 'query', name: 'limit', schema: { type: 'integer', default: 20 }, description: 'Order count' }],
        responses: response,
      },
    },
    '/public': { get: { security: [], servers: [{ url: 'https://public.example/v2' }], responses: response } },
    '/oauth': { get: { security: [{ oauth: [] }], responses: response } },
  },
  components: {
    securitySchemes: {
      bearer: { type: 'http', scheme: 'bearer' },
      basic: { type: 'http', scheme: 'basic' },
      key: { type: 'apiKey', in: 'query', name: 'api_key' },
      oauth: { type: 'oauth2', flows: {} },
    },
  },
}
const base = { sourceUrl: 'https://api.example/spec.json', path: '/orders', method: 'get' }
const selected = () => selectOperation(document, base.sourceUrl, base.path, base.method)
const executor = (task: ManagedTaskDefinition): OpenApiExecutor => {
  if (task.executor.kind != 'openapi') throw new Error('Expected OpenAPI task')
  return task.executor
}

describe('OpenAPI business authoring configuration', () => {
  it('advertises complete authentication alternatives without exposing internal descriptors', () => {
    expect(openApiConfigView(selected())).toEqual({ ...base, serverUrl: 'https://api.example/v1', authentication: { schemes: ['bearer', 'key'] } })
    expect(openApiAuthenticationChoices(selected())).toEqual([
      { label: 'bearer + key', authentication: { schemes: ['bearer', 'key'] } },
      { label: 'basic', authentication: { schemes: ['basic'] } },
    ])
    expect(authoringOpenApiSchema.safeParse({ ...base, auth: [{ id: 'bearer', type: 'bearer' }] }).success).toBe(false)
  })

  it('selects an operation default and assembles its ports from the document', async () => {
    const fetch = vi.fn(async () => document)
    const task = await prepareOpenApiTask(base, undefined, fetch, 'Orders')
    expect(fetch).toHaveBeenCalledExactlyOnceWith(base.sourceUrl)
    expect(task).toEqual(openApiTask(selected(), 'Orders'))
  })

  it('resolves combined scheme selections in document order and binds credentials', async () => {
    const task = await prepareOpenApiTask({ ...base, authentication: { schemes: ['key', 'bearer'] } }, undefined, async () => document, 'Orders')
    const request = buildRequest(executor(task), { 'auth.bearer.token': 'secret', 'auth.key.token': 'key-secret' })
    expect(new Headers(request.init.headers).get('authorization')).toBe('Bearer secret')
    expect(new URL(request.url).searchParams.get('api_key')).toBe('key-secret')
  })

  it.each([['bearer'], ['bearer', 'basic'], ['missing'], ['basic', 'basic'], []])(
    'rejects an unavailable or incomplete scheme selection %j',
    async (...schemes) => {
      await expect(prepareOpenApiTask({ ...base, authentication: { schemes } }, undefined, async () => document, 'Orders')).rejects.toMatchObject({
        code: 'openapi.authentication-invalid',
        details: { field: 'config.authentication' },
      })
    },
  )

  it('retains the exact saved snapshot and port metadata without fetching on unrelated updates', async () => {
    const saved = selected()
    const previous = openApiTask(saved, 'Orders')
    const fetch = vi.fn(async () => document)
    const task = await prepareOpenApiTask({ ...openApiConfigView(saved), serverUrl: 'https://proxy.example/' }, previous, fetch, 'Renamed orders')
    expect(fetch).not.toHaveBeenCalled()
    expect(task.inputs).toBe(previous.inputs)
    expect(task.outputs).toBe(previous.outputs)
    expect(executor(task).document).toBe(saved.document)
    expect(executor(task).serverUrl).toBe('https://proxy.example/')
    expect(task.name).toBe('Renamed orders')
  })

  it('changes authentication using the saved snapshot without a network refresh', async () => {
    const previous = openApiTask(selected())
    const fetch = vi.fn(async () => document)
    const task = await prepareOpenApiTask({ ...openApiConfigView(executor(previous)), authentication: { schemes: ['basic'] } }, previous, fetch, 'Orders')
    expect(fetch).not.toHaveBeenCalled()
    expect(executor(task).auth).toEqual([{ id: 'basic', type: 'basic' }])
    expect(task.inputs.map((port) => ('handle' in port ? port.handle : 'group'))).toEqual(['query.limit', 'auth.basic.username', 'auth.basic.password'])
  })

  it('clears explicit selections back to the saved operation defaults', async () => {
    const previous = openApiTask({ ...selected(), auth: [{ id: 'manual', type: 'basic' }], serverUrl: 'https://proxy.example/' })
    const fetch = vi.fn(async () => document)
    const task = await prepareOpenApiTask(base, previous, fetch, 'Orders', { authentication: true, serverUrl: true })
    expect(task).toEqual(openApiTask(selected(), 'Orders'))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('can read an incomplete persisted operation draft', () => {
    const draft: OpenApiExecutor = { kind: 'openapi', sourceUrl: '', path: '', method: 'get', serverUrl: '', auth: [], document: {} }
    expect(openApiConfigView(draft)).toEqual({ sourceUrl: '', path: '', method: 'get', serverUrl: '', authentication: { schemes: [] } })
    expect(openApiAuthenticationChoices(draft)[0]).toHaveProperty('error')
  })

  it('uses the new operation defaults instead of inheriting merged authentication and server selection', async () => {
    const previous = openApiTask({ ...selected(), serverUrl: 'https://proxy.example/' })
    const task = await prepareOpenApiTask({ ...openApiConfigView(executor(previous)), path: '/public' }, previous, async () => document, 'Public')
    expect(executor(task).auth).toEqual([])
    expect(executor(task).serverUrl).toBe('https://public.example/v2')
    expect(task.inputs).toEqual([])
  })

  it('honors explicit manual authentication and server choices when changing operation', async () => {
    const previous = openApiTask(selected())
    const task = await prepareOpenApiTask(
      { ...openApiConfigView(executor(previous)), path: '/public', authentication: { type: 'bearer' }, serverUrl: 'https://proxy.example/' },
      previous,
      async () => document,
      'Public',
      { authentication: true, serverUrl: true },
    )
    expect(executor(task).auth).toEqual([{ id: 'manual', type: 'bearer' }])
    expect(executor(task).serverUrl).toBe('https://proxy.example/')
  })

  it('supports manually supplied access tokens for unsupported OAuth operations', async () => {
    const task = await prepareOpenApiTask(
      { ...base, path: '/oauth', authentication: { type: 'bearer' } },
      undefined,
      async () => document,
      'OAuth access token',
    )
    const request = buildRequest(executor(task), { 'auth.manual.token': 'access-token' })
    expect(new Headers(request.init.headers).get('authorization')).toBe('Bearer access-token')
  })

  it.each([
    { id: 'manual', type: 'bearer' as const },
    { id: 'basic-legacy', type: 'basic' as const },
    { id: 'manual', type: 'apiKey' as const, name: 'X-Token', in: 'header' as const },
  ])('roundtrips existing manual authentication without renaming credential inputs: %j', async (auth) => {
    const saved = { ...selected(), auth: [auth] }
    const previous = openApiTask(saved)
    const fetch = vi.fn(async () => document)
    const task = await prepareOpenApiTask(openApiConfigView(saved), previous, fetch, previous.name)
    expect(task).toEqual(previous)
    expect(fetch).not.toHaveBeenCalled()
  })
})
