import type { ReadonlyVal, Val } from 'value-enhancer'
import type { NodeId, TriggerDescriptor } from '../../../../schema/index.ts'
import type { TriggerCatalogDescriptor } from '../../../../trigger/common/catalog.ts'
import type { NodeStoreDisplay$, NodeStoreManifest$, NodeStoreProps } from './node.store.ts'

import { NODE_TYPE } from './constants.ts'
import { NodeStore } from './node.store.ts'

export type TriggerNodeSchedule =
  | { readonly expression: string; readonly timezone: string; readonly type: 'cron' }
  | { readonly type: 'every'; readonly unit: 'day' | 'hour' | 'minute' | 'month' | 'week'; readonly value: number }

interface TriggerNodeFieldBase {
  readonly description?: string
  readonly invalid?: boolean
  readonly label: string
  readonly name: string
  readonly required: boolean
  readonly source: string
}

export type TriggerNodeField =
  | (TriggerNodeFieldBase & { readonly kind: 'boolean' | 'integer' | 'number' | 'string' })
  | (TriggerNodeFieldBase & { readonly kind: 'json' })
  | (TriggerNodeFieldBase & {
      readonly kind: 'multi-select'
      readonly options: readonly { readonly label: string; readonly source: string; readonly value: unknown }[]
      readonly selected: readonly string[]
    })
  | (TriggerNodeFieldBase & {
      readonly kind: 'select'
      readonly options: readonly { readonly label: string; readonly source: string; readonly value: unknown }[]
    })

export interface TriggerNodePresentation {
  readonly config?: readonly TriggerNodeField[]
  readonly kind: 'cron' | 'integration' | 'manual' | 'poll' | 'webhook'
  readonly schedules: readonly TriggerNodeSchedule[]
  readonly source?: string
  readonly webhook?: {
    readonly inputs: readonly TriggerNodeWebhookInput[]
    readonly options: TriggerNodeWebhookOptions
  }
}

export interface TriggerNodeWebhookInput {
  readonly description?: string
  readonly handle: string
  readonly jsonSchema?: unknown
  readonly nullable: boolean
  readonly value?: unknown
}

export interface TriggerNodeWebhookOptions {
  readonly allowedMethods?: readonly string[]
  readonly allowedOrigins?: readonly string[]
  readonly noResponseBody?: boolean
  readonly responseData?: string
  readonly responseHeaders?: Readonly<Record<string, string>>
  readonly responseStatusCode?: number
}

export interface TriggerNodeWebhook {
  readonly inputs: readonly TriggerNodeWebhookInput[]
  readonly options: TriggerNodeWebhookOptions
}

export interface TriggerNodeStoreManifest$ extends NodeStoreManifest$ {
  readonly trigger: Val<TriggerDescriptor | undefined>
}

export interface TriggerNodeStoreDisplay$ extends NodeStoreDisplay$ {
  readonly editable?: ReadonlyVal<boolean>
  readonly presentation?: ReadonlyVal<TriggerNodePresentation | undefined>
  readonly trigger: ReadonlyVal<TriggerCatalogDescriptor | undefined>
}

export class TriggerNodeStore extends NodeStore<TriggerNodeStoreManifest$, TriggerNodeStoreDisplay$> {
  public readonly changeConfig: ((name: string, value: unknown | undefined) => void) | undefined
  public readonly changeSchedule: ((schedule: readonly TriggerNodeSchedule[]) => void) | undefined
  public readonly changeWebhook: ((webhook: TriggerNodeWebhook) => void) | undefined

  public static override is(value: unknown): value is TriggerNodeStore {
    return value instanceof TriggerNodeStore
  }

  public constructor(
    nodeId: NodeId,
    props: NodeStoreProps<TriggerNodeStoreManifest$, TriggerNodeStoreDisplay$> & {
      readonly changeConfig?: (name: string, value: unknown | undefined) => void
      readonly changeSchedule?: (schedule: readonly TriggerNodeSchedule[]) => void
      readonly changeWebhook?: (webhook: TriggerNodeWebhook) => void
    },
  ) {
    super(nodeId, NODE_TYPE.TriggerNode, props)
    this.changeConfig = props.changeConfig
    this.changeSchedule = props.changeSchedule
    this.changeWebhook = props.changeWebhook
  }
}
