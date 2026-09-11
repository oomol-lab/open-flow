import type { ConnectorProxy } from '../../connector/common/proxy.ts'
import type { JsonValue } from '../../flow/common/change.ts'

export interface TriggerConfigOption {
  readonly value: string
  readonly label: string
  readonly color?: string
}

export interface TriggerConfigOptionsContext {
  readonly field: string
  readonly config: Readonly<Record<string, JsonValue>>
  readonly connector: ConnectorProxy
  readonly signal?: AbortSignal
}
