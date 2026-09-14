import { z } from 'zod'

const id = z.string().min(1).max(256)
const eventType = z.string().regex(/^[a-z][a-z0-9_.]{0,127}$/)
const name = z.string().trim().min(1).max(128)
const secret = z.string().min(1).max(256)

export const createEventSourceSchema = z.strictObject({
  version: z.literal(1),
  name,
  connectionId: id,
  teamId: id.nullable(),
  verificationToken: secret,
  encryptKey: secret,
  eventTypes: z
    .array(eventType)
    .min(1)
    .max(200)
    .refine((values) => new Set(values).size == values.length),
  manageSubscriptions: z.boolean(),
})

export const updateEventSourceSchema = z.strictObject({
  version: z.literal(1),
  expectedRevision: z.int().positive(),
  name,
  enabled: z.boolean(),
  eventTypes: z
    .array(eventType)
    .min(1)
    .max(200)
    .refine((values) => new Set(values).size == values.length),
  verificationToken: secret.optional(),
  encryptKey: secret.optional(),
})

export const eventSourceRevisionSchema = z.strictObject({ version: z.literal(1), expectedRevision: z.int().positive() })

const eventSourceSchema = z.strictObject({
  version: z.literal(1),
  sourceId: id,
  revision: z.int().positive(),
  name,
  provider: z.enum(['feishu', 'feishu_app_bot']),
  appId: id,
  tenantKey: id,
  connectionId: id,
  teamId: id.nullable(),
  enabled: z.boolean(),
  eventTypes: z.array(eventType),
  manageSubscriptions: z.boolean(),
  verificationTokenConfigured: z.boolean(),
  encryptKeyConfigured: z.boolean(),
  endpointUrl: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  lastReceivedAt: z.string().nullable(),
  updatedAt: z.string(),
  consumers: z.array(z.strictObject({ flowId: id, flowName: z.string(), triggerNodeId: id })),
})

export type EventSource = z.infer<typeof eventSourceSchema>
export type CreateEventSource = z.infer<typeof createEventSourceSchema>
export type UpdateEventSource = z.infer<typeof updateEventSourceSchema>

export function decodeEventSource(value: unknown): EventSource {
  return eventSourceSchema.parse(value)
}

export function decodeEventSources(value: unknown): { readonly version: 1; readonly sources: readonly EventSource[]; readonly teamId?: string | null } {
  return z.strictObject({ version: z.literal(1), sources: z.array(eventSourceSchema), teamId: id.nullable().optional() }).parse(value)
}
