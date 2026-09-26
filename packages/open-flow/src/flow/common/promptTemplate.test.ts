import { describe, expect, it } from 'vitest'
import { renamePromptInput, renderPrompt } from './promptTemplate.ts'

describe('prompt templates', () => {
  it('renders plain text, whole-input prompts and mixed content', () => {
    expect(renderPrompt('Summarize.', {})).toBe('Summarize.')
    expect(renderPrompt('{{request}}', { request: 'Help.' })).toBe('Help.')
    expect(renderPrompt('Summarize {{ 邮件内容 }} for {{name}}.', { 邮件内容: 'Meeting', name: 'Ada' })).toBe('Summarize Meeting for Ada.')
  })
  it('serializes JSON values without losing null, false or zero', () => {
    expect(renderPrompt('{{data}} {{empty}} {{flag}} {{count}}', { data: [1, { a: 2 }], empty: null, flag: false, count: 0 })).toBe('[1,{"a":2}] null false 0')
  })
  it('preserves unknown references and does not recursively expand input data', () => {
    expect(renderPrompt('{{missing}} {{a}} {{toString}}', { a: '{{b}}', b: 'secret' })).toBe('{{missing}} {{b}} {{toString}}')
  })
  it('renames complete references only', () => {
    expect(renamePromptInput('{{name}} {{ name }} {{names}} name', 'name', '姓名')).toBe('{{姓名}} {{姓名}} {{names}} name')
  })
})
