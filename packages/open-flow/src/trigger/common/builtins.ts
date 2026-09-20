import type { TriggerCatalogCompatibleItem, TriggerCatalogIdentity } from './catalog.ts'

import { webhookOutputs } from './contract.ts'

export const BUILT_IN_TRIGGER_NAMESPACE = 'open-flow.'
export const WEBHOOK_TYPE = 'open-flow.webhook'
export const WEBHOOK_REVISION = '2'

export const webhookTrigger: TriggerCatalogCompatibleItem = {
  compatible: true,
  definitionDigest: 'sha256:35c07b0b352991fb0dfdeb925b8790cc60684c2cf77ba8ab46c3e32143ac9d5e',
  icon: ':carbon:webhook:',
  revision: WEBHOOK_REVISION,
  trigger: {
    config: {},
    definition: {
      config_inputs: [],
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
