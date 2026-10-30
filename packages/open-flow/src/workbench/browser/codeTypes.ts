import ts from 'typescript-lsp'

/**
 * Type environment of Code modules, matching the default Engine Contract `open-flow-engine/v8/nodejs-compat-v1`.
 * It declares ECMAScript, the Web globals that runtime provides, and the Node declarations of its builtin allowlist only,
 * so editor completion never offers DOM, networking or other host APIs that Tasks cannot use.
 */
export const codeCompilerOptions: import('typescript-lsp').CompilerOptions = {
  allowJs: true,
  checkJs: true,
  lib: ['lib.es2024.d.ts'],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  noEmit: true,
  strict: true,
  target: ts.ScriptTarget.ES2024,
  types: [],
}

const libraries = import.meta.glob<string>(
  [
    '../../../node_modules/typescript-lsp/lib/lib.es*.d.ts',
    '../../../node_modules/typescript-lsp/lib/lib.decorators*.d.ts',
    '!../../../node_modules/typescript-lsp/lib/lib.*.full.d.ts',
  ],
  { eager: true, query: '?raw', import: 'default' },
)
// Keep in sync with the builtin allowlist of the Node compatibility contract; codeTypes.test.ts verifies the coverage.
const nodeDeclarations = import.meta.glob<string>(
  [
    '../../../node_modules/@types/node/{assert,buffer,console,constants,crypto,events,fs,os,path,process,punycode,querystring}.d.ts',
    '../../../node_modules/@types/node/{stream,string_decoder,timers,url,util,zlib}.d.ts',
    '../../../node_modules/@types/node/{assert/strict,fs/promises,path/posix,stream/promises,stream/web,timers/promises,util/types}.d.ts',
    '../../../node_modules/@types/node/{globals,globals.typedarray,buffer.buffer}.d.ts',
    '../../../node_modules/@types/node/web-globals/{abortcontroller,console,crypto,domexception,encoding,events,performance,streams,timers,url}.d.ts',
  ],
  { eager: true, query: '?raw', import: 'default' },
)
const platformSources = import.meta.glob<string>('../../types/index.ts', { eager: true, query: '?raw', import: 'default' })

const nodeTypesPrefix = '../../../node_modules/@types/node/'
export const codeTypeFiles: ReadonlyMap<string, string> = new Map([
  ...Object.entries(libraries).map(([path, text]) => [`/${path.split('/').at(-1)}`, text] as const),
  ...Object.entries(nodeDeclarations).map(([path, text]) => [`file:///node_modules/@types/node/${path.slice(nodeTypesPrefix.length)}`, text] as const),
  ['file:///node_modules/@oomol-lab/open-flow/package.json', JSON.stringify({ name: '@oomol-lab/open-flow', types: 'index.d.ts' })],
  ['file:///node_modules/@oomol-lab/open-flow/index.d.ts', platformSources['../../types/index.ts']!],
])
/** Ambient declarations are program roots; ECMAScript libraries load through `lib`. */
export const codeTypeRoots: readonly string[] = [...codeTypeFiles.keys()].filter((file) => file.startsWith('file:///node_modules/@types/node/'))
