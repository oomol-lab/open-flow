import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import { glob, readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

const traverse = ((traverseModule as unknown as { readonly default?: typeof traverseModule }).default ?? traverseModule) as typeof traverseModule

test('keeps Icon Picker controls named and stateful', async () => {
  const source = await readFile('src/ui/browser/icons/picker/IconPicker.tsx', 'utf8')

  expect(source).toMatch(/aria-label=\{t\('close'\)\}/)
  expect(source).toMatch(/aria-label=\{t\('random'\)\}/)
  expect(source).toMatch(/aria-expanded=\{colorsPanel\}/)
  expect(source).toMatch(/aria-pressed=\{selectedColor === color\}/)
  expect(source).toMatch(/aria-label=\{t\('filter'\)\}/)
  expect(source).toMatch(/aria-label=\{icon\}/)
})

test('keeps JSON expansion on semantic controls', async () => {
  const [jsonViewer, jsonViewerStyles] = await Promise.all([
    readFile('src/ui/browser/json-viewer/DataRender.tsx', 'utf8'),
    readFile('src/ui/browser/json-viewer/JSONViewer.module.scss', 'utf8'),
  ])

  expect(jsonViewer).not.toMatch(/<(?:span|div)[^>]*onClick=/)
  expect(jsonViewer).toMatch(/<button[\s\S]*?aria-label=\{ariaLabel\}/)
  expect(jsonViewer).not.toMatch(/role="button"/)
  expect(jsonViewerStyles).toMatch(/& > div > button:first-child/)
  expect(jsonViewerStyles).not.toMatch(/span\[role='button'\]/)
})

test('keeps every native canvas button safe inside forms', async () => {
  const missingType: string[] = []
  for await (const path of glob('src/canvas/browser/**/*.tsx')) {
    const source = await readFile(path, 'utf8')
    const ast = parse(source, { plugins: ['jsx', 'typescript'], sourceFilename: path, sourceType: 'module' })
    traverse(ast, {
      JSXOpeningElement(element) {
        if (element.node.name.type != 'JSXIdentifier' || element.node.name.name != 'button') return
        const hasType = element.node.attributes.some(
          (attribute) => attribute.type == 'JSXAttribute' && attribute.name.type == 'JSXIdentifier' && attribute.name.name == 'type',
        )
        if (!hasType) missingType.push(`${path}:${element.node.loc?.start.line ?? 0}`)
      },
    })
  }

  expect(missingType).toEqual([])
})
