import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { prepareFlow } from '@oomol-lab/open-flow/flow-semantics'
import { httpRequestConfigSchema, httpRequestTask } from '@oomol-lab/open-flow/http-request'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { runFlow } from '@oomol-lab/open-flow/scheduler'
import * as Effect from 'effect/Effect'
import { createServer } from 'node:http'
import { expect, it, vi } from 'vitest'
import { executeHttpRequest } from '../node/deployment/http-request.ts'
import { HttpTaskError } from '../node/deployment/http-transport.ts'

const config = (value: unknown = {}) => httpRequestConfigSchema.parse(value)
const signal = () => new AbortController().signal
it('sends JSON and authentication to a real HTTP endpoint and returns its response', async () => {
  let requests = 0
  const server = createServer(async (request, response) => {
    requests++
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    response.writeHead(201, { 'Content-Type': 'application/json', 'Set-Cookie': 'secret' })
    response.end(
      JSON.stringify({
        method: request.method,
        body: JSON.parse(Buffer.concat(chunks).toString()),
        authenticated: request.headers.authorization == 'Bearer token',
        query: new URL(request.url!, 'http://local').searchParams.getAll('tag'),
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (address == null || typeof address == 'string') throw new Error('No server address')
    const result = await executeHttpRequest(
      config({ method: 'POST', bodyFormat: 'json', authentication: { type: 'bearer' }, query: { names: ['tag'] } }),
      { 'url': `http://127.0.0.1:${address.port}`, 'body': null, 'auth.token': 'token', 'query.tag': ['a b', 'c'] },
      signal(),
    )
    expect(result).toMatchObject({ body: { method: 'POST', body: null, authenticated: true, query: ['a b', 'c'] }, statusCode: 201 })
    expect(result.headers).not.toHaveProperty('set-cookie')
    expect(requests).toBe(1)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
it('handles wire formats, response policies and deadlines against a local HTTP fixture', async () => {
  let redirected = false
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://local')
    switch (url.pathname) {
      case '/redirect':
        response.writeHead(302, { location: '/target' }).end()
        return
      case '/target':
        redirected = true
        response.end()
        return
      case '/empty':
        response.writeHead(204).end()
        return
      case '/invalid':
        response.writeHead(200, { 'content-type': 'application/json' }).end('private malformed content')
        return
      case '/large':
        response.end(Buffer.alloc(4 * 1024 * 1024 + 1))
        return
      case '/slow':
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.write('pending')
        return
      case '/missing':
        response.writeHead(404, { 'content-type': 'text/plain' }).end('missing')
        return
      default: {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        response.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            body: Buffer.concat(chunks).toString(),
            contentType: request.headers['content-type'] ?? null,
            basic: request.headers.authorization == `Basic ${Buffer.from('user:pass').toString('base64')}`,
            apiKey: request.headers['x-api-key'] ?? url.searchParams.get('key'),
          }),
        )
      }
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (address == null || typeof address == 'string') throw new Error('No server address')
    const origin = `http://127.0.0.1:${address.port}`
    expect(
      await executeHttpRequest(
        config({ method: 'POST', bodyFormat: 'form', authentication: { type: 'basic' } }),
        {
          'url': origin,
          'body': { tag: ['a b', 'c'] },
          'auth.username': 'user',
          'auth.password': 'pass',
        },
        signal(),
      ),
    ).toMatchObject({ body: { body: 'tag=a+b&tag=c', contentType: 'application/x-www-form-urlencoded', basic: true } })
    for (const location of ['header', 'query'] as const)
      expect(
        await executeHttpRequest(
          config({ method: 'POST', bodyFormat: 'text', authentication: { type: 'apiKey', name: location == 'header' ? 'X-API-Key' : 'key', in: location } }),
          {
            'url': origin,
            'body': '',
            'auth.token': 'test-key',
          },
          signal(),
        ),
      ).toMatchObject({ body: { body: '', contentType: 'text/plain', apiKey: 'test-key' } })
    expect(await executeHttpRequest(config(), { url: `${origin}/empty` }, signal())).toMatchObject({ body: null, statusCode: 204 })
    expect(await executeHttpRequest(config({ statusPolicy: 'all' }), { url: `${origin}/missing` }, signal())).toMatchObject({
      body: 'missing',
      statusCode: 404,
    })
    await expect(executeHttpRequest(config(), { url: `${origin}/missing` }, signal())).rejects.toMatchObject({ code: 'http-request.http-failed' })
    await expect(executeHttpRequest(config(), { url: `${origin}/invalid` }, signal())).rejects.toMatchObject({ code: 'http-request.response-invalid' })
    await expect(executeHttpRequest(config(), { url: `${origin}/large` }, signal())).rejects.toMatchObject({ code: 'http-request.limit-exceeded' })
    expect(await executeHttpRequest(config({ statusPolicy: 'all' }), { url: `${origin}/redirect` }, signal())).toMatchObject({ statusCode: 302 })
    expect(redirected).toBe(false)
    const timeout = AbortSignal.timeout.bind(AbortSignal)
    const deadline = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => timeout(30))
    try {
      await expect(executeHttpRequest(config(), { url: `${origin}/slow` }, signal())).rejects.toMatchObject({ name: 'TimeoutError' })
      expect(deadline).toHaveBeenCalledWith(30000)
    } finally {
      deadline.mockRestore()
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
it('classifies failures without retrying the transport or exposing secrets', async () => {
  for (const [method, retryable] of [
    ['GET', true],
    ['POST', false],
  ] as const) {
    const request = vi.fn(async () => {
      throw new Error('request-secret')
    })
    await expect(executeHttpRequest(config({ method }), { url: 'https://example.test' }, signal(), request)).rejects.toMatchObject({
      code: retryable ? 'http-request.http-failed' : 'http-request.indeterminate',
      retryable,
      catchable: retryable,
    })
    expect(request).toHaveBeenCalledTimes(1)
  }
  for (const status of [404, 429, 503])
    await expect(executeHttpRequest(config(), { url: 'https://example.test' }, signal(), async () => new Response('secret', { status }))).rejects.toMatchObject(
      { code: 'http-request.http-failed', retryable: status != 404 },
    )
})
it('supports non-2xx responses without hiding malformed JSON, and keeps redirects manual', async () => {
  const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('missing', { status: 404 }))
  expect(await executeHttpRequest(config({ statusPolicy: 'all' }), { url: 'https://example.test' }, signal(), request)).toMatchObject({
    body: 'missing',
    statusCode: 404,
  })
  expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
  await expect(
    executeHttpRequest(config({ statusPolicy: 'all', responseFormat: 'json' }), { url: 'https://example.test' }, signal(), request),
  ).rejects.toMatchObject({ code: 'http-request.response-invalid', retryable: false })
  expect(
    await executeHttpRequest(
      config({ statusPolicy: 'all' }),
      { url: 'https://example.test' },
      signal(),
      async () => new Response(null, { status: 302, headers: { location: 'https://other.test' } }),
    ),
  ).toMatchObject({ body: null, statusCode: 302 })
})
it('bounds streamed responses and propagates cancellation during body reading', async () => {
  await expect(
    executeHttpRequest(config(), { url: 'https://example.test' }, signal(), async () => new Response(new Uint8Array(4 * 1024 * 1024 + 1))),
  ).rejects.toMatchObject({ code: 'http-request.limit-exceeded', retryable: false, catchable: false })
  const controller = new AbortController()
  const pending = executeHttpRequest(
    config(),
    { url: 'https://example.test' },
    controller.signal,
    async (_url, init) =>
      new Response(
        new ReadableStream({
          start(stream) {
            init!.signal!.addEventListener('abort', () => stream.error(init!.signal!.reason), { once: true })
          },
        }),
      ),
  )
  await Promise.resolve()
  controller.abort()
  await expect(pending).rejects.toThrow('abort')
})

it.each(['recover', 'handled', 'indeterminate'] as const)('uses node-level retry and error handling for %s', async (mode) => {
  const requestConfig = config({ method: mode == 'indeterminate' ? 'POST' : 'GET' })
  const prepared = await prepareFlow(
    {
      modelVersion: currentFlowModelVersion,
      modules: {},
      document: {
        bindings: {},
        graph: {
          nodes: {
            start: { kind: 'start', name: 'Start', inputDefs: [] },
            http: {
              kind: 'task',
              name: 'HTTP',
              task: httpRequestTask(requestConfig),
              inputs: { url: { kind: 'value', value: 'https://example.test' } },
              retry: { maxRetries: 1, intervalMs: 1000 },
              onError: 'error',
            },
            out: {
              kind: 'outputs',
              name: 'Outputs',
              outputDefs: [{ handle: 'failure', jsonSchema: {}, nullable: true }],
              outputMappings: { failure: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'http', output: 'error', system: true }] } },
            },
          },
          edges: [
            { source: 'start', target: 'http' },
            { source: 'http', target: 'out' },
          ],
        },
      },
    },
    currentEngineContract,
  )
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  let calls = 0
  let sequence = 0
  const request = async () => {
    calls++
    if (mode == 'indeterminate') throw new Error('private transport detail')
    return Response.json({ ok: true }, { status: mode == 'recover' && calls == 2 ? 200 : 503 })
  }
  const running = Effect.runPromise(
    runFlow(prepared.flow, {
      flowId: 'flow',
      runId: 'run',
      trigger: { nodeId: 'start', outputs: {} },
      createId: () => String(++sequence),
      emit: () => Effect.void,
      invokeTask: (invocation) =>
        Effect.tryPromise({
          try: () => executeHttpRequest(requestConfig, invocation.input, signal(), request),
          catch: (error) => (error instanceof Error ? error : new Error('HTTP request failed')),
        }),
      projectFailure: (error) =>
        error instanceof HttpTaskError
          ? { code: error.code, message: error.message, retryable: error.retryable, catchable: error.catchable }
          : { code: 'unexpected', message: String(error) },
    }),
  )
  if (mode == 'indeterminate') {
    await expect(running).rejects.toThrow('could not be confirmed')
    expect(calls).toBe(1)
  } else {
    const result = await running
    expect(result).toMatchObject({
      kind: 'node-results',
      outputs: { failure: mode == 'recover' ? null : { code: 'http-request.http-failed', nodeId: 'http' } },
    })
    expect(calls).toBe(2)
  }
})
