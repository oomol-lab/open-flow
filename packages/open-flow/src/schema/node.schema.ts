import type { JsonObject } from '../base/common/json.ts'
import type { JsonValue } from '../types/index.ts'

import { z } from 'zod'
import { isJsonObject } from '../base/common/json.ts'
import { GroupDividerDefSchema, InputHandleDefSchema, OutputHandleDefSchema } from './handle.schema.ts'

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
  config_inputs: z.array(z.union([InputHandleDefSchema, GroupDividerDefSchema])),
  outputs: z.array(OutputHandleDefSchema).refine((ports) => new Set(ports.map((port) => port.handle)).size === ports.length),
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
