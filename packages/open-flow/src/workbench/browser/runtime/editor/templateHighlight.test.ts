import { describe, expect, it } from 'vitest'
import { highlightTemplateText } from './templateHighlight.ts'

describe('LLM template highlighting', () => {
  it('highlights existing handles with optional whitespace', () => {
    expect(highlightTemplateText('Hello {{input}} and {{ name }}.', ['input', 'name'])).toBe('Hello <mark>{{input}}</mark> and <mark>{{ name }}</mark>.')
  })

  it('escapes content and leaves unknown handles unmarked', () => {
    expect(highlightTemplateText('<b>{{missing}}</b> & {{input}}', ['input'])).toBe('&lt;b&gt;{{missing}}&lt;/b&gt; &amp; <mark>{{input}}</mark>')
  })
})
