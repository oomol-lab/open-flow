import type { IntegrationDefinition } from '../common/integration.ts'

import { isJsonObject } from '../../base/common/json.ts'
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
          const payload = context.payload
          if (!isJsonObject(payload) || typeof payload.deliveryId !== 'string' || payload.deliveryId.length === 0)
            throw new PermanentIntegrationError('The source event has no delivery identity.')
          return { outcome: 'event', dedupeKey: payload.deliveryId, outputs: payload }
        },
        async reconcile() {
          throw new PermanentIntegrationError('This deployment does not support shared event sources.')
        },
      }) satisfies IntegrationDefinition,
  )
