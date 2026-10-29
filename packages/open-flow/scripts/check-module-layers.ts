import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as ts from 'typescript-lsp'

/**
 * Source modules from the lowest layer to the highest. A file may import only its own layer or lower ones,
 * including type-only imports, so node families never depend on the graph that aggregates them.
 */
const layers: readonly (readonly [name: string, patterns: readonly RegExp[]])[] = [
  ['foundation', [/^types\//, /^base\//, /^json-schema-subset\//, /^localization\//, /^llm\//, /^schema\//]],
  [
    'flow model',
    [
      /^flow\/common\/(?:model|inputValue|json|schema|schemaCompare|schemaComparer|schemaKeywords|triggerScheduleSchema|webhookMethod|webhookResponse)\.ts$/,
      /^connector\/common\//,
      /^event-source\/common\//,
    ],
  ],
  ['node families', [/^decision\//, /^openapi\//, /^trigger\/(?:common|providers)\//, /^runtime\//]],
  ['flow', [/^flow\//]],
  ['workflow calls', [/^workflow\//]],
  ['execution', [/^execution\//]],
  ['control', [/^control\//, /^canvas\/common\//, /^form\/common\//]],
  ['browser', [/^(?:canvas|form|trigger|ui|workbench|designer|distribution)\/browser\//]],
  ['build', [/^build\//, /^distribution\/node\//]],
]

const sourceRoot = path.resolve(import.meta.dirname, '../src')

function layerOf(file: string): number | undefined {
  const index = layers.findIndex(([, patterns]) => patterns.some((pattern) => pattern.test(file)))
  return index < 0 ? undefined : index
}

const violations: string[] = []
for (const file of globSync('**/*.{ts,tsx}', { cwd: sourceRoot })) {
  if (/\.(?:test|spec)\.tsx?$|(?:^|\/)__tests__\/|\.d\.ts$/.test(file)) continue
  const layer = layerOf(file)
  if (layer == null) {
    violations.push(`${file}: assign this module to a layer in scripts/check-module-layers.ts`)
    continue
  }
  const source = ts.createSourceFile(file, readFileSync(path.join(sourceRoot, file), 'utf8'), ts.ScriptTarget.Latest, true)
  const visit = (node: ts.Node): void => {
    const specifier =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier != null && ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier
        : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)
          ? node.argument.literal
          : ts.isCallExpression(node) &&
              node.expression.kind == ts.SyntaxKind.ImportKeyword &&
              node.arguments[0] != null &&
              ts.isStringLiteral(node.arguments[0])
            ? node.arguments[0]
            : undefined
    if (specifier?.text.startsWith('.')) {
      const target = path.posix.join(path.posix.dirname(file), specifier.text)
      const targetLayer = layerOf(target)
      if (targetLayer != null && targetLayer > layer) {
        const line = source.getLineAndCharacterOfPosition(specifier.getStart(source)).line + 1
        violations.push(`${file}:${line}: ${layers[layer]![0]} must not import ${layers[targetLayer]![0]} (${target})`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}
if (violations.length) throw new Error(violations.join('\n'))
