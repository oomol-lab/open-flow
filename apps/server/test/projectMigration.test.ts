import { convertProjectFlow, digestBytes } from '@oomol-lab/open-flow/flow-encoding'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { migrateProjectDatabase } from '../scripts/migrate-project.ts'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function revision() {
  return {
    kind: 'open-flow-project-revision',
    version: 1,
    modelVersion: 1,
    modules: { code: { name: 'Echo', imports: [], source: 'export default (input) => ({ result: input.value })' } },
    document: {
      bindings: {},
      tasks: {},
      subflows: {},
      flows: {
        main: {
          name: 'Original Flow',
          graph: {
            nodes: {
              clock: { kind: 'cron', name: 'Clock', cronTimes: [{ type: 'every', unit: 'minute', value: 1 }] },
              echo: {
                kind: 'task',
                name: 'Echo',
                concurrency: 1,
                inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'clock', output: 'payload' }] } },
                task: {
                  name: 'Echo',
                  moduleId: 'code',
                  inputs: { value: { jsonSchema: {}, nullable: true } },
                  outputs: { result: { jsonSchema: {}, nullable: true } },
                },
              },
            },
          },
        },
      },
    },
  }
}

async function fixture(content: unknown = revision()) {
  const directory = await mkdtemp(path.join(tmpdir(), 'project-migration-'))
  directories.push(directory)
  const sourceFile = path.join(directory, 'legacy.sqlite')
  const database = new DatabaseSync(sourceFile)
  database.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE projects (project_id TEXT, draft_revision_id TEXT, status TEXT, created_at INTEGER);
    CREATE TABLE revisions (revision_id TEXT, content TEXT, digest TEXT);
    CREATE TABLE publications (publication_id TEXT);
    INSERT INTO projects VALUES ('project', 'revision', 'active', 1);
    INSERT INTO publications VALUES ('old-publication');`)
  const serialized = JSON.stringify(content)
  database.prepare('INSERT INTO revisions VALUES (?, ?, ?)').run('revision', serialized, await digestBytes(new TextEncoder().encode(serialized)))
  return { database, sourceFile, output: path.join(directory, 'converted') }
}

it('imports a valid draft while archiving the complete WAL-backed source and leaving Live unset', async () => {
  const f = await fixture()
  try {
    const before = await readFile(f.sourceFile)
    const report = await migrateProjectDatabase(f.sourceFile, f.output)
    expect(report.blocked).toEqual([])
    expect(report.migrated).toMatchObject([{ projectId: 'project', sourceRevisionId: 'revision', flowId: 'main' }])
    expect(await readFile(f.sourceFile)).toEqual(before)
    expect(f.database.prepare('SELECT * FROM publications').all()).toEqual([{ publication_id: 'old-publication' }])
    const archive = new DatabaseSync(path.join(f.output, 'source.sqlite'), { readOnly: true })
    const target = new DatabaseSync(path.join(f.output, 'open-flow.sqlite'), { readOnly: true })
    try {
      expect(archive.prepare('SELECT * FROM publications').all()).toEqual([{ publication_id: 'old-publication' }])
      expect(target.prepare('SELECT * FROM publications').all()).toEqual([])
      expect(target.prepare('SELECT * FROM flow_live').all()).toEqual([])
      expect(target.prepare('SELECT flow_id, name FROM flows').all()).toEqual([{ flow_id: 'main', name: 'Original Flow' }])
      const content = JSON.parse((target.prepare('SELECT content FROM revisions').get() as { content: string }).content)
      expect(content.document.graph.edges).toEqual([{ source: 'clock', target: 'echo' }])
      expect(content.modules).toEqual(revision().modules)
    } finally {
      archive.close()
      target.close()
    }
  } finally {
    f.database.close()
  }
})

it('reports unsupported branches while still importing other convertible flows', async () => {
  const content = revision()
  const unsupported = structuredClone(content.document.flows.main)
  Object.assign(unsupported.graph.nodes, { second: structuredClone(unsupported.graph.nodes.echo) })
  Object.assign(content.document.flows, { unsupported })
  const f = await fixture(content)
  try {
    const report = await migrateProjectDatabase(f.sourceFile, f.output)
    expect(report.migrated.map((entry) => entry.flowId)).toEqual(['main'])
    expect(report.blocked).toMatchObject([{ flowId: 'unsupported', reason: 'Parallel legacy branches require an explicit execution-order decision.' }])
  } finally {
    f.database.close()
  }
})

it('does not import a revision whose digest is corrupt', async () => {
  const f = await fixture()
  try {
    f.database.exec("UPDATE revisions SET digest = 'sha256:wrong'")
    const report = await migrateProjectDatabase(f.sourceFile, f.output)
    expect(report.migrated).toEqual([])
    expect(report.blocked[0]?.reason).toContain('digest does not match')
  } finally {
    f.database.close()
  }
})

it('gives identical drafts in separate flows distinct revision identities and refuses an existing output directory', async () => {
  const content = revision()
  Object.assign(content.document.flows, { another: structuredClone(content.document.flows.main) })
  const f = await fixture(content)
  try {
    const report = await migrateProjectDatabase(f.sourceFile, f.output)
    expect(report.blocked).toEqual([])
    expect(new Set(report.migrated.map((entry) => entry.revisionId)).size).toBe(2)
    await expect(migrateProjectDatabase(f.sourceFile, f.output)).rejects.toThrow('EEXIST')
    expect(JSON.parse(await readFile(path.join(f.output, 'report.json'), 'utf8'))).toEqual(report)
  } finally {
    f.database.close()
  }
})

it('rejects unsupported legacy fields and bindings instead of dropping them', () => {
  const content = revision()
  Object.assign(content.document.bindings, { credential: { kind: 'connection', target: 'legacy' } })
  expect(() => convertProjectFlow(content, 'main')).toThrow('explicit semantic conversion')
  const concurrent = revision()
  concurrent.document.flows.main.graph.nodes.echo.concurrency = 2
  expect(() => convertProjectFlow(concurrent, 'main')).toThrow()
})

it('adds a manual entry to a single root chain and resolves duplicate display names without changing references', () => {
  const content = revision()
  Reflect.deleteProperty(content.document.flows.main.graph.nodes, 'clock')
  Object.assign(content.document.flows.main.graph.nodes.echo.inputs, { value: { kind: 'value', value: 'constant' } })
  const second = structuredClone(content.document.flows.main.graph.nodes.echo)
  Object.assign(second.inputs, { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'echo', output: 'result' }] } })
  Object.assign(content.document.flows.main.graph.nodes, { second })
  const converted = convertProjectFlow(content, 'main')
  expect(converted.revision.document.graph.edges).toEqual([
    { source: 'migration-start', target: 'echo' },
    { source: 'echo', target: 'second' },
  ])
  expect(new Set(Object.values(converted.revision.document.graph.nodes).map((node) => node.name)).size).toBe(3)
  expect(converted.adjustments).toHaveLength(2)
})
