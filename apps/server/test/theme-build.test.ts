import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

it('keeps light and dark palette switching intact in the delivered Server stylesheet', async () => {
  const publicDirectory = new URL('../dist/public/', import.meta.url)
  const index = await readFile(new URL('index.html', publicDirectory), 'utf8')
  const styles = [...index.matchAll(/<link\b[^>]*\bhref="\/([^"]+\.css)"/g)]
  expect(styles).not.toHaveLength(0)
  const source = (await Promise.all(styles.map((match) => readFile(new URL(match[1]!, publicDirectory), 'utf8')))).join('\n')
  const light = [...source.matchAll(/\.open-flow-theme\{([^}]+)\}/g)].map((match) => match[1]).find((rule) => rule?.includes('color-scheme:'))
  const dark = source.match(/\.open-flow-theme\[data-theme=(?:["']?)dark(?:["']?)\]\{([^}]+)\}/)?.[1]

  // Without these switches, both fallback colors concatenate into an invalid color.
  expect(light).toMatch(/--lightningcss-light:\s*initial\s*(?:;|$)/)
  expect(light).toMatch(/--lightningcss-dark:\s*(?:;|$)/)
  expect(dark).toMatch(/--lightningcss-light:\s*(?:;|$)/)
  expect(dark).toMatch(/--lightningcss-dark:\s*initial\s*(?:;|$)/)
})
