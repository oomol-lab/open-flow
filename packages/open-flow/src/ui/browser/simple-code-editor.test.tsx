import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SimpleCodeEditor } from './simple-code-editor.ts'

describe('SimpleCodeEditor', () => {
  it('unwraps the CommonJS default export into a React component', () => {
    const markup = renderToStaticMarkup(<SimpleCodeEditor value="Hello" highlight={(value) => value} onValueChange={() => undefined} />)
    expect(markup).toContain('<textarea')
    expect(markup).toContain('Hello')
  })
})
