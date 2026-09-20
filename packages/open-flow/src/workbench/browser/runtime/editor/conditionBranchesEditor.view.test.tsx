import type { ConditionSettings } from './flowChanges.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it } from 'vitest'
import { createI18n } from '../i18n.ts'
import { ConditionBranchesEditor } from './conditionBranchesEditor.tsx'

const expression = { left: { kind: 'value' as const, value: 1 }, operator: '==' as const, right: { kind: 'value' as const, value: 1 } }

function render(groups: ConditionSettings['cases'][number]['groups']): string {
  return renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <ConditionBranchesEditor value={{ matchMode: 'first', cases: [{ output: 'matched', groups }] }} disabled onChange={() => {}} />
    </I18nProvider>,
  )
}

describe('condition group disclosure', () => {
  it('omits the group heading for a case with exactly one condition', () => {
    const markup = render([{ expressions: [expression] }])

    expect(markup).not.toContain('aria-label="AND 1"')
    expect(markup).toContain('data-branch-endpoint="control"')
  })

  it('keeps the group heading when one group contains multiple conditions', () => {
    const markup = render([{ expressions: [expression, expression] }])

    expect(markup).toContain('aria-label="AND 1"')
    expect(markup).toContain('data-branch-endpoint="marker"')
  })

  it('keeps every group heading when the case contains multiple groups', () => {
    const markup = render([{ expressions: [expression] }, { expressions: [expression] }])

    expect(markup).toContain('aria-label="AND 1"')
    expect(markup).toContain('aria-label="AND 2"')
  })
})
