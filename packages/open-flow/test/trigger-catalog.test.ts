import type { TriggerDefinition } from '../src/schema/index.ts'
import type { TriggerCatalogSource } from '../src/trigger/common/catalog.ts'

import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  decodeTriggerCatalogItem,
  encodeTriggerCatalogIdentity,
  getTriggerCatalogItem,
  normalizeTriggerCatalogSourceItem,
  searchTriggerCatalog,
  TRIGGER_CATALOG_REVISION,
} from '../src/trigger/common/catalog.ts'

function catalogItem(
  provider: string,
  key: string,
  displayName: string,
  configSchema: TriggerDefinition['config_schema'] = { additionalProperties: false, type: 'object' },
  type: 'integration' | 'poll' = 'poll',
  outputs: readonly import('../src/flow/common/change.ts').Port[] = [
    { handle: 'payload', jsonSchema: { additionalProperties: true, type: 'object' }, nullable: false },
  ],
): Readonly<Record<string, unknown>> {
  const item = {
    configSchema,
    description: `${displayName} event`,
    displayName,
    key,
    name: key.slice(key.indexOf('.') + 1),
    provider,
    type,
  }
  return { ...item, outputs }
}

function catalogSource(items: readonly Readonly<Record<string, unknown>>[]): TriggerCatalogSource {
  return {
    async get(key) {
      const item = items.find((candidate) => candidate.key == key)
      if (item == null) throw new Error(`Unknown Trigger key "${key}".`)
      return item
    },
    async list() {
      return { keys: items.map(({ configSchema: _configSchema, outputs: _outputs, ...item }) => item) }
    },
  }
}

test('normalizes provider poll and integration Triggers', async () => {
  const poll = await normalizeTriggerCatalogSourceItem(catalogItem('gmail', 'gmail.on_message_received', 'New message'))
  assert.equal(poll.compatible, true)
  if (!poll.compatible) throw new Error('Expected a compatible poll Trigger.')
  assert.deepEqual(poll.trigger.poll_times, [{ type: 'every', unit: 'minute', value: 5 }])

  const outputs = [
    {
      handle: 'payload',
      nullable: false,
      jsonSchema: {
        additionalProperties: false,
        properties: { action: { type: 'string' } },
        required: ['action'],
        type: 'object',
      },
    },
  ] as const
  const integration = await normalizeTriggerCatalogSourceItem(
    catalogItem('github', 'github.on_repo_event', 'Repository event', { additionalProperties: false, type: 'object' }, 'integration', outputs),
  )
  assert.equal(integration.compatible, true)
  if (!integration.compatible) throw new Error('Expected a compatible Integration Trigger.')
  assert.equal(integration.trigger.definition.provisioning.kind, 'integration')
  assert.deepEqual(
    integration.trigger.definition.outputs,
    outputs.map(({ jsonSchema, ...port }) => Object.assign({}, port, { json_schema: jsonSchema })),
  )
  assert.equal(integration.trigger.poll_times, undefined)
  assert.deepEqual(await decodeTriggerCatalogItem(integration), integration)
})

test('searches summaries before loading matching Trigger details', async () => {
  const github = catalogItem('github', 'github.on_push', 'Push')
  const sheets = catalogItem('google-sheets', 'google-sheets.on_spreadsheet_changed', 'Spreadsheet changed')
  const detailRequests: string[] = []
  const source = catalogSource([github, sheets])
  const page = await searchTriggerCatalog(
    {
      ...source,
      async get(key) {
        detailRequests.push(key)
        return await source.get(key)
      },
    },
    { query: 'change' },
  )

  assert.deepEqual(detailRequests, ['google-sheets.on_spreadsheet_changed'])
  assert.equal(page.items[0]?.type, 'google-sheets.on_spreadsheet_changed')
  assert.equal(page.nextCursor, null)
})

test('rejects incompatible definitions and unsupported identities', async () => {
  const unsupported = catalogItem('github', 'github.on_push', 'Push', {
    oneOf: [{ type: 'object' }],
    type: 'object',
  })
  const normalized = await normalizeTriggerCatalogSourceItem(unsupported)
  assert.equal(normalized.compatible, false)
  if (normalized.compatible) throw new Error('Expected an incompatible Trigger Catalog item.')
  assert.match(normalized.reason, /oneOf/i)
  assert.ok(normalized.reason.length <= 500)

  await assert.rejects(getTriggerCatalogItem(catalogSource([unsupported]), { revision: 'unsupported', type: 'github.on_push' }), /revision "2"/)
  assert.equal(encodeTriggerCatalogIdentity({ revision: TRIGGER_CATALOG_REVISION, type: 'github.on_push' }), '["github.on_push","2"]')
})
