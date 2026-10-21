import type { FieldValueDeletion } from '../../../../form/common/fieldValue.ts'
import type { WebhookOptions } from '../api.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { expect, it, vi } from 'vitest'
import { FieldValueEditor } from '../../../../form/browser/fieldValueEditor.tsx'
import { createI18n } from '../i18n.ts'
import { WebhookHeadersEditor } from './webhookHeadersEditor.tsx'

vi.mock('../../../../form/browser/fieldValueEditor.tsx', () => ({ FieldValueEditor: vi.fn(() => null) }))

function change(options: WebhookOptions, next: Record<string, string> | undefined, deletion?: FieldValueDeletion) {
  const onChange = vi.fn()
  renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <WebhookHeadersEditor options={options} disabled={false} sourceDisabled={false} diagnostics={[]} onChange={onChange} />
    </I18nProvider>,
  )
  expect(onChange).not.toHaveBeenCalled()
  vi.mocked(FieldValueEditor).mock.calls.at(-1)![0].onChange(next, deletion)
  expect(onChange).toHaveBeenCalledOnce()
  return onChange.mock.calls[0]!
}

it('does not persist binding-only placeholders when another fixed header changes', () => {
  expect(
    change(
      { responseHeaders: { 'X-Empty': '', 'X-Fixed': 'before' }, responseHeaderOutputs: { 'x-empty': 'empty', 'X-Bound': 'value' } },
      { 'X-Empty': '', 'X-Fixed': 'after', 'X-Bound': '' },
    )[0],
  ).toEqual({ responseHeaders: { 'X-Empty': '', 'X-Fixed': 'after' }, responseHeaderOutputs: { 'x-empty': 'empty', 'X-Bound': 'value' } })
})

it('preserves a newly added unbound empty header', () => {
  expect(change({ responseHeaderOutputs: { 'X-Bound': 'value' } }, { 'X-Bound': '', 'X-New': '' })[0]).toEqual({
    responseHeaders: { 'X-New': '' },
    responseHeaderOutputs: { 'X-Bound': 'value' },
  })
})

it('renames a binding-only header without creating a fixed empty value', () => {
  expect(change({ responseHeaderOutputs: { 'X-Bound': 'value' } }, { 'X-Renamed': '' })[0]).toEqual({ responseHeaderOutputs: { 'X-Renamed': 'value' } })
})

it('preserves an explicitly fixed empty value when its bound header is renamed', () => {
  expect(change({ responseHeaders: { 'x-bound': '' }, responseHeaderOutputs: { 'X-Bound': 'value' } }, { 'X-Renamed': '' })[0]).toEqual({
    responseHeaders: { 'X-Renamed': '' },
    responseHeaderOutputs: { 'X-Renamed': 'value' },
  })
})

it.each([{}, undefined])('preserves deletion behavior when the last bound header is removed (%j)', (next) => {
  const deletion = { target: 'objectItem', name: 'Response headers.X-Bound' } as const
  expect(change({ responseHeaderOutputs: { 'X-Bound': 'value' }, responseStatusCode: 201 }, next, deletion)).toEqual([{ responseStatusCode: 201 }, deletion])
})
