// @vitest-environment happy-dom
import { act } from 'react'
import { expect, it, vi } from 'vitest'
import { click, input, render } from '../../../../../test/support/render.tsx'
import { skipDuplicatesTask } from '../../../../state/common/state.ts'
import { SkipDuplicatesSection } from './skipDuplicatesSection.tsx'

it('adds, saves and removes identity fields without saving blank editor rows', async () => {
  const save = vi.fn(async () => true)
  const task = skipDuplicatesTask({ fields: ['company'] })
  const view = render(<SkipDuplicatesSection task={task} disabled={false} onSave={save} />)
  const add = [...view.container.querySelectorAll('button')].find((button) => button.textContent === view.i18n.t('flowState.addField'))!
  await act(async () => view.container.querySelector('input')!.focus())
  await click(add)
  let inputs = view.container.querySelectorAll('input')
  expect(inputs).toHaveLength(2)
  expect(document.activeElement).toBe(inputs[1])
  expect(save.mock.calls.every((call) => !JSON.stringify(call).includes('""'))).toBe(true)
  await input(inputs[1]!, 'record.id')
  await act(async () => inputs[1]!.blur())
  expect(save).toHaveBeenLastCalledWith(task, { ...task, executor: { kind: 'skip-duplicates', fields: ['company', 'record.id'] } })
  const remove = view.container.querySelector<HTMLButtonElement>(`button[aria-label="${view.i18n.t('flowState.removeField', { index: 1 })}"]`)!
  await click(remove)
  inputs = view.container.querySelectorAll('input')
  expect(inputs).toHaveLength(1)
  expect(inputs[0]!.value).toBe('record.id')
  expect(save).toHaveBeenLastCalledWith(task, { ...task, executor: { kind: 'skip-duplicates', fields: ['record.id'] } })
})

it('keeps the draft for retry and preserves the latest unrelated task settings', async () => {
  const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
  const task = skipDuplicatesTask({ fields: ['id'] })
  const view = render(<SkipDuplicatesSection task={task} disabled={false} onSave={save} />)
  const field = view.container.querySelector('input')!
  await input(field, 'url')
  await act(async () => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(view.i18n.t('flowState.saveFailed'))
  const renamed = { ...task, name: 'Articles' }
  view.rerender(<SkipDuplicatesSection task={renamed} disabled={false} onSave={save} />)
  await click([...view.container.querySelectorAll('button')].find((button) => button.textContent === view.i18n.t('flowState.retry'))!)
  expect(save).toHaveBeenLastCalledWith(renamed, { ...renamed, executor: { kind: 'skip-duplicates', fields: ['url'] } })
  expect(view.container.querySelector('[role="alert"]')).toBeNull()
})

it('rejects duplicate paths and leaves read-only fields immutable', async () => {
  const save = vi.fn(async () => true)
  const task = skipDuplicatesTask({ fields: ['id', 'version'] })
  const view = render(<SkipDuplicatesSection task={task} disabled={false} onSave={save} />)
  const second = view.container.querySelectorAll('input')[1]!
  await input(second, 'id')
  await act(async () => second.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(save).not.toHaveBeenCalled()
  expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(view.i18n.t('flowState.invalidFields'))
  expect([...view.container.querySelectorAll('button')].some((button) => button.textContent === view.i18n.t('flowState.retry'))).toBe(false)
  expect(second.getAttribute('aria-describedby')).toBe(view.container.querySelector('[role="alert"]')?.id)
  view.rerender(<SkipDuplicatesSection task={task} disabled onSave={save} />)
  expect([...view.container.querySelectorAll('input')].every((field) => field.disabled)).toBe(true)
})

it('reflects undo after adding a blank field row', async () => {
  const save = vi.fn(async () => true)
  const task = skipDuplicatesTask({ fields: ['id', 'version'] })
  const view = render(<SkipDuplicatesSection task={task} disabled={false} onSave={save} />)
  await click([...view.container.querySelectorAll('button')].find((button) => button.textContent === view.i18n.t('flowState.addField'))!)
  await act(async () => view.container.querySelectorAll('input')[2]!.blur())
  expect(save).not.toHaveBeenCalled()
  const undone = skipDuplicatesTask({ fields: ['id'] })
  view.rerender(<SkipDuplicatesSection task={undone} disabled={false} onSave={save} />)
  expect([...view.container.querySelectorAll('input')].map((field) => field.value)).toEqual(['id'])
})

it('keeps newer validation feedback when an earlier save completes', async () => {
  let finish!: (saved: boolean) => void
  const save = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve
      }),
  )
  const task = skipDuplicatesTask({ fields: ['id'] })
  const view = render(<SkipDuplicatesSection task={task} disabled={false} onSave={save} />)
  const field = view.container.querySelector('input')!
  await input(field, 'url')
  await act(async () => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  await input(field, 'record..id')
  await act(async () => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(view.i18n.t('flowState.invalidFields'))
  await act(async () => finish(true))
  expect(view.container.querySelector('[role="alert"]')?.textContent).toContain(view.i18n.t('flowState.invalidFields'))
  expect(field.value).toBe('record..id')
  expect(save).toHaveBeenCalledTimes(1)
})

it('cancels a blurred draft before validation when the user edits it again', async () => {
  const save = vi.fn(async () => true)
  const view = render(<SkipDuplicatesSection task={skipDuplicatesTask({ fields: ['id'] })} disabled={false} onSave={save} />)
  const field = view.container.querySelector('input')!
  await input(field, 'url')
  await act(async () => {
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'record.id')
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(field.value).toBe('record.id')
  expect(save).not.toHaveBeenCalled()
  expect(view.container.querySelector('[role="alert"]')).toBeNull()
})

it('returns keyboard focus to a field after removing the last row', async () => {
  const save = vi.fn(async () => true)
  const view = render(<SkipDuplicatesSection task={skipDuplicatesTask({ fields: ['id', 'version'] })} disabled={false} onSave={save} />)
  const remove = view.container.querySelector<HTMLButtonElement>(`button[aria-label="${view.i18n.t('flowState.removeField', { index: 2 })}"]`)!
  await act(async () => remove.focus())
  await click(remove)
  expect(document.activeElement).toBe(view.container.querySelector('input'))
})
