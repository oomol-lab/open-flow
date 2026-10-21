import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const styles = (await Promise.all(['styles.css', 'host-ui.css'].map((file) => readFile(new URL(`../browser/${file}`, import.meta.url), 'utf8')))).join('\n')
const main = await readFile(new URL('../browser/main.tsx', import.meta.url), 'utf8')
const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')

describe('Browser style boundaries', () => {
  it('keeps native control resets inside Server-owned chrome', () => {
    expect(styles).not.toMatch(/(?:^|\n)(?:button|input)(?=[\s,:{])/)
  })

  it('keeps Server chrome on the shared semantic theme contract', () => {
    expect(styles).not.toContain('@oomol-lab/open-flow')
    expect(styles).not.toMatch(/:root\s*\{[^}]*var\(--ui-(?:background|foreground)\)/)
    expect(styles).not.toMatch(/--ui-(?:background|foreground|primary|border|radius):\s*#/)
    expect(styles).not.toMatch(/\.open-flow-workbench\s*\{[^}]*--ui-radius:/)
    expect(styles).not.toContain('.resource-page-header')
    expect(styles).not.toContain('.workspace-actions')
    expect(styles).not.toMatch(/\.server-host\[data-theme='dark'\]\s+\./)
    expect(styles).not.toMatch(/\.session-(?:gate|form|error)/)
  })

  it('loads the scoped UnoCSS icon layer for Server chrome', () => {
    expect(main).toContain("import 'virtual:uno.css'")
    expect(main).toContain("import '@oomol-lab/open-flow/workbench.css'")
    expect(viteConfig).toContain("scopeDesignerSelector(utility.selector, [...designerUnoScopes, '.server-host'])")
  })
})
