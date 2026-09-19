import type { ConditionOperand } from '../../../../flow/common/change.ts'

import { describe, expect, it } from 'vitest'
import { conditionCaseIssues } from './conditionBranchesEditor.tsx'

const operandType = (operand: ConditionOperand | undefined) => (operand?.kind == 'value' && operand.value !== undefined ? typeof operand.value : undefined)

describe('condition case error ownership', () => {
  it('keeps valid cases collapsed', () => {
    const issues = conditionCaseIssues(
      {
        output: 'matched',
        groups: [{ expressions: [{ left: { kind: 'value', value: 1 }, operator: '==', right: { kind: 'value', value: 1 } }] }],
      },
      {},
      operandType,
    )

    expect(issues).toEqual({ case: false, groups: [undefined] })
  })

  it('uses missing conditions for both feedback and expansion', () => {
    expect(conditionCaseIssues({ output: 'empty', groups: [] }, {}, operandType)).toEqual({ case: true, groups: [] })
    expect(conditionCaseIssues({ output: 'incomplete', groups: [{ expressions: [] }] }, {}, operandType)).toEqual({
      case: true,
      groups: ['incomplete'],
    })
  })

  it('uses comparison and operand errors for both feedback and expansion', () => {
    const incompatible = conditionCaseIssues(
      {
        output: 'incompatible',
        groups: [{ expressions: [{ left: { kind: 'value', value: 1 }, operator: '==', right: { kind: 'value', value: 'one' } }] }],
      },
      {},
      operandType,
    )
    const invalidOperand = conditionCaseIssues(
      {
        output: 'invalid-operand',
        groups: [{ expressions: [{ left: { kind: 'value' }, operator: '==', right: { kind: 'value', value: 'ready' } }] }],
      },
      { 'invalid-operand/0/0/left': true },
      operandType,
    )

    expect(incompatible).toEqual({ case: true, groups: ['contains'] })
    expect(invalidOperand).toEqual({ case: true, groups: ['contains'] })
  })
})
