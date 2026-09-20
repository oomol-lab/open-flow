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
      configInputs: [
        { handle: 'sourceId', jsonSchema: { type: 'string', pattern: '^source_[0-9a-f]{32}$', title: 'Event source' }, nullable: false },
        {
          handle: 'eventTypes',
          jsonSchema: {
            type: 'array',
            minItems: 1,
            maxItems: 200,
            uniqueItems: true,
            items: { type: 'string', pattern: '^[a-z][a-z0-9_.]{0,127}$' },
            title: 'Event types',
          },
          nullable: false,
        },
        {
          handle: 'chatIds',
          jsonSchema: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 256 }, title: 'Chat IDs' },
          nullable: true,
          description: 'Leave empty to receive events from all chats available to the source.',
        },
        {
          handle: 'resource',
          jsonSchema: {
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
          nullable: true,
        },
      ],
      outputs: [
        { handle: 'event', jsonSchema: { type: 'string' }, nullable: false },
        { handle: 'deliveryId', jsonSchema: { type: 'string' }, nullable: false },
        { handle: 'appId', jsonSchema: { type: 'string' }, nullable: false },
        { handle: 'tenantKey', jsonSchema: { type: 'string' }, nullable: false },
        { handle: 'occurredAt', jsonSchema: { type: 'string' }, nullable: true },
        { handle: 'body', jsonSchema: { type: 'object' }, nullable: false },
      ],
    },
    receive(context) {
      if (context.eventSourceId !== context.config.sourceId) return { outcome: 'respond', status: 404, body: '', contentType: 'text/plain' }
      const payload = context.payload as Record<string, import('../../../flow/common/change.ts').JsonValue>
      return { outcome: 'event', dedupeKey: payload.deliveryId as string, outputs: payload }
    },
    async reconcile() {
      throw new PermanentIntegrationError('This deployment does not support shared Feishu event sources.')
    },
  },
]
