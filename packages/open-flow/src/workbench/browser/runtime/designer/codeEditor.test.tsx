import { describe, expect, it, vi } from 'vitest'
import { CodeEditor } from './codeEditor.tsx'

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: vi.fn(),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, vi.fn()],
}))

describe('CodeEditor focus', () => {
  it('saves only when focus leaves the editor, not when it moves into a completion control', () => {
    const onBlur = vi.fn()
    const element = CodeEditor({
      ariaLabel: 'Code',
      disabled: false,
      errorLabel: 'Unavailable',
      loadingLabel: 'Loading',
      onBlur,
      onChange: vi.fn(),
      theme: 'light',
      typing: '',
      uri: 'file:///modules/main.js',
      value: 'export default () => {}',
    })
    const completion = {}
    const currentTarget = { contains: (target: unknown) => target === completion }

    element.props.onBlur({ currentTarget, relatedTarget: completion })
    expect(onBlur).not.toHaveBeenCalled()

    element.props.onBlur({ currentTarget, relatedTarget: null })
    expect(onBlur).toHaveBeenCalledOnce()
  })
})
