import { convertProjectFlow, digestBytes, encodeRevision, legacyProjectFlowIds } from '@oomol-lab/open-flow/flow-encoding'
import { validateFlow } from '@oomol-lab/open-flow/flow-semantics'
import { currentEngineContract, findEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { migrateDatabase } from '../node/storage/migrate.ts'
import { Store } from '../node/storage/store.ts'

export async function migrateProjectDatabase(sourceFile: string, outputDirectory: string) {
  await mkdir(outputDirectory, { mode: 0o700 })
  const source = new DatabaseSync(sourceFile, { readOnly: true })
  try {
    await backup(source, path.join(outputDirectory, 'source.sqlite'))
  } finally {
    source.close()
  }
  const archive = new DatabaseSync(path.join(outputDirectory, 'source.sqlite'), { readOnly: true })
  let target: Store | undefined
  const migrated: { projectId: string; sourceRevisionId: string; flowId: string; revisionId: string; adjustments: readonly string[] }[] = []
  const blocked: { projectId: string; flowId?: string; reason: string }[] = []
  const flowIds = new Set<string>()
  try {
    const targetFile = path.join(outputDirectory, 'open-flow.sqlite')
    migrateDatabase(targetFile)
    target = new Store(targetFile)
    const projects = archive
      .prepare(`SELECT project_id AS projectId, draft_revision_id AS revisionId, status, created_at AS createdAt FROM projects ORDER BY project_id`)
      .all() as unknown as { projectId: string; revisionId: string; status: string; createdAt: number }[]
    for (const entry of projects) {
      if (entry.status != 'active') {
        blocked.push({ projectId: entry.projectId, reason: 'Project retirement must be resolved before importing its drafts.' })
        continue
      }
      const stored = archive.prepare('SELECT content, digest FROM revisions WHERE revision_id = ?').get(entry.revisionId) as
        | { content: string; digest: string }
        | undefined
      try {
        if (stored == null) throw new Error('The Project draft revision is missing.')
        if ((await digestBytes(new TextEncoder().encode(stored.content))) != stored.digest)
          throw new Error('The Project draft digest does not match its stored bytes.')
        const content: unknown = JSON.parse(stored.content)
        for (const flowId of legacyProjectFlowIds(content)) {
          try {
            if (flowIds.has(flowId)) throw new Error('The legacy Flow identity is shared by multiple Projects.')
            const converted = convertProjectFlow(content, flowId)
            const validation = await validateFlow(converted.revision, findEngineContract(currentEngineContract)!)
            if (!validation.valid) throw new Error(validation.diagnostics.map((diagnostic) => diagnostic.message).join('\n'))
            const bytes = encodeRevision(converted.revision)
            const digest = await digestBytes(bytes)
            const identity = await digestBytes(new TextEncoder().encode(JSON.stringify([entry.projectId, flowId, digest])))
            const revisionId = `revision_${identity.slice(7)}`
            const result = target.createFlow({
              actorId: 'project-migration',
              content: new TextDecoder().decode(bytes),
              createdAt: entry.createdAt,
              digest,
              flowId,
              idempotencyKey: `project-migration:${entry.projectId}:${flowId}`,
              name: converted.name,
              requestDigest: digest,
              revisionId,
            })
            if ('kind' in result) throw new Error('The migrated Flow conflicts with another imported Flow.')
            flowIds.add(flowId)
            migrated.push({ projectId: entry.projectId, sourceRevisionId: entry.revisionId, flowId, revisionId, adjustments: converted.adjustments })
          } catch (error) {
            blocked.push({ projectId: entry.projectId, flowId, reason: error instanceof Error ? error.message : String(error) })
          }
        }
      } catch (error) {
        blocked.push({ projectId: entry.projectId, reason: error instanceof Error ? error.message : String(error) })
      }
    }
  } finally {
    target?.close()
    archive.close()
  }
  const report = {
    version: 1,
    mode: 'draft-import',
    source: path.resolve(sourceFile),
    archive: 'source.sqlite',
    database: 'open-flow.sqlite',
    migrated,
    blocked,
    preservedOnlyInArchive: ['revision history', 'publications', 'runs', 'subscriptions', 'listener progress', 'presentation', 'deployment settings'],
  }
  await writeFile(path.join(outputDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  return report
}

if (process.argv[1] != null && path.resolve(process.argv[1]) == fileURLToPath(import.meta.url)) {
  const [source, output] = process.argv.slice(2)
  if (source == null || output == null || process.argv.length != 4) throw new Error('Usage: node scripts/migrate-project.ts SOURCE.sqlite NEW_OUTPUT_DIRECTORY')
  const report = await migrateProjectDatabase(source, output)
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  if (report.blocked.length != 0) process.exitCode = 2
}
