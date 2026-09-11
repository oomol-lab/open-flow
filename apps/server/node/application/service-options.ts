import type { ProviderTriggerDefinition } from '@oomol-lab/open-flow/provider-triggers'
import type * as Clock from 'effect/Clock'
import type { Logger } from 'pino'
import type { ConnectorHost } from '../deployment/connector.ts'
import type { LlmHost } from '../deployment/llm.ts'
import type { IntegrationOptions } from '../runtime/integration-runtime.ts'

export interface ServerRuntime {
  readonly maxConcurrentRuns?: number
  readonly maxPendingRuns?: number
  readonly runEventRetentionMs?: number
  readonly runTimeoutMs?: number
}

export interface ServerCapabilities {
  readonly connector?: () => ConnectorHost | undefined
  readonly connectorConsoleOrigin?: () => URL | undefined
  readonly integration?: () => IntegrationOptions | undefined
  readonly llm?: () => LlmHost | undefined
  readonly waitPublicOrigin?: () => URL | undefined
}

export interface ServerServiceOptions {
  readonly capabilities?: ServerCapabilities
  readonly clock?: Clock.Clock | (() => number)
  readonly logger?: Logger
  readonly runtime?: ServerRuntime
  readonly triggerDefinitions?: readonly ProviderTriggerDefinition[]
}

function validatePositiveInteger(value: number | undefined, message: string): void {
  if (value != null && (!Number.isSafeInteger(value) || value <= 0)) throw new TypeError(message)
}

function parseOrigin(value: string, label: string): URL {
  const origin = new URL(value)
  if (
    (origin.protocol != 'https:' && !(origin.protocol == 'http:' && ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(origin.hostname))) ||
    origin.username != '' ||
    origin.password != '' ||
    origin.pathname != '/' ||
    origin.search != '' ||
    origin.hash != ''
  ) {
    throw new Error(`${label} must be an HTTPS origin without credentials, a path, query, or fragment, except on loopback.`)
  }
  return origin
}

export function validateRuntime(runtime: ServerRuntime): void {
  validatePositiveInteger(runtime.runEventRetentionMs, 'Run event retention must be a positive safe integer number of milliseconds.')
  validatePositiveInteger(runtime.maxPendingRuns, 'Maximum pending Runs must be a positive safe integer.')
  validatePositiveInteger(runtime.maxConcurrentRuns, 'Maximum concurrent Runs must be a positive safe integer.')
  validatePositiveInteger(runtime.runTimeoutMs, 'Run timeout must be a positive safe integer number of milliseconds.')
}

export function validateCapabilities(capabilities: ServerCapabilities): void {
  const consoleOrigin = capabilities.connectorConsoleOrigin?.()
  if (consoleOrigin != null) parseOrigin(consoleOrigin.href, 'Connector Console origin')
  const integration = capabilities.integration?.()
  if (integration != null) parseOrigin(integration.publicOrigin, 'Integration public origin')
  const waitPublicOrigin = capabilities.waitPublicOrigin?.()
  if (waitPublicOrigin != null) parseOrigin(waitPublicOrigin.href, 'Wait public origin')
}
