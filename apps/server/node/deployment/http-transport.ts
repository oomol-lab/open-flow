export type HttpFailure = 'input-invalid' | 'response-invalid' | 'http-failed' | 'indeterminate' | 'limit-exceeded'
export class HttpTaskError extends Error {
  readonly retryable: boolean
  readonly code: `http-request.${HttpFailure}` | `openapi.${HttpFailure}` | `http.${HttpFailure}`
  constructor(code: HttpTaskError['code'], message: string, retryable = false) {
    super(message)
    this.name = 'HttpTaskError'
    this.code = code
    this.retryable = retryable
  }
  get catchable(): boolean {
    return !this.code.endsWith('.indeterminate') && !this.code.endsWith('.limit-exceeded')
  }
  get indeterminate(): boolean {
    return this.code.endsWith('.indeterminate')
  }
}
type FailureFactory = (code: HttpFailure, message: string, retryable?: boolean) => HttpTaskError
const maximumBytes = 4 * 1024 * 1024
/** Reads a complete response body, failing with `limit-exceeded` once it exceeds `limit` bytes. */
export async function readHttpBytes(response: Response, failure: FailureFactory, limit = maximumBytes): Promise<Uint8Array> {
  const message = `Response exceeds ${limit / 1024 / 1024} MiB.`
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel()
    throw failure('limit-exceeded', message)
  }
  const reader = response.body?.getReader()
  if (reader == null) return new Uint8Array()
  const parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw failure('limit-exceeded', message)
      parts.push(value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return bytes
}
export async function readHttpBody(response: Response, failure: FailureFactory): Promise<string> {
  return new TextDecoder('utf-8', { fatal: true }).decode(await readHttpBytes(response, failure))
}
/** Server-side HTTP policy shared by explicit HTTP nodes and OpenAPI operations. */
export async function executeHttpTransport(
  built: { url: string; init: RequestInit },
  signal: AbortSignal,
  acceptAllStatuses: boolean,
  failure: FailureFactory,
  request = fetch,
): Promise<{ response: Response; body: string }> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)])
  let response: Response
  try {
    response = await request(built.url, { ...built.init, signal: requestSignal, redirect: 'manual' })
  } catch (error) {
    if (requestSignal.aborted) throw requestSignal.reason
    if (error instanceof HttpTaskError) throw error
    if (['GET', 'HEAD', 'OPTIONS'].includes((built.init.method ?? 'GET').toUpperCase()))
      throw failure('http-failed', 'The API request failed before a response was received.', true)
    throw failure('indeterminate', 'The API request outcome could not be confirmed.')
  }
  const httpFailure =
    response.ok || acceptAllStatuses
      ? undefined
      : failure('http-failed', `API request failed with HTTP ${response.status}.`, response.status == 429 || response.status >= 500)
  let body: string
  try {
    body = await readHttpBody(response, failure)
  } catch (error) {
    if (requestSignal.aborted) throw requestSignal.reason
    if (error instanceof HttpTaskError) throw error
    if (httpFailure) throw httpFailure
    throw failure('response-invalid', 'The API response body could not be read.')
  }
  if (httpFailure) throw httpFailure
  return { response, body }
}
