import { z } from 'zod'
import { HandleSchemaOverridesItemSchema } from './schema-overrides.schema.ts'

export const HandleNameSchema = /* @__PURE__ */ z.string().describe('Handle name')

export const ConditionExpressionSchema = /* @__PURE__ */ z
  .strictObject({
    input_handle: HandleNameSchema.describe('Input handle name to evaluate the expression'),
    operator: z
      .enum([
        '==',
        '!=',
        '<',
        '<=',
        '>',
        '>=',
        'is null',
        'is not null',
        'is true',
        'is false',
        'contains',
        'not contains',
        'is empty',
        'is not empty',
        'has key',
        'not has key',
        'has value',
        'not has value',
        'starts with',
        'ends with',
      ])
      .describe('Operator to compare the handle value'),
    value: z.any().optional().describe('Value to compare the handle value'),
  })
  .describe('A single expression to evaluate a condition')

export const ConditionHandleDefSchema = /* @__PURE__ */ z
  .strictObject({
    handle: HandleNameSchema,
    description: /* @__PURE__ */ z.string().optional().describe('Describe the Condition'),
    logical: z.enum(['AND', 'OR']).optional().describe('Logical operator to combine multiple expressions, default is OR.').default('OR'),
    expressions: z.array(ConditionExpressionSchema).optional().describe('Expressions to evaluate the condition'),
  })
  .describe('Condition definition to control the flow')

export const DefaultConditionHandleDefSchema = /* @__PURE__ */ z
  .strictObject({
    handle: HandleNameSchema,
    description: /* @__PURE__ */ z.string().optional().describe('Describe the Default Condition'),
  })
  .describe('Default Condition definition to control the flow')

const BaseHandleDef = {
  handle: HandleNameSchema,
  description: /* @__PURE__ */ z.string().optional().describe('Describe the Handle'),
  json_schema: z
    .any()
    .optional()
    .describe('JSON Schema to validate value passed to the Handle, if not set, value will be treated as any type')
    .describe("'contentMediaType' is 'oomol/bin' means the value is a binary data.")
    .describe("'contentMediaType' is 'oomol/artifact' means the value is a runtime-managed ArtifactRef.")
    .describe("If 'contentMediaType' is undefined, value will be treated as 'application/json' type"),
  kind: z.string().optional().describe('Custom kind name. If set the value will be treated as the specified kind.'),
  nullable: z.boolean().optional().describe('If the value can be null, default is false.'),
}

export const OutputHandleDefSchema = /* @__PURE__ */ z.strictObject(BaseHandleDef).describe('Output Handles on Block.')

export const InputHandleDefSchema = /* @__PURE__ */ z
  .strictObject(BaseHandleDef)
  .extend({
    value: z.any().optional().describe('Provide static value for block, default is null.'),
    schema_overrides: z.array(HandleSchemaOverridesItemSchema).optional().describe('Override block schema for specific JSON path'),
  })
  .describe('Input Handles on Block.')

export const GroupDividerDefSchema = /* @__PURE__ */ z.strictObject({
  group: z.string().describe('Title of the group divider'),
  collapsed: z.boolean().optional().describe('If the group is collapsed, default is false.'),
})

export const ValueHandleDefSchema = /* @__PURE__ */ z
  .strictObject(BaseHandleDef)
  .extend({
    value: z.any().optional().describe('Provide static value for block, default is null.'),
  })
  .describe('Value Handles on Block.')
