import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const repository = process.argv[2]
if (!repository) throw new Error('Pass the path to a public OpenConnector checkout with its dependencies installed.')
const source = resolve(repository)
const target = resolve(import.meta.dirname, '../src/trigger/providers/catalog.generated.json')
const result = spawnSync('node', [resolve(source, 'scripts/export-flow-trigger-catalog.ts'), target], { cwd: source, stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) throw new Error('OpenConnector Trigger catalog export failed.')
