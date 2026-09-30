import type { JsonValue } from '../../flow/common/change.ts'
export type TriggerOperationRequest =
  | { readonly operation: 'read'; readonly config: Readonly<Record<string, JsonValue>>; readonly checkpoint: JsonValue }
  | { readonly operation: 'options'; readonly config: Readonly<Record<string, JsonValue>>; readonly field: string }
  | {
      readonly operation: 'reconcile'
      readonly subscriptionId?: string
      readonly config: Readonly<Record<string, JsonValue>>
      readonly requestKey: string
      readonly endpointUrl: string
      readonly active: boolean
    }
  | {
      readonly operation: 'receive'
      readonly subscriptionId: string
      readonly method: string
      readonly headers: Readonly<Record<string, string>>
      readonly query: Readonly<Record<string, string>>
      readonly rawBody: string
      readonly admit: boolean
      readonly current: boolean
    }
  | { readonly operation: 'resource'; readonly config: Readonly<Record<string, JsonValue>>; readonly requestKey: string; readonly active: boolean }

export interface ConnectorProxyRequest {
  readonly body?: unknown
  readonly endpoint: string
  readonly headers?: Readonly<Record<string, string>>
  readonly method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
  readonly query?: Readonly<Record<string, boolean | number | string | null>>
}

export interface ConnectorProxyResult {
  readonly data: unknown
  readonly status: number
}

export interface ConnectorProxy {
  trigger?(request: TriggerOperationRequest, signal?: AbortSignal): Promise<unknown>
  execute(request: ConnectorProxyRequest, signal?: AbortSignal): Promise<ConnectorProxyResult>
}
