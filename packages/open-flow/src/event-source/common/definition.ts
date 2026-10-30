import type { JsonValue } from '../../types/index.ts'

export interface SourceConfiguration {
  readonly identity: string
  readonly eventTypes: string[]
  readonly config: Readonly<Record<string, JsonValue>>
  readonly secrets: Readonly<Record<string, JsonValue>>
  readonly state: Readonly<Record<string, JsonValue>>
}
export interface SourceEvent {
  readonly ordering?: { readonly key: string; readonly version: number }
  readonly id: string
  readonly type: string
  readonly payload: Readonly<Record<string, JsonValue>>
  readonly matches: readonly string[]
}
export interface SourceSubscription {
  readonly key: string
  readonly config: Readonly<Record<string, JsonValue>>
}
export interface EventSourceDefinition {
  readonly kind: string
  readonly provider: string
  readonly triggerId: string
  readonly maximumBodyBytes: number
  readonly applicationIngress: boolean
  readonly managed: boolean
}
export type SourceOperation =
  | { readonly action: 'initialize'; readonly input: Readonly<Record<string, JsonValue>> }
  | { readonly action: 'update'; readonly source: SourceConfiguration; readonly input: Readonly<Record<string, JsonValue>> }
  | { readonly action: 'inspect'; readonly source: SourceConfiguration }
  | { readonly action: 'prepare'; readonly source: SourceConfiguration; readonly config: Readonly<Record<string, JsonValue>>; readonly endpointUrl?: string }
  | {
      readonly action: 'receive'
      readonly source: SourceConfiguration
      readonly headers: Readonly<Record<string, string>>
      readonly rawBody: string
      readonly consumers: readonly { readonly id: string; readonly config: Readonly<Record<string, JsonValue>> }[]
    }

export class SourceIdentityError extends Error {}

export interface SourceReference {
  readonly applicationId: string
  readonly sourceId: string
}
export type SourceReferenceOperation = { readonly deploymentId: string } & (
  | { readonly action: 'route'; readonly applicationId: string; readonly headers: Readonly<Record<string, string>>; readonly rawBody: string }
  | {
      readonly action: 'create'
      readonly requestKey: string
      readonly input: Readonly<Record<string, JsonValue>>
    }
  | { readonly action: 'get'; readonly reference: SourceReference }
  | { readonly action: 'delete'; readonly reference: SourceReference | { readonly appId?: string; readonly requestKey: string } }
  | {
      readonly action: 'update'
      readonly reference: SourceReference
      readonly expectedRevision: number
      readonly input: Readonly<Record<string, JsonValue>>
    }
  | { readonly action: 'prepare'; readonly reference: SourceReference; readonly config: Readonly<Record<string, JsonValue>>; readonly endpointUrl?: string }
  | { readonly action: 'resource'; readonly reference: SourceReference; readonly key: string; readonly active: boolean }
  | ({ readonly action: 'receive'; readonly reference: SourceReference } & Omit<Extract<SourceOperation, { action: 'receive' }>, 'source' | 'action'>)
)
