import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { OpenApiExecutor } from '@oomol-lab/open-flow/openapi'
import type { HttpFailure } from './http-transport.ts'

import { buildRequest, httpUrl, parseOpenApi, parseResponse } from '@oomol-lab/open-flow/openapi'
import { HttpTaskError, executeHttpTransport, readHttpBody } from './http-transport.ts'

export class OpenApiTaskError extends HttpTaskError {
  declare readonly code: `openapi.${HttpFailure}`
  constructor(code: OpenApiTaskError['code'], message: string, retryable = false) {
    super(code, message, retryable)
    this.name = 'OpenApiTaskError'
  }
}
const failure = (code: HttpFailure, message: string, retryable = false) => new OpenApiTaskError(`openapi.${code}`, message, retryable)
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
    return parseOpenApi(JSON.parse(await readHttpBody(response, failure)))
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
  const { response, body } = await executeHttpTransport(built, signal, false, failure, request)
  try {
    return parseResponse(config, response.status, response.headers, body)
  } catch {
    throw new OpenApiTaskError('openapi.response-invalid', 'The API response does not match the saved definition.')
  }
}
