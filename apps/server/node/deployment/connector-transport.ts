import type { Logger } from 'pino'
import type { ResponseBudget } from './connector-response.ts'

import { errorKind } from '../logger.ts'
import { ConnectorTaskError, unavailable } from './connector-contract.ts'
import { connectorFailureDetails, readJson } from './connector-response.ts'

export const maxResponseBytes = 1024 * 1024

interface GetOptions {
  readonly fields?: Readonly<Record<string, string>>
  readonly teamId?: string
  readonly locale?: string
  readonly budget?: ResponseBudget
  readonly maximumResponseBytes?: number
  readonly failure?: (data: unknown) => ConnectorTaskError
}

export class RequestError extends ConnectorTaskError {
  readonly reason: string
  readonly status: number | undefined

  constructor(cause: ConnectorTaskError, reason: string, status: number | undefined) {
    super(cause.code, cause.message)
    this.cause = cause
    this.reason = reason
    this.status = status
  }
}

export class ConnectorTransport {
  readonly #origin: URL
  readonly #token: string
  readonly #timeoutMs: number
  readonly #logger: Logger

  constructor(origin: URL, token: string, timeoutMs: number, logger: Logger) {
    this.#origin = origin
    this.#token = token
    this.#timeoutMs = timeoutMs
    this.#logger = logger
  }

  async get<Value>(operation: string, path: string, decode: (data: unknown) => Value, signal?: AbortSignal, options: GetOptions = {}): Promise<Value> {
    signal?.throwIfAborted()
    const response = await this.request(operation, path, { method: 'GET' }, signal, options)
    if (!response.ok) throw options.failure?.(response.value) ?? unavailable()
    signal?.throwIfAborted()
    return this.decode(operation, { ...options.fields, upstreamPath: new URL(path, this.#origin).pathname }, () => decode(response.value))
  }

  decode<Value>(operation: string, fields: Readonly<Record<string, string>>, decode: () => Value): Value {
    try {
      return decode()
    } catch (error) {
      this.#logger.warn(
        {
          category: 'connector.request.failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          failure: 'response-invalid',
          operation,
          upstreamOrigin: this.#origin.origin,
          ...fields,
          ...errorKind(error),
        },
        'Connector response was invalid.',
      )
      if (error instanceof ConnectorTaskError) throw error
      throw unavailable()
    }
  }

  async request(
    operation: string,
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
    {
      budget,
      fields = {},
      maximumResponseBytes = maxResponseBytes,
      origin = this.#origin,
      teamId,
      locale,
    }: {
      readonly budget?: ResponseBudget
      readonly fields?: Readonly<Record<string, string>>
      readonly maximumResponseBytes?: number
      readonly locale?: string
      readonly origin?: URL
      readonly teamId?: string
    } = {},
  ): Promise<{ readonly headers: Headers; readonly ok: boolean; readonly status: number; readonly value: unknown }> {
    const startedAt = performance.now()
    const timeout = AbortSignal.timeout(this.#timeoutMs)
    const target = new URL(path, origin)
    let status: number | undefined
    try {
      const response = await fetch(target, {
        ...init,
        headers: {
          ...(this.#token == '' ? {} : { authorization: `Bearer ${this.#token}` }),
          ...(origin == this.#origin && teamId != null ? { 'x-oo-team-id': teamId } : {}),
          ...(locale == null ? {} : { 'Accept-Language': locale }),
          ...init.headers,
        },
        redirect: 'error',
        signal: signal == null ? timeout : AbortSignal.any([signal, timeout]),
      })
      status = response.status
      const value = await readJson(response, maximumResponseBytes, budget)
      if (!response.ok) {
        this.#logger.warn(
          {
            category: 'connector.request.failed',
            durationMs: Math.round(performance.now() - startedAt),
            failure: 'upstream-status',
            ...connectorFailureDetails(value, this.#token),
            method: init.method ?? 'GET',
            operation,
            status,
            upstreamOrigin: target.origin,
            upstreamPath: target.pathname,
            ...fields,
          },
          'Connector request failed.',
        )
      }
      return { headers: response.headers, ok: response.ok, status: response.status, value }
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      let failure = 'transport'
      if (error instanceof ConnectorTaskError) failure = 'response-invalid'
      else if (timeout.aborted) failure = 'timeout'
      this.#logger.warn(
        {
          category: 'connector.request.failed',
          durationMs: Math.round(performance.now() - startedAt),
          failure,
          errorMessage: error instanceof Error ? error.message : String(error),
          method: init.method ?? 'GET',
          operation,
          ...(status == null ? {} : { status }),
          upstreamOrigin: target.origin,
          upstreamPath: target.pathname,
          ...fields,
          ...errorKind(error),
        },
        'Connector request failed.',
      )
      let reason = 'Connector connection failed while sending the request or receiving its response'
      if (failure == 'timeout') reason = `Connector request timed out after ${this.#timeoutMs} ms`
      else if (error instanceof ConnectorTaskError) reason = error.message
      throw new RequestError(error instanceof ConnectorTaskError ? error : unavailable(), reason, status)
    }
  }
}
