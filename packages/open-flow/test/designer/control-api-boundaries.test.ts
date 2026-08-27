import { glob, readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

interface ControlContract {
  readonly file: string
  readonly forbidden: RegExp
  readonly required: RegExp
}

const controlContracts: readonly ControlContract[] = [
  {
    file: 'src/designer/browser/components/input2.tsx',
    forbidden: /\b(?:Input2|Input2Props)\b/,
    required: /export const TranslationInput\b/,
  },
  {
    file: 'src/designer/browser/components/select.tsx',
    forbidden: /\b(?:SelectProps|IBasicOption|IBasicGroup)\b|export const Select\b/,
    required: /export const DesignerCombobox\b/,
  },
  {
    file: 'src/designer/browser/components/toggleSwitch.tsx',
    forbidden: /\b(?:ToggleSwitch|ToggleSwitchProps)\b/,
    required: /export function LabeledSwitch\b/,
  },
  {
    file: 'src/designer/browser/components/checkbox.tsx',
    forbidden: /\b(?:CheckBox|CheckBoxProps|ILabelConfig)\b/,
    required: /export const DesignerCheckbox\b/,
  },
]

test('does not reintroduce generic Designer control APIs', async () => {
  for (const contract of controlContracts) {
    const source = await readFile(contract.file, 'utf8')
    expect(source, contract.file).toMatch(contract.required)
    expect(source, contract.file).not.toMatch(contract.forbidden)
  }
})

test('keeps Cloud Workbench form controls on the shared component layer', async () => {
  const paths: string[] = []
  for await (const path of glob('src/workbench/browser/runtime/**/*.{ts,tsx}')) paths.push(path)
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
  expect(styles).toContain("@source '../../designer/browser';")
  expect(styles).toContain("@source '../../workbench/browser';")
  expect(unoConfig).toContain('presetIcons({')
  expect(unoConfig).not.toContain('presetWind3')
})

test('does not use utility syntax that only UnoCSS Wind3 understands', async () => {
  const paths: string[] = []
  for await (const path of glob('src/{designer,workbench}/browser/**/*.{ts,tsx}')) paths.push(path)
  const sources = await Promise.all(paths.map((path) => readFile(path, 'utf8')))
  const source = sources.join('\n')

  expect(source).not.toMatch(/(?:!justify-start|\bmb-2px\b|\bfont-size-4\b|\bbg-dark\b)/)
})
