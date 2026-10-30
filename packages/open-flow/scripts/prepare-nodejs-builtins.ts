import type { BuildOptions } from 'esbuild'

import { build } from 'esbuild'
import packages from 'node-stdlib-browser'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { runInNewContext } from 'node:vm'

// Bundles the platform-owned guest implementation of open-flow-engine/v8/nodejs-compat-v1. Only trusted, pinned
// dependencies run here; user modules never enter this build. `--check` verifies the committed output instead.
const root = path.resolve(import.meta.dirname, '..')
const sources = path.join(import.meta.dirname, 'nodejs-builtins')
const outputPath = path.join(root, 'src/runtime/common/nodejsGuest.generated.json')
const check = process.argv.includes('--check')
const require = createRequire(import.meta.url)
const entries: Record<string, string> = Object.fromEntries(
  [
    'assert',
    'buffer',
    'constants',
    'crypto',
    'events',
    'os',
    'path',
    'process',
    'punycode',
    'querystring',
    'stream',
    'string_decoder',
    'timers',
    'timers/promises',
    'url',
    'util',
    'zlib',
  ].map((name) => [name, `import value from ${JSON.stringify(name)};`]),
)
Object.assign(entries, {
  'process': "import value from './compat-process.js';",
  'timers/promises': "import value from './compat-timers-promises.js';",
  'assert/strict': "import assert from 'assert'; const value = assert.strict;",
  'path/posix': "import path from 'path'; const value = path.posix;",
  'fs': "import value from './compat-fs.js';",
  'fs/promises': "import fs from './compat-fs.js'; const value = fs.promises;",
  'stream/web': "import * as value from 'web-streams-polyfill';",
  'stream/promises': "import value from 'readable-stream/lib/stream/promises.js';",
  'console':
    "const value = Object.fromEntries(['assert', 'debug', 'error', 'info', 'log', 'warn'].map(name => [name, (...args) => globalThis.console[name](...args)]));",
})
entries.crypto += 'Object.assign(value, { randomUUID: globalThis.crypto.randomUUID, getRandomValues: globalThis.crypto.getRandomValues });'
entries.stream +=
  "import promises from 'readable-stream/lib/stream/promises.js'; Object.defineProperty(value, 'promises', { value: promises, enumerable: true, configurable: true, writable: true });"
entries.url += 'Object.assign(value, { URL: globalThis.URL, URLSearchParams: globalThis.URLSearchParams });'
entries.util += 'Object.assign(value, { TextEncoder: globalThis.TextEncoder, TextDecoder: globalThis.TextDecoder });'

