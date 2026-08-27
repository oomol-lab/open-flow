import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import { glob, readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

const traverse = ((traverseModule as unknown as { readonly default?: typeof traverseModule }).default ?? traverseModule) as typeof traverseModule

test('keeps the canvas and off-screen node navigation keyboard visible', async () => {
  const [containerStyles, indicator, indicatorStyles] = await Promise.all([
    readFile('src/designer/browser/graph/ReactFlowContainer/ReactFlowContainer.module.scss', 'utf8'),
    readFile('src/designer/browser/graph/ReactFlowContainer/NodeIndicator.tsx', 'utf8'),
    readFile('src/designer/browser/graph/ReactFlowContainer/NodeIndicator.module.scss', 'utf8'),
  ])

  expect(containerStyles).toMatch(/\.flow:focus-visible \{[\s\S]*?box-shadow: inset 0 0 0 2px var\(--ui-ring\)/)
  expect(indicator).toMatch(/aria-label=\{title \|\| nodeId\}/)
  expect(indicator).toMatch(/ev\.detail === 0/)
  expect(indicator).not.toMatch(/tabIndex=\{-1\}/)
  expect(indicatorStyles).toMatch(/\.indicator:focus-visible/)
  expect(indicatorStyles).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
})

test('keeps Icon Picker controls named and stateful', async () => {
  const source = await readFile('src/designer/browser/icons/IconPicker/IconPicker.tsx', 'utf8')

  expect(source).toMatch(/aria-label=\{t\('close'\)\}/)
  expect(source).toMatch(/aria-label=\{t\('random'\)\}/)
  expect(source).toMatch(/aria-expanded=\{colorsPanel\}/)
  expect(source).toMatch(/aria-pressed=\{selectedColor === color\}/)
  expect(source).toMatch(/aria-label=\{t\('filter'\)\}/)
  expect(source).toMatch(/aria-label=\{icon\}/)
})

test('keeps expandable Handle rows on one labelled keyboard trigger', async () => {
  const [handleRow, handleRowStyles, flowSettings, nodeSettings] = await Promise.all([
    readFile('src/designer/browser/components/handleRow.tsx', 'utf8'),
    readFile('src/designer/browser/components/handleRow.module.scss', 'utf8'),
    readFile('src/designer/browser/graph/FlowDesigner/FlowSettings.tsx', 'utf8'),
    readFile('src/designer/browser/graph/Nodes/components/NodeHeadBlockSettings.tsx', 'utf8'),
  ])

  expect(handleRow).toMatch(/valueExpands\?: boolean/)
  expect(handleRow).toMatch(/aria-labelledby=\{expandLabelId\}/)
  expect(handleRow).toMatch(/className=\{styles\.valueExpandTrigger\}/)
  expect(handleRow).toMatch(/aria-expanded=\{props\.expanded \?\? undefined\}/)
  expect(handleRowStyles).toMatch(/\.valueExpandTrigger:focus-visible/)
  expect(flowSettings).not.toMatch(/className=\{styles\.subtitle\} onClick=/)
  expect(nodeSettings).not.toMatch(/className=\{styles\.subtitle\} onClick=/)
  expect((flowSettings.match(/valueExpands/g) ?? []).length).toBe(2)
  expect((nodeSettings.match(/valueExpands/g) ?? []).length).toBe(5)
})

test('keeps labels, iframe previews, and JSON expansion on semantic controls', async () => {
  const [label, iframePreview, jsonViewer, jsonViewerStyles] = await Promise.all([
    readFile('src/designer/browser/components/label.tsx', 'utf8'),
    readFile('src/designer/browser/preview/iframePreview.tsx', 'utf8'),
    readFile('src/designer/browser/jsonViewer/DataRender.tsx', 'utf8'),
    readFile('src/designer/browser/jsonViewer/JSONViewer.module.scss', 'utf8'),
  ])

  expect(label).not.toMatch(/onClick/)
  expect(iframePreview).not.toMatch(/<div onClick=/)
  expect(iframePreview).toMatch(/listen\(window, 'pointerup', \(\) => setFocus\(false\), true\)/)
  expect(iframePreview).toMatch(/onBlur=\{\(\) => setFocus\(false\)\}/)
  expect(iframePreview).toMatch(/onFocus=\{\(\) => setFocus\(true\)\}/)
  // The iframe always carries an accessible name, falling back to the localized default title.
  expect(iframePreview).toMatch(/title=\{title \?\? t\('preview\.title'\)\}/)
  expect(jsonViewer).not.toMatch(/<(?:span|div)[^>]*onClick=/)
  expect(jsonViewer).toMatch(/<button[\s\S]*?aria-label=\{ariaLabel\}/)
  expect(jsonViewer).not.toMatch(/role="button"/)
  expect(jsonViewerStyles).toMatch(/& > div > button:first-child/)
  expect(jsonViewerStyles).not.toMatch(/span\[role='button'\]/)
})

test('keeps every native Designer button safe inside forms', async () => {
  const missingType: string[] = []
  for await (const path of glob('src/designer/browser/**/*.tsx')) {
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

test('keeps section expansion and color actions on named keyboard controls', async () => {
  const [card, colorPicker, handleRow, inputSection, outputSection] = await Promise.all([
    readFile('src/designer/browser/graph/NodeSection/card.tsx', 'utf8'),
    readFile('src/designer/browser/components/colorPicker.tsx', 'utf8'),
    readFile('src/designer/browser/components/handleRow.tsx', 'utf8'),
    readFile('src/designer/browser/graph/NodeSection/InputSection.tsx', 'utf8'),
    readFile('src/designer/browser/graph/NodeSection/OutputSection.tsx', 'utf8'),
  ])

  expect(card).not.toMatch(/<h4[^>]*onClick=/)
  expect(card).toMatch(/<button aria-expanded=\{!collapsed\}[\s\S]*?type="button"/)
  expect(colorPicker).toMatch(/aria-label=\{t\('components\.chooseColor'\)\}/)
  expect(colorPicker).toMatch(/aria-label=\{t\('components\.pickColorFromScreen'\)\}/)
  expect(colorPicker).toMatch(/aria-label=\{t\('components\.clear'\)\}/)
  expect(colorPicker).not.toMatch(/<button tabIndex=\{-1\}/)
  expect(handleRow).toMatch(/aria-label=\{action\.title\}/)
  for (const section of [inputSection, outputSection]) {
    expect(section).toMatch(/aria-expanded=\{additional\}/)
    expect(section).toMatch(/aria-labelledby=\{additionalLabelId\}/)
  }
})
