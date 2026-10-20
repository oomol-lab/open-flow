import type { ControlService } from '../node/application/control-service.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { prepareFlow } from '@oomol-lab/open-flow/flow-semantics'
import { openApiTask, selectOperation } from '@oomol-lab/open-flow/openapi'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { createServer } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { executeOpenApi, loadOpenApiDocument, OpenApiTaskError } from '../node/deployment/openapi.ts'
import { createControlApp } from '../node/transport/control.ts'

const doc = {
  openapi: '3.1.0',
  paths: {
    '/items': {
      get: {
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: { '200': { content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } } } } },
      },
    },
  },
}
afterEach(() => vi.unstubAllGlobals())
it('loads a document through an authenticated Control API only', async () => {
  const upstream = vi.fn(async () => Response.json(doc))
  vi.stubGlobal('fetch', upstream)
  let authorized = false
  const app = createControlApp({} as ControlService, () => (authorized ? 'operator' : undefined)).onError(() => Response.json({}, { status: 401 }))
  const request = () =>
    app.request('/openapi/document', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.test/spec', version: 1 }),
    })
  expect((await request()).status).toBe(401)
  expect(upstream).not.toHaveBeenCalled()
  authorized = true
  expect(await (await request()).json()).toEqual({ version: 1, document: doc })
  expect(upstream).toHaveBeenCalledTimes(1)
})
it('uses a fixed definition to call a local server without requesting the document', async () => {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url!)
    expect(request.headers.authorization).toBe('Bearer token')
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ ok: true }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (address == null || typeof address == 'string') throw new Error('No server address')
    const config = {
      ...selectOperation(doc, 'https://unavailable.example/spec', '/items', 'get'),
      serverUrl: `http://127.0.0.1:${address.port}`,
      auth: [{ id: 'token', type: 'bearer' as const }],
    }
    const task = openApiTask(config)
    const prepared = await prepareFlow(
      {
        modelVersion: currentFlowModelVersion,
        modules: {},
        document: {
          bindings: { token: { kind: 'variable', target: 'API_TOKEN' } },

          graph: {
            nodes: {
              start: { kind: 'manual', name: 'Start' },
              api: {
                kind: 'task',
                name: 'API',
                task: task,
                inputs: { 'auth.token.token': { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'token' }] } },
              },
            },
            edges: [{ source: 'start', target: 'api' }],
          },
        },
      },
      currentEngineContract,
    )
    expect(prepared.kind).toBe('prepared')
    const result = await executeOpenApi(config, { 'query.limit': 3, 'auth.token.token': 'token' }, new AbortController().signal)
    expect(result.body).toEqual({ ok: true })
    expect(requests).toEqual(['/items?limit=3'])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
})
it('bounds document size, rejects redirects and propagates cancellation without leaking request secrets', async () => {
  await expect(loadOpenApiDocument('file:///etc/passwd')).rejects.toThrow()
  const redirect = vi.fn(async () => new Response('', { status: 302, headers: { location: 'https://other.example' } }))
  await expect(loadOpenApiDocument('https://example.test/spec', undefined, redirect)).rejects.toThrow('Unable')
  expect(redirect).toHaveBeenCalledTimes(1)
  await expect(
    loadOpenApiDocument('https://example.test/spec', undefined, async () => new Response('{}', { headers: { 'content-length': '9000000' } })),
  ).rejects.toThrow('Unable')
  const controller = new AbortController()
  const config = {
    ...selectOperation(doc, 'https://example.test/spec', '/items', 'get'),
    auth: [{ id: 'key', type: 'apiKey' as const, in: 'query' as const, name: 'key' }],
  }
  const request = vi.fn(
    async (_url: string | URL | Request, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('secret-token')), { once: true })),
  )
  const pending = executeOpenApi(config, { 'auth.key.token': 'secret-token' }, controller.signal, request)
  controller.abort()
  await expect(pending).rejects.toThrow('abort')
  expect(request).toHaveBeenCalledTimes(1)
})

