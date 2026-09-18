import { describe, expect, it } from 'vitest'
import { normalizeStorySearch } from './storySearch.ts'

describe('normalizeStorySearch', () => {
  it('ignores whitespace and letter case', () => {
    expect(normalizeStorySearch('Node Input')).toBe('nodeinput')
    expect(normalizeStorySearch('NODE\nINPUT')).toBe('nodeinput')
    expect(normalizeStorySearch('Node Input').includes(normalizeStorySearch('nodein'))).toBe(true)
  })
})
