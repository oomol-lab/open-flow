import type { JsonValue, TriggerNode, WaitAction } from '@oomol-lab/open-flow/flow-change'
import type { Logger } from 'pino'
import type { ResolveControlActor } from './control.ts'
import type { OperatorSession } from './operator.ts'
import type { Settings } from './settings.ts'

import { serveStatic } from '@hono/node-server/serve-static'
import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { resourceNameIssue } from '@oomol-lab/open-flow/flow-change'
import { integrationEndpointId } from '@oomol-lab/open-flow/integration-trigger'
import { maximumWebhookBodyBytes, webhookEndpointId, webhookOccurrenceId } from '@oomol-lab/open-flow/webhook-trigger'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { createConfigApp } from './config.ts'
import { createControlApp } from './control.ts'
import { AcceptanceError, ControlError, serverErrorCode } from './error.ts'
import { handleIntegration } from './integration.ts'
import { errorKind, silentLogger } from './logger.ts'
import { createOperatorApp } from './operator.ts'
import { serverPaths } from './server-paths.ts'
import { ServerService } from './service.ts'

const defaultWebhookMethods = ['POST'] as const
const nullBodyStatuses = new Set([204, 205, 304])
const forbiddenWebhookResponseHeaders = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'content-security-policy',
  'location',
  'refresh',
  'set-cookie',
  'strict-transport-security',
  'transfer-encoding',
  'x-accel-redirect',
  'x-reproxy-url',
  'x-sendfile',
])
const reservedPaths = ['/assets', ...serverPaths] as const
const encoder = new TextEncoder()
const defaultCallbackRequestsPerMinute = 120
const maximumHostRequestBytes = 4 * 1024

interface CallbackWindow {
  count: number
  resetAt: number
}

interface ServerAppOptions {
  readonly callbackRequestsPerMinute?: number
  readonly logger?: Logger
  readonly operator?: OperatorSession
  readonly operatorLoginAttemptsPerMinute?: number
  readonly publicDirectory?: string
  readonly resolveControlActor?: ResolveControlActor
  readonly settings?: Settings
  readonly shutdownSignal?: AbortSignal
}

interface AppEnv {
  readonly Variables: {
    readonly errorCode?: string
    readonly requestId: string
  }
}

