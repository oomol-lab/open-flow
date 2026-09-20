import type { TriggerNode } from '../../flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { matchesTriggerOutputs, triggerOutputDefinitions } from './contract.ts'
import { computeTriggerDefinitionDigest, validateTriggerDefinitionSchemas } from './definition.ts'

const webhook: TriggerNode = { kind: 'webhook', name: 'Webhook', bodyFields: [{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false }] }
const outputs = { headers: {}, query: {}, body: { message: 'hello' }, webhookUrl: 'https://example.com/webhook' }
const ports = [
  { handle: 'text', jsonSchema: { type: 'string' }, nullable: false },
  { handle: 'items', jsonSchema: { type: 'array', items: { type: 'number' } }, nullable: true },
] as const

it('declares ordered built-in ports', () => {
  expect(triggerOutputDefinitions({ kind: 'manual', name: 'Manual' })).toEqual([])
  expect(triggerOutputDefinitions({ kind: 'cron', name: 'Cron', cronTimes: [] }).map((port) => port.handle)).toEqual(['scheduledAt'])
  expect(triggerOutputDefinitions(webhook).map((port) => port.handle)).toEqual(['headers', 'query', 'body', 'webhookUrl'])
  expect(matchesTriggerOutputs({ kind: 'manual', name: 'Manual' }, {})).toBe(true)
  expect(matchesTriggerOutputs({ kind: 'manual', name: 'Manual' }, { payload: null })).toBe(false)
})

it('validates the Cron scheduled time as a direct output', () => {
  const trigger: TriggerNode = { kind: 'cron', name: 'Cron', cronTimes: [] }
  expect(triggerOutputDefinitions(trigger)[0]?.description).toBeUndefined()
  expect(matchesTriggerOutputs(trigger, { scheduledAt: '2026-08-21T00:01:00.000Z' })).toBe(true)
  expect(matchesTriggerOutputs(trigger, { scheduledAt: 1 })).toBe(false)
  expect(matchesTriggerOutputs(trigger, { payload: { scheduledAt: '2026-08-21T00:01:00.000Z' } })).toBe(false)
})

it.each([
  null,
  [],
  {},
  { ...outputs, extra: true },
  { ...outputs, body: {} },
  { ...outputs, body: { message: 'hello', extra: true } },
  { ...outputs, webhookUrl: 2 },
  { ...outputs, query: { x: [1] } },
])('rejects malformed outputs %j', (value) => {
  expect(matchesTriggerOutputs(webhook, value)).toBe(false)
})

it('accepts string or repeated query values and arbitrary own keys', () => {
  expect(matchesTriggerOutputs(webhook, { ...outputs, query: JSON.parse('{"__proto__":["a","b"],"constructor":"c"}') })).toBe(true)
})

describe.each(['poll', 'integration'] as const)('%s output definitions', (kind) => {
  const definition = {
    configInputs: [],
    definitionVersion: 2,
    description: '',
    displayName: 'Event',
    key: 'test.event',
    name: 'event',
    provider: 'test',
    outputs: ports,
  }
  const base = { name: 'Event', bindingId: 'account', config: {} }
  const trigger: TriggerNode =
    kind === 'poll'
      ? { ...base, kind, definition: { ...definition, type: kind }, pollTimes: [] }
      : {
          ...base,
          kind,
          definition: {
            ...definition,
            type: kind,
            endpoint: { body: { allowArray: false, allowEmpty: false, formats: ['json'] }, methods: ['POST'], successStatus: 200 },
          },
        }
  it('preserves heterogeneous ports and distinguishes missing from null', () => {
    expect(triggerOutputDefinitions(trigger)).toEqual(ports)
    expect(matchesTriggerOutputs(trigger, { text: 'ok', items: null })).toBe(true)
    expect(matchesTriggerOutputs(trigger, { text: 'ok', items: [1, 2] })).toBe(true)
    expect(matchesTriggerOutputs(trigger, { text: 'ok' })).toBe(false)
    expect(matchesTriggerOutputs(trigger, { text: null, items: [] })).toBe(false)
    expect(matchesTriggerOutputs(trigger, { text: 'ok', items: ['wrong'] })).toBe(false)
  })
})

it('allows scalar output schemas, rejects duplicates and retains object config roots', () => {
  expect(() => validateTriggerDefinitionSchemas({ configInputs: [], outputs: ports })).not.toThrow()
  expect(() => validateTriggerDefinitionSchemas({ configInputs: [{ handle: 'bad', nullable: false, jsonSchema: 'string' }], outputs: ports })).toThrow()
  expect(() => validateTriggerDefinitionSchemas({ configInputs: [], outputs: [ports[0], ports[0]] })).toThrow(/duplicate/)
})

it('includes output order and nullable in the definition digest', async () => {
  const definition = { configInputs: [], outputs: ports, provisioning: 'poll' as const, revision: '2', serviceId: 'test', type: 'test.event' }
  const digest = await computeTriggerDefinitionDigest(definition)
  expect(await computeTriggerDefinitionDigest({ ...definition, outputs: ports.toReversed() })).not.toBe(digest)
  expect(await computeTriggerDefinitionDigest({ ...definition, outputs: ports.map((port) => Object.assign({}, port, { nullable: false })) })).not.toBe(digest)
})
