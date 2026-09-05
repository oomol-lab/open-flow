import type { IntegrationBodyFormat, IntegrationEndpointDeclaration, JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { Logger } from 'pino'

import { maximumIntegrationBodyBytes } from '@oomol-lab/open-flow/integration-trigger'
import { errorKind } from './logger.ts'
import { ServerService } from './service.ts'

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
const encoder = new TextEncoder()

class BodyTooLarge extends Error {}
class RequestInvalid extends Error {}

export async function handleIntegration(
  service: ServerService,
  endpointId: string,
  request: Request,
  logger: Logger,
  requestId: string,
  admit: () => number | undefined,
): Promise<Response> {
  try {
    const target = service.integrationTarget(endpointId)
    if (target == null) return plain(404)
    const retryAfter = admit()
    if (retryAfter != null) return plain(429, { 'retry-after': String(retryAfter) })
    const endpoint = target.trigger.definition.endpoint
    const method = request.method
    if (!(endpoint.methods as readonly string[]).includes(method)) {
      return plain(405, { allow: endpoint.methods.join(', ') })
    }
    const body = await payload(request, endpoint)
    const result = await service.receiveIntegrationTarget(
      target,
      {
        headers: request.headers,
        method: method as (typeof endpoint.methods)[number],
        payload: body.value,
        query: new URL(request.url).searchParams,
        rawBody: body.bytes,
      },
      request.signal,
    )
    const headers = new Headers(result.headers)
    if (result.contentType != null) headers.set('content-type', result.contentType)
    return plain(result.status, headers, result.body)
  } catch (error) {
    if (error instanceof BodyTooLarge) return plain(413)
    if (error instanceof RequestInvalid) return plain(400)
    logger.error({ category: 'integration.request.failed', requestId, ...errorKind(error) }, 'Integration request failed.')
    return plain(503)
  }
}

async function payload(request: Request, declaration: IntegrationEndpointDeclaration): Promise<{ readonly bytes: Uint8Array; readonly value: JsonValue }> {
  if (request.method == 'GET' || request.method == 'HEAD') return { bytes: new Uint8Array(), value: {} }
  const format = bodyFormat(request.headers.get('content-type') ?? undefined)
  const bytes = await readBytes(request)
  if (bytes.byteLength == 0 && declaration.body.allowEmpty) return { bytes, value: {} }
  if (!declaration.body.formats.includes(format)) throw new RequestInvalid()
  if (format == 'form') return { bytes, value: form(new URLSearchParams(decoder.decode(bytes))) }
  if (format == 'multipart') return { bytes, value: await multipart(request, bytes) }
  return { bytes, value: json(decoder.decode(bytes), declaration.body.allowArray) }
}

function bodyFormat(contentType: string | undefined): IntegrationBodyFormat {
  const normalized = (contentType ?? '').split(';', 1)[0]!.trim().toLowerCase()
  if (normalized == 'application/x-www-form-urlencoded') return 'form'
  if (normalized == 'multipart/form-data') return 'multipart'
  if (normalized.startsWith('text/')) return 'text'
  return 'json'
}

function form(values: URLSearchParams): JsonValue {
  const result = new Map<string, string | string[]>()
  for (const [name, value] of values) {
    const current = result.get(name)
    if (current == null) result.set(name, value)
    else if (Array.isArray(current)) current.push(value)
    else result.set(name, [current, value])
  }
  if (result.size == 0) throw new RequestInvalid()
  return Object.fromEntries(result)
}

function json(source: string, allowArray: boolean): JsonValue {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new RequestInvalid()
  }
  if (value != null && typeof value == 'object' && (allowArray || !Array.isArray(value))) return value as JsonValue
  throw new RequestInvalid()
}

async function multipart(request: Request, bytes: Uint8Array): Promise<JsonValue> {
  let data: FormData
  try {
    data = await new Request(request.url, {
      body: bytes.buffer as ArrayBuffer,
      headers: request.headers,
      method: request.method,
    }).formData()
  } catch {
    throw new RequestInvalid()
  }
  const values = new URLSearchParams()
  for (const [name, value] of data) if (typeof value == 'string') values.append(name, value)
  return form(values)
}

async function readBytes(request: Request): Promise<Uint8Array> {
  if (request.body == null) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request.body) {
    size += chunk.byteLength
    if (size > maximumIntegrationBodyBytes) throw new BodyTooLarge()
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

function plain(status: number, headers?: Headers | Readonly<Record<string, string>>, body?: string): Response {
  const values = new Headers(headers)
  values.set('cache-control', 'no-store')
  if (body != null) values.set('content-length', String(encoder.encode(body).byteLength))
  return new Response(body ?? null, { headers: values, status })
}
