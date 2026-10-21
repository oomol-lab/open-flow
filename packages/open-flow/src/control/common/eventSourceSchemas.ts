import type { CreateEventSource, UpdateEventSource } from './eventSources.ts'

import { z } from 'zod'
import catalog from '../../trigger/providers/catalog.generated.json' with { type: 'json' }

function requestSchema(schema: unknown): z.ZodObject {
  return (z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]) as z.ZodObject).extend({ name: z.string().trim().min(1).max(128) })
}

const sources = catalog.flatMap((entry) => ('source' in entry && entry.source != null ? [entry.source] : []))
export const createEventSourceSchema = z.union(sources.map((source) => requestSchema(source.createSchema))) as unknown as z.ZodType<CreateEventSource>
export const updateEventSourceSchema = requestSchema(sources[0]!.updateSchema) as unknown as z.ZodType<UpdateEventSource>
export const eventSourceRevisionSchema = z.strictObject({ version: z.literal(1), expectedRevision: z.int().positive() })
