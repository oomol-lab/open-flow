import type { ControlService } from '../node/application/control-service.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { prepareFlow } from '@oomol-lab/open-flow/flow-semantics'
import { openApiTask, selectOperation } from '@oomol-lab/open-flow/openapi'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { createServer } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { executeOpenApi, loadOpenApiDocument } from '../node/deployment/openapi.ts'
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
          tasks: { api: task },
          graph: {
            nodes: {
              start: { kind: 'manual', name: 'Start' },
              api: {
                kind: 'task',
                name: 'API',
                taskId: 'api',
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
  await expect(pending).rejects.toThrow('could not be completed')
  expect(request).toHaveBeenCalledTimes(1)
})
