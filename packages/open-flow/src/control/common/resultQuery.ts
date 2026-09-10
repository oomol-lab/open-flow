import { z } from 'zod'

export const resultQuerySchema = z.strictObject({
  pointer: z.string().max(4096).default(''),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(20),
  maxBytes: z.number().int().min(1).max(1048576).default(15000),
})
