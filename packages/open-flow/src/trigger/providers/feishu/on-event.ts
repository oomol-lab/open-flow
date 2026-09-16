import type { IntegrationDefinition } from '../../common/integration.ts'

import { PermanentIntegrationError } from '../../common/integration.ts'

export const feishuEvents: readonly IntegrationDefinition[] = [
  {
    eventSource: 'feishu',
    snapshot: {
      key: 'feishu_app_bot.on_event',
      provider: 'feishu_app_bot',
      name: 'on_event',
      displayName: 'Application Event',
      description: 'Receives selected Feishu application events through a shared event source.',
      definitionVersion: 2,
      type: 'integration',
      endpoint: { methods: ['POST'], body: { formats: ['json'], allowArray: false, allowEmpty: false }, successStatus: 200 },
      configSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sourceId: { type: 'string', pattern: '^source_[0-9a-f]{32}$', title: 'Event source' },
          eventTypes: {
            type: 'array',
            minItems: 1,
            maxItems: 200,
            uniqueItems: true,
            items: { type: 'string', pattern: '^[a-z][a-z0-9_.]{0,127}$' },
            title: 'Event types',
          },
          chatIds: {
            type: 'array',
            maxItems: 100,
            uniqueItems: true,
            items: { type: 'string', minLength: 1, maxLength: 256 },
            title: 'Chat IDs',
            description: 'Leave empty to receive events from all chats available to the source.',
          },
          resource: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'id'],
            title: 'Resource subscription',
            properties: {
              kind: { type: 'string', enum: ['document', 'calendar', 'approval'] },
              id: { type: 'string', minLength: 1, maxLength: 256 },
              documentType: { type: 'string', enum: ['doc', 'docx', 'sheet', 'bitable', 'file', 'folder'] },
            },
          },
        },
        required: ['sourceId', 'eventTypes'],
      },
      outputs: [
        {
          handle: 'payload',
          jsonSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              event: { type: 'string' },
              deliveryId: { type: 'string' },
              appId: { type: 'string' },
              tenantKey: { type: 'string' },
              occurredAt: { type: ['string', 'null'] },
              body: { type: 'object' },
            },
            required: ['event', 'deliveryId', 'appId', 'tenantKey', 'occurredAt', 'body'],
          },
          nullable: false,
        },
      ],
    },
    receive(context) {
      if (context.eventSourceId !== context.config.sourceId) return { outcome: 'respond', status: 404, body: '', contentType: 'text/plain' }
      const payload = context.payload as Record<string, import('../../../flow/common/change.ts').JsonValue>
      return { outcome: 'event', dedupeKey: payload.deliveryId as string, payload }
    },
    async reconcile() {
      throw new PermanentIntegrationError('This deployment does not support shared Feishu event sources.')
    },
  },
]
