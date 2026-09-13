import type { ConnectorProxyResource } from '../node/deployment/connector-proxy.ts'

import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import { forwardConnector } from '../node/deployment/connector-proxy.ts'
import { ControlError } from '../node/error.ts'
import { createConnectorProxyApp } from '../node/transport/connector-proxy.ts'

const configuration = { origin: 'https://connector.example/base/', token: 'deployment-token' }
afterEach(() => vi.unstubAllGlobals())

function app(configured = true, authenticated = true) {
  const scope = vi.fn(async (flowId?: string) => {
    if (flowId === 'missing') throw new ControlError('flow.not-found', 'Flow was not found.')
    return flowId == null ? undefined : 'team'
  })
  const result = createConnectorProxyApp({
    authenticate: async () => {
      if (!authenticated) throw new ControlError('authentication.required', 'Authentication is required.')
      return 'actor'
    },
    configuration: () => (configured ? configuration : undefined),
    resolveScope: scope,
    forward: forwardConnector,
  })
  result.onError((error) => {
    if (!(error instanceof ControlError)) throw error
    return Response.json({ version: 1, error: { code: error.code, message: error.message } }, { status: error.status })
  })
  return { app: result, scope }
}

it.each<ConnectorProxyResource>(['providers', 'actions', 'apps'])('forwards %s without transforming queries, data or credentials', async (resource) => {
  const raw = '{ "success": true, "data": [{"service":"mail","id":"mail.send","extra":{"future":true}}], "meta": {"source":"upstream"} }\n'
  const fetcher = vi.fn(
    async () =>
      new Response(raw, { headers: { 'etag': 'W/"upstream"', 'cache-control': 'public, max-age=60', 'content-language': 'zh-CN', 'vary': 'Accept-Language' } }),
  )
  vi.stubGlobal('fetch', fetcher)
  const test = app()
  for (let i = 0; i < 2; i++) {
    const result = await test.app.request(`/${resource}?flowId=flow&service=a&service=b&q=%20hello%20&locale=zh`, {
      headers: { 'authorization': 'Bearer caller', 'x-oo-team-id': 'caller-team', 'if-none-match': '"client"', 'accept-language': 'zh-CN' },
    })
    expect(await result.text()).toBe(raw)
    expect(result.headers.get('etag')).toBe('W/"upstream"')
    expect(result.headers.get('cache-control')).toBe('public, max-age=60')
    expect(result.headers.get('content-language')).toBe('zh-CN')
    expect(result.headers.get('vary')).toBe('Accept-Language')
  }
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(test.scope).toHaveBeenCalledWith('flow')
  const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit]
  expect(url.pathname).toBe(`/base/v1/${resource}`)
  expect([...url.searchParams]).toEqual([
    ['service', 'a'],
    ['service', 'b'],
    ['q', ' hello '],
    ['locale', 'zh'],
  ])
  expect(Object.fromEntries(new Headers(init.headers))).toEqual({
    'authorization': 'Bearer deployment-token',
    'x-oo-team-id': 'team',
    'if-none-match': '"client"',
    'accept-language': 'zh-CN',
  })
})

it.each(['"strong"', 'W/"weak"', null])('preserves bodyless 304 with ETag %s', async (etag) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 304, headers: etag == null ? {} : { etag } })),
  )
  const result = await app().app.request('/providers', { headers: { 'if-none-match': '"old"' } })
  expect(result.status).toBe(304)
  expect(await result.text()).toBe('')
  expect(result.headers.get('etag')).toBe(etag)
})

it('cancels the upstream body when Hono serves a HEAD request', async () => {
  const cancel = vi.fn()
  const pull = vi.fn()
  const stream = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(stream, { headers: { etag: '"upstream"' } })),
  )
  const response = await app().app.request('/apps', { method: 'HEAD' })
  expect(response.status).toBe(200)
  expect(response.body).toBeNull()
  expect(response.headers.get('etag')).toBe('"upstream"')
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(pull).not.toHaveBeenCalled()
})

it('preserves upstream errors and redirects, without generating ETags', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('not JSON', { status: 429, headers: { 'retry-after': '30', 'content-type': 'text/plain' } }))
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/' } }))
  vi.stubGlobal('fetch', fetcher)
  const test = app()
  const error = await test.app.request('/actions')
  expect(error.status).toBe(429)
  expect(await error.text()).toBe('not JSON')
  expect(error.headers.get('retry-after')).toBe('30')
  expect(error.headers.get('etag')).toBeNull()
  const redirect = await test.app.request('/apps')
  expect(redirect.status).toBe(302)
  expect(redirect.headers.get('location')).toBe('https://elsewhere.example/')
  expect(fetcher.mock.calls[1]![1].redirect).toBe('manual')
  expect(new Headers(fetcher.mock.calls[1]![1].headers).has('x-oo-team-id')).toBe(false)
})

