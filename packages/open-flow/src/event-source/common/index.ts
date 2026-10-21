import type { EventSourceDefinition, SourceConfiguration } from './definition.ts'

import { z } from 'zod'
import { eventSourceViewSchema } from '../../control/common/eventSources.ts'
import catalog from '../../trigger/providers/catalog.generated.json' with { type: 'json' }
import { SourceIdentityError } from './definition.ts'

export type { EventSourceDefinition, SourceConfiguration, SourceEvent, SourceSubscription, SourceOperation } from './definition.ts'
export { SourceIdentityError } from './definition.ts'

export function eventSourceDefinition(kind: string): EventSourceDefinition {
  for (const entry of catalog) if ('source' in entry && entry.source != null && entry.source.kind === kind) return entry.source
  throw new SourceIdentityError(`Unknown event source kind: ${kind}`)
}

const jsonObject = z.record(z.string(), z.json())
const projectionSchema = z.object({ view: eventSourceViewSchema, ready: z.boolean(), expiresAt: z.number().optional() })
export const sourceConfigurationSchema = z.object({
  identity: z.string().min(1),
  eventTypes: z.array(z.string()),
  config: jsonObject,
  secrets: jsonObject,
  state: jsonObject.refine((state) => projectionSchema.safeParse(state.projection).success, 'Connector source projection is invalid.'),
})

export function sourceReady(source: SourceConfiguration, now = Date.now()): boolean {
  const projection = projectionSchema.safeParse(source.state.projection)
  return projection.success && projection.data.ready && (projection.data.expiresAt == null || projection.data.expiresAt > now)
}

export function sourceView(source: SourceConfiguration, now = Date.now()): z.infer<typeof eventSourceViewSchema> {
  const projection = projectionSchema.parse(source.state.projection)
  const expired = projection.expiresAt != null && projection.expiresAt <= now
  return {
    ...projection.view,
    ...(expired ? { subscriptionStatus: 'error', lastError: 'The source subscription expired. Restore Connector access and retry publication.' } : {}),
  }
}