it.each([400, 401, 403, 404, 429, 500, 503])('classifies a fully received HTTP %s response at the request owner', async (status) => {
  const config = selectOperation(doc, 'https://example.test/spec', '/items', 'get')
  await expect(executeOpenApi(config, {}, new AbortController().signal, async () => new Response('{}', { status }))).rejects.toMatchObject({
    code: 'openapi.http-failed',
    retryable: status == 429 || status >= 500,
  })
})
it('forbids retries for invalid inputs, response validation and resource limits', async () => {
  const config = selectOperation(doc, 'https://example.test/spec', '/items', 'get')
  await expect(executeOpenApi(config, { 'query.limit': 'invalid' }, new AbortController().signal)).rejects.toMatchObject({
    code: 'openapi.input-invalid',
    retryable: false,
  })
  await expect(executeOpenApi(config, {}, new AbortController().signal, async () => Response.json({ ok: 'wrong' }))).rejects.toMatchObject({
    code: 'openapi.response-invalid',
    retryable: false,
  })
  await expect(
    executeOpenApi(config, {}, new AbortController().signal, async () => new Response('{}', { headers: { 'content-length': '9000000' } })),
  ).rejects.toMatchObject({ code: 'openapi.limit-exceeded', retryable: false })
})

it.each(['get', 'head', 'options', 'post', 'put', 'patch', 'delete'])('classifies %s transport failures using the request method', async (method) => {
  const config = selectOperation({ ...doc, paths: { '/items': { [method]: doc.paths['/items'].get } } }, 'https://example.test/spec', '/items', method)
  const retryable = ['get', 'head', 'options'].includes(method)
  await expect(
    executeOpenApi(config, {}, new AbortController().signal, async () => {
      throw new Error('secret')
    }),
  ).rejects.toMatchObject({
    code: retryable ? 'openapi.http-failed' : 'openapi.indeterminate',
    retryable,
  })
})
it.each([200, 400, 401, 429, 500, 503])('uses the received HTTP %s status when reading the body fails', async (status) => {
  const config = selectOperation({ ...doc, paths: { '/items': { post: doc.paths['/items'].get } } }, 'https://example.test/spec', '/items', 'post')
  await expect(
    executeOpenApi(
      config,
      {},
      new AbortController().signal,
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('secret'))
            },
          }),
          { status },
        ),
    ),
  ).rejects.toMatchObject({
    code: status == 200 ? 'openapi.response-invalid' : 'openapi.http-failed',
    retryable: status == 429 || status >= 500,
  })
})
it.each(['transport', 'body'])('preserves cancellation and deadlines during %s failures', async (phase) => {
  const deadline = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
  try {
    const config = selectOperation(doc, 'https://example.test/spec', '/items', 'get')
    const reason = new DOMException('Deadline exceeded', 'TimeoutError')
    await expect(
      executeOpenApi(config, {}, new AbortController().signal, async () => {
        if (phase == 'transport') {
          deadline.abort(reason)
          throw new Error('secret')
        }
        return new Response(
          new ReadableStream({
            pull(controller) {
              deadline.abort(reason)
              controller.error(new Error('secret'))
            },
          }),
          { status: 503 },
        )
      }),
    ).rejects.toBe(reason)
  } finally {
    vi.restoreAllMocks()
  }
})
it('preserves structured errors and resource limits instead of converting them to retryable HTTP errors', async () => {
  const config = selectOperation(doc, 'https://example.test/spec', '/items', 'get')
  const error = new OpenApiTaskError('openapi.input-invalid', 'Invalid request')
  await expect(
    executeOpenApi(config, {}, new AbortController().signal, async () => {
      throw error
    }),
  ).rejects.toBe(error)
  await expect(
    executeOpenApi(
      config,
      {},
      new AbortController().signal,
      async () =>
        new Response('{}', {
          status: 503,
          headers: { 'content-length': '9000000' },
        }),
    ),
  ).rejects.toMatchObject({ code: 'openapi.limit-exceeded', retryable: false })
})
