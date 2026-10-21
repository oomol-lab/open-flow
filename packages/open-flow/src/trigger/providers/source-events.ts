import type { IntegrationDefinition } from '../common/integration.ts'

import { PermanentIntegrationError } from '../common/integration.ts'
import catalog from './catalog.generated.json' with { type: 'json' }

export const sourceEvents: readonly IntegrationDefinition[] = catalog
  .filter((item) => 'eventSource' in item)
  .map(
    (item) =>
      ({
        eventSource: ('eventSource' in item ? item.eventSource : undefined) as IntegrationDefinition['eventSource'],
        snapshot: item.snapshot as unknown as IntegrationDefinition['snapshot'],
        receive(context) {
          if (context.eventSourceId !== context.config.sourceId) return { outcome: 'respond', status: 404, body: '', contentType: 'text/plain' }
          const payload = context.payload as Record<string, import('../../flow/common/change.ts').JsonValue>
          return { outcome: 'event', dedupeKey: payload.deliveryId as string, outputs: payload }
        },
        async reconcile() {
          throw new PermanentIntegrationError('This deployment does not support shared event sources.')
        },
      }) satisfies IntegrationDefinition,
  )
