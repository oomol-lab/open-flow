import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const styles = await readFile(new URL('../browser/styles.css', import.meta.url), 'utf8')
const app = await readFile(new URL('../browser/app.tsx', import.meta.url), 'utf8')
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
    expect(styles).toContain("@import '@oomol-lab/open-flow/theme.css';")
    expect(styles).not.toMatch(/:root\s*\{[^}]*var\(--ui-(?:background|foreground)\)/)
    expect(styles).not.toMatch(/--ui-(?:background|foreground|primary|border|radius):\s*#/)
    expect(styles).not.toMatch(/\.server-host\[data-theme='dark'\]\s+\./)
    expect(app).toMatch(/className="open-flow-theme server-host"/)
    expect(styles).toMatch(/\.session-form button \{[\s\S]*?background: var\(--ui-primary\);[\s\S]*?color: var\(--ui-primary-foreground\);/)
  })
})
