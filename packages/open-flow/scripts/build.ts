import { toPlainObject } from '@wopjs/cast'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { promisify } from 'node:util'
import { generateTriggerLocales } from '../src/build/node/triggerLocales.ts'
import { buildBrowserPackage } from '../src/distribution/node/browserPackage.ts'
import { stageNpmPackage } from '../src/distribution/node/npmPackage.ts'

const rootPath = path.resolve(import.meta.dirname, '..')
const workspaceRoot = path.resolve(rootPath, '../..')
const outputPath = path.join(rootPath, 'dist')
const npmPackageRoot = path.join(outputPath, 'npm-package/package')
const releaseRoot = path.join(outputPath, 'release')
const quiet = process.argv.includes('--quiet')
const execFileAsync = promisify(execFile)
const packageRequire = createRequire(import.meta.url)
const packageManifest = await readManifest(path.join(rootPath, 'package.json'))
const workspaceManifest = await readManifest(path.join(workspaceRoot, 'package.json'))
const openFlowVersion = readString(packageManifest, 'version')

await validateVersions()
await generateTriggerLocales()
await rm(outputPath, { force: true, recursive: true })
await mkdir(releaseRoot, { recursive: true })
await buildNpmPackage()

async function buildNpmPackage(): Promise<void> {
  await stageNpmPackage({ packageRoot: npmPackageRoot, sourceRoot: rootPath, version: openFlowVersion })
  const compiler = path.join(path.dirname(packageRequire.resolve('typescript/package.json')), 'bin/tsc')
  await Promise.all([
    execFileAsync(
      process.execPath,
      [
        compiler,
        '--ignoreConfig',
        '--declaration',
        '--emitDeclarationOnly',
        '--outDir',
        path.join(npmPackageRoot, 'dist'),
        '--rootDir',
        path.join(rootPath, 'src/types'),
        '--module',
        'nodenext',
        '--moduleResolution',
        'nodenext',
        '--target',
        'esnext',
        '--skipLibCheck',
        'true',
        path.join(rootPath, 'src/types/index.ts'),
      ],
      { cwd: rootPath },
    ),
    buildBrowserPackage({ packageRoot: npmPackageRoot, quiet, sourceRoot: rootPath }),
  ])
  await execFileAsync(
    process.execPath,
    ['pm', 'pack', '--ignore-scripts', '--filename', path.join(releaseRoot, `oomol-lab-open-flow-${openFlowVersion}.tgz`), ...(quiet ? ['--quiet'] : [])],
    { cwd: npmPackageRoot },
  )
}

async function validateVersions(): Promise<void> {
  const bunVersionFile = (await readFile(path.join(workspaceRoot, '.bun-version'), 'utf8')).trim()
  const packageManager = readString(workspaceManifest, 'packageManager')
  const bun = Reflect.get(globalThis, 'Bun')
  const runtimeVersion = bun != null && typeof bun == 'object' ? Reflect.get(bun, 'version') : undefined
  if (packageManager != `bun@${bunVersionFile}`) {
    throw new Error(`packageManager must be bun@${bunVersionFile}; received ${packageManager}.`)
  }
  if (runtimeVersion != bunVersionFile) {
    throw new Error(`Build requires Bun ${bunVersionFile}; received ${String(runtimeVersion ?? 'an unsupported runtime')}.`)
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
