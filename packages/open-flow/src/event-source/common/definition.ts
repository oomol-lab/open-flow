import type { JsonValue } from '../../flow/common/change.ts'

export interface SourceConfiguration {
  readonly identity: string
  readonly eventTypes: string[]
  readonly config: Readonly<Record<string, JsonValue>>
  readonly secrets: Readonly<Record<string, JsonValue>>
  readonly state: Readonly<Record<string, JsonValue>>
}

export interface SourceEvent {
  readonly id: string
  readonly type: string
  readonly payload: Readonly<Record<string, JsonValue>>
}

export interface SourceSubscription {
  readonly key: string
  readonly config: Readonly<Record<string, JsonValue>>
}

export interface EventSourceDefinition<Create, Update, View> {
  readonly kind: string
  readonly provider: string
  readonly maximumBodyBytes: number
  readonly initialize: (input: Create, accountId: string | undefined) => SourceConfiguration
  readonly update: (source: SourceConfiguration, input: Update) => SourceConfiguration
  readonly view: (source: SourceConfiguration) => View
  readonly ready: (source: SourceConfiguration) => boolean
  readonly receive: (
    source: SourceConfiguration,
    bytes: Uint8Array,
    headers: Headers,
    now: number,
  ) => Promise<{ readonly response: Response; readonly state: SourceConfiguration['state'] } | { readonly event: SourceEvent }>
  readonly matches: (config: Readonly<Record<string, JsonValue>>, event: SourceEvent) => boolean
  readonly resources: {
    readonly triggerId: string
    readonly requests: (source: SourceConfiguration, provider: string, config: Readonly<Record<string, JsonValue>>) => readonly SourceSubscription[]
  }
}

export class SourceIdentityError extends Error {}
