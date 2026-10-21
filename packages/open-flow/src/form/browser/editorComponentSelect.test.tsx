// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { click, render } from '../../../test/support/render.tsx'
import { EditorComponentSelect } from './editorComponentSelect.tsx'

it('offers Any once and changes the value editor through its menu', async () => {
  const onChange = vi.fn()
  const { container, i18n } = render(<EditorComponentSelect name="value" schema={{}} valueOnly addon onChange={onChange} />)
  const trigger = container.querySelector<HTMLElement>('[role="combobox"]')!
  expect(trigger.textContent).toContain(i18n.t('valueEditor.any'))
  await click(trigger)
  const options = [...container.querySelectorAll<HTMLElement>('[role="option"]')]
  expect(options.filter((option) => option.textContent === i18n.t('valueEditor.any'))).toHaveLength(1)
  expect(options.some((option) => option.textContent === i18n.t('valueEditor.components.json'))).toBe(false)
  await click(options.find((option) => option.textContent === i18n.t('valueEditor.components.text'))!)
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ 'type': 'string', 'ui:widget': 'text' })
})

it.each([
  { schema: { type: 'string', format: 'date' }, valueOnly: true, label: 'valueEditor.any', expected: {} },
  {
    schema: { const: 'choice', description: 'Result kind' },
    valueOnly: false,
    label: 'valueEditor.components.string',
    expected: { type: 'string', description: 'Result kind' },
  },
  { schema: { const: 'choice', description: 'Result kind' }, valueOnly: false, label: 'valueEditor.components.json', expected: { description: 'Result kind' } },
])('replaces $schema with $label without retaining old constraints', async ({ schema, valueOnly, label, expected }) => {
  const onChange = vi.fn()
  const { container, i18n } = render(<EditorComponentSelect name="result" schema={schema} valueOnly={valueOnly} onChange={onChange} />)
  expect(onChange).not.toHaveBeenCalled()
  await click(container.querySelector<HTMLElement>('[role="combobox"]')!)
  await click([...container.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent === i18n.t(label))!)
  expect(onChange).toHaveBeenCalledExactlyOnceWith(expected)
})

it('keeps local value-editor selection independent of a constant definition', () => {
  const { container, i18n } = render(<EditorComponentSelect name="result" schema={{ const: 'choice' }} valueOnly onChange={vi.fn()} />)
  expect(container.querySelector('[role="combobox"]')!.textContent).toContain(i18n.t('valueEditor.any'))
})
