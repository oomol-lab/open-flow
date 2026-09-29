import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { OpenApiExecutor } from '@oomol-lab/open-flow/openapi'

import { buildRequest, httpUrl, parseOpenApi, parseResponse } from '@oomol-lab/open-flow/openapi'

const maximumBytes = 4 * 1024 * 1024
async function readBody(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > maximumBytes) {
    await response.body?.cancel()
    throw new Error('Response exceeds 4 MiB.')
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
      if (size > maximumBytes) throw new Error('Response exceeds 4 MiB.')
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
    throw new Error('The API request configuration or inputs are invalid.')
  }
  const { url, init } = built
  let response: Response
  let body: string
  try {
    response = await request(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) })
    body = await readBody(response)
  } catch {
    throw new Error('The API request could not be completed within the time and size limits.')
  }
  return parseResponse(config, response.status, response.headers, body)
}
