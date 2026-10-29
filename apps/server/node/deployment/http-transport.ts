export type HttpFailure = 'input-invalid' | 'response-invalid' | 'http-failed' | 'indeterminate' | 'limit-exceeded'
export class HttpTaskError extends Error {
  readonly retryable: boolean
  readonly code: `http-request.${HttpFailure}` | `openapi.${HttpFailure}`
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
export async function readHttpBody(response: Response, failure: FailureFactory): Promise<string> {
  if (Number(response.headers.get('content-length')) > maximumBytes) {
    await response.body?.cancel()
    throw failure('limit-exceeded', 'Response exceeds 4 MiB.')
  }
  const reader = response.body?.getReader()
  if (reader == null) return ''
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximumBytes) throw failure('limit-exceeded', 'Response exceeds 4 MiB.')
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
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
