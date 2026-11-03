import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const styles = (await Promise.all(['styles.css', 'host-ui.css'].map((file) => readFile(new URL(`../browser/${file}`, import.meta.url), 'utf8')))).join('\n')

describe('Browser style boundaries', () => {
  it('keeps native control resets inside Server-owned chrome', () => {
    expect(styles).not.toMatch(/(?:^|\n)(?:button|input)(?=[\s,:{])/)
  })

  it('keeps Server chrome on the shared semantic theme contract', () => {
    expect(styles).not.toContain('@oomol-lab/open-flow')
    expect(styles).not.toMatch(/:root\s*\{[^}]*var\(--ui-(?:background|foreground)\)/)
    expect(styles).not.toMatch(/--ui-(?:background|foreground|primary|border|radius):\s*#/)
    expect(styles).not.toMatch(/\.open-flow-workbench\s*\{[^}]*--ui-radius:/)
    expect(styles).not.toMatch(/\.server-host\[data-theme='dark'\]\s+\./)
  })
})
