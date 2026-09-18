import { describe, expect, it } from 'vitest'
import { comparisonIssue } from './condition.ts'

describe('comparison error ownership', () => {
  it('assigns an unsupported operation to the operator before checking the right value', () => {
    expect(comparisonIssue('>', 'array', 'string')?.target).toBe('operator')
  })

  it('assigns incompatible comparison values to the right operand', () => {
    expect(comparisonIssue('==', 'array', 'string')?.target).toBe('right')
    expect(comparisonIssue('>', 'number', 'string')?.target).toBe('right')
    expect(comparisonIssue('hasKey', 'object', 'number')?.target).toBe('right')
  })

  it('accepts numeric normalization and heterogeneous array membership', () => {
    expect(comparisonIssue('==', 'integer', 'number')).toBeUndefined()
    expect(comparisonIssue('contains', 'array', 'object')).toBeUndefined()
  })

  it('does not infer a mismatch from an unresolved operand or an unused right value', () => {
    expect(comparisonIssue('==', undefined, 'string')).toBeUndefined()
    expect(comparisonIssue('==', 'array', undefined)).toBeUndefined()
    expect(comparisonIssue('isNull', 'array', 'string')).toBeUndefined()
  })
})
