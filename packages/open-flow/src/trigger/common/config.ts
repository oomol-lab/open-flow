import type { Group, InputPort, InputValues, JsonValue } from '../../flow/common/model.ts'

import eventSources from '../../event-source/common/catalog.generated.json' with { type: 'json' }
import { inputValue } from '../../flow/common/inputValue.ts'
import { matchesSchema } from '../../flow/common/schema.ts'

export function clearTriggerEventSource(key: string, config: InputValues): InputValues {
  if (!eventSources.some((source) => source.triggerId === key)) return config
  return { ...config, sourceId: { kind: 'unset' } }
}

export function triggerConfigValue(input: InputPort, config: InputValues): JsonValue | undefined {
  return inputValue(config[input.handle], input.value)
}

/** Provider-specific controls consume values, never persistence wrappers. */
export function triggerConfigValues(inputs: readonly (InputPort | Group)[], config: InputValues): Readonly<Record<string, JsonValue>> {
  return Object.fromEntries(inputs.flatMap((input) => ('handle' in input ? [[input.handle, triggerConfigValue(input, config) ?? null]] : [])))
}

export function missingTriggerConfig(inputs: readonly (InputPort | Group)[], config: InputValues): readonly string[] {
  return inputs.flatMap((input) => ('handle' in input && !input.nullable && triggerConfigValue(input, config) === undefined ? [input.handle] : []))
}

function resolvedTriggerConfig(inputs: readonly (InputPort | Group)[], config: InputValues, allowUnset: boolean): Readonly<Record<string, JsonValue>> {
  const fields = inputs.filter((input): input is InputPort => 'handle' in input)
  const handles = new Set(fields.map((input) => input.handle))
  if (handles.size !== fields.length) throw new TypeError('Trigger config has duplicate input handles.')
  const unknown = Object.keys(config).find((handle) => !handles.has(handle))
  if (unknown != null) throw new TypeError(`Unknown Trigger config input "${unknown}".`)
  const resolved = Object.fromEntries(
    fields.flatMap((input) => {
      const rawValue = triggerConfigValue(input, config)
      if (allowUnset && rawValue === undefined) return []
      const value = rawValue ?? null
      if (!(value === null && input.nullable) && !matchesSchema(value, input.jsonSchema)) {
        throw new TypeError(`Trigger config input "${input.handle}" does not match its declared schema.`)
      }
      return [[input.handle, value] as const]
    }),
  )
  if (new TextEncoder().encode(JSON.stringify(resolved)).byteLength > 64 * 1024) throw new TypeError('Trigger config exceeds the 65536-byte limit.')
  return resolved
}

/** Resolves fixed inputs before a Provider sees them, using the same defaults/null semantics as node inputs. */
export function resolveTriggerConfig(inputs: readonly (InputPort | Group)[], config: InputValues): Readonly<Record<string, JsonValue>> {
  return resolvedTriggerConfig(inputs, config, false)
}

export function validateTemplateTriggerConfig(inputs: readonly (InputPort | Group)[], config: InputValues): void {
  resolvedTriggerConfig(inputs, config, true)
}
