import type { JsonValue, TriggerNode } from '../../../../flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { matchesTriggerOutputs } from '../../../../trigger/common/contract.ts'
import { triggerDefinitions } from '../../../../trigger/providers/definitions.ts'
import { defaultTriggerTestOutputs } from './triggerTestInputs.ts'

describe('Trigger test defaults', () => {
  it('uses configured Webhook fields and defaults without changing the definition', () => {
    const trigger: TriggerNode = {
      kind: 'webhook',
      name: 'Webhook',
      method: 'POST',
      bodyFields: [
        { handle: 'event', jsonSchema: { type: 'string', enum: ['order.created', 'order.updated'] }, nullable: false },
        { handle: 'count', jsonSchema: { type: 'integer' }, nullable: false, value: 0 },
        { handle: 'enabled', jsonSchema: { type: 'boolean' }, nullable: false, value: false },
        { handle: 'note', jsonSchema: { type: 'string' }, nullable: true },
      ],
    }
    const original = structuredClone(trigger)
    const outputs = defaultTriggerTestOutputs(trigger)
    expect(outputs).toEqual({ headers: {}, query: {}, body: { event: 'order.created', count: 0, enabled: false }, webhookUrl: 'https://example.com/webhook' })
    expect(matchesTriggerOutputs(trigger, outputs)).toBe(true)
    expect(trigger).toEqual(original)
    const get: TriggerNode = { ...trigger, method: 'GET' }
    expect(defaultTriggerTestOutputs(get)).not.toHaveProperty('body')
    expect(matchesTriggerOutputs(get, defaultTriggerTestOutputs(get))).toBe(true)
  })

  it('fills required Start parameters and keeps nullable parameters omitted', () => {
    const trigger: TriggerNode = {
      kind: 'start',
      name: 'Start',
      inputDefs: [
        { handle: 'message', nullable: false, jsonSchema: { type: 'string', default: 'Hello' } },
        { handle: 'count', nullable: false, jsonSchema: { type: 'integer', minimum: 5, multipleOf: 2 } },
        { handle: 'choice', nullable: false, jsonSchema: { const: 'created' } },
        { handle: 'enabled', nullable: false, jsonSchema: { type: 'boolean' } },
        { handle: 'note', nullable: true, jsonSchema: { type: 'string' } },
      ],
    }
    expect(defaultTriggerTestOutputs(trigger)).toEqual({ message: 'Hello', count: 6, choice: 'created', enabled: false })
  })

  it.each(['gmail.on_message_received', 'linear.on_issue_changed', 'tally.on_form_response', 'slackbot.on_event'])(
    'generates valid nested data for %s',
    (key) => {
      const definition = triggerDefinitions.find(({ snapshot }) => snapshot.key === key)!.snapshot
      const trigger: TriggerNode =
        definition.type === 'poll'
          ? { kind: 'poll', definition, name: definition.displayName, config: {}, pollTimes: [] }
          : { kind: 'integration', definition, name: definition.displayName, config: {} }
      const outputs = defaultTriggerTestOutputs(trigger)
      expect(matchesTriggerOutputs(trigger, outputs)).toBe(true)
      if ('events' in outputs) expect(outputs.events).toEqual([expect.any(Object)])
      if ('response' in outputs) expect(outputs.response).toEqual(expect.objectContaining({ fields: [expect.objectContaining({ value: null })] }))
    },
  )

  it('honors formats, explicit null, false and empty values and returns fresh copies', () => {
    const schemas: Readonly<Record<string, JsonValue>> = {
      time: { type: 'string', format: 'date-time' },
      email: { type: 'string', format: 'email' },
      empty: { type: 'array', default: [] },
      disabled: { type: 'boolean', default: false },
      nullable: { type: ['string', 'null'], default: null },
      nested: { type: 'object', default: { items: [] } },
    }
    const trigger: TriggerNode = {
      kind: 'start',
      name: 'Start',
      inputDefs: Object.entries(schemas).map(([handle, jsonSchema]) => ({ handle, jsonSchema, nullable: false })),
    }
    const outputs = defaultTriggerTestOutputs(trigger)
    expect(matchesTriggerOutputs(trigger, outputs)).toBe(true)
    expect(outputs).toMatchObject({ email: 'test@example.com', empty: [], disabled: false, nullable: null, nested: { items: [] } })
    expect(defaultTriggerTestOutputs(trigger).nested).not.toBe(outputs.nested)
  })

  it('leaves constraints it cannot satisfy unset instead of supplying invalid data', () => {
    const trigger: TriggerNode = {
      kind: 'start',
      name: 'Start',
      inputDefs: [{ handle: 'code', jsonSchema: { type: 'string', pattern: '^[A-Z]{4}$' }, nullable: false }],
    }
    expect(defaultTriggerTestOutputs(trigger)).toEqual({})
  })
})
