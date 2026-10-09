import type { Group, InputPort, JsonValue, ManagedTaskDefinition } from '../../flow/common/change.ts'

import { dequal } from 'dequal/lite'
import { z } from 'zod'

// Values remain JSON so an existing draft with invalid runtime values can still
// be inspected and repaired without rewriting unrelated configuration.
export const authoringLlmConfiguration = z.strictObject({
  mode: z.enum(['chat', 'json']),
  resultSchema: z.json(),
  model: z.json().optional().describe('Default model settings: {model, temperature?, top_p?, max_tokens?}. A bound model input takes precedence.'),
  template: z.json().optional().describe('Default message templates: [{role: "system" | "user" | "assistant", content: "Text with {{namedInput}}"}].'),
  messages: z.json().optional().describe('Default conversation history, prepended without template interpolation; an array of {role, content} or null.'),
})

const defaults = { model: 'model', template: 'template', messages: 'messages' } as const
type DefaultName = keyof typeof defaults

/** Read defaults only. Node bindings remain independently visible and editable. */
export function llmConfigurationView(task: ManagedTaskDefinition): Record<string, JsonValue> {
  if (task.executor.kind != 'llm') throw new TypeError('Expected an LLM task.')
  const config: Record<string, JsonValue> = {
    mode: task.executor.mode,
    resultSchema: task.outputs.find((port) => 'handle' in port)?.jsonSchema ?? {},
  }
  for (const [name, handle] of Object.entries(defaults)) {
    const port = task.inputs.find((candidate): candidate is InputPort => 'handle' in candidate && candidate.handle == handle)
    if (port != null && Object.hasOwn(port, 'value')) config[name] = port.value!
  }
  return config
}

/** Update default values without altering port contracts, groups, or node bindings. */
export function prepareLlmConfiguration(config: Record<string, unknown>, previous: ManagedTaskDefinition, name: string): ManagedTaskDefinition {
  if (previous.executor.kind != 'llm') throw new TypeError('Expected an LLM task.')
  const old = llmConfigurationView(previous)
  const changed = (Object.keys(defaults) as DefaultName[]).filter(
    (key) => Object.hasOwn(old, key) != Object.hasOwn(config, key) || !dequal(old[key], config[key]),
  )
  const inputs = previous.inputs.map((port): InputPort | Group => {
    if (!('handle' in port)) return port
    const key = changed.find((candidate) => defaults[candidate] == port.handle)
    if (key == null) return port
    const { value: _value, ...withoutDefault } = port
    return Object.hasOwn(config, key) ? { ...withoutDefault, value: config[key] as JsonValue } : withoutDefault
  })
  return {
    ...previous,
    name,
    executor: { ...previous.executor, mode: config.mode as 'chat' | 'json' },
    inputs,
    outputs: dequal(old.resultSchema, config.resultSchema)
      ? previous.outputs
      : previous.outputs.map((port) => ('handle' in port ? { ...port, jsonSchema: config.resultSchema as JsonValue } : port)),
  }
}

/** Keep the production LLM factory's contracts while removing sample business data. */
export function initialAuthoringLlmTask(task: ManagedTaskDefinition): ManagedTaskDefinition {
  if (task.executor.kind != 'llm') throw new TypeError('Expected an LLM task.')
  return {
    ...task,
    inputs: task.inputs.flatMap<InputPort | Group>((port) => {
      if (!('handle' in port)) return [port]
      if (port.handle == 'input') return []
      if (port.handle == 'template') return [{ ...port, value: [{ role: 'user', content: '' }] }]
      return [port]
    }),
  }
}
