import { createSystem, createVirtualTypeScriptEnvironment } from '@typescript/vfs'
import ts from 'typescript-lsp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findEngineContract, nodejsEngineContract } from '../../runtime/common/engineContract.ts'
import { codeCompilerOptions, codeTypeFiles, codeTypeRoots } from './codeTypes.ts'

const moduleUri = 'file:///module.js'
let environment: ReturnType<typeof createVirtualTypeScriptEnvironment>

beforeAll(() => {
  const files = new Map(codeTypeFiles)
  files.set(moduleUri, 'export {}')
  const compiler = ts as unknown as Parameters<typeof createVirtualTypeScriptEnvironment>[2]
  environment = createVirtualTypeScriptEnvironment(createSystem(files), [...codeTypeRoots, moduleUri], compiler, codeCompilerOptions)
})
afterAll(() => environment?.languageService.dispose())

function diagnostics(source: string): string[] {
  environment.updateFile(moduleUri, source)
  return environment.languageService
    .getSemanticDiagnostics(moduleUri)
    .map((diagnostic: ts.Diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

describe('Code type environment', () => {
  it('declares every builtin module of the default Engine Contract', () => {
    const builtins = [...findEngineContract(nodejsEngineContract)!.builtinModules!]
    const source = builtins.map((name, index) => `import * as module${index} from ${JSON.stringify(name)}`).join('\n')
    expect(diagnostics(`${source}\nexport {}`)).toEqual([])
  })

  it('declares the runtime globals and the Task context', () => {
    expect(
      diagnostics(`/** @param {unknown} _ @param {import('@oomol-lab/open-flow').TaskContext} context */
export default async function (_, context) {
  const bytes = Buffer.from(new TextEncoder().encode(process.cwd()))
  const url = new URL('https://example.com/?q=' + new URLSearchParams({ id: crypto.randomUUID() }))
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 1)
  console.info(url.href, bytes.length, AbortSignal.timeout(10).aborted, new ReadableStream())
  const ref = await context.artifact.put('text', { name: 'a.txt' })
  return { ref, previous: await context.getPrevious(), signal: context.signal.aborted }
}`),
    ).toEqual([])
  })

  it('omits browser, networking and module-loader APIs the runtime does not provide', () => {
    expect(
      diagnostics(`import http from 'node:http'
/** @param {unknown} _ @param {import('@oomol-lab/open-flow').TaskContext} context */
export default async function (_, context) {
  return [http, fetch, document, window, XMLHttpRequest, require, context.fetch, context.logger]
}`),
    ).toEqual(
      [
        "'node:http'",
        "name 'fetch'",
        "name 'document'",
        "name 'window'",
        "name 'XMLHttpRequest'",
        "name 'require'",
        "'fetch' does not exist",
        "'logger' does not exist",
      ].map((text) => expect.stringContaining(text)),
    )
  })
})
