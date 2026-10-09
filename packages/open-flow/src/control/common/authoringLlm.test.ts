import type { InputPort, ManagedTaskDefinition } from '../../flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { createLlmTask } from '../../flow/common/nodeChanges.ts'
import { authoringLlmConfiguration, initialAuthoringLlmTask, llmConfigurationView, prepareLlmConfiguration } from './authoringLlm.ts'

function task(): ManagedTaskDefinition {
  const created = createLlmTask({ nodeId: 'node' }, 'Summary', 'chat', 'Summary text').find((operation) => operation.kind == 'graph.node.create')
  if (created?.kind != 'graph.node.create' || created.node.kind != 'task' || !('executor' in created.node.task)) throw new Error('Missing task.')
  return created.node.task
}
function port(definition: ManagedTaskDefinition, handle: string): InputPort {
  const selected = definition.inputs.find((candidate): candidate is InputPort => 'handle' in candidate && candidate.handle == handle)
  if (selected == null) throw new Error(`Missing ${handle}.`)
  return selected
}

describe('LLM business configuration', () => {
  it('exposes model settings and messages directly and round trips without replacing contracts', () => {
    const original = task()
    const model = port(original, 'model')
    const previous: ManagedTaskDefinition = {
      ...original,
      inputs: [
        { group: 'Settings', collapsed: true },
        ...original.inputs.filter((candidate) => !('handle' in candidate) || candidate.handle != 'model'),
        { ...model, description: 'Chosen model', value: { model: 'configured', temperature: 0.25, top_p: 0.8, max_tokens: 4096 } },
        { handle: 'order', jsonSchema: { type: 'object' }, nullable: false },
      ],
    }
    const view = llmConfigurationView(previous)
    expect(view).toEqual({
      mode: 'chat',
      resultSchema: { type: 'string' },
      model: { model: 'configured', temperature: 0.25, top_p: 0.8, max_tokens: 4096 },
      template: [{ role: 'user', content: "Hello, I'm {{input}}" }],
      messages: null,
    })
    expect(authoringLlmConfiguration.parse(view)).toEqual(view)
    const prepared = prepareLlmConfiguration(view, previous, previous.name)
    expect(prepared).toEqual(previous)
    expect(prepared.inputs.every((input, index) => input === previous.inputs[index])).toBe(true)
    expect(prepared.outputs).toBe(previous.outputs)
  })

  it('keeps null, absence, invalid draft values, and explicit default removal distinct', () => {
    const original = task()
    const { value: _value, ...modelWithoutDefault } = port(original, 'model')
    const previous: ManagedTaskDefinition = {
      ...original,
      inputs: original.inputs.map((candidate) => ('handle' in candidate && candidate.handle == 'model' ? modelWithoutDefault : candidate)),
    }
    const view = llmConfigurationView(previous)
    expect(view).not.toHaveProperty('model')
    expect(view.messages).toBe(null)
    expect(prepareLlmConfiguration(view, previous, 'Renamed').inputs).toEqual(previous.inputs)

    const nullModel = prepareLlmConfiguration({ ...view, model: null }, previous, previous.name)
    expect(port(nullModel, 'model')).toHaveProperty('value', null)
    expect(authoringLlmConfiguration.parse(llmConfigurationView(nullModel))).toHaveProperty('model', null)
    const removed = prepareLlmConfiguration(view, nullModel, nullModel.name)
    expect(port(removed, 'model')).not.toHaveProperty('value')

    const invalid = prepareLlmConfiguration({ ...view, model: 'repair me' }, previous, previous.name)
    expect(authoringLlmConfiguration.parse(llmConfigurationView(invalid))).toHaveProperty('model', 'repair me')
    expect(prepareLlmConfiguration(llmConfigurationView(invalid), invalid, 'Renamed').inputs).toEqual(invalid.inputs)
  })

  it('changes defaults and result schema while preserving existing constraints and unrelated inputs', () => {
    const previous = task()
    const config = {
      ...llmConfigurationView(previous),
      mode: 'json',
      model: { model: 'custom', temperature: 0, max_tokens: 800 },
      template: [{ role: 'user', content: 'Summarize {{order}}.' }],
      messages: [{ role: 'system', content: 'Use concise language.' }],
      resultSchema: { type: 'object', properties: { summary: { type: 'string' } } },
    }
    const updated = prepareLlmConfiguration(config, previous, 'Updated')
    expect(llmConfigurationView(updated)).toEqual(config)
    for (const handle of ['model', 'messages', 'template']) {
      const { value: _before, ...contractBefore } = port(previous, handle)
      const { value: _after, ...contractAfter } = port(updated, handle)
      expect(contractAfter).toEqual(contractBefore)
    }
    expect(port(updated, 'input')).toBe(port(previous, 'input'))
    expect(updated.outputs).toEqual([{ ...previous.outputs[0], jsonSchema: config.resultSchema }])
  })

  it('initializes authoring tasks without sample business inputs and retains the production defaults', () => {
    const original = task()
    const initial = initialAuthoringLlmTask(original)
    expect(initial.inputs.some((candidate) => 'handle' in candidate && candidate.handle == 'input')).toBe(false)
    expect(port(initial, 'template').value).toEqual([{ role: 'user', content: '' }])
    expect(port(initial, 'model')).toBe(port(original, 'model'))
    expect(port(initial, 'messages')).toBe(port(original, 'messages'))
    expect(initial.outputs).toBe(original.outputs)
    expect(initial.executor).toBe(original.executor)
    expect(JSON.stringify(initial)).not.toMatch(/Alex|Hello/)
  })
})
