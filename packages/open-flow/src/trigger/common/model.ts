import type { Group, InputPort, InputValues, Port } from '../../flow/common/model.ts'
import type { WebhookMethod } from '../../flow/common/webhookMethod.ts'

/** Trigger node shapes. The graph node union and its operations belong to flow/common/change.ts. */

export type TriggerSchedule =
  | { readonly expression: string; readonly timezone: string; readonly type: 'cron' }
  | { readonly type: 'every'; readonly unit: 'day' | 'hour' | 'minute' | 'month' | 'week'; readonly value: number }

interface TriggerKeySnapshotBase {
  readonly configInputs: readonly (InputPort | Group)[]
  readonly definitionVersion: number
  readonly description: string
  readonly displayName: string
  readonly key: string
  readonly name: string
  readonly outputs: readonly Port[]
  readonly provider: string
}

export type IntegrationEndpointMethod = 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST' | 'PUT'

export type IntegrationBodyFormat = 'form' | 'json' | 'multipart' | 'text'

export interface IntegrationEndpointDeclaration {
  readonly body: {
    readonly allowArray: boolean
    readonly allowEmpty: boolean
    readonly formats: readonly IntegrationBodyFormat[]
  }
  readonly methods: readonly IntegrationEndpointMethod[]
  readonly successStatus: number
}

export type TriggerKeySnapshot =
  | (TriggerKeySnapshotBase & { readonly type: 'poll' })
  | (TriggerKeySnapshotBase & { readonly endpoint: IntegrationEndpointDeclaration; readonly type: 'integration' })

export interface WebhookBodyField extends InputPort {}

export interface WebhookOptions {
  readonly allowedOrigins?: readonly string[]
  readonly responseBody?:
    | { readonly kind: 'workflow-outputs'; readonly output?: string; readonly timeoutMs?: number }
    | { readonly kind: 'webhook-response'; readonly nodeId?: string; readonly timeoutMs?: number }
  readonly responseData?: string
  readonly responseHeaders?: Readonly<Record<string, string>>
  readonly responseHeadersSource?: {
    readonly kind: 'workflow-outputs'
    readonly output?: string
  }
  readonly responseHeaderOutputs?: Readonly<Record<string, string>>
  readonly responseStatusCode?: number
  readonly responseStatusCodeOutput?: string
}

interface TriggerNodeBase {
  readonly onError?: never
  readonly description?: string
  readonly icon?: string
  readonly name: string
}

export type TriggerNode =
  | (TriggerNodeBase & { readonly kind: 'manual' })
  | (TriggerNodeBase & { readonly kind: 'start'; readonly inputDefs: readonly Port[] })
  | (TriggerNodeBase & { readonly kind: 'error'; readonly sourceFlowIds?: readonly string[] })
  | (TriggerNodeBase & {
      readonly bodyFields: readonly WebhookBodyField[]
      readonly kind: 'webhook'
      readonly method: WebhookMethod
      readonly options?: WebhookOptions
    })
  | (TriggerNodeBase & { readonly cronTimes: readonly TriggerSchedule[]; readonly kind: 'cron' })
  | (TriggerNodeBase & {
      readonly connectionId?: string
      readonly config: InputValues
      readonly definition: TriggerKeySnapshot & { readonly type: 'poll' }
      readonly kind: 'poll'
      readonly pollTimes: readonly TriggerSchedule[]
    })
  | (TriggerNodeBase & {
      readonly connectionId?: string
      readonly config: InputValues
      readonly definition: TriggerKeySnapshot & { readonly type: 'integration' }
      readonly kind: 'integration'
    })
