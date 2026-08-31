export type Block = TaskBlock | SubflowBlock

export type BlockUI = {
  /** Default node width */
  default_width?: number | undefined
}

/**
 * A single expression to evaluate a condition
 */
export type ConditionExpression = {
  /** Input handle name to evaluate the expression */
  input_handle: HandleName
  /** Operator to compare the handle value */
  operator:
    | '=='
    | '!='
    | '<'
    | '<='
    | '>'
    | '>='
    | 'is null'
    | 'is not null'
    | 'is true'
    | 'is false'
    | 'contains'
    | 'not contains'
    | 'is empty'
    | 'is not empty'
    | 'has key'
    | 'not has key'
    | 'has value'
    | 'not has value'
    | 'starts with'
    | 'ends with'
  /** Value to compare the handle value */
  value?: any | undefined
}

/**
 * Condition definition to control the flow
 */
export type ConditionHandleDef = {
  /** Handle name */
  handle: HandleName
  /** Describe the Condition */
  description?: string | undefined
  /** Logical operator to combine multiple expressions, default is OR. */
  logical?: 'AND' | 'OR'
  /** Expressions to evaluate the condition */
  expressions?: ConditionExpression[] | undefined
}

/**
 * Condition Node returns all inputs as output from successful condition evaluation.
 */
export type ConditionNode = {
  /** Node ID. Unique in current Flow. */
  node_id: NodeId
  /** Ignore this Node in execution */
  ignore?: boolean | undefined
  /** Path to a icon image for the Node */
  icon?: string | undefined
  /** Node title */
  title?: string | undefined
  /** Node description */
  description?: string | undefined
  /** Provide data source for Node input Handles. */
  inputs_from?: HandleInputFrom[] | undefined
  /** The weight of this node in current flow progress calculation. Flow will sum all nodes' progress divided by their weight sum. Default is 1. Set to 0 to ignore this node in flow's progress calculation. */
  progress_weight?: number
  /** Input handles definitions */
  inputs_def?: InputHandleDef[] | undefined
  /** Inline Condition Block defines a set of conditions to evaluate and route data accordingly. */
  conditions: InlineConditionBlock
}

/**
 * Default Condition definition to control the flow
 */
export type DefaultConditionHandleDef = {
  /** Handle name */
  handle: HandleName
  /** Describe the Default Condition */
  description?: string | undefined
}

export type Executor = JavascriptExecutor | ConnectorExecutor | LlmExecutor

/**
 * Flow defines a web of Blocks described by a series of Nodes
 */
export type Flow = {
  /** Flow display title */
  title?: string | undefined
  /** Flow display description */
  description?: string | undefined
  /** Path to a icon image for the Flow */
  icon?: string | undefined
  /** Trigger definition snapshots referenced by Trigger Nodes */
  trigger_definitions?: TriggerDefinitionSnapshot[] | undefined
  /** Nodes in Flow */
  nodes: FlowNode[]
}

export type FlowNode = Node | TriggerNode

export type GroupDividerDef = {
  /** Title of the group divider */
  group: string
  /** If the group is collapsed, default is false. */
  collapsed?: boolean | undefined
}

/**
 * Data source from the input Handle of current Subflow Block
 */
export type HandleFromFlow = {
  /** Input Handle of current Subflow Block */
  input_handle: HandleName
}

/**
 * Data source from output Handle of another Node
 */
export type HandleFromNode = {
  /** Node ID in current Flow */
  node_id: NodeId
  /** Output Handle of Node */
  output_handle: HandleName
}

export type HandleInputFrom = {
  /** Handle name */
  handle: HandleName
  /** Provide static value for block, default is null. */
  value?: any | undefined
  from_flow?: HandleFromFlow[] | undefined
  from_node?: HandleFromNode[] | undefined
  /** Override block schema for specific JSON path */
  schema_overrides?: HandleSchemaOverridesItem[] | undefined
}

/**
 * Handle name
 */
export type HandleName = string & {
  __PHANTOM_TYPE__: HandleInputFrom | HandleOutputFrom
}