export function createServerApp(service: ServerService, options: ServerAppOptions = {}): Hono<AppEnv> {
  const callbackRequestsPerMinute = options.callbackRequestsPerMinute ?? defaultCallbackRequestsPerMinute
  if (!Number.isSafeInteger(callbackRequestsPerMinute) || callbackRequestsPerMinute <= 0) {
    throw new TypeError('Callback requests per minute must be a positive safe integer.')
  }
  const app = new Hono<AppEnv>()
  const callbackWindows = new Map<string, CallbackWindow>()
  const logger = (options.logger ?? silentLogger).child({ component: 'http' })
  const operator = options.operator
  const resolveActor = operator == null ? options.resolveControlActor : (request: Request) => operator.actor(request)

  app.use('*', async (context, next) => {
    const startedAt = performance.now()
    const requestId = safeRequestId(context.req.header('x-request-id')) ?? randomUUID()
    context.set('requestId', requestId)
    await next()
    context.header('x-request-id', requestId)
    context.header('cross-origin-opener-policy', 'same-origin')
    context.header('permissions-policy', 'camera=(), geolocation=(), microphone=()')
    context.header('referrer-policy', 'no-referrer')
    context.header('x-content-type-options', 'nosniff')
    context.header('x-frame-options', 'DENY')
    const fields = {
      category: 'http.request.completed',
      durationMs: Math.round(performance.now() - startedAt),
      ...(context.get('errorCode') == null ? {} : { errorCode: context.get('errorCode') }),
      method: context.req.method,
      path: logPath(context.req.path),
      requestId,
      status: context.res.status,
    }
    if (context.res.status >= 500) logger.warn(fields, 'HTTP request completed with a server error.')
    else logger.trace(fields, 'HTTP request completed.')
  })

  app.route('/auth', createOperatorApp(operator, options.operatorLoginAttemptsPerMinute))
  const admitCallback = (key: string): number | undefined => callbackRetryAfter(callbackWindows, key, callbackRequestsPerMinute, Date.now())
  app.all('/v1/integrations', (context) => integration(service, context.req.raw, logger, context.get('requestId'), admitCallback))
  app.all('/v1/integrations/*', (context) => integration(service, context.req.raw, logger, context.get('requestId'), admitCallback))
  app.all('/v1/webhooks', (context) => webhook(service, context.req.raw, logger, context.get('requestId'), admitCallback))
  app.all('/v1/webhooks/*', (context) => webhook(service, context.req.raw, logger, context.get('requestId'), admitCallback))
  const authenticate = async (request: Request): Promise<string> => {
    const actor = await resolveActor?.(request)
    if (actor == null || actor.length == 0) throw new ControlError(controlErrorCode.authenticationRequired, 'Authentication is required.')
    return actor
  }
  app.get('/v1/flows/notifications', async (context) => {
    await authenticate(context.req.raw)
    return notificationResponse(notifications((listener) => service.subscribeFlowCatalog(listener), [context.req.raw.signal, options.shutdownSignal]))
  })
  app.get('/v1/flows/:flowId/notifications', async (context) => {
    await authenticate(context.req.raw)
    return notificationResponse(
      notifications((listener) => service.subscribeFlow(context.req.param('flowId'), listener), [context.req.raw.signal, options.shutdownSignal]),
    )
  })
  app.all('/v1/wait-actions/:capability/:action', (context) => {
    const method = context.req.method
    if (method != 'GET' && method != 'HEAD' && method != 'POST') {
      const response = json(405, { error: { code: 'wait-action.method-not-allowed', message: 'Method is not allowed.' }, version: 1 })
      response.headers.set('allow', 'GET, HEAD, POST')
      response.headers.set('cache-control', 'no-store')
      return response
    }
    const capability = context.req.param('capability')
    const action = context.req.param('action')
    const requested = action == 'approve' || action == 'continue' || action == 'reject' ? (action satisfies WaitAction) : undefined
    const retryAfter = admitCallback('wait-action')
    if (retryAfter != null) {
      const response = json(429, { error: { code: 'wait-action.rate-limited', message: 'Too many requests.' }, version: 1 })
      response.headers.set('cache-control', 'no-store')
      response.headers.set('retry-after', String(retryAfter))
      return response
    }
    const result =
      requested == null || !/^[A-Za-z0-9_-]{43}$/.test(capability)
        ? undefined
        : method == 'POST'
          ? service.resolveWaitAction(capability, requested)
          : service.inspectWaitAction(capability, requested)
    const response =
      result == null
        ? json(404, { error: { code: 'wait-action.not-found', message: 'Wait action was not found.' }, version: 1 })
        : json(200, { ...result, version: 1 })
    response.headers.set('cache-control', 'no-store')
    return method == 'HEAD' ? new Response(null, { headers: response.headers, status: response.status }) : response
  })
  app.route('/v1', createControlApp(service.control, resolveActor))
  if (options.settings != null)
    app.route(
      '/config',
      createConfigApp(options.settings, authenticate, () => service.configurationChanged()),
    )
  app.get('/connector/teams', async (context) => {
    await authenticate(context.req.raw)
    return json(200, await service.connectorTeams(context.req.raw.signal))
  })
  app.post('/connector/flows', async (context) => {
    const actorId = await authenticate(context.req.raw)
    const input = await connectorFlowRequest(context.req.raw)
    if (input === false) throw new ControlError(serverErrorCode.requestInvalid, 'Connector Flow request is invalid.')
    const key = context.req.header('idempotency-key')
    if (key == null || key.length == 0 || key.length > 256) throw new ControlError(serverErrorCode.requestInvalid, 'Idempotency-Key is invalid.')
    const created = await service.control.createFlow(actorId, input.name, key, input.teamId)
    return json(created.created ? 201 : 200, created.flow)
  })

  app.get('/healthz', () => json(200, { status: 'ok' }))
  app.get('/readyz', async () => {
    const ready = await service.ready()
    return json(ready ? 200 : 503, { status: ready ? 'ready' : 'not-ready' })
  })
  if (options.publicDirectory != null) {
    app.use(
      '/assets/*',
      serveStatic({
        onFound: (_path, context) => context.res.headers.set('cache-control', 'public, max-age=31536000, immutable'),
        root: options.publicDirectory,
      }),
    )
    const index = serveStatic({
      path: 'index.html',
      root: options.publicDirectory,
    })
    app.get('*', async (context, next) => {
      if (reserved(context.req.path) || !acceptsHtml(context.req.header('accept'))) return await next()
      const response = await index(context, next)
      response?.headers.set('cache-control', 'no-cache')
      return response
    })
  }

  app.notFound(routeNotFound)
  app.onError((error, context) => {
    if (error instanceof ControlError) {
      context.set('errorCode', error.code)
      return json(error.status, { error: { code: error.code, message: error.message }, version: 1 })
    }
    if (error instanceof AcceptanceError) {
      context.set('errorCode', error.code)
      const status = error.code == 'revision-conflict' ? 409 : 422
      return json(status, { error: { code: error.code, message: error.message } })
    }
    context.set('errorCode', serverErrorCode.internal)
    logger.error(
      {
        category: 'http.request.failed',
        err: error,
        method: context.req.method,
        path: logPath(context.req.path),
        requestId: context.get('requestId'),
      },
      'HTTP request failed.',
    )
    return json(500, { error: { code: serverErrorCode.internal, message: 'The request could not be completed.' } })
  })
  return app
}

function notificationResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: { 'cache-control': 'no-cache', 'connection': 'keep-alive', 'content-type': 'text/event-stream' },
  })
}

function notifications<Event>(
  subscribe: (listener: (event: Event) => void) => () => void,
  signals: readonly (AbortSignal | undefined)[],
): ReadableStream<Uint8Array> {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let closed = false
  let unsubscribe: (() => void) | undefined
  const cleanup = (): void => {
    if (closed) return
    closed = true
    for (const signal of signals) signal?.removeEventListener('abort', abort)
    unsubscribe?.()
  }
  const abort = (): void => {
    if (closed) return
    cleanup()
    controller?.close()
  }
  return new ReadableStream({
    cancel() {
      cleanup()
    },
    start(streamController) {
      controller = streamController
      unsubscribe = subscribe((event) => {
        if (!closed) streamController.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      })
      if (signals.some((signal) => signal?.aborted)) return abort()
      for (const signal of signals) signal?.addEventListener('abort', abort, { once: true })
      streamController.enqueue(encoder.encode(': connected\n\n'))
    },
  })
}

function safeRequestId(value: string | undefined): string | undefined {
  return value != null && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : undefined
}

function logPath(path: string): string {
  if (path.startsWith('/v1/wait-actions/')) return '/v1/wait-actions/:capability/:action'
  if (path.startsWith('/v1/webhooks/')) return '/v1/webhooks/:endpointId'
  if (path.startsWith('/v1/integrations/')) return '/v1/integrations/:endpointId'
  return path
}

function reserved(path: string): boolean {
  return reservedPaths.some((prefix) => path == prefix || path.startsWith(`${prefix}/`))
}

function acceptsHtml(accept: string | undefined): boolean {
  return accept == null || accept.split(',').some((value) => ['*/*', 'text/*', 'text/html'].includes(value.split(';', 1)[0]!.trim()))
}

class WebhookBodyTooLarge extends Error {}
class WebhookRequestInvalid extends Error {}

async function integration(
  service: ServerService,
  request: Request,
  logger: Logger,
  requestId: string,
  admitCallback: (key: string) => number | undefined,
): Promise<Response> {
  const endpointId = integrationEndpointId(new URL(request.url))
  return endpointId == null
    ? plain(404)
    : await handleIntegration(service, endpointId, request, logger, requestId, () => admitCallback(`integration:${endpointId}`))
}

async function webhook(
  service: ServerService,
  request: Request,
  logger: Logger,
  requestId: string,
  admitCallback: (key: string) => number | undefined,
): Promise<Response> {
  const endpointId = webhookEndpointId(new URL(request.url))
  if (endpointId == null) return plain(404)
  let origin: string | undefined
  try {
    const target = service.webhookTarget(endpointId)
    if (target == null) return plain(404)
    const retryAfter = admitCallback(`webhook:${endpointId}`)
    if (retryAfter != null) return plain(429, { 'retry-after': String(retryAfter) })
    const methods = (target.trigger.options?.allowedMethods ?? defaultWebhookMethods).map((method) => method.toUpperCase())
    const requestOrigin = requestHeader(request, 'origin')
    origin = corsOrigin(requestOrigin, target.trigger.options?.allowedOrigins)
    const preflightResponse = preflight(request, methods, origin)
    if (preflightResponse != null) return preflightResponse
    if (requestOrigin != null && origin == null) return plain(403)
    const method = request.method
    if (!methods.includes(method)) return plain(405, { allow: methods.join(', ') }, origin)

    const payload = await readWebhookPayload(request)
    const occurrenceId = await webhookOccurrenceId(endpointId, target.runtimeVersion, requestHeader(request, 'idempotency-key') ?? null)
    if (occurrenceId == null) throw new WebhookRequestInvalid()
    const accepted = await service.acceptWebhookTarget(target, occurrenceId, payload)
    if (accepted == null) return plain(404)
    if (accepted.kind == 'conflict') return plain(409, undefined, origin)
    if (accepted.kind == 'overloaded') return plain(429, undefined, origin)
    return webhookSuccess(method, target.trigger, origin)
  } catch (error) {
    if (error instanceof WebhookBodyTooLarge) return plain(413, undefined, origin)
    if (error instanceof WebhookRequestInvalid || (error instanceof AcceptanceError && error.code == 'trigger-payload-invalid')) {
      return plain(400, undefined, origin)
    }
    logger.error({ category: 'webhook.request.failed', requestId, ...errorKind(error) }, 'Webhook request failed.')
    return plain(503, undefined, origin)
  }
}