const globals: Record<string, string> = {
  buffer: "export { Buffer } from 'buffer';",
  process: "export { default as process } from './compat-process.js';",
  url: 'export const { URL, URLSearchParams } = globalThis;',
  streams: "export * from 'web-streams-polyfill';",
  abort: "export { AbortController, AbortSignal } from './compat-abort.js';",
}
let exportedNames: Record<string, string[]> = {}
const options: BuildOptions = {
  absWorkingDir: root,
  bundle: true,
  write: false,
  platform: 'browser',
  target: 'es2022',
  alias: {
    ...packages,
    'stream': require.resolve('readable-stream/lib/ours/browser.js'),
    'node:stream': require.resolve('readable-stream/lib/ours/browser.js'),
    'abort-controller': path.join(sources, 'compat-abort.js'),
  },
  inject: [path.join(sources, 'compat-globals.js')],
  define: { global: 'globalThis' },
  minify: true,
  keepNames: true,
  legalComments: 'inline',
  plugins: [
    {
      name: 'builtin-modules',
      setup(plugin) {
        plugin.onResolve({ filter: /^guest:buffer$/ }, () => ({ path: require.resolve(packages.buffer!) }))
        plugin.onResolve({ filter: /^guest:primitives$/ }, () => ({ path: 'guest:primitives', external: true }))
        plugin.onResolve({ filter: /^environment:/ }, (args) => ({ path: args.path.slice(12), namespace: 'environment' }))
        plugin.onLoad({ filter: /.*/, namespace: 'environment' }, (args) => ({ contents: globals[args.path], resolveDir: sources }))
        plugin.onResolve({ filter: /^deferred:crypto$/ }, () => ({ path: 'crypto', namespace: 'deferred' }))
        plugin.onLoad({ filter: /.*/, namespace: 'deferred' }, () => ({ contents: `${legacyCrypto} export default value;`, resolveDir: sources }))
        plugin.onResolve({ filter: /^compat:/ }, (args) => ({ path: args.path.slice(7), namespace: 'compat' }))
        plugin.onLoad({ filter: /.*/, namespace: 'compat' }, (args) => ({
          contents:
            `${entries[args.path]} export default value;\n` +
            (exportedNames[args.path] ?? [])
              .filter((key) => key !== 'default' && /^[A-Za-z_$][\w$]*$/.test(key))
              .map((key, index) => `const exported${index} = value[${JSON.stringify(key)}]; export { exported${index} as ${key} };`)
              .join('\n'),
          resolveDir: sources,
        }))
      },
    },
  ],
}
const result = await build({
  ...options,
  format: 'iife',
  globalName: '__compat',
  stdin: {
    contents:
      `import './compat-environment.js';\n` +
      Object.keys(globals)
        .map((name, index) => `import * as g${index} from 'environment:${name}';`)
        .join('\n') +
      `\nexport const globals = { ${Object.keys(globals)
        .map((name, index) => `${JSON.stringify(name)}: Object.keys(g${index})`)
        .join(',')} };\n` +
      Object.keys(entries)
        .map((name, index) => `import m${index} from 'compat:${name}';`)
        .join('\n') +
      `\nexport const modules = { ${Object.keys(entries)
        .map((name, index) => `${JSON.stringify(name)}: m${index}`)
        .join(',')} };`,
    resolveDir: sources,
  },
})
const source = result.outputFiles![0]!.text
// Only trusted, bundled dependencies run here; user modules never enter this build step.
const sandbox = {
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  queueMicrotask,
  atob,
  btoa,
  crypto,
  console,
}
const inspected = runInNewContext(
  `${source}; ({ crypto: __compat.modules.crypto, globals: __compat.globals, modules: Object.fromEntries(Object.entries(__compat.modules).map(([name, value]) => { if (value == null) throw new Error(name); return [name, Object.keys(value)] })) })`,
  sandbox,
) as { crypto: Record<string, unknown>; globals: Record<string, string[]>; modules: Record<string, string[]> }
exportedNames = inspected.modules
const legacyCrypto = entries.crypto
const functions = new Map<object, string>()
entries.crypto = "import { loadBuiltin } from 'guest:primitives'; import { createHash, createHmac } from './compat-hash.js'; const value = {};"
for (const [name, value] of Object.entries(inspected.crypto)) {
  if (typeof value !== 'function') {
    entries.crypto += `value[${JSON.stringify(name)}] = ${JSON.stringify(value)};`
    continue
  }
  let local = functions.get(value)
  if (!local) {
    // These polyfill exports are factories, not classes with prototype methods or static state.
    if (
      Object.getOwnPropertyNames(value).some((key) => !['length', 'name', 'prototype', 'arguments', 'caller'].includes(key)) ||
      Object.getOwnPropertyNames(value.prototype ?? {}).some((key) => key !== 'constructor')
    )
      throw new Error(`Crypto export requires explicit lazy loading support: ${name}`)
    local = `lazy${functions.size}`
    functions.set(value, local)
    entries.crypto += `function ${local}(...args) { return Reflect.apply(loadBuiltin('crypto').default[${JSON.stringify(name)}], this, args); }
      Object.defineProperties(${local}, { name: {value: ${JSON.stringify(value.name)}}, length: {value: ${value.length}} });`
  }
  entries.crypto += `value[${JSON.stringify(name)}] = ${local};`
}
entries.crypto +=
  'Object.assign(value, {createHash, createHmac, Hash: createHash, Hmac: createHmac, randomUUID: globalThis.crypto.randomUUID, getRandomValues: globalThis.crypto.getRandomValues});'

entries.zlib = "import value from './compat-zlib.js';"
Object.assign(options.alias!, {
  'buffer': path.join(sources, 'compat-buffer.js'),
  'node:buffer': path.join(sources, 'compat-buffer.js'),
})
const outdir = path.join(root, 'node_modules/.cache/open-flow-nodejs-builtins')
const output = await build({
  ...options,
  format: 'esm',
  splitting: true,
  outdir,
  outExtension: { '.js': '.mjs' },
  entryNames: '[dir]/[name]',
  chunkNames: 'chunks/[name]-[hash]',
  entryPoints: Object.fromEntries([
    ['deferred/crypto', 'deferred:crypto'],
    ...Object.keys(globals).map((name) => [`globals/${name}`, `environment:${name}`]),
    ...Object.keys(entries).map((name) => [`builtin/${name}`, `compat:${name}`]),
  ]),
})
const modules: Record<string, string> = Object.fromEntries(
  output.outputFiles!.map((file) => [
    `engine/${path.relative(outdir, file.path)}`,
    file.text.replaceAll('"guest:primitives"', JSON.stringify(path.relative(path.dirname(file.path), path.join(outdir, 'web.mjs')))),
  ]),
)
modules['engine/globals/url.mjs'] = await readFile(path.join(sources, 'url.guest.js'), 'utf8')
modules['engine/web.mjs'] = await readFile(path.join(sources, 'web.guest.js'), 'utf8')
modules['engine/globals.mjs'] = (await readFile(path.join(sources, 'globals.guest.js'), 'utf8')).replace(
  '// Global groups.',
  `const groups = ${JSON.stringify(inspected.globals)};`,
)
const generated = `${JSON.stringify(Object.fromEntries(Object.entries(modules).toSorted(([left], [right]) => left.localeCompare(right))), null, 2)}\n`
if (check) {
  if ((await readFile(outputPath, 'utf8').catch(() => '')) != generated) {
    console.error('Node compatibility builtins are stale. Run `bun run generate:nodejs-builtins`.')
    process.exit(1)
  }
} else {
  const temporary = `${outputPath}.${process.pid}.tmp`
  await writeFile(temporary, generated)
  await rename(temporary, outputPath)
  const sourceBytes = Object.values(modules).reduce((size, code) => size + Buffer.byteLength(code), 0)
  console.log(`Prepared ${Object.keys(entries).length} builtin modules with shared chunks (${sourceBytes} bundled source bytes).`)
}
