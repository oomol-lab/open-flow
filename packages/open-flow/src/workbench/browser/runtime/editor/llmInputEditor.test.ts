import { describe, expect, it } from 'vitest'
import { supportsLlmInput } from './llmInputEditor.tsx'

describe('LLM input routing', () => {
  it('accepts empty and valid specialized values', () => {
    expect(supportsLlmInput({ 'ui:widget': 'llm/messages' }, undefined)).toBe(true)
    expect(supportsLlmInput({ 'ui:widget': 'llm/messages' }, [{ role: 'user', content: 'Hello', extra: true }])).toBe(true)
    expect(supportsLlmInput({ 'ui:widget': 'llm/model' }, { model: 'custom', extra: true })).toBe(true)
  })

  it('leaves malformed and unrecognized values to the generic editor', () => {
    expect(supportsLlmInput({ 'ui:widget': 'llm/messages' }, [{ role: 'tool', content: 'Result' }])).toBe(false)
    expect(supportsLlmInput({ 'ui:widget': 'llm/messages' }, [{ role: 'user', content: [] }])).toBe(false)
    expect(supportsLlmInput({ 'ui:widget': 'llm/model' }, ['custom'])).toBe(false)
    expect(supportsLlmInput({ 'ui:options': { widget: 'llm/messages' } }, [])).toBe(false)
  })
})
