import { unpackTar } from 'modern-tar'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { gunzipSync } from 'node:zlib'

const execFileAsync = promisify(execFile)
const packageRequire = createRequire(import.meta.url)
const compiler = path.join(path.dirname(packageRequire.resolve('typescript/package.json')), 'bin/tsc')
const rootPath = path.resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(path.join(rootPath, 'package.json'), 'utf8')) as { version: string; devDependencies: Record<string, string> }
const tarballPath = path.join(rootPath, 'dist/release', `oomol-lab-open-flow-${manifest.version}.tgz`)
const sharedUiTokens = [
  '--ui-accent',
  '--ui-accent-foreground',
  '--ui-background',
  '--ui-border',
  '--ui-card',
  '--ui-card-foreground',
  '--ui-destructive',
  '--ui-foreground',
  '--ui-input',
  '--ui-muted',
  '--ui-muted-foreground',
  '--ui-popover',
  '--ui-popover-foreground',
  '--ui-primary',
  '--ui-primary-foreground',
  '--ui-radius',
  '--ui-ring',
  '--ui-secondary',
  '--ui-secondary-foreground',
] as const

await execFileAsync(process.execPath, [path.join(rootPath, 'scripts/build.ts'), '--quiet'], { cwd: rootPath })
const entries = await unpackTar(gunzipSync(await readFile(tarballPath)), { strict: true })
const entryNames = entries.map((entry) => entry.header.name)
// Documentation and legal notices must ship even though consumers do not import them.
for (const expected of ['LICENSE', 'NOTICE', 'README.md', 'dist/browser/licenses.md', 'dist/command/licenses.md']) {
  assert.ok(entryNames.includes(`package/${expected}`), `Missing npm package entry ${expected}.`)
}
assert.equal(
  entryNames.some((name) => name.includes('/src/')),
  false,
)
assert.equal(
  entryNames.some((name) => name.includes('isolated-vm-runtime')),
  false,
)
assert.equal(
  entryNames.every((name) => !name.startsWith('package/dist/browser/') || !name.endsWith('.map')),
  true,
)

const packedManifest = JSON.parse(readPackedText('package.json')) as Record<string, unknown>
assert.equal(packedManifest.name, '@oomol-lab/open-flow')
assert.equal(packedManifest.version, manifest.version)
assert.equal(packedManifest.license, 'SEE LICENSE IN LICENSE')
assert.equal(readPackedText('LICENSE'), await readFile(path.join(rootPath, '../../LICENSE'), 'utf8'))
// Validate advertised targets without freezing the internal output layout or export inventory.
assert.ok(packedManifest.exports && typeof packedManifest.exports == 'object')
verifyExportTargets(packedManifest.exports)
assert.equal(typeof packedManifest.types, 'string')
verifyExportTargets(packedManifest.types)
for (const forbidden of ['bin', 'dependencies', 'devDependencies', 'main', 'module', 'scripts']) {
  assert.equal(Object.hasOwn(packedManifest, forbidden), false)
}

