import type { JsonObject, JsonValue } from '../base/common/json.ts'

import { z } from 'zod'
import { isJsonObject } from '../base/common/json.ts'
import { LOCAL_BLOCK_REFERENCE_PATTERN } from './block-reference.ts'
import { InlineConditionBlockSchema } from './block.schema/inline-condition-block.schema.ts'
import { InlineTaskBlockSchema } from './block.schema/inline-task-block.schema.ts'
import { HandleNameSchema, InputHandleDefSchema, OutputHandleDefSchema, ValueHandleDefSchema } from './handle.schema.ts'
import { HandleSchemaOverridesItemSchema } from './schema-overrides.schema.ts'

export const NodeIdSchema = /* @__PURE__ */ z.string().describe('Node ID. Unique in current Flow.')

export const HandleFromFlowSchema = /* @__PURE__ */ z
  .strictObject({
    input_handle: HandleNameSchema.describe('Input Handle of current Subflow Block'),
  })
  .describe('Data source from the input Handle of current Subflow Block')

export const HandleFromNodeSchema = /* @__PURE__ */ z
  .strictObject({
    node_id: /* @__PURE__ */ NodeIdSchema.describe('Node ID in current Flow'),
    output_handle: HandleNameSchema.describe('Output Handle of Node'),
  })
  .describe('Data source from output Handle of another Node')

export const HandleInputFromSchema = /* @__PURE__ */ z.strictObject({
  handle: HandleNameSchema,
  value: z.any().optional().describe('Provide static value for block, default is null.'),
  from_flow: z.array(HandleFromFlowSchema).optional(),
  from_node: z.array(HandleFromNodeSchema).optional(),
  schema_overrides: z.array(HandleSchemaOverridesItemSchema).optional().describe('Override block schema for specific JSON path'),
})

export const HandleOutputFromSchema = /* @__PURE__ */ z.strictObject({
  handle: HandleNameSchema,
  from_flow: z.array(HandleFromFlowSchema).optional(),
  from_node: z.array(HandleFromNodeSchema).optional(),
})

export const ValueNodeSchema = /* @__PURE__ */ z.strictObject({
  node_id: NodeIdSchema,
  ignore: z.boolean().optional().describe('Ignore this Node in execution'),
  icon: z.string().optional().describe('Path to a icon image for the Node'),
  title: z.string().optional().describe('Node title'),
  description: z.string().optional().describe('Node description'),
  values: z.array(ValueHandleDefSchema).describe('Provide static value for block'),
})

const NodeBase = {
  node_id: NodeIdSchema,
  ignore: z.boolean().optional().describe('Ignore this Node in execution'),
  icon: z.string().optional().describe('Path to a icon image for the Node'),
  title: z.string().optional().describe('Node title'),
  description: z.string().optional().describe('Node description'),
  inputs_from: z.array(HandleInputFromSchema).optional().describe('Provide data source for Node input Handles.'),
  progress_weight: z
    .number()
    .min(0)
    .default(1)
    // eslint-disable-next-line max-len
    .describe(
      "The weight of this node in current flow progress calculation. Flow will sum all nodes' progress divided by their weight sum. Default is 1. Set to 0 to ignore this node in flow's progress calculation.",
    ),
}

const ScheduledNodeBase = {
  ...NodeBase,
  timeout: z.number().positive().optional().describe('Node execution timeout in seconds'),
}

export const TaskNodeSchema = /* @__PURE__ */ z.strictObject({
  ...ScheduledNodeBase,
  task: z.union([z.string().regex(LOCAL_BLOCK_REFERENCE_PATTERN).describe('Location of a Task Block manifest'), InlineTaskBlockSchema]),
  inputs_def: z.array(InputHandleDefSchema).optional().describe("Additional inputs def if the task's additional_inputs is set"),
  outputs_def: z.array(OutputHandleDefSchema).optional().describe("Additional outputs def if the task's additional_outputs is set"),
})

export const SubflowNodeSchema = /* @__PURE__ */ z
  .strictObject({
    ...ScheduledNodeBase,
    subflow: z.string().regex(LOCAL_BLOCK_REFERENCE_PATTERN).describe('Location of a Subflow Block manifest'),
  })
  .describe('Subflow Node points to a Subflow Block manifest')

export const ConditionNodeSchema = /* @__PURE__ */ z
  .strictObject({
    ...NodeBase,
    inputs_def: z.array(InputHandleDefSchema).optional().describe('Input handles definitions'),
    conditions: InlineConditionBlockSchema,
  })
  .describe('Condition Node returns all inputs as output from successful condition evaluation.')

const TriggerIdentitySchema = /* @__PURE__ */ z.string().min(1)
const JsonValueSchema: z.ZodType<JsonValue, JsonValue> = /* @__PURE__ */ z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(JsonValueSchema), JsonObjectSchema]),
)
const JsonObjectSchema: z.ZodType<JsonObject, JsonObject> = /* @__PURE__ */ z
  .record(z.string(), JsonValueSchema)
  .refine(isJsonObject, 'Expected a JSON-safe object.')

export const TriggerDefinitionSchema = /* @__PURE__ */ z.strictObject({
  service_id: TriggerIdentitySchema,
  service_name: TriggerIdentitySchema,
  name: TriggerIdentitySchema,
  provisioning: z.strictObject({
    kind: z.enum(['integration', 'poll', 'webhook']),
  }),
  connector: z
    .strictObject({
      service_id: TriggerIdentitySchema,
      account_required: z.literal(true),
    })
    .optional(),
  config_schema: JsonObjectSchema,
  payload_schema: JsonObjectSchema,
})

export const TriggerPollTimeSchema = /* @__PURE__ */ z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('cron'),
    expression: z
      .string()
      .trim()
      .min(1)
      .refine((expression) => expression.split(/\s+/).length == 5, 'Expected a five-field cron expression.'),
    timezone: z.string().trim().min(1),
  }),
  z.strictObject({
    type: z.literal('every'),
    unit: z.enum(['minute', 'hour', 'day', 'week', 'month']),
    value: z.number().int().positive(),
  }),
])

export const TriggerDescriptorSchema = /* @__PURE__ */ z.strictObject({
  type: TriggerIdentitySchema,
  revision: TriggerIdentitySchema,
  connection: TriggerIdentitySchema.optional(),
  config: JsonObjectSchema,
  poll_times: z.tuple([TriggerPollTimeSchema]).optional(),
})

export const TriggerDefinitionSnapshotSchema = /* @__PURE__ */ z.strictObject({
  type: TriggerIdentitySchema,
  revision: TriggerIdentitySchema,
  definition: TriggerDefinitionSchema,
})

export const TriggerNodeSchema = /* @__PURE__ */ z.strictObject({
  node_id: NodeIdSchema,
  ignore: z.boolean().optional().describe('Ignore this Trigger when building a deployment'),
  icon: z.string().optional().describe('Path to a icon image for the Trigger'),
  title: z.string().optional().describe('Trigger title'),
  description: z.string().optional().describe('Trigger description'),
  trigger: TriggerDescriptorSchema,
})

export const NodeSchema = /* @__PURE__ */ z.union([TaskNodeSchema, SubflowNodeSchema, ValueNodeSchema, ConditionNodeSchema])
export const FlowNodeSchema = /* @__PURE__ */ z.union([TaskNodeSchema, SubflowNodeSchema, ValueNodeSchema, ConditionNodeSchema, TriggerNodeSchema])
