import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { HttpRequestConfig } from '@oomol-lab/open-flow/http-request'
import type { HttpFailure } from './http-transport.ts'

import { buildHttpRequest, parseHttpResponse } from '@oomol-lab/open-flow/http-request'
import { HttpTaskError, executeHttpTransport } from './http-transport.ts'

const failure = (code: HttpFailure, message: string, retryable = false) => new HttpTaskError(`http-request.${code}`, message, retryable)
export async function executeHttpRequest(
  config: HttpRequestConfig,
  input: Readonly<Record<string, JsonValue>>,
  signal: AbortSignal,
  request = fetch,
): Promise<Readonly<Record<string, JsonValue>>> {
  let built: ReturnType<typeof buildHttpRequest>
  try {
    built = buildHttpRequest(config, input)
  } catch {
    throw failure('input-invalid', 'The HTTP request configuration or inputs are invalid.')
  }
  const { response, body } = await executeHttpTransport(built, signal, config.statusPolicy == 'all', failure, request)
  try {
    return parseHttpResponse(config, response.status, response.headers, body)
  } catch {
    throw failure('response-invalid', 'The HTTP response could not be parsed in the selected format.')
  }
}
