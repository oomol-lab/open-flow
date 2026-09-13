import { globSync, readFileSync } from 'node:fs'
import * as ts from 'typescript-lsp'

const owners = new Set(['src/workbench/browser/runtime/stores/catalogStores.ts', 'src/workbench/browser/runtime/stores/triggerCatalog.ts'])
const methods = new Set([
  'readCatalog',
  'readProxyCatalog',
  'getTriggerCatalog',
  'listTriggerDefinitions',
  'listConnectorProviders',
  'listConnectorActions',
  'searchConnectorActions',
  'getConnectorAction',
  'listAllConnectorConnections',
  'listConnectorConnections',
])
const violations: string[] = []
for (const path of globSync('src/**/browser/**/*.{ts,tsx}')) {
  if (path.includes('.test.') || owners.has(path)) continue
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const visit = (node: ts.Node): void => {
    const name = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)
        ? node.argumentExpression.text
        : ts.isBindingElement(node)
          ? (node.propertyName ?? node.name).getText(source)
          : undefined
    if (name != null && methods.has(name)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      violations.push(`${path}:${line}: use the catalog Store instead of ${name}`)
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) &&
      /\/v1\/(connector\/(proxy\/(?:providers|actions|apps)|providers|actions|action-metadata|connections)(?:[/?]|$)|trigger-keys\/catalog)/.test(node.text)
    ) {
      violations.push(`${path}: catalog request paths belong to the catalog Stores`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}
if (violations.length) throw new Error(violations.join('\n'))
