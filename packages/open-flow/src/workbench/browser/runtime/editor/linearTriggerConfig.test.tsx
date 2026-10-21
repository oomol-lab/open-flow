// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { click, render } from '../../../../../test/support/render.tsx'
import { StatusSelect, TeamSelect } from './linearTriggerConfig.tsx'

function options(overrides: Partial<Parameters<typeof TeamSelect>[0]['options']> = {}) {
  return {
    failed: false,
    loading: false,
    options: [
      { label: 'Engineering (ENG)', value: 'engineering' },
      { label: 'Design (DES)', value: 'design' },
    ],
    refresh: vi.fn(),
    ...overrides,
  }
}

it('refreshes Team choices whenever the menu opens and saves the selected Team', async () => {
  const source = options()
  const onChange = vi.fn()
  const { container } = render(<TeamSelect disabled={false} missing={false} onChange={onChange} options={source} value="engineering" />)
  await click(container.querySelector<HTMLElement>('[role="combobox"]')!)
  expect(source.refresh).toHaveBeenCalledOnce()
  await click([...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent === 'Design (DES)')!)
  expect(onChange).toHaveBeenCalledWith('design')
  await click(container.querySelector<HTMLElement>('[role="combobox"]')!)
  expect(source.refresh).toHaveBeenCalledTimes(2)
})

it('keeps an unavailable Team visible, invalid and unselectable', async () => {
  const { container, i18n } = render(<TeamSelect disabled={false} missing onChange={vi.fn()} options={options()} value="missing-team" />)
  const trigger = container.querySelector<HTMLElement>('[role="combobox"]')!
  expect(trigger.getAttribute('aria-invalid')).toBe('true')
  await click(trigger)
  const unavailable = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (item) => item.textContent === i18n.t('linearTrigger.unavailableTeam', { id: 'missing-team' }),
  )
  expect(unavailable?.getAttribute('aria-disabled')).toBe('true')
})

it('preserves the saved Team id when the initial request fails', () => {
  const { container } = render(
    <TeamSelect disabled={false} missing={false} onChange={vi.fn()} options={options({ failed: true, options: undefined })} value="saved-team" />,
  )
  expect(container.querySelector('[role="combobox"]')!.textContent).toContain('saved-team')
})

const statuses = () =>
  options({
    options: [
      { color: '#f2c94c', label: 'In Progress', value: 'progress' },
      { color: '#5e6ad2', label: 'Done', value: 'done' },
    ],
  })
it.each([
  { selected: [], teamSelected: false, key: 'linearTrigger.selectTeamFirst' },
  { selected: [], teamSelected: true, key: 'linearTrigger.allStatuses' },
  { selected: ['done'], teamSelected: true, key: undefined },
  { selected: ['progress', 'done'], teamSelected: true, key: 'linearTrigger.selectedCount' },
])('summarizes statuses $selected with Team selected=$teamSelected', ({ selected, teamSelected, key }) => {
  const { container, i18n } = render(
    <StatusSelect disabled={!teamSelected} missing={[]} onChange={vi.fn()} options={statuses()} selected={selected} teamSelected={teamSelected} />,
  )
  const trigger = container.querySelector<HTMLButtonElement>('button')!
  expect(trigger.textContent).toContain(key ? i18n.t(key, { count: selected.length }) : 'Done')
  expect(trigger.disabled).toBe(!teamSelected)
})

it('refreshes statuses on open and adds or removes selected values', async () => {
  const source = statuses()
  const onChange = vi.fn()
  const { container } = render(<StatusSelect disabled={false} missing={[]} onChange={onChange} options={source} selected={['done']} teamSelected />)
  await click(container.querySelector('button')!)
  expect(source.refresh).toHaveBeenCalledOnce()
  const checkboxes = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')]
  await click(checkboxes.find((item) => item.textContent?.includes('In Progress'))!)
  expect(onChange).toHaveBeenLastCalledWith(['done', 'progress'])
  await click(checkboxes.find((item) => item.textContent?.includes('Done'))!)
  expect(onChange).toHaveBeenLastCalledWith([])
})

it('keeps an unavailable selected status removable', async () => {
  const onChange = vi.fn()
  const { container } = render(
    <StatusSelect
      disabled={false}
      missing={['missing-status']}
      onChange={onChange}
      options={options({ options: [] })}
      selected={['missing-status']}
      teamSelected
    />,
  )
  const trigger = container.querySelector('button')!
  expect(trigger.getAttribute('aria-invalid')).toBe('true')
  await click(trigger)
  await click(document.querySelector<HTMLElement>('[role="menuitemcheckbox"]')!)
  expect(onChange).toHaveBeenCalledWith([])
})