function callbackRetryAfter(windows: Map<string, CallbackWindow>, key: string, limit: number, now: number): number | undefined {
  const current = windows.get(key)
  if (current == null || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + 60_000 })
    return
  }
  if (current.count >= limit) return Math.max(1, Math.ceil((current.resetAt - now) / 1_000))
  current.count += 1
}

function corsOrigin(origin: string | undefined, allowedOrigins: readonly string[] | undefined): string | undefined {
  if (origin == null) return
  if (allowedOrigins?.includes('*')) return '*'
  if (allowedOrigins?.includes(origin)) return origin
}

function preflight(request: Request, methods: readonly string[], origin: string | undefined): Response | undefined {
  const requestedMethod = requestHeader(request, 'access-control-request-method')?.toUpperCase()
  if (request.method != 'OPTIONS' || requestedMethod == null) return
  if (origin == null || !methods.includes(requestedMethod)) return plain(403)
  const headers = new Headers({
    'access-control-allow-methods': methods.join(', '),
    'access-control-max-age': '600',
    'vary': 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
  })
  const requestedHeaders = requestHeader(request, 'access-control-request-headers')
  if (requestedHeaders != null) headers.set('access-control-allow-headers', requestedHeaders)
  return plain(204, headers, origin)
}

function webhookSuccess(method: string, trigger: Extract<TriggerNode, { readonly kind: 'webhook' }>, origin: string | undefined): Response {
  const status = trigger.options?.responseStatusCode ?? 200
  const headers = new Headers(trigger.options?.responseHeaders)
  for (const name of forbiddenWebhookResponseHeaders) headers.delete(name)
  for (const name of headers.keys()) if (name.startsWith('access-control-')) headers.delete(name)
  headers.set('cache-control', 'no-store')
  headers.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'; sandbox")
  headers.set('content-type', 'text/plain;charset=UTF-8')
  headers.set('referrer-policy', 'no-referrer')
  headers.set('x-content-type-options', 'nosniff')
  headers.set('x-frame-options', 'DENY')
  withOrigin(headers, origin)
  const body = trigger.options?.noResponseBody || method == 'HEAD' || nullBodyStatuses.has(status) ? null : (trigger.options?.responseData ?? null)
  return text(status, body, headers)
}

function plain(status: number, headers?: Headers | Readonly<Record<string, string>>, origin?: string): Response {
  const values = new Headers(headers)
  values.set('cache-control', 'no-store')
  withOrigin(values, origin)
  return text(status, null, values)
}

function withOrigin(headers: Headers, origin: string | undefined): void {
  if (origin == null) return
  headers.set('access-control-allow-origin', origin)
  if (
    !headers
      .get('vary')
      ?.split(',')
      .some((value) => value.trim().toLowerCase() == 'origin')
  ) {
    headers.append('vary', 'Origin')
  }
}

function requestHeader(request: Request, name: string): string | undefined {
  return request.headers.get(name) ?? undefined
}

async function readWebhookPayload(request: Request): Promise<JsonValue> {
  const source = new TextDecoder().decode(await readBody(request, maximumWebhookBodyBytes, () => new WebhookBodyTooLarge()))
  if (source.length == 0) return {}
  try {
    return JSON.parse(source) as JsonValue
  } catch {
    throw new WebhookRequestInvalid()
  }
}

async function connectorFlowRequest(request: Request): Promise<{ readonly name: string; readonly teamId: string } | false> {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(await readBody(request, maximumHostRequestBytes, () => new Error('Host request is too large.')))) as unknown
  } catch {
    return false
  }
  if (value == null || typeof value != 'object' || Array.isArray(value)) return false
  const body = value as Record<string, unknown>
  if (
    Object.keys(body).length != 3 ||
    body.version !== 1 ||
    typeof body.name != 'string' ||
    body.name != body.name.trim() ||
    resourceNameIssue(body.name) != null ||
    typeof body.teamId != 'string' ||
    body.teamId.length == 0
  ) {
    return false
  }
  return { name: body.name, teamId: body.teamId }
}

function text(status: number, body: string | null, headers: Headers): Response {
  if (body != null) {
    if (!headers.has('content-type')) headers.set('content-type', 'text/plain;charset=UTF-8')
    headers.set('content-length', String(encoder.encode(body).byteLength))
  }
  return new Response(body, { headers, status })
}

async function readBody(request: Request, limit: number, tooLarge: () => Error): Promise<Uint8Array> {
  if (request.body == null) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request.body) {
    size += chunk.byteLength
    if (size > limit) throw tooLarge()
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function json(status: number, body: unknown): Response {
  const source = JSON.stringify(body)
  return new Response(source, {
    headers: { 'content-length': String(encoder.encode(source).byteLength), 'content-type': 'application/json; charset=utf-8' },
    status,
  })
}

function routeNotFound(): Response {
  return json(404, { error: { code: controlErrorCode.routeNotFound, message: 'Route was not found.' } })
}
