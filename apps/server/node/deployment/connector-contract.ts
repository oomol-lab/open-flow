import type { ConnectorProxyRequest, ConnectorProxyResult, TriggerOperationRequest } from '@oomol-lab/open-flow/connector-proxy'
import type {
  ConnectorAccess,
  ConnectorAccessSnapshot,
  ConnectorActionMetadata,
  ConnectorConnection,
  ConnectorProvider,
} from '@oomol-lab/open-flow/control-api'
import type { JsonValue } from '@oomol-lab/open-flow/flow-change'

export interface ConnectorHost {
  execute(
    action: string,
    connectionId: string | undefined,
    input: Readonly<Record<string, JsonValue>>,
    invocationId: string,
    signal: AbortSignal,
    access?: ConnectorAccessContext,
  ): Promise<JsonValue>
  getAction(actionId: string, signal?: AbortSignal, access?: ConnectorAccessContext, locale?: string): Promise<ConnectorActionMetadata>
  listActions(serviceId?: string, signal?: AbortSignal, access?: ConnectorAccessContext, locale?: string): Promise<readonly ConnectorActionMetadata[]>
  listAllConnections(signal?: AbortSignal, access?: ConnectorAccessContext): Promise<readonly ConnectorConnection[]>
  listConnections(serviceId: string, signal?: AbortSignal, access?: ConnectorAccessContext): Promise<readonly ConnectorConnection[]>
  listProviders(signal?: AbortSignal, access?: ConnectorAccessContext, locale?: string): Promise<readonly ConnectorProvider[]>
  proxy(
    provider: string,
    connectionId: string,
    rateLimitId: string,
    request: ConnectorProxyRequest,
    signal: AbortSignal,
    access?: ConnectorAccessContext,
  ): Promise<ConnectorProxyResult>
  trigger?(
    provider: string,
    connectionId: string,
    triggerId: string,
    request: TriggerOperationRequest,
    signal: AbortSignal,
    access?: ConnectorAccessContext,
  ): Promise<unknown>
  ready(): Promise<boolean>
  searchActions(query: string, signal?: AbortSignal, access?: ConnectorAccessContext, locale?: string): Promise<readonly ConnectorActionMetadata[]>
}

interface ConnectorContext {
  readonly actorId?: string
  readonly flowId?: string
  readonly providerId?: string
  readonly purpose: 'catalog' | 'eligibility' | 'execute' | 'proxy' | 'trigger'
  readonly source: 'operator' | 'draft' | 'publication' | 'run'
  readonly teamId?: string
}

export type ConnectorAccessContext = ConnectorContext &
  (
    | { readonly scope: 'catalog'; readonly providerAccess: ConnectorAccess }
    | { readonly scope: 'shared' | 'selected'; readonly providerAccess: ConnectorAccessSnapshot }
    | { readonly scope: 'action'; readonly providerAccess: ConnectorAccessSnapshot; readonly action: string; readonly connectionId?: string }
    | {
        readonly scope: 'trigger'
        readonly triggerId: string
        readonly providerAccess: ConnectorAccessSnapshot
        readonly providerId: string
        readonly connectionId: string
      }
    | { readonly scope: 'proxy'; readonly providerAccess: ConnectorAccessSnapshot; readonly providerId: string; readonly connectionId: string }
  )

export type ConnectorErrorCode =
  | 'connector.access-invalid'
  | 'connector.access-required'
  | 'connector.input-invalid'
  | 'connector.indeterminate'
  | 'connector.action-not-found'
  | 'connector.connection-required'
  | 'connector.unavailable'
  | 'connector.unconfigured'

export class ConnectorTaskError extends Error {
  readonly code: ConnectorErrorCode
  readonly status?: number

  constructor(code: ConnectorErrorCode, message: string, status?: number) {
    super(message)
    this.code = code
    this.status = status
    this.name = 'ConnectorTaskError'
  }

  get catchable(): boolean {
    return this.code != 'connector.indeterminate' && this.code != 'connector.unconfigured'
  }

  get retryable(): boolean {
    return this.code == 'connector.unavailable'
  }

  get indeterminate(): boolean {
    return this.code == 'connector.indeterminate'
  }
}

export function connectionRequired(): ConnectorTaskError {
  return new ConnectorTaskError('connector.connection-required', 'The selected Connector Connection must be reconnected or replaced.')
}

export function accessInvalid(message = 'The Flow Provider access binding is no longer valid.'): ConnectorTaskError {
  return new ConnectorTaskError('connector.access-invalid', message)
}

export function unavailable(message = 'The Connector request could not be completed.'): ConnectorTaskError {
  return new ConnectorTaskError('connector.unavailable', message)
}

/** An explicitly deferred account must never resolve to a default account. */
export function assertConnectionNotDeferred(connectionId: string | undefined): void {
  if (connectionId === '') throw new ConnectorTaskError('connector.connection-required', 'Configure an account before calling this Action.')
}
