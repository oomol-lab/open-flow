import type { Group, InputPort, InputValues, JsonValue } from '../../flow/common/change.ts'

import { inputValue } from '../../flow/common/inputValue.ts'
import { matchesSchema } from '../../flow/common/schema.ts'

/** Deployment-bound selections owned by the Trigger configuration contract. */
export function clearTriggerExternalConfig(key: string, config: InputValues): InputValues {
  const fields =
    key == 'jira.on_issue_event' ||
    key == 'intercom.on_conversation_event' ||
    key == 'sentry.on_issue_alert' ||
    key == 'zoom.on_recording_ready' ||
    key == 'fireflies.on_meeting_ready'
      ? ['sourceId', 'eventTypes']
      : key == 'slackbot.on_event'
        ? ['sourceId', 'eventTypes', 'channelIds']
        : key == 'feishu_app_bot.on_event'
          ? ['sourceId', 'eventTypes', 'resource', 'chatIds']
          : key == 'linear.on_issue_changed'
            ? ['teamId', 'stateIds']
            : []
  return { ...config, ...Object.fromEntries(fields.map((field) => [field, { kind: 'unset' as const }])) }
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

/** Resolves fixed inputs before a Provider sees them, using the same defaults/null semantics as node inputs. */
export function resolveTriggerConfig(inputs: readonly (InputPort | Group)[], config: InputValues): Readonly<Record<string, JsonValue>> {
  const fields = inputs.filter((input): input is InputPort => 'handle' in input)
  const handles = new Set(fields.map((input) => input.handle))
  if (handles.size !== fields.length) throw new TypeError('Trigger config has duplicate input handles.')
  const unknown = Object.keys(config).find((handle) => !handles.has(handle))
  if (unknown != null) throw new TypeError(`Unknown Trigger config input "${unknown}".`)
  const resolved = Object.fromEntries(
    fields.map((input) => {
      const value = triggerConfigValue(input, config) ?? null
      if (!(value === null && input.nullable) && !matchesSchema(value, input.jsonSchema)) {
        throw new TypeError(`Trigger config input "${input.handle}" does not match its declared schema.`)
      }
      return [input.handle, value]
    }),
  )
  if (new TextEncoder().encode(JSON.stringify(resolved)).byteLength > 64 * 1024) throw new TypeError('Trigger config exceeds the 65536-byte limit.')
  return resolved
}
