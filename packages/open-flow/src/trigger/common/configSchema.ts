import { z } from 'zod'

export const configInputsSchema = z.array(
  z.union([
    z.strictObject({ handle: z.string().min(1), description: z.string().optional(), jsonSchema: z.json(), nullable: z.boolean(), value: z.json().optional() }),
    z.strictObject({ group: z.string(), collapsed: z.boolean().optional() }),
  ]),
)
