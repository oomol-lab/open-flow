import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { acceptRun } from './runFixture.ts'
import { closeOpenServices, closeService, openService, startService } from './serviceFixture.ts'

const directories: string[] = []
const port = { jsonSchema: {}, nullable: false } as const
const artifactPort = { jsonSchema: { contentMediaType: 'oomol/artifact' }, nullable: false } as const

afterEach(async () => {
  await closeOpenServices()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function databaseFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-artifacts-'))
  directories.push(directory)
  return path.join(directory, 'open-flow.sqlite')
}

function artifactFlow(producer: string): RevisionContent {
  return {
    document: {
      bindings: {},
      graph: {
        edges: [{ source: 'produce', target: 'consume' }],
        nodes: {
          produce: {
            inputs: {},
            kind: 'task',
            task: {
              inputs: [],
              moduleId: 'produce',
              name: 'Produce',
              outputs: [
                { ...artifactPort, handle: 'text' },
                { ...artifactPort, handle: 'binary' },
              ],
            },
          },
          consume: {
            inputs: {
              text: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'produce', output: 'text' }] },
              binary: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'produce', output: 'binary' }] },
            },
            kind: 'task',
            task: {
              inputs: [
                { ...artifactPort, handle: 'text' },
                { ...artifactPort, handle: 'binary' },
              ],
              moduleId: 'consume',
              name: 'Consume',
              outputs: [{ ...port, handle: 'summary' }],
            },
          },
        },
      },
    },
    modelVersion: currentFlowModelVersion,
    modules: {
      produce: { imports: [], name: 'Produce', source: producer },
      consume: {
        imports: [],
        name: 'Consume',
        source: `export default async ({ text, binary }, context) => {
  const bytes = await context.artifact.open(binary)
  let sum = 0
  for (const byte of bytes) sum = (sum + byte) % 65521
  return { summary: { text: new TextDecoder().decode(await context.artifact.open(text)), length: bytes.length, sum } }
}`,
      },
    },
  }
}

const producer = `export default async (_inputs, context) => {
  const binary = new Uint8Array(1300 * 1024).map((_, index) => index % 251)
  return {
    text: await context.artifact.put('你好', { name: 'greeting.txt', mediaType: 'text/plain' }),
    binary: await context.artifact.put(binary, { name: 'data.bin' }),
  }
}`

it('passes Artifacts between Code nodes of one Run and records node.artifact events', async () => {
  const file = await databaseFile()
  const service = await openService(file)
  await startService(service)
  const accepted = await acceptRun(service, { flowId: 'main', idempotencyKey: 'artifacts', revision: artifactFlow(producer), revisionId: 'artifacts' })
  if (accepted.kind != 'accepted') throw new Error('Artifact Run was not accepted.')
  await service.waitForIdle()

  const binary = new Uint8Array(1300 * 1024).map((_, index) => index % 251)
  let sum = 0
  for (const byte of binary) sum = (sum + byte) % 65521
  const result = service.control.runs.getRunResult('test', accepted.runId) as unknown as {
    readonly result: { readonly nodes: readonly { readonly nodeId: string; readonly outputs: Readonly<Record<string, unknown>> }[] }
    readonly status: string
  }
  expect(result.status).toBe('completed')
  expect(result.result.nodes.find((node) => node.nodeId == 'consume')?.outputs).toEqual({ summary: { text: '你好', length: binary.length, sum } })
  const produced = service.events(accepted.runId).find((event) => event.kind == 'node.completed' && event.payload.nodeId == 'produce')!.value as Readonly<
    Record<string, unknown>
  >
  expect(produced.binary).toEqual({
    kind: 'artifact',
    id: expect.any(String),
    name: 'data.bin',
    size: binary.length,
    digest: `sha256:${createHash('sha256').update(binary).digest('hex')}`,
  })
  expect(produced.text).toMatchObject({ name: 'greeting.txt', mediaType: 'text/plain', size: 6 })
  const events = service.events(accepted.runId).filter(({ kind }) => kind == 'node.artifact')
  expect(events.map((event) => (event.payload as { artifact: unknown }).artifact)).toEqual([produced.text, produced.binary])
  await closeService(service)

  const database = new DatabaseSync(file)
  expect(database.prepare('SELECT COUNT(*) AS count FROM run_artifacts WHERE run_id = ?').get(accepted.runId)).toEqual({ count: 2 })
  database.close()
})

async function runProducer(statement: string) {
  const service = await openService(await databaseFile())
  await startService(service)
  const accepted = await acceptRun(service, {
    flowId: 'main',
    idempotencyKey: statement,
    revision: artifactFlow(`export default async (_inputs, context) => { try { ${statement} } catch (error) { return { text: error.code, binary: null } } }`),
    revisionId: `artifacts-${createHash('sha256').update(statement).digest('hex')}`,
  })
  if (accepted.kind != 'accepted') throw new Error('Artifact Run was not accepted.')
  await service.waitForIdle()
  return { accepted, service }
}

it('fails a Run whose Artifact exceeds the size limit even when user code catches the error', async () => {
  const { accepted, service } = await runProducer('await context.artifact.put(new Uint8Array(10 * 1024 * 1024 + 1), { name: "large" })')
  const result = service.control.runs.getRunResult('test', accepted.runId) as { readonly status: string }
  expect(result.status).toBe('failed')
  expect(JSON.stringify(result)).toMatch(/size limit/)
  await closeService(service)
})

it('denies an Artifact reference that does not belong to the Run', async () => {
  const { accepted, service } = await runProducer('await context.artifact.open({ kind: "artifact", id: "missing" })')
  const produced = service.events(accepted.runId).find((event) => event.kind == 'node.completed' && event.payload.nodeId == 'produce')
  expect(produced?.value).toEqual({ text: 'capability.denied', binary: null })
  await closeService(service)
})