const previewStyle = readPackedText('dist/browser/preview.css')
for (const token of sharedUiTokens) assert.ok(previewStyle.includes(`${token}:`), `Missing ${token} from the published preview CSS.`)
assert.doesNotMatch(previewStyle, /data:font\//)
for (const [, asset] of previewStyle.matchAll(/url\((?:["'])?(\.\/assets\/[^)"']+)/g)) {
  assert.ok(
    entries.some((entry) => entry.header.name == `package/dist/browser/${asset!.slice(2)}`),
    `Missing preview asset ${asset}`,
  )
}
const workbenchStyle = readPackedText('dist/browser/workbench.css')
for (const icon of ['i-lucide-light:zoom-in', 'i-lucide-light:zoom-out', 'i-lucide-light:scan', 'i-codicon:copy', 'i-codicon:trash']) {
  assert.ok(workbenchStyle.includes(`.${icon.replaceAll(':', '\\:')}`), `Missing packaged icon CSS for ${icon}.`)
}
assert.match(workbenchStyle, /:where\([^)]*\.open-flow-workbench[^)]*\)\s+\.hidden\s*\{\s*display:\s*none\s*;?\s*\}/)
for (const token of sharedUiTokens) assert.ok(workbenchStyle.includes(`${token}:`), `Missing ${token} from the published Workbench CSS.`)
const themeStyle = readPackedText('dist/browser/theme.css')
assert.match(themeStyle, /\.open-flow-theme\s*\{/)
assert.match(themeStyle, /\.open-flow-theme\[data-theme='dark'\]/)
for (const token of sharedUiTokens) assert.ok(themeStyle.includes(`${token}:`), `Missing ${token} from the published product theme CSS.`)
assert.doesNotMatch(workbenchStyle, /(?:^|[{},])\s*\.hidden\s*\{\s*display:\s*none/)
assert.doesNotMatch(workbenchStyle, /data:font\//)
const referencedFonts = [...workbenchStyle.matchAll(/url\((\.\/assets\/font-[a-f\d]{16}\.(?:woff2|woff|ttf))\)/g)].map(
  (match) => `package/dist/browser/${match[1]!.slice(2)}`,
)

assert.ok(referencedFonts.length > 0)
for (const font of referencedFonts) {
  assert.ok(entryNames.includes(font), `Missing Workbench font ${font}.`)
}
await verifyConsumer()

console.log('Verified the public npm package, Browser runtime, and bundled command consumer.')

function readPackedText(file: string): string {
  const packedFile = entries.find((entry) => entry.header.name == `package/${file}`)
  assert.ok(packedFile?.data, `Missing npm package file ${file}.`)
  return new TextDecoder().decode(packedFile.data)
}

function verifyExportTargets(target: unknown): void {
  if (typeof target == 'string') {
    assert.ok(target.startsWith('./'), `Package target must be relative: ${target}`)
    assert.ok(entryNames.includes(`package/${target.slice(2)}`), `Missing npm package target ${target}.`)
    return
  }
  assert.ok(target && typeof target == 'object', 'Expected an export target or condition map.')
  for (const value of Object.values(target)) verifyExportTargets(value)
}

async function verifyConsumer(): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-consumer-'))
  try {
    // Templates become source files only in the isolated project that installs the tarball.
    const templates = path.join(import.meta.dirname, 'npm-package-consumer')
    for (const file of (await readdir(templates)).filter((name) => name.endsWith('.txt'))) {
      await copyFile(path.join(templates, file), path.join(directory, file.slice(0, -'.txt'.length)))
    }
    await writeFile(
      path.join(directory, 'package.json'),
      `${JSON.stringify(
        {
          dependencies: {
            '@oomol-lab/open-flow': `file:${tarballPath}`,
            'effect': (packedManifest.peerDependencies as { effect: string }).effect,
            'react': manifest.devDependencies.react,
            'react-dom': manifest.devDependencies['react-dom'],
          },
          devDependencies: {
            '@types/react': manifest.devDependencies['@types/react'],
            '@types/react-dom': manifest.devDependencies['@types/react-dom'],
            // Exercise the Rollup consumer pipeline as well as our Rolldown package build.
            'vite': '7.3.6',
          },
          private: true,
          type: 'module',
        },
        undefined,
        2,
      )}\n`,
    )
    await execFileAsync(process.execPath, ['install', '--ignore-scripts'], { cwd: directory })
    const consumerPath = path.join(directory, 'types.tsx')
    await execFileAsync(
      process.execPath,
      [
        compiler,
        '--ignoreConfig',
        '--noEmit',
        '--module',
        'preserve',
        '--moduleResolution',
        'bundler',
        '--target',
        'esnext',
        '--jsx',
        'react-jsx',
        '--strict',
        '--verbatimModuleSyntax',
        consumerPath,
      ],
      { cwd: directory },
    )
    const runtimePath = path.join(directory, 'runtime.mjs')
    await execFileAsync(process.execPath, [runtimePath], { cwd: directory })
    const browserPath = path.join(directory, 'browser.mjs')
    await execFileAsync(process.execPath, [browserPath], { cwd: directory })
    await verifyCommandConsumer(directory, manifest.version)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

async function verifyCommandConsumer(consumer: string, version: string): Promise<void> {
  const entry = '@oomol-lab/open-flow/command'
  const imported = await execFileAsync(process.execPath, ['-e', `await import('${entry}')`], { cwd: consumer })
  assert.equal(imported.stdout, '', 'Import must not execute the CLI.')
  assert.equal(imported.stderr, '')
  await execFileAsync(process.execPath, [compiler, '--ignoreConfig', '--noEmit', '--strict', '--module', 'nodenext', '--target', 'esnext', 'command.ts'], {
    cwd: consumer,
  })
  const direct = await execFileAsync(process.execPath, ['command.ts'], { cwd: consumer })
  assert.equal(direct.stderr, '')
  const outputs = direct.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.deepEqual(outputs[0], { version })
  assert.deepEqual(outputs[1], { flows: [], kind: 'flow.list', version: 1 })
  assert.equal(outputs[2].url, 'https://example.test/flows/flow-1')
  assert.deepEqual(outputs[3], {
    kind: 'flow.live',
    live: { flowId: 'flow-1', publication: null, inputDefs: null, status: 'not-published', entries: [], version: 1 },
    version: 1,
  })
  await execFileAsync(process.execPath, ['build', 'command.ts', '--target=bun', '--outfile=host.js'], { cwd: consumer })
  await execFileAsync(process.execPath, ['build', 'command.ts', '--compile', '--outfile=host'], { cwd: consumer })
  await rm(path.join(consumer, 'node_modules'), { recursive: true, force: true })
  const bundled = await execFileAsync(process.execPath, ['host.js'], { cwd: consumer, env: { ...process.env, BUN_CONFIG_NO_INSTALL: '1' } })
  assert.equal(bundled.stderr, '')
  assert.equal(bundled.stdout, direct.stdout)
  const executable = await execFileAsync(path.join(consumer, 'host'), [], { cwd: consumer })
  assert.equal(executable.stderr, '')
  assert.equal(executable.stdout, direct.stdout)
}
