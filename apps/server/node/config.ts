import { Hono } from 'hono'
import { serverErrorCode } from './error.ts'
import { Settings } from './settings.ts'

const maxRequestBytes = 4 * 1024
const encoder = new TextEncoder()

export function createConfigApp(settings: Settings, authenticate: (request: Request) => Promise<string>, changed: () => void = () => {}): Hono {
  const app = new Hono()
  app.use('*', async (context, next) => {
    await authenticate(context.req.raw)
    await next()
  })
  app.get('/', () => json(200, settings.status()))
  app.put('/connector', async (context) => {
    const body = await objectRequest(context.req.raw)
    if (!runtimeRequest(body)) return invalid()
    let result
    try {
      result = settings.putConnector(Number(body.expectedRevision), body.origin, body.token)
    } catch {
      return invalid()
    }
    return updated(result, settings, changed)
  })
  app.delete('/connector', async (context) => {
    const body = await objectRequest(context.req.raw)
    if (!deleteRequest(body)) return invalid()
    return updated(settings.deleteConnector(Number(body.expectedRevision)), settings, changed)
  })
  app.put('/connector-console', async (context) => {
    const body = await objectRequest(context.req.raw)
    if (
      body == null ||
      Object.keys(body).length != 3 ||
      body.version !== 1 ||
      !Number.isSafeInteger(body.expectedRevision) ||
      Number(body.expectedRevision) <= 0 ||
      typeof body.origin != 'string'
    ) {
      return invalid()
    }
    let result
    try {
      result = settings.putConnectorConsole(Number(body.expectedRevision), body.origin)
    } catch {
      return invalid()
    }
    return updated(result, settings, changed)
  })
  app.delete('/connector-console', async (context) => {
    const body = await objectRequest(context.req.raw)
    if (!deleteRequest(body)) return invalid()
    return updated(settings.deleteConnectorConsole(Number(body.expectedRevision)), settings, changed)
  })
  app.put('/integration', async (context) => {
    const body = await objectRequest(context.req.raw)
    if (
      body == null ||
      Object.keys(body).length != 4 ||
      body.version !== 1 ||
      !Number.isSafeInteger(body.expectedRevision) ||
      Number(body.expectedRevision) <= 0 ||
      typeof body.publicOrigin != 'string' ||
      typeof body.callbackKey != 'string'
    ) {
      return invalid()
    }
    let result
    try {
      result = settings.putIntegration(Number(body.expectedRevision), body.publicOrigin, body.callbackKey)
    } catch {
      return invalid()
    }
    return updated(result, settings, changed)
  })
  app.delete('/integration', async (context) => {
    const body = await objectRequest(context.req.raw)
    if (!deleteRequest(body)) return invalid()
    return updated(settings.deleteIntegration(Number(body.expectedRevision)), settings, changed)
  })
  app.put('/llm', async (context) => {
    const body = await objectRequest(context.req.raw)
    if (!runtimeRequest(body)) return invalid()
    let result
    try {
      result = settings.putLlm(Number(body.expectedRevision), body.origin, body.token)
    } catch {
      return invalid()
    }
    return updated(result, settings, changed)
  })
  app.delete('/llm', async (context) => {
    const body = await objectRequest(context.req.raw)
    if (!deleteRequest(body)) return invalid()
    return updated(settings.deleteLlm(Number(body.expectedRevision)), settings, changed)
  })
  return app
}

function runtimeRequest(
  body: Record<string, unknown> | undefined,
): body is { readonly expectedRevision: number; readonly origin: string; readonly token: string; readonly version: 1 } {
  return (
    body != null &&
    Object.keys(body).length == 4 &&
    body.version === 1 &&
    Number.isSafeInteger(body.expectedRevision) &&
    Number(body.expectedRevision) > 0 &&
    typeof body.origin == 'string' &&
    typeof body.token == 'string'
  )
}

function deleteRequest(body: Record<string, unknown> | undefined): body is Record<'expectedRevision' | 'version', number> {
  return body != null && Object.keys(body).length == 2 && body.version === 1 && Number.isSafeInteger(body.expectedRevision) && Number(body.expectedRevision) > 0
}

function updated(result: 'conflict' | 'environment' | 'saved', settings: Settings, changed: () => void): Response {
  if (result == 'environment') return environment()
  if (result == 'conflict') return conflict()
  changed()
  return json(200, settings.status())
}

async function objectRequest(request: Request): Promise<Record<string, unknown> | undefined> {
  if (request.body == null) return
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request.body) {
    size += chunk.byteLength
    if (size > maxRequestBytes) return
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    return
  }
  return value != null && typeof value == 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function invalid(): Response {
  return json(400, { error: { code: serverErrorCode.requestInvalid, message: 'Configuration request is invalid.' }, version: 1 })
}

function environment(): Response {
  return json(409, { error: { code: serverErrorCode.configurationEnvironmentManaged, message: 'Configuration is managed by the environment.' }, version: 1 })
}

function conflict(): Response {
  return json(409, { error: { code: serverErrorCode.configurationConflict, message: 'Configuration changed.' }, version: 1 })
}

function json(status: number, body: unknown): Response {
  const source = JSON.stringify(body)
  return new Response(source, {
    headers: {
      'cache-control': 'no-store',
      'content-length': String(encoder.encode(source).byteLength),
      'content-type': 'application/json; charset=utf-8',
    },
    status,
  })
}
