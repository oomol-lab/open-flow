import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const styles = await readFile(new URL('../browser/styles.css', import.meta.url), 'utf8')
const app = await readFile(new URL('../browser/app.tsx', import.meta.url), 'utf8')
const main = await readFile(new URL('../browser/main.tsx', import.meta.url), 'utf8')
const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8')
const theme = await readFile(new URL('../../../packages/open-flow/src/ui/browser/theme.css', import.meta.url), 'utf8')

describe('Browser style boundaries', () => {
  it('keeps native control resets inside Server-owned chrome', () => {
    expect(styles).not.toMatch(/(?:^|\n)(?:button|input)(?=[\s,:{])/)
  })

  it('keeps Server chrome on the shared semantic theme contract', () => {
    for (const token of [
      'background',
      'foreground',
      'popover',
      'popover-foreground',
      'primary',
      'primary-foreground',
      'muted',
      'muted-foreground',
      'destructive',
      'border',
      'input',
      'ring',
      'radius',
    ]) {
      expect(theme).toContain(`--ui-${token}:`)
    }
    expect(styles).not.toContain('@oomol-lab/open-flow')
    expect(styles).not.toMatch(/:root\s*\{[^}]*var\(--ui-(?:background|foreground)\)/)
    expect(styles).not.toMatch(/--ui-(?:background|foreground|primary|border|radius):\s*#/)
    expect(styles).not.toMatch(/calc\(var\(--ui-radius\)/)
    expect(styles).toMatch(/\.server-host\s*\{[^}]*--ui-radius:\s*6px;/)
    expect(styles).toMatch(/\.server-host \.open-flow-workbench\s*\{[^}]*--ui-radius:\s*inherit;/)
    expect(styles).not.toContain('.resource-page-header')
    expect(styles).not.toContain('.workspace-actions')
    expect(styles).not.toMatch(/\.server-host\[data-theme='dark'\]\s+\./)
    expect(app).toMatch(/className="open-flow-theme server-host"/)
    expect(app).toMatch(/OpenFlowSessionGate, OpenFlowWorkbench/)
    expect(app).toMatch(/<OpenFlowSessionGate/)
    expect(styles).not.toMatch(/\.session-(?:gate|form|error)/)
  })

  it('loads the scoped UnoCSS icon layer for Server chrome', () => {
    expect(main).toContain("import 'virtual:uno.css'")
    expect(main).toContain("import '@oomol-lab/open-flow/workbench.css'")
    expect(viteConfig).toContain("scopeDesignerSelector(utility.selector, [...designerUnoScopes, '.server-host'])")
  })
})
