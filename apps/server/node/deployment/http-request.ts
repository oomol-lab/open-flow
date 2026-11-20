import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { ArtifactContent, HttpRequestConfig } from '@oomol-lab/open-flow/http-request'
import type { HttpFailure } from './http-transport.ts'

import { artifactMediaType, artifactName, buildHttpRequest, httpRequestArtifactIds, parseHttpResponse } from '@oomol-lab/open-flow/http-request'
import { HttpTaskError, executeHttpBytesTransport, executeHttpTransport } from './http-transport.ts'

const failure = (code: HttpFailure, message: string, retryable = false) => new HttpTaskError(`http-request.${code}`, message, retryable)

/** Run Artifact access for one HTTP Task invocation. */
export interface HttpArtifactHost {
  /** The largest Artifact the deployment stores; downloads stop reading beyond it. */
  readonly maxBytes: number
  resolve(ids: readonly string[]): ReadonlyMap<string, ArtifactContent>
  store(content: ArtifactContent): Promise<JsonValue>
}

export async function executeHttpRequest(
  config: HttpRequestConfig,
  input: Readonly<Record<string, JsonValue>>,
  signal: AbortSignal,
  request = fetch,
  artifacts?: HttpArtifactHost,
): Promise<Readonly<Record<string, JsonValue>>> {
  let built: ReturnType<typeof buildHttpRequest>
  try {
    const ids = httpRequestArtifactIds(config, input)
    built = buildHttpRequest(config, input, ids.length == 0 ? undefined : artifacts?.resolve(ids))
  } catch {
    throw failure('input-invalid', 'The HTTP request configuration or inputs are invalid.')
  }
  if (config.responseFormat == 'artifact') {
    if (artifacts == null) throw failure('input-invalid', 'Artifact responses are unavailable for this Task.')
    const { response, body } = await executeHttpBytesTransport(built, signal, config.statusPolicy == 'all', failure, artifacts.maxBytes, request)
    const result = parseHttpResponse(config, response.status, response.headers, '')
    const mediaType = artifactMediaType(response.headers.get('content-type'))
    const ref = await artifacts.store({
      bytes: body,
      name: artifactName(response.headers.get('content-disposition'), built.url),
      ...(mediaType == null ? {} : { mediaType }),
    })
    return { ...result, body: ref }
  }
  const { response, body } = await executeHttpTransport(built, signal, config.statusPolicy == 'all', failure, request)
  try {
    return parseHttpResponse(config, response.status, response.headers, body)
  } catch {
    throw failure('response-invalid', 'The HTTP response could not be parsed in the selected format.')
  }
}
