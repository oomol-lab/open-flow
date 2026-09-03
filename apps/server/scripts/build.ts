import { spawn } from 'node:child_process'
import { copyFile, cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

const appRoot = path.resolve(import.meta.dirname, '..')
const workspaceRoot = path.resolve(appRoot, '../..')
const outputRoot = path.join(appRoot, 'dist')
const require = createRequire(import.meta.url)
const vitePath = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js')

await rm(outputRoot, { force: true, recursive: true })
await run([vitePath, 'build'])
await run([
  'build',
  'node/main.ts',
  'node/isolated-vm.ts',
  'node/isolated-vm-executor.ts',
  '--target=node',
  '--packages=bundle',
  '--external=isolated-vm',
  '--outdir=dist/server',
])

await Promise.all([
  cp(path.join(appRoot, 'migrations'), path.join(outputRoot, 'migrations'), { recursive: true }),
  copyRuntimePackage('isolated-vm'),
  copyRuntimePackage('node-gyp-build'),
  copyFile(path.join(workspaceRoot, 'LICENSE'), path.join(outputRoot, 'LICENSE')),
  copyFile(path.join(workspaceRoot, 'NOTICE'), path.join(outputRoot, 'NOTICE')),
])
await writeFile(
  path.join(outputRoot, 'package.json'),
  `${JSON.stringify({ name: '@oomol-lab/open-flow-server-release', private: true, type: 'module' }, null, 2)}\n`,
)

async function copyRuntimePackage(name: string): Promise<void> {
  const source = path.dirname(require.resolve(`${name}/package.json`))
  const target = path.join(outputRoot, 'node_modules', name)
  await mkdir(path.dirname(target), { recursive: true })
  await cp(source, target, { recursive: true })
}

async function run(args: readonly string[]): Promise<void> {
  const child = spawn(process.execPath, [...args], { cwd: appRoot, stdio: 'inherit' })
  const result = await new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  if (result.code != 0) throw new Error(`Build command failed with ${result.signal ?? `code ${result.code ?? 'unknown'}`}.`)
}
