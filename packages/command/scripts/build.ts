import { toPlainObject } from '@wopjs/cast'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire, isBuiltin } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { buildJavaScriptBundle } from '../src/build/node/bundle.ts'
import { buildBunVersion } from '../src/cli/common/version.ts'

const rootPath = path.resolve(import.meta.dirname, '..')
const workspaceRoot = path.resolve(rootPath, '../..')
const openFlowRoot = path.resolve(rootPath, '../open-flow')
const outputArgument = process.argv.indexOf('--output')
if (outputArgument >= 0 && process.argv[outputArgument + 1] == null) throw new Error('--output requires a directory.')
const outputPath = path.resolve(outputArgument < 0 ? path.join(rootPath, 'dist/command') : process.argv[outputArgument + 1]!)
const execFileAsync = promisify(execFile)
const quiet = process.argv.includes('--quiet')
const packageManifest = await readManifest(path.join(rootPath, 'package.json'))
const openFlowManifest = await readManifest(path.join(openFlowRoot, 'package.json'))
const workspaceManifest = await readManifest(path.join(workspaceRoot, 'package.json'))
const commandVersion = readString(packageManifest, 'version')
const openFlowVersion = readString(openFlowManifest, 'version')

interface BundledPackageLicense {
  readonly license: string
  readonly licenseText: string
  readonly name: string
  readonly version: string
}

await validateVersions()
await rm(outputPath, { force: true, recursive: true })
await mkdir(outputPath, { recursive: true })
const result = await buildJavaScriptBundle(
  { entrypoints: [path.join(rootPath, 'src/cli/node/command.ts')], env: 'disable', format: 'esm', minify: true, splitting: false, target: 'bun' },
  { failureMessage: 'Command entry build failed.', onWarning: quiet ? undefined : (message) => process.stderr.write(`${message}\n`), projectRoot: rootPath },
)
for (const imported of result.externalImports) {
  if (!isBuiltin(imported)) throw new Error(`Unexpected external import ${imported}. Bundle it into the command entry.`)
}
for (const input of result.resolvedInputPaths) {
  const normalized = input.split(path.sep).join('/')
  if (['/src/workbench/', '/src/compiler/', '/src/project/node/'].some((part) => normalized.includes(part))) {
    throw new Error(`Command entry includes forbidden product code: ${input}`)
  }
}
await writeFile(path.join(outputPath, 'index.js'), result.bytes)
const declarations = path.join(outputPath, 'declarations')
const compiler = path.join(path.dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin/tsc')
await execFileAsync(
  process.execPath,
  [
    compiler,
    '--ignoreConfig',
    '--noCheck',
    '--declaration',
    '--emitDeclarationOnly',
    '--outDir',
    declarations,
    '--rootDir',
    workspaceRoot,
    '--module',
    'esnext',
    '--moduleResolution',
    'bundler',
    '--target',
    'esnext',
    '--allowImportingTsExtensions',
    '--resolveJsonModule',
    path.join(rootPath, 'src/cli/node/command.ts'),
  ],
  { cwd: rootPath },
)
await copyFile(path.join(declarations, 'packages/command/src/cli/node/command.d.ts'), path.join(outputPath, 'index.d.ts'))
await rm(declarations, { recursive: true, force: true })
await writeFile(path.join(outputPath, 'licenses.md'), await renderNodeLicenses(result.resolvedInputPaths))

async function validateVersions(): Promise<void> {
  const bunVersionFile = (await readFile(path.join(workspaceRoot, '.bun-version'), 'utf8')).trim()
  const packageManager = readString(workspaceManifest, 'packageManager')
  const bun = Reflect.get(globalThis, 'Bun')
  const runtimeVersion = bun != null && typeof bun == 'object' ? Reflect.get(bun, 'version') : undefined
  if (commandVersion != openFlowVersion) {
    throw new Error(`Command version ${commandVersion} does not match Open Flow version ${openFlowVersion}.`)
  }
  if (bunVersionFile != buildBunVersion) {
    throw new Error(`.bun-version must be ${buildBunVersion}; received ${bunVersionFile}.`)
  }
  if (packageManager != `bun@${buildBunVersion}`) {
    throw new Error(`packageManager must be bun@${buildBunVersion}; received ${packageManager}.`)
  }
  if (runtimeVersion != buildBunVersion) {
    throw new Error(`Build requires Bun ${buildBunVersion}; received ${String(runtimeVersion ?? 'an unsupported runtime')}.`)
  }
}

async function readManifest(filePath: string): Promise<Record<string, unknown>> {
  const manifest = toPlainObject(JSON.parse(await readFile(filePath, 'utf8')))
  if (manifest == null) throw new Error(`Invalid package manifest: ${filePath}`)
  return manifest
}

function readString(manifest: Record<string, unknown>, field: string): string {
  const value = manifest[field]
  if (typeof value != 'string' || value.length == 0) throw new Error(`Package manifest field ${field} must be a non-empty string.`)
  return value
}

async function renderNodeLicenses(inputs: readonly string[]): Promise<string> {
  const packagePaths = new Set<string>()
  for (const input of inputs) {
    if (!input.split(path.sep).includes('node_modules')) continue
    const packagePath = await findPackageManifest(input)
    if (packagePath != null) packagePaths.add(packagePath)
  }
  const packages = await Promise.all([...packagePaths].map(readPackageLicense))
  return packages
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
    .map((dependency) => [`### ${dependency.name} - ${dependency.version} (${dependency.license})`, '', dependency.licenseText].join('\n').trim())
    .join('\n\n')
}

async function findPackageManifest(inputPath: string, excludedPath?: string): Promise<string | undefined> {
  let directory = path.dirname(inputPath)
  while (true) {
    const packagePath = path.join(directory, 'package.json')
    if (packagePath == excludedPath) {
      const parent = path.dirname(directory)
      if (parent == directory) return
      directory = parent
      continue
    }
    try {
      await readFile(packagePath)
      return packagePath
    } catch (error) {
      if (error == null || typeof error != 'object' || !('code' in error) || error.code != 'ENOENT') throw error
    }
    const parent = path.dirname(directory)
    if (parent == directory) return
    directory = parent
  }
}

async function readPackageLicense(packagePath: string): Promise<BundledPackageLicense> {
  const manifest = toPlainObject(JSON.parse(await readFile(packagePath, 'utf8')))
  if (manifest == null) throw new Error(`Bundled dependency has invalid package metadata: ${packagePath}`)
  const name = manifest?.name
  const version = manifest?.version
  if (typeof name != 'string' || typeof version != 'string') {
    const ownerPackagePath = await findPackageManifest(packagePath, packagePath)
    if (ownerPackagePath != null) return readPackageLicense(ownerPackagePath)
    throw new Error(`Bundled dependency has invalid package metadata: ${packagePath}`)
  }

  const directory = path.dirname(packagePath)
  const licenseFile = (await readdir(directory)).find((file) => /^licen[cs]e(?:\.|$)/i.test(file))
  return {
    license: typeof manifest.license == 'string' ? manifest.license : 'unknown',
    licenseText: licenseFile == null ? '' : (await readFile(path.join(directory, licenseFile), 'utf8')).trim(),
    name,
    version,
  }
}
