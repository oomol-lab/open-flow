import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { ServerService } from '../node/service.ts'
import { closeService, openService } from './serviceFixture.ts'

const directories: string[] = []
const services = new Set<ServerService>()

afterEach(async () => {
  await Promise.allSettled([...services].map(closeService))
  services.clear()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function databaseFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-publish-operation-'))
  directories.push(directory)
  return path.join(directory, 'open-flow.sqlite')
}

async function addMarker(service: ServerService, flowId: string, revisionId: string, nodeId: string): Promise<string> {
  const changed = await service.control.changeDraft('operator', flowId, revisionId, [
    {
      kind: 'graph.node.create',
      node: {
        concurrency: 1,
        inputs: {},
        kind: 'value',
        values: [{ handle: 'ready', jsonSchema: { type: 'boolean' }, nullable: false, value: true }],
      },
      nodeId,
      target: { kind: 'flow' },
    },
  ])
  return changed.revision.revisionId
}

it('keeps Live fixed while persistent Publish work is pending or failed and activates one Publication after recovery', async () => {
  const file = await databaseFile()
  let service = await openService(file)
  services.add(service)
  const created = await service.control.createFlow('operator', 'Main', 'create-main')
  const flowId = created.flow.flowId
  const firstRevisionId = await addMarker(service, flowId, created.flow.draftRevisionId, 'first')

  const first = await service.control.publishFlow('operator', flowId, firstRevisionId, 'open-flow-engine/v1', null, 'publish-first')
  expect(first).toMatchObject({ flowId, revisionId: firstRevisionId, status: 'pending' })
  await expect(service.control.getLive(flowId)).resolves.toMatchObject({ publication: null, status: 'not-published' })
  await service.tickMaintenance()
  const firstDone = service.control.getPublishOperation(flowId, first.operationId)
  if (firstDone.status != 'succeeded') throw new Error('Initial Publish operation did not succeed.')
  const firstPublicationId = firstDone.publicationId

  const database = new DatabaseSync(file)
  database.exec(`
    CREATE TRIGGER add_synthetic_publish_work AFTER INSERT ON publish_operations BEGIN
      INSERT INTO publish_work (work_id, operation_id, node_id, action, status, next_at, created_at, updated_at)
      VALUES ('work_' || NEW.operation_id, NEW.operation_id, 'candidate', 'synthetic', 'pending', NEW.created_at, NEW.created_at, NEW.created_at);
    END;
  `)

  const failedRevisionId = await addMarker(service, flowId, firstRevisionId, 'failed-candidate')
  const failed = await service.control.publishFlow('operator', flowId, failedRevisionId, 'open-flow-engine/v1', firstPublicationId, 'publish-failed')
  const replay = await service.control.publishFlow('operator', flowId, failedRevisionId, 'open-flow-engine/v1', firstPublicationId, 'publish-failed')
  expect(replay).toEqual(failed)
  await expect(
    service.control.publishFlow('operator', flowId, failedRevisionId, 'open-flow-engine/v1', firstPublicationId, 'publish-concurrent'),
  ).rejects.toMatchObject({ code: 'flow.busy' })

  await service.tickMaintenance()
  expect(service.control.getPublishOperation(flowId, failed.operationId).status).toBe('pending')
  await expect(service.control.getLive(flowId)).resolves.toMatchObject({ publication: { publicationId: firstPublicationId } })
  database
    .prepare(
      `UPDATE publish_work
       SET status = 'failed', issue_code = 'provider.subscription-failed', issue_message = 'The subscription could not be created.', updated_at = updated_at + 1
       WHERE operation_id = ?`,
    )
    .run(failed.operationId)
  await service.tickMaintenance()
  expect(service.control.getPublishOperation(flowId, failed.operationId)).toMatchObject({
    issue: { code: 'provider.subscription-failed', message: 'The subscription could not be created.', nodeId: 'candidate' },
    status: 'failed',
  })
  await expect(service.control.getLive(flowId)).resolves.toMatchObject({ publication: { publicationId: firstPublicationId } })
  expect(service.control.listPublications(flowId, 10).page.publications).toHaveLength(1)

  const readyRevisionId = await addMarker(service, flowId, failedRevisionId, 'ready-candidate')
  const ready = await service.control.publishFlow('operator', flowId, readyRevisionId, 'open-flow-engine/v1', firstPublicationId, 'publish-ready')
  database.prepare("UPDATE publish_work SET status = 'ready', next_at = NULL, updated_at = updated_at + 1 WHERE operation_id = ?").run(ready.operationId)
  database.close()

  await closeService(service)
  services.delete(service)
  service = await openService(file)
  services.add(service)
  expect(service.control.getPublishOperation(flowId, ready.operationId).status).toBe('pending')
  await service.tickMaintenance()
  const readyDone = service.control.getPublishOperation(flowId, ready.operationId)
  if (readyDone.status != 'succeeded') throw new Error('Recovered Publish operation did not succeed.')
  await expect(service.control.getLive(flowId)).resolves.toMatchObject({ publication: { publicationId: readyDone.publicationId } })
  expect(service.control.listPublications(flowId, 10).page.publications).toHaveLength(2)
})