export type HandleOutputFrom = {
  /** Handle name */
  handle: HandleName
  from_flow?: HandleFromFlow[] | undefined
  from_node?: HandleFromNode[] | undefined
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

/**
 * Path to value
 */
export type HandleSchemaOverridesPath = undefined | string | number | (string | number)[]

/**
 * Inline Condition Block defines a set of conditions to evaluate and route data accordingly.
 */
export type InlineConditionBlock = {
  /** Block cases Handle definitions */
  cases?: ConditionHandleDef[] | undefined
  /** Block default Handle definition */
  default?: DefaultConditionHandleDef | undefined
}

/**
 * Inline Task Block defines a single executable Task in Node
 */
export type InlineTaskBlock = {
  /** Block input Handles definitions */
  inputs_def?: (InputHandleDef | GroupDividerDef)[] | undefined
  /** Block output Handles definitions */
  outputs_def?: (OutputHandleDef | GroupDividerDef)[] | undefined
  executor: Executor
}

/**
 * Input Handles on Block.
 */
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

/**
 * Node ID. Unique in current Flow.
 */
export type NodeId = string & {
  __PHANTOM_TYPE__: Node
}

export type Node = TaskNode | SubflowNode | ValueNode | ConditionNode

/**
 * JavaScript Executor Name
 */
export type JavascriptExecutorName = 'javascript'

/**
 * JavaScript Executor runs a portable bundled Task.
 */
export type JavascriptExecutor = {
  /** JavaScript Executor Name */
  name: JavascriptExecutorName
  options: {
    /** Portable JavaScript or TypeScript entry file. */
    entry: string
    /** Exported function name; defaults to the default export. */
    function?: string | undefined
  }
}

/**
 * Connector Executor Name
 */
export type ConnectorExecutorName = 'connector'

/**
 * Connector Executor calls a versioned remote action.
 */
export type ConnectorExecutor = {
  name: ConnectorExecutorName
  options: {
    /** Connector action id in service.action form. */
    action: string
    /** Team-owned Connector connection id. */
    connection?: string | undefined
  }
}

/**
 * LLM Executor Name
 */
export type LlmExecutorName = 'llm'

/**
 * LLM Executor calls an OpenAI-compatible chat completion API.
 */
export type LlmExecutor = {
  name: LlmExecutorName
  options: {
    /** Return text or structured outputs. */
    mode: 'chat' | 'json'
  }
}

/**
 * Output Handles on Block.
 */
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

export type Package = {
  /** Project name */
  name?: string | undefined
  /** Project display name */
  displayName?: string | undefined
  /** Project description */
  description?: string | undefined
  /** Project icon URI */
  icon?: string | undefined
}

/**
 * A Subflow Block defines a Subflow that acts as a Block externally and as a Flow internally.
 */
export type SubflowBlock = {
  /** Block input Handles definitions */
  inputs_def?: (InputHandleDef | GroupDividerDef)[] | undefined
  /** Block output Handles definitions */
  outputs_def?: (OutputHandleDef | GroupDividerDef)[] | undefined
  /** UI settings of the block */
  ui?: BlockUI | undefined
  /** Block display title */
  title?: string | undefined
  /** Block display description */
  description?: string | undefined
  /** Path to a icon image for the Block */
  icon?: string | undefined
  /** Hide the subflow from the blocks list and exclude it from AI tools */
  private?: boolean
  /** Nodes in the Subflow */
  nodes?: Node[] | undefined
  /** Provides data sources for Subflow output handles. */
  outputs_from?: HandleOutputFrom[] | undefined
  /** List of nodes whose previews are forwarded to the Subflow node. */
  forward_previews?: NodeId[] | undefined
}

/**
 * Subflow Node points to a Subflow Block manifest
 */
export type SubflowNode = {
  /** Node ID. Unique in current Flow. */
  node_id: NodeId
  /** Ignore this Node in execution */
  ignore?: boolean | undefined
  /** Path to a icon image for the Node */
  icon?: string | undefined
  /** Node title */
  title?: string | undefined
  /** Node description */
  description?: string | undefined
  /** Node execution timeout in seconds */
  timeout?: number | undefined
  /** Provide data source for Node input Handles. */
  inputs_from?: HandleInputFrom[] | undefined
  /** the maximum number of this node can be executed concurrently. default is 1. */
  concurrency?: number | undefined
  /** The weight of this node in current flow progress calculation. Flow will sum all nodes' progress divided by their weight sum. Default is 1. Set to 0 to ignore this node in flow's progress calculation. */
  progress_weight?: number
  /** Location of a Subflow Block manifest */
  subflow: string
}

/**
 * Task Block defines a single executable Task
 */
export type TaskBlock = {
  /** Block input Handles definitions */
  inputs_def?: (InputHandleDef | GroupDividerDef)[] | undefined
  /** Block output Handles definitions */
  outputs_def?: (OutputHandleDef | GroupDividerDef)[] | undefined
  /** UI settings of the block */
  ui?: BlockUI | undefined
  /** Block display title */
  title?: string | undefined
  /** Block display description */
  description?: string | undefined
  /** Path to a icon image for the Block */
  icon?: string | undefined
  executor: Executor
  /** Hide the task from the blocks list and exclude it from AI tools */
  private?: boolean
  /** Allow additional inputs def to be added on node */
  additional_inputs?: (boolean | InputHandleDef) | undefined
  /** Allow additional outputs def to be added on node */
  additional_outputs?: (boolean | OutputHandleDef) | undefined
  /** Default node.inputs_def */
  additional_inputs_def?: InputHandleDef[] | undefined
  /** Default node.outputs_def */
  additional_outputs_def?: OutputHandleDef[] | undefined
}

export type TaskNode = {
  /** Node ID. Unique in current Flow. */
  node_id: NodeId
  /** Ignore this Node in execution */
  ignore?: boolean | undefined
  /** Path to a icon image for the Node */
  icon?: string | undefined
  /** Node title */
  title?: string | undefined
  /** Node description */
  description?: string | undefined
  /** Node execution timeout in seconds */
  timeout?: number | undefined
  /** Provide data source for Node input Handles. */
  inputs_from?: HandleInputFrom[] | undefined
  /** the maximum number of this node can be executed concurrently. default is 1. */
  concurrency?: number | undefined
  /** The weight of this node in current flow progress calculation. Flow will sum all nodes' progress divided by their weight sum. Default is 1. Set to 0 to ignore this node in flow's progress calculation. */
  progress_weight?: number
  task: string | InlineTaskBlock
  /** Additional inputs def if the task's additional_inputs is set */
  inputs_def?: InputHandleDef[] | undefined
  /** Additional outputs def if the task's additional_outputs is set */
  outputs_def?: OutputHandleDef[] | undefined
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
  config_schema: JsonObject
  payload_schema: JsonObject
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

export type TriggerDefinitionSnapshot = {
  type: string
  revision: string
  definition: TriggerDefinition
}

export type TriggerNode = {
  /** Node ID. Unique in current Flow. */
  node_id: NodeId
  /** Ignore this Trigger when building a deployment */
  ignore?: boolean | undefined
  /** Path to a icon image for the Trigger */
  icon?: string | undefined
  /** Trigger title */
  title?: string | undefined
  /** Trigger description */
  description?: string | undefined
  trigger: TriggerDescriptor
}

export type JsonObject = {
  readonly [key: string]: JsonValue
}

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject

/**
 * Value Handles on Block.
 */
export type ValueHandleDef = {
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
}

export type ValueNode = {
  /** Node ID. Unique in current Flow. */
  node_id: NodeId
  /** Ignore this Node in execution */
  ignore?: boolean | undefined
  /** Path to a icon image for the Node */
  icon?: string | undefined
  /** Node title */
  title?: string | undefined
  /** Node description */
  description?: string | undefined
  /** Provide static value for block */
  values: ValueHandleDef[]
}
