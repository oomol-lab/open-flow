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
