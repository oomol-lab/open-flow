import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { OpenApiExecutor } from '@oomol-lab/open-flow/openapi'

import { buildRequest, httpUrl, parseOpenApi, parseResponse } from '@oomol-lab/open-flow/openapi'

export class OpenApiTaskError extends Error {
  readonly code: 'openapi.input-invalid' | 'openapi.response-invalid' | 'openapi.http-failed' | 'openapi.indeterminate' | 'openapi.limit-exceeded'
  readonly retryable: boolean
  constructor(code: OpenApiTaskError['code'], message: string, retryable = false) {
    super(message)
    this.name = 'OpenApiTaskError'
    this.code = code
    this.retryable = retryable
  }

  get catchable(): boolean {
    return this.code != 'openapi.indeterminate' && this.code != 'openapi.limit-exceeded'
  }

  get indeterminate(): boolean {
    return this.code == 'openapi.indeterminate'
  }
}

const maximumBytes = 4 * 1024 * 1024
async function readBody(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > maximumBytes) {
    await response.body?.cancel()
    throw new OpenApiTaskError('openapi.limit-exceeded', 'Response exceeds 4 MiB.')
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
      if (size > maximumBytes) throw new OpenApiTaskError('openapi.limit-exceeded', 'Response exceeds 4 MiB.')
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}
export async function loadOpenApiDocument(url: string, signal?: AbortSignal, request = fetch): Promise<JsonValue> {
  const target = httpUrl(url)
  try {
    const response = await request(target, {
      headers: { accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal == null ? [] : [signal])]),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Document request failed with HTTP ${response.status}.`)
    }
    return parseOpenApi(JSON.parse(await readBody(response)))
  } catch {
    throw new Error('Unable to load an OpenAPI 3.0/3.1 JSON document. Check the address, size and server response.')
  }
}
export async function executeOpenApi(
  config: OpenApiExecutor,
  input: Readonly<Record<string, JsonValue>>,
  signal: AbortSignal,
  request = fetch,
): Promise<Readonly<Record<string, JsonValue>>> {
  let built: ReturnType<typeof buildRequest>
  try {
    built = buildRequest(config, input)
  } catch {
    throw new OpenApiTaskError('openapi.input-invalid', 'The API request configuration or inputs are invalid.')
  }
  const { url, init } = built
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)])
  let response: Response
  try {
    response = await request(url, { ...init, signal: requestSignal })
  } catch (error) {
    if (requestSignal.aborted) throw requestSignal.reason
    if (error instanceof OpenApiTaskError) throw error
    if (['GET', 'HEAD', 'OPTIONS'].includes(config.method.toUpperCase()))
      throw new OpenApiTaskError('openapi.http-failed', 'The API request failed before a response was received.', true)
    throw new OpenApiTaskError('openapi.indeterminate', 'The API request outcome could not be confirmed.')
  }
  const httpFailure = response.ok
    ? undefined
    : new OpenApiTaskError('openapi.http-failed', `API request failed with HTTP ${response.status}.`, response.status == 429 || response.status >= 500)
  let body: string
  try {
    body = await readBody(response)
  } catch (error) {
    if (requestSignal.aborted) throw requestSignal.reason
    if (error instanceof OpenApiTaskError) throw error
    if (httpFailure) throw httpFailure
    throw new OpenApiTaskError('openapi.response-invalid', 'The API response body could not be read.')
  }
  if (httpFailure) throw httpFailure
  try {
    return parseResponse(config, response.status, response.headers, body)
  } catch {
    throw new OpenApiTaskError('openapi.response-invalid', 'The API response does not match the saved definition.')
  }
}
