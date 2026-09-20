import type { Group, InputPort, JsonValue } from '../../flow/common/change.ts'

import { z } from 'zod'
import { matchesSchema } from '../../flow/common/schema.ts'

export const configInputsSchema = z.array(
  z.union([
    z.strictObject({ handle: z.string().min(1), description: z.string().optional(), jsonSchema: z.json(), nullable: z.boolean(), value: z.json().optional() }),
    z.strictObject({ group: z.string(), collapsed: z.boolean().optional() }),
  ]),
)

export function triggerConfigValue(input: InputPort, config: Readonly<Record<string, JsonValue>>): JsonValue {
  const value = Object.hasOwn(config, input.handle) ? config[input.handle] : input.value
  return value === undefined ? null : value
}

export function missingTriggerConfig(inputs: readonly (InputPort | Group)[], config: Readonly<Record<string, JsonValue>>): readonly string[] {
  return inputs.flatMap((input) =>
    'handle' in input && !input.nullable && !Object.hasOwn(config, input.handle) && input.value === undefined ? [input.handle] : [],
  )
}

/** Resolves fixed inputs before a Provider sees them, using the same defaults/null semantics as node inputs. */
export function resolveTriggerConfig(inputs: readonly (InputPort | Group)[], config: Readonly<Record<string, JsonValue>>): Readonly<Record<string, JsonValue>> {
  const fields = inputs.filter((input): input is InputPort => 'handle' in input)
  const handles = new Set(fields.map((input) => input.handle))
  if (handles.size !== fields.length) throw new TypeError('Trigger config has duplicate input handles.')
  const unknown = Object.keys(config).find((handle) => !handles.has(handle))
  if (unknown != null) throw new TypeError(`Unknown Trigger config input "${unknown}".`)
  const resolved = Object.fromEntries(
    fields.map((input) => {
      const value = triggerConfigValue(input, config)
      if (!(value === null && input.nullable) && !matchesSchema(value, input.jsonSchema)) {
        throw new TypeError(`Trigger config input "${input.handle}" does not match its declared schema.`)
      }
      return [input.handle, value]
    }),
  )
  if (new TextEncoder().encode(JSON.stringify(resolved)).byteLength > 64 * 1024) throw new TypeError('Trigger config exceeds the 65536-byte limit.')
  return resolved
}
