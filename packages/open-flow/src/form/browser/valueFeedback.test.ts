import { describe, expect, it } from 'vitest'
import { valueIssues } from '../common/validation/valueIssues.ts'
import { valueFeedback } from './valueFeedback.ts'

const collectionView = { expanded: true, hasSummary: true, hasChildren: true, draftInvalid: false }

async function errorsFor(schema: unknown, value: unknown) {
  const result = await valueIssues(schema, value, 'en', new AbortController().signal)
  return result!.errors.map((error) => ({ instancePath: error.instancePath, message: error.message! }))
}

describe('Value feedback ownership', () => {
  it('moves nested object feedback between the summary and children on collapse/expand', async () => {
    const errors = await errorsFor({ type: 'object', properties: { title: { type: 'string', minLength: 8 } } }, { title: 'short' })
    const collapsed = valueFeedback(errors, { ...collectionView, expanded: false })
    expect(collapsed.summaryInvalid).toBe(true)
    expect(collapsed.messages).toHaveLength(1)
    expect(collapsed.messages[0]).toContain('/title:')
    const expanded = valueFeedback(errors, collectionView)
    expect(expanded.summaryInvalid).toBe(false)
    expect(expanded.messages).toEqual([])
    expect(valueFeedback(errors, { ...collectionView, expanded: false })).toEqual(collapsed)
  })

  it('keeps array length feedback on the summary, independently of item errors', async () => {
    const schema = { type: 'array', minItems: 2, items: { type: 'number', minimum: 0 } }
    for (const value of [[-1], [0]]) {
      const feedback = valueFeedback(await errorsFor(schema, value), collectionView)
      expect(feedback.anchor).toBe('summary')
      expect(feedback.summaryInvalid).toBe(true)
      expect(feedback.messages).toEqual(['must NOT have less than 2 items'])
    }
    const childOnly = valueFeedback(await errorsFor(schema, [-1, 0]), collectionView)
    expect(childOnly.summaryInvalid).toBe(false)
    expect(childOnly.messages).toEqual([])
    expect(valueFeedback(await errorsFor(schema, [0, 0]), collectionView).editorInvalid).toBe(false)
  })

  it('routes the same nested Schema error to the expanded JSON editor', async () => {
    const errors = await errorsFor({ type: 'object', properties: { title: { type: 'string' } } }, { title: 1 })
    const jsonView = { ...collectionView, hasChildren: false }
    const expanded = valueFeedback(errors, jsonView)
    expect(expanded.anchor).toBe('body')
    expect(expanded.editorInvalid).toBe(true)
    expect(expanded.summaryInvalid).toBe(false)
    expect(expanded.messages).toHaveLength(1)
    expect(valueFeedback(errors, { ...jsonView, expanded: false }).summaryInvalid).toBe(true)
  })

  it('keeps standalone collection feedback on its body', () => {
    const feedback = valueFeedback([{ instancePath: '', message: 'Required' }], { ...collectionView, hasSummary: false })
    expect(feedback.anchor).toBe('body')
    expect(feedback.editorInvalid).toBe(true)
    expect(feedback.summaryInvalid).toBe(false)
    expect(feedback.messages).toEqual(['Required'])
  })
})
