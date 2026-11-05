// @vitest-environment happy-dom
import { act, startTransition, Suspense } from 'react'
import { expect, it, vi } from 'vitest'
import { click, input, render } from '../../../../../test/support/render.tsx'
import { skipDuplicatesTask } from '../../../../state/common/state.ts'
import { SkipDuplicatesSection } from './skipDuplicatesSection.tsx'

function fieldAction(view: ReturnType<typeof render>, action: 'addItem' | 'remove', index?: number) {
  const label = `${view.i18n.t(`valueEditor.${action}`)} ${view.i18n.t('flowState.field')}${index == null ? '' : `.${index}`}`
  const button = view.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  expect(button, label).not.toBeNull()
  return button!
}

it('inserts after the selected row, saves and removes fields without saving blank editor rows', async () => {
  const save = vi.fn(async () => true)
  const task = skipDuplicatesTask({ fields: ['company', 'id'] })
  const view = render(<SkipDuplicatesSection task={task} disabled={false} onSave={save} />)
  await click(fieldAction(view, 'addItem', 0))
  let inputs = view.container.querySelectorAll('input')
  expect([...inputs].map((field) => field.value)).toEqual(['company', '', 'id'])
  expect(save).not.toHaveBeenCalled()
  await input(inputs[1]!, 'record.id')
  await act(async () => inputs[1]!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(save).toHaveBeenLastCalledWith(task, { ...task, executor: { kind: 'skip-duplicates', fields: ['company', 'record.id', 'id'] } })
  await click(fieldAction(view, 'remove', 0))
  inputs = view.container.querySelectorAll('input')
  expect([...inputs].map((field) => field.value)).toEqual(['record.id', 'id'])
  expect(save).toHaveBeenLastCalledWith(task, { ...task, executor: { kind: 'skip-duplicates', fields: ['record.id', 'id'] } })
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
  expect(second.closest('[aria-labelledby]')?.getAttribute('aria-describedby')?.split(/\s+/)).toContain(view.container.querySelector('[role="alert"]')?.id)
  view.rerender(<SkipDuplicatesSection task={task} disabled onSave={save} />)
  expect([...view.container.querySelectorAll('input')].every((field) => field.readOnly)).toBe(true)
  expect(view.container.querySelector('button')).toBeNull()
})

it('reflects undo after adding a blank field row', async () => {
  const save = vi.fn(async () => true)
  const task = skipDuplicatesTask({ fields: ['id', 'version'] })
  const view = render(<SkipDuplicatesSection task={task} disabled={false} onSave={save} />)
  await click(fieldAction(view, 'addItem', 1))
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

it('saves an empty field list after removing the final row and reuses the empty-list add action', async () => {
  const save = vi.fn(async () => true)
  const task = skipDuplicatesTask({ fields: ['id'] })
  const view = render(<SkipDuplicatesSection task={task} disabled={false} onSave={save} />)
  await click(fieldAction(view, 'remove', 0))
  expect(view.container.querySelector('input')).toBeNull()
  expect(save).toHaveBeenLastCalledWith(task, { ...task, executor: { kind: 'skip-duplicates', fields: [] } })
  await click(fieldAction(view, 'addItem'))
  expect(view.container.querySelector('input')?.value).toBe('')
  expect(save).toHaveBeenCalledTimes(1)
})

it('uses only committed task settings and save callbacks for queued saves', async () => {
  let finish!: (saved: boolean) => void
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValue(true)
  const uncommittedSave = vi.fn(async () => true)
  const task = skipDuplicatesTask({ fields: ['id'] })
  const pending = new Promise<void>(() => {})
  function Suspend(): never {
    throw pending
  }
  const editor = (suspend: boolean) => (
    <Suspense fallback="Loading">
      <SkipDuplicatesSection task={suspend ? { ...task, name: 'Uncommitted task' } : task} disabled={false} onSave={suspend ? uncommittedSave : save} />
      {suspend && <Suspend />}
    </Suspense>
  )
  const view = render(editor(false))
  const field = view.container.querySelector('input')!
  for (const value of ['url', 'record.id']) {
    await input(field, value)
    await act(async () => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  }
  expect(save).toHaveBeenCalledTimes(1)
  await act(async () => {
    startTransition(() => {
      view.rerender(editor(true))
    })
  })
  expect(view.container.querySelector('input')).toBe(field)
  await act(async () => finish(true))
  expect(uncommittedSave).not.toHaveBeenCalled()
  expect(save).toHaveBeenCalledTimes(2)
  expect(save).toHaveBeenLastCalledWith(task, { ...task, executor: { kind: 'skip-duplicates', fields: ['record.id'] } })
})
