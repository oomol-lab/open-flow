import type { JsonValue, Port, PortDefinition, TriggerNode } from '../../flow/common/change.ts'

import { isJsonObject } from '../../base/common/json.ts'
import { matchesSchema } from '../../flow/common/schema.ts'

export const webhookOutputs: readonly Port[] = [
  { handle: 'headers', jsonSchema: { type: 'object', additionalProperties: { type: 'string' } }, nullable: false },
  { handle: 'query', jsonSchema: { type: 'object', additionalProperties: { type: ['string', 'array'], items: { type: 'string' } } }, nullable: false },
  { handle: 'body', jsonSchema: { type: 'object', additionalProperties: true }, nullable: false },
  { handle: 'webhookUrl', jsonSchema: { type: 'string' }, nullable: false },
]
const cronOutputs: readonly Port[] = [
  {
    handle: 'scheduledAt',
    jsonSchema: { type: 'string', format: 'date-time' },
    nullable: false,
  },
]

export function triggerOutputDefinitions(trigger: TriggerNode): readonly Port[] {
  switch (trigger.kind) {
    case 'manual':
      return []
    case 'cron':
      return cronOutputs
    case 'poll':
    case 'integration':
      return trigger.definition.outputs
    case 'webhook':
      return webhookOutputs.map((port) =>
        port.handle === 'body'
          ? Object.assign({}, port, {
              jsonSchema: {
                type: 'object',
                additionalProperties: false,
                properties: Object.fromEntries(trigger.bodyFields.map((field) => [field.handle, field.jsonSchema])),
                required: trigger.bodyFields.filter((field) => !field.nullable && !Object.hasOwn(field, 'value')).map((field) => field.handle),
              },
            })
          : port,
      )
  }
}

export function triggerOutputPorts(trigger: TriggerNode): Readonly<Record<string, PortDefinition>> {
  return Object.fromEntries(triggerOutputDefinitions(trigger).map(({ handle, ...port }) => [handle, port]))
}

export function matchesTriggerOutputs(trigger: TriggerNode, outputs: unknown): outputs is Readonly<Record<string, JsonValue>> {
  if (!isJsonObject(outputs)) return false
  const ports = triggerOutputDefinitions(trigger)
  return (
    new Set(ports.map((port) => port.handle)).size === ports.length &&
    Object.keys(outputs).length === ports.length &&
    ports.every(
      (port) =>
        Object.hasOwn(outputs, port.handle) && ((outputs[port.handle] === null && port.nullable) || matchesSchema(outputs[port.handle]!, port.jsonSchema)),
    )
  )
}
