import type { TriggerCatalogCompatibleItem, TriggerCatalogIdentity } from './catalog.ts'

import { webhookOutputs } from './contract.ts'

export const BUILT_IN_TRIGGER_NAMESPACE = 'open-flow.'
export const WEBHOOK_TYPE = 'open-flow.webhook'
export const WEBHOOK_REVISION = '2'

export const webhookTrigger: TriggerCatalogCompatibleItem = {
  compatible: true,
  definitionDigest: 'sha256:be38773c7273ed490be13a5c30abbc3300c4262b96614d73fb351e01fb36d9dc',
  icon: ':carbon:webhook:',
  revision: WEBHOOK_REVISION,
  trigger: {
    config: {},
    definition: {
      config_schema: {
        additionalProperties: false,
        type: 'object',
      },
      name: 'Webhook',
      provisioning: { kind: 'webhook' },
      outputs: webhookOutputs.map(({ jsonSchema, ...port }) => Object.assign({}, port, { json_schema: jsonSchema })),
      service_id: 'open-flow',
      service_name: 'Open Flow',
    },
    revision: WEBHOOK_REVISION,
    type: WEBHOOK_TYPE,
  },
  type: WEBHOOK_TYPE,
}

export const builtInTriggers: readonly TriggerCatalogCompatibleItem[] = [webhookTrigger]

export function isBuiltInTriggerType(type: string): boolean {
  return type.startsWith(BUILT_IN_TRIGGER_NAMESPACE)
}

export function findBuiltInTrigger(identity: TriggerCatalogIdentity): TriggerCatalogCompatibleItem | undefined {
  return builtInTriggers.find((item) => item.type === identity.type && item.revision === identity.revision)
}
