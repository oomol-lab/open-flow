import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { HttpFailure } from './http-transport.ts'

import { httpHostAllowed, httpRequestUrl } from '@oomol-lab/open-flow/http-request'
import { Buffer } from 'node:buffer'
import { HttpTaskError, readHttpBytes } from './http-transport.ts'

const maximumBytes = 1024 * 1024
const methods: ReadonlySet<string> = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
const reservedHeaders: ReadonlySet<string> = new Set(['connection', 'content-length', 'host', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade'])
const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export class CodeFetchDeniedError extends Error {
  readonly code = 'capability.denied'
  readonly catchable = false
  readonly retryable = false
}

const failure = (code: HttpFailure, message: string, retryable = false) => new HttpTaskError(`http.${code}`, message, retryable)

/**
 * Serves `http.fetch` for a Code node: the URL host must match its declared `http` Capability. Redirects are returned,
 * not followed, no deployment credentials are added, and request and response bodies are limited to 1 MiB.
 */
export async function executeCodeFetch(
  hosts: readonly string[],
  payload: JsonValue,
  signal: AbortSignal,
  request = fetch,
): Promise<Readonly<Record<string, JsonValue>>> {
  const call = payload as { readonly url?: unknown; readonly method?: unknown; readonly headers?: unknown; readonly body?: unknown } | null
  if (call == null || typeof call != 'object' || typeof call.method != 'string' || !methods.has(call.method) || !Array.isArray(call.headers))
    throw failure('input-invalid', 'The fetch request is invalid.')
  let url: URL
  try {
    url = httpRequestUrl(call.url)
  } catch {
    throw failure('input-invalid', 'fetch requires an HTTP(S) URL without credentials.')
  }
  if (!httpHostAllowed(hosts, url.hostname)) throw new CodeFetchDeniedError(`The host "${url.hostname}" is not declared for this Code node.`)
  const headers = new Headers()
  for (const pair of call.headers) {
    if (!Array.isArray(pair) || typeof pair[0] != 'string' || typeof pair[1] != 'string') throw failure('input-invalid', 'Fetch headers are invalid.')
    if (reservedHeaders.has(pair[0].toLowerCase())) throw failure('input-invalid', `The "${pair[0]}" header is managed by the platform.`)
    try {
      headers.append(pair[0], pair[1])
    } catch {
      throw failure('input-invalid', `The "${pair[0]}" header is invalid.`)
    }
  }
  if (call.body !== undefined && (typeof call.body != 'string' || !base64.test(call.body))) throw failure('input-invalid', 'The fetch body is invalid.')
  const body = call.body === undefined ? undefined : Buffer.from(call.body, 'base64')
  if (body != null && body.length > maximumBytes) throw failure('limit-exceeded', 'Fetch request body exceeds 1 MiB.')

  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
  let response: Response
  try {
    response = await request(url, { method: call.method, headers, body, redirect: 'manual', signal: requestSignal })
  } catch {
    if (signal.aborted) throw signal.reason
    throw failure('http-failed', requestSignal.aborted ? 'The HTTP request timed out.' : 'The HTTP request failed before a response was received.', true)
  }
  let content: Uint8Array
  try {
    content = await readHttpBytes(response, failure, maximumBytes)
  } catch (error) {
    if (signal.aborted) throw signal.reason
    if (error instanceof HttpTaskError) throw error
    throw failure('http-failed', 'The HTTP response body could not be read.', true)
  }
  return {
    status: response.status,
    statusText: response.statusText,
    url: url.href,
    headers: [...response.headers].filter(([name]) => name != 'set-cookie'),
    body: Buffer.from(content).toString('base64'),
  }
}
