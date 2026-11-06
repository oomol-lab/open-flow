// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { captureStyleProperties } from './captureStyles.ts'

it('collects matched rules, pseudo-elements, inherited inline styles and SVG attributes', () => {
  const sheet = document.createElement('style')
  sheet.textContent = `
    .capture-node { display: grid; padding: 4px 8px; }
    .capture-node::before { content: "note"; border: 2px solid red; }
    .unrelated-capture-rule { animation-name: unrelated; }
  `
  const parent = document.createElement('section')
  parent.style.fontFamily = 'monospace'
  parent.style.setProperty('--capture-color', 'red')
  parent.innerHTML = '<div class="capture-node"><svg><path stroke="var(--capture-color)" d="M 0 0 L 5 5" /></svg></div>'
  document.head.append(sheet)
  document.body.append(parent)
  try {
    const properties = captureStyleProperties(parent.firstElementChild as HTMLElement)
    for (const name of ['display', 'padding-top', 'padding-right', 'content', 'border-top-width', 'font-family', 'stroke']) expect(properties).toContain(name)
    expect(properties).not.toContain('--capture-color')
    expect(properties).not.toContain('animation-name')
  } finally {
    sheet.remove()
    parent.remove()
  }
})