it.each([
  [false, true, '/apps', 'connector.unconfigured'],
  [true, false, '/apps', 'authentication.required'],
  [true, true, '/apps?flowId=', 'flow.invalid'],
  [true, true, '/apps?flowId=a&flowId=b', 'flow.invalid'],
  [true, true, '/apps?flowId=missing', 'flow.not-found'],
] as const)('rejects local errors before fetching (%s, %s, %s)', async (configured, authenticated, route, code) => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const response = await app(configured, authenticated).app.request(route)
  expect((await response.json()).error.code).toBe(code)
  expect(fetcher).not.toHaveBeenCalled()
})

it('maps transport and timeout failures, and propagates caller cancellation', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  expect((await (await app().app.request('/providers')).json()).error.code).toBe('connector.unavailable')
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (_url, init: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          if (init.signal?.aborted) reject(init.signal.reason)
          else init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        }),
    ),
  )
  await expect(forwardConnector(configuration, 'apps', new Request('https://flow.example/apps'), undefined, { timeoutMs: 5 })).rejects.toMatchObject({
    code: 'connector.unavailable',
  })
  const controller = new AbortController()
  const pending = forwardConnector(configuration, 'apps', new Request('https://flow.example/apps', { signal: controller.signal }))
  controller.abort(new Error('caller cancelled'))
  await expect(pending).rejects.toThrow('caller cancelled')
})

it('handles real fetch decompression and removes hop-by-hop headers', async () => {
  const raw = '{ "success": true, "data": [] }\n'
  const server = createServer((_request, response) => {
    const body = gzipSync(raw)
    response.writeHead(200, {
      'content-encoding': 'gzip',
      'content-length': body.length,
      'etag': '"compressed"',
      'connection': 'close, x-hop',
      'x-hop': 'private',
    })
    response.end(body)
  })
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address == null || typeof address == 'string') throw new Error('Missing server address')
    const result = await forwardConnector({ origin: `http://127.0.0.1:${address.port}`, token: '' }, 'providers', new Request('http://flow.example/providers'))
    expect(await result.text()).toBe(raw)
    expect(result.headers.get('etag')).toBe('"compressed"')
    for (const header of ['content-encoding', 'content-length', 'connection', 'x-hop']) expect(result.headers.has(header)).toBe(false)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
  expect(server.listening).toBe(false)
})

it('returns headers before reading and streams large bodies with backpressure and cancellation', async () => {
  let reads = 0
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        reads++
        controller.enqueue(new Uint8Array(1024 * 1024))
      },
      cancel,
    },
    { highWaterMark: 0 },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(stream)),
  )
  const response = await forwardConnector(configuration, 'actions', new Request('http://flow.example/actions'))
  expect(reads).toBe(0)
  const reader = response.body!.getReader()
  for (let i = 0; i < 10; i++) expect((await reader.read()).value!.byteLength).toBe(1024 * 1024)
  expect(reads).toBe(10)
  await reader.cancel('downstream disconnected')
  expect(cancel).toHaveBeenCalledWith('downstream disconnected')
  reader.releaseLock()
})

it('propagates upstream body failures after headers without replacing the response', async () => {
  const failure = new Error('upstream disconnected')
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        controller.error(failure)
      },
    },
    { highWaterMark: 0 },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(stream, { headers: { etag: '"original"' } })),
  )
  const response = await forwardConnector(configuration, 'apps', new Request('http://flow.example/apps'))
  expect(response.status).toBe(200)
  expect(response.headers.get('etag')).toBe('"original"')
  await expect(response.text()).rejects.toBe(failure)
})

it.each(['timeout', 'cancel'] as const)('interrupts a real upstream body after headers on %s', async (mode) => {
  const server = createServer((_request, response) => {
    response.writeHead(200)
    response.write('first chunk')
  })
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address == null || typeof address == 'string') throw new Error('Missing server address')
    const controller = new AbortController()
    const response = await forwardConnector(
      { origin: `http://127.0.0.1:${address.port}`, token: '' },
      'apps',
      new Request('http://flow.example/apps', { signal: controller.signal }),
      undefined,
      { timeoutMs: mode == 'timeout' ? 200 : 30_000 },
    )
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first chunk')
    const pending = reader.read()
    if (mode == 'cancel') controller.abort()
    await expect(pending).rejects.toThrow()
    reader.releaseLock()
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
  expect(server.listening).toBe(false)
})
