import type { JsonValue, TriggerNode } from '../../../../flow/common/change.ts'

import { isJsonValue } from '../../../../base/common/json.ts'
import { matchesSchema, schemaObject } from '../../../../flow/common/schema.ts'
import { initialValue, valueType } from '../../../../form/common/value.ts'
import { sampleErrorOutputs, triggerOutputDefinitions } from '../../../../trigger/common/contract.ts'

/** Best-effort test data. Unsupported constraints stay unset for the user to fill in. */
function sampleValue(schema: JsonValue): JsonValue | undefined {
  const source = schemaObject(schema)
  const types = Array.isArray(source?.type) ? source.type : [source?.type]
  const type = types.find((candidate) => candidate !== 'null') ?? types[0]
  const initial = initialValue(schema, valueType({ type }, null))
  if (source == null) return isJsonValue(initial) && matchesSchema(initial, schema) ? initial : undefined
  if (
    (Object.hasOwn(source, 'default') || Object.hasOwn(source, 'const') || Array.isArray(source.enum)) &&
    isJsonValue(initial) &&
    matchesSchema(initial, schema)
  )
    return initial

  let value: JsonValue = null
  switch (type) {
    case 'object': {
      const properties = schemaObject(source.properties ?? {}) ?? {}
      const required = Array.isArray(source.required) ? source.required : []
      value = Object.fromEntries(
        Object.entries(properties).flatMap(([key, property]) => {
          if (!required.includes(key) && !Object.hasOwn(schemaObject(property) ?? {}, 'default')) return []
          const sample = sampleValue(property)
          return sample === undefined ? [] : [[key, sample]]
        }),
      )
      break
    }
    case 'array': {
      const item = sampleValue(source.items ?? {})
      const count = Math.min(20, typeof source.maxItems === 'number' ? source.maxItems : 20, Math.max(1, Number(source.minItems) || 0))
      value = item === undefined ? [] : Array.from({ length: count }, () => structuredClone(item))
      break
    }
    case 'string': {
      const formats: Readonly<Record<string, string>> = {
        'date-time': new Date().toISOString(),
        'date': new Date().toISOString().slice(0, 10),
        'time': '12:00:00Z',
        'email': 'test@example.com',
        'uri': 'https://example.com',
        'uri-reference': 'https://example.com',
        'uuid': '00000000-0000-4000-8000-000000000001',
      }
      const text = formats[String(source.format)] ?? 'sample'
      value = text.padEnd(Math.min(256, Number(source.minLength) || 0), 'x').slice(0, typeof source.maxLength === 'number' ? source.maxLength : undefined)
      break
    }
    case 'number':
    case 'integer': {
      const step = typeof source.multipleOf === 'number' && source.multipleOf > 0 ? source.multipleOf : 1
      let number = typeof source.minimum === 'number' ? source.minimum : 1
      if (typeof source.exclusiveMinimum === 'number') number = Math.max(number, source.exclusiveMinimum + step)
      if (typeof source.maximum === 'number') number = Math.min(number, source.maximum)
      if (typeof source.exclusiveMaximum === 'number') number = Math.min(number, source.exclusiveMaximum - step)
      value = Math.ceil((type === 'integer' ? Math.ceil(number) : number) / step) * step
      break
    }
    default:
      if (isJsonValue(initial)) value = initial
  }
  if (matchesSchema(value, schema)) return value
  return isJsonValue(initial) && matchesSchema(initial, schema) ? initial : undefined
}

export function defaultTriggerTestOutputs(trigger: TriggerNode): Readonly<Record<string, JsonValue>> {
  if (trigger.kind === 'error') return structuredClone(sampleErrorOutputs)
  if (trigger.kind === 'cron') return { scheduledAt: new Date().toISOString() }
  return Object.fromEntries(
    triggerOutputDefinitions(trigger).flatMap((port) => {
      if (trigger.kind === 'start' && port.nullable) return []
      let value = trigger.kind === 'webhook' && port.handle === 'webhookUrl' ? 'https://example.com/webhook' : sampleValue(port.jsonSchema)
      if (trigger.kind === 'webhook' && port.handle === 'body') {
        const body = {
          ...schemaObject(value ?? {}),
          ...Object.fromEntries(trigger.bodyFields.flatMap((field) => (field.value === undefined ? [] : [[field.handle, structuredClone(field.value)]]))),
        }
        value = matchesSchema(body, port.jsonSchema) ? body : undefined
      }
      return value === undefined ? (port.nullable ? [[port.handle, null]] : []) : [[port.handle, value]]
    }),
  )
}
