import type { Logger } from 'pino'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { ControlError } from '../error.ts'
import { silentLogger } from '../logger.ts'

export type ConnectorProxyResource = 'providers' | 'actions' | 'apps'
export interface ConnectorProxyConfiguration {
  readonly origin: string
  readonly token: string
}

const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']

export async function forwardConnector(
  configuration: ConnectorProxyConfiguration,
  resource: ConnectorProxyResource,
  request: Request,
  teamId?: string,
  { logger = silentLogger, timeoutMs = 30_000 }: { readonly logger?: Logger; readonly timeoutMs?: number } = {},
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = AbortSignal.any([request.signal, timeout])
  try {
    const origin = new URL(configuration.origin)
    origin.pathname = `${origin.pathname.replace(/\/+$/, '')}/`
    const target = new URL(`v1/${resource}`, origin)
    const parameters = new URL(request.url).searchParams
    parameters.delete('flowId')
    target.search = parameters.toString()
    const headers = new Headers()
    if (configuration.token) headers.set('Authorization', `Bearer ${configuration.token}`)
    if (teamId != null) headers.set('x-oo-team-id', teamId)
    for (const name of ['accept-language', 'if-none-match']) {
      const value = request.headers.get(name)
      if (value != null) headers.set(name, value)
    }
    const upstream = await fetch(target, { headers, method: 'GET', redirect: 'manual', signal })
    const responseHeaders = new Headers(upstream.headers)
    const connectionHeaders =
      responseHeaders
        .get('connection')
        ?.split(',')
        .map((name) => name.trim())
        .filter(Boolean) ?? []
    for (const name of [...hopHeaders, ...connectionHeaders, 'content-encoding', 'content-length']) responseHeaders.delete(name)
    // Forward the fetch stream directly to preserve backpressure and downstream cancellation.
    // Once headers are sent, upstream read failures terminate the stream.
    const body = request.method == 'HEAD' || [204, 205, 304].includes(upstream.status) ? null : upstream.body
    if (body == null) await upstream.body?.cancel()
    return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders })
  } catch (error) {
    if (request.signal.aborted) throw request.signal.reason
    logger.warn({ category: 'connector.proxy.failed', resource, failure: timeout.aborted ? 'timeout' : 'transport' }, 'Connector proxy request failed.')
    throw new ControlError(controlErrorCode.connectorUnavailable, 'The Connector request could not be completed.', { cause: error })
  }
}
