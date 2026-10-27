import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

const [publicCheckout, managedCheckout] = process.argv.slice(2)
if (!publicCheckout || !managedCheckout) throw new Error('Pass the OpenConnector and managed Connector checkout paths.')
const publicRoot = resolve(publicCheckout)
const managedRoot = resolve(managedCheckout)
const root = resolve(import.meta.dirname, '..')
const suite = join(publicRoot, 'contracts/triggers/run.ts')
const directory = mkdtempSync(join(tmpdir(), 'trigger-contracts-'))
const run = (command: string, args: string[], cwd: string) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (${result.status ?? result.signal}).`)
}

try {
  run('node', [suite, 'src/server/trigger-conformance-adapter.ts'], publicRoot)
  run('bun', [suite, 'scripts/flow-triggers/conformance-adapter.ts'], managedRoot)
  const publicCatalog = join(directory, 'public.json')
  const managedCatalog = join(directory, 'managed.json')
  run('node', ['scripts/export-flow-trigger-catalog.ts', publicCatalog], publicRoot)
  run('bun', ['scripts/flow-triggers/export-catalog.ts', managedCatalog], managedRoot)
  const catalogs = [publicCatalog, managedCatalog, join(root, 'packages/open-flow/src/trigger/providers/catalog.generated.json')].map(
    (file) => JSON.parse(readFileSync(file, 'utf8')) as { snapshot: { key: string } }[],
  )
  for (const key of catalogs[0]!.map((entry) => entry.snapshot.key)) {
    const entries = catalogs.map((catalog) => catalog.filter((entry) => entry.snapshot.key === key))
    entries.forEach((entry, index) => assert.equal(entry.length, 1, `${key}: catalog ${index} must contain one definition`))
    assert.deepEqual(entries[1], entries[0], `${key}: Connector catalog contracts differ`)
    assert.deepEqual(entries[2], entries[0], `${key}: Open Flow's bundled catalog differs`)
    console.log(`PASS ${key} catalog compatibility across both backends and Open Flow`)
  }
  for (const adapter of [join(publicRoot, 'src/server/trigger-conformance-adapter.ts'), join(managedRoot, 'scripts/flow-triggers/conformance-adapter.ts')]) {
    run('node', ['--no-node-snapshot', '--import', '@oxc-node/core/register', 'apps/server/scripts/check-trigger-source.ts', adapter], root)
  }
} finally {
  rmSync(directory, { recursive: true, force: true })
}
