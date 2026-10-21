// @vitest-environment happy-dom
import { act } from 'react'
import { expect, it, vi } from 'vitest'
import { render } from '../../../../../test/support/render.tsx'
import { createCodeEditor } from '../../../../ui/browser/code-editor.ts'
import { CodeEditor } from './codeEditor.tsx'

vi.mock('../../../../ui/browser/code-editor.ts', () => ({
  createCodeEditor: vi.fn(async (container: HTMLElement) => {
    container.innerHTML = '<textarea aria-label="Code"></textarea><button>Completion</button>'
    return { updateOptions: vi.fn(), getValue: () => '', setValue: vi.fn(), onChange: () => vi.fn(), dispose: vi.fn() }
  }),
}))
vi.mock('../../typeScriptSession.ts', () => ({ loadTypeScriptExtension: vi.fn(), updateTypeScriptTyping: vi.fn() }))

it('saves when focus leaves the editor, including unmount, but not when entering completion controls', async () => {
  const onBlur = vi.fn()
  const view = render(
    <CodeEditor
      ariaLabel="Code"
      disabled={false}
      errorLabel="Unavailable"
      loadingLabel="Loading"
      onBlur={onBlur}
      onChange={vi.fn()}
      theme="light"
      typing=""
      uri="file:///modules/main.js"
      value=""
    />,
  )
  await act(async () => {})
  expect(createCodeEditor).toHaveBeenCalledOnce()
  const input = view.container.querySelector('textarea')!
  const completion = view.container.querySelector('button')!
  act(() => {
    input.focus()
    completion.focus()
  })
  expect(onBlur).not.toHaveBeenCalled()
  act(() => completion.blur())
  expect(onBlur).toHaveBeenCalledOnce()
  view.unmount()
  expect(onBlur).toHaveBeenCalledTimes(2)
})
