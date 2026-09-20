import assert from 'node:assert/strict'
import { test } from 'vitest'
import { FlowSchema } from '../src/schema/index.ts'
import { builtInTriggers, findBuiltInTrigger, WEBHOOK_REVISION, WEBHOOK_TYPE, webhookTrigger } from '../src/trigger/common/builtins.ts'
import { normalizeTriggerCatalogSourceItem } from '../src/trigger/common/catalog.ts'
import { computeTriggerDefinitionDigest } from '../src/trigger/common/definition.ts'

test('publishes a stable built-in Webhook definition without provider configuration', async () => {
  assert.deepEqual(builtInTriggers, [webhookTrigger])
  assert.equal(findBuiltInTrigger({ revision: WEBHOOK_REVISION, type: WEBHOOK_TYPE }), webhookTrigger)
  assert.equal(findBuiltInTrigger({ revision: 'unknown', type: WEBHOOK_TYPE }), undefined)
  assert.equal(
    webhookTrigger.definitionDigest,
    await computeTriggerDefinitionDigest({
      configInputs: webhookTrigger.trigger.definition.config_inputs.map((port) =>
        'group' in port ? port : { ...port, jsonSchema: port.json_schema ?? {}, nullable: port.nullable ?? false },
      ),
      outputs: webhookTrigger.trigger.definition.outputs.map(({ json_schema, ...port }) => ({
        ...port,
        nullable: port.nullable ?? false,
        jsonSchema: json_schema ?? {},
      })),
      provisioning: 'webhook',
      revision: WEBHOOK_REVISION,
      serviceId: webhookTrigger.trigger.definition.service_id,
      type: WEBHOOK_TYPE,
    }),
  )
  assert.deepEqual(
    FlowSchema.parse({
      trigger_definitions: [
        {
          definition: webhookTrigger.trigger.definition,
          revision: webhookTrigger.revision,
          type: webhookTrigger.type,
        },
      ],
      nodes: [
        {
          node_id: 'webhook',
          trigger: {
            config: webhookTrigger.trigger.config,
            revision: webhookTrigger.revision,
            type: webhookTrigger.type,
          },
        },
      ],
    }).nodes[0],
    {
      node_id: 'webhook',
      trigger: {
        config: webhookTrigger.trigger.config,
        revision: webhookTrigger.revision,
        type: webhookTrigger.type,
      },
    },
  )
})

test('keeps the built-in Trigger namespace out of provider Catalog responses', async () => {
  const item = await normalizeTriggerCatalogSourceItem({
    configInputs: [],
    outputs: [],
    description: 'Webhook event',
    displayName: 'Webhook',
    key: webhookTrigger.type,
    name: 'webhook',
    provider: 'open-flow',
    type: 'poll',
  })

  assert.equal(item.compatible, false)
  if (item.compatible) throw new Error('Expected the provider definition to be incompatible.')
  assert.match(item.reason, /reserved Open Flow namespace/)
})
