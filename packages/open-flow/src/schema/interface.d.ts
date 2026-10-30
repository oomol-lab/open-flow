import type { JsonObject } from '../base/common/json.ts'
import type { JsonValue } from '../types/index.ts'

/** Node ID. Unique in current Flow. */
export type NodeId = string & { __PHANTOM_TYPE__: 'NodeId' }

/** Handle name. */
export type HandleName = string & { __PHANTOM_TYPE__: 'HandleName' }

export type GroupDividerDef = {
  /** Title of the group divider */
  group: string
  /** If the group is collapsed, default is false. */
  collapsed?: boolean | undefined
}

export type HandleSchemaOverridesItem = {
  /** Path to value */
  'path'?: HandleSchemaOverridesPath | undefined
  /** Set new schema */
  'schema'?: any
  'ui:options'?:
    | {
        selected?: number | undefined
      }
    | undefined
}

export type HandleSchemaOverridesPath = undefined | string | number | (string | number)[]

export type InputHandleDef = {
  /** Handle name */
  handle: HandleName
  /** Describe the Handle */
  description?: string | undefined
  /** If 'contentMediaType' is undefined, value will be treated as 'application/json' type */
  json_schema?: any | undefined
  /** Custom kind name. If set the value will be treated as the specified kind. */
  kind?: string | undefined
  /** If the value can be null, default is false. */
  nullable?: boolean | undefined
  /** Provide static value for block, default is null. */
  value?: any | undefined
  /** Override block schema for specific JSON path */
  schema_overrides?: HandleSchemaOverridesItem[] | undefined
}

export type OutputHandleDef = {
  /** Handle name */
  handle: HandleName
  /** Describe the Handle */
  description?: string | undefined
  /** If 'contentMediaType' is undefined, value will be treated as 'application/json' type */
  json_schema?: any | undefined
  /** Custom kind name. If set the value will be treated as the specified kind. */
  kind?: string | undefined
  /** If the value can be null, default is false. */
  nullable?: boolean | undefined
}

export type TriggerDefinition = {
  service_id: string
  service_name: string
  name: string
  provisioning: {
    kind: 'integration' | 'poll' | 'webhook'
  }
  connector?:
    | {
        service_id: string
        account_required: true
      }
    | undefined
  config_inputs: ((Omit<InputHandleDef, 'handle'> & { handle: string }) | GroupDividerDef)[]
  outputs: { handle: string; json_schema?: JsonValue; description?: string; nullable?: boolean; kind?: string }[]
}

export type TriggerDescriptor = {
  type: string
  revision: string
  connection?: string | undefined
  config: JsonObject
  poll_times?: [TriggerPollTime] | undefined
}

export type TriggerPollTime =
  | {
      type: 'cron'
      expression: string
      timezone: string
    }
  | {
      type: 'every'
      unit: 'day' | 'hour' | 'minute' | 'month' | 'week'
      value: number
    }
