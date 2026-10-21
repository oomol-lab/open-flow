import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const repository = process.argv[2]
if (!repository) throw new Error('Pass the path to a public OpenConnector checkout with its dependencies installed.')
const source = resolve(repository)
const target = resolve(import.meta.dirname, '../src/trigger/providers/catalog.generated.json')
const keys = new Set(process.argv.slice(3))
const directory = mkdtempSync(resolve(tmpdir(), 'open-flow-trigger-catalog-'))
try {
  const exported = resolve(directory, 'catalog.json')
  const result = spawnSync('node', [resolve(source, 'scripts/export-flow-trigger-catalog.ts'), exported], { cwd: source, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('OpenConnector Trigger catalog export failed.')
  const entries = JSON.parse(readFileSync(exported, 'utf8')) as { snapshot: { key: string }; source?: Record<string, unknown> }[]
  for (const key of keys) {
    if (!entries.some((entry) => entry.snapshot.key == key)) throw new Error(`Trigger not found in OpenConnector: ${key}`)
  }
  const selected =
    keys.size == 0
      ? entries
      : [
          ...(JSON.parse(readFileSync(target, 'utf8')) as typeof entries).filter((entry) => !keys.has(entry.snapshot.key)),
          ...entries.filter((entry) => keys.has(entry.snapshot.key)),
        ]
  selected.sort((left, right) => left.snapshot.key.localeCompare(right.snapshot.key))
  writeFileSync(target, JSON.stringify(selected, null, 2) + '\n')
  writeFileSync(
    resolve(import.meta.dirname, '../src/event-source/common/catalog.generated.json'),
    JSON.stringify(
      selected
        .filter((entry) => entry.source != null)
        .map((entry) => {
          const { createSchema: _create, updateSchema: _update, ...metadata } = entry.source!
          return Object.assign({ key: entry.snapshot.key }, metadata)
        }),
      null,
      2,
    ) + '\n',
  )
} finally {
  rmSync(directory, { recursive: true })
}
