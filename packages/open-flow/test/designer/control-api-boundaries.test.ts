import { glob, readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('keeps Cloud Workbench form controls on the shared component layer', async () => {
  const paths: string[] = []
  for await (const path of glob('src/workbench/browser/runtime/**/*.{ts,tsx}')) {
    if (!/\.test\.tsx?$/.test(path)) paths.push(path)
  }
  const sources = await Promise.all(paths.map(async (path) => ({ path, source: await readFile(path, 'utf8') })))
  const rawControls = sources.filter(({ source }) => /<(?:button|input|label|select|textarea)\b/.test(source))
  expect(rawControls.map(({ path }) => path)).toEqual([])
})

test('keeps Tailwind as the utility owner and UnoCSS as the icon owner', async () => {
  const [styles, unoConfig] = await Promise.all([readFile('src/ui/browser/styles.css', 'utf8'), readFile('src/build/node/designerUnoConfig.ts', 'utf8')])

  expect(styles).toContain('@layer theme, base, utilities;')
  expect(styles).toContain("@config './tailwind.config.ts';")
  expect(styles).toContain("@import 'tailwindcss/utilities.css' layer(utilities);")
  expect(styles).toContain("@import 'tw-animate-css';")
  expect(styles).toContain("@source '../../canvas/browser';")
  expect(styles).toContain("@source '../../workbench/browser';")
  expect(unoConfig).toContain('presetIcons({')
  expect(unoConfig).not.toContain('presetWind3')
})

test('does not use utility syntax that only UnoCSS Wind3 understands', async () => {
  const paths: string[] = []
  for await (const path of glob('src/{canvas,workbench}/browser/**/*.{ts,tsx}')) paths.push(path)
  const sources = await Promise.all(paths.map((path) => readFile(path, 'utf8')))
  const source = sources.join('\n')

  expect(source).not.toMatch(/(?:!justify-start|\bmb-2px\b|\bfont-size-4\b|\bbg-dark\b)/)
})
