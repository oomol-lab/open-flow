import type { WorkflowFile } from '@oomol-lab/open-flow/flow-encoding'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { encodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { expect, it, onTestFinished, vi } from 'vitest'
import { runEnvironment } from '../node/application/run-environment.ts'
import { ConnectorClient } from '../node/deployment/connector.ts'
import { isolatedVmEngineDigest } from '../node/runtime/isolated-vm.ts'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'
import { createServerApp } from '../node/transport/http.ts'
import { openService } from './serviceFixture.ts'

const file: WorkflowFile = {
  kind: 'open-flow-workflow',
  version: 1,
  name: 'Imported',
  content: {
    modelVersion: 6,
    modules: {},
    document: {
      bindings: {},
      graph: { nodes: { start: { kind: 'manual', name: 'Start' }, error: { kind: 'error', name: 'Error', sourceFlowIds: ['elsewhere'] } }, edges: [] },
    },
  },
  presentation: { viewport: { x: 30, y: 20, zoom: 1 }, comments: [] },
}

it('imports once, keeps layout and node identities, and isolates actor scopes on HTTP', async () => {
  const service = await openService(':memory:')
  let actor = 'alice'
  const app = createServerApp(service, { resolveControlActor: () => actor })
  const client = new ControlClient(async (path, init) => app.request(`http://test${path}`, init))
  const created = await client.importFlow(file, { idempotencyKey: 'import' })
  expect(await client.importFlow(file, { idempotencyKey: 'import' })).toEqual(created)
  await expect(client.importFlow(file, { name: 'Changed', idempotencyKey: 'import' })).rejects.toMatchObject({ code: 'flow.conflict' })
  const editor = await client.getEditor(created.flowId)
  expect(editor.presentation.value).toEqual(file.presentation)
  expect(editor.draft.content.document.graph.nodes).toEqual({
    start: { inputDefs: [], kind: 'start', name: 'Start' },
    error: { kind: 'error', name: 'Error', sourceFlowIds: [] },
  })
  expect(file.content.document.graph.nodes.start).toEqual({ kind: 'manual', name: 'Start' })
  expect(editor.live.publication).toBeNull()
  expect((await client.listRuns(created.flowId)).runs).toEqual([])
  const exported = await client.exportFlow(created.flowId)
  expect(exported).toEqual({ ...file, content: editor.draft.content })
  const second = await client.importFlow(exported)
  expect(second.flowId).not.toBe(created.flowId)
  expect(second.draftRevisionId).not.toBe(created.draftRevisionId)
  actor = 'bob'
  await expect(client.exportFlow(created.flowId)).rejects.toMatchObject({ status: 404 })
  const own = await client.importFlow(file, { idempotencyKey: 'import' })
  expect(own.flowId).not.toBe(created.flowId)
  expect((await client.listFlows()).flows.map((flow) => flow.flowId)).toEqual([own.flowId])
})

it('rejects unsupported files before creating any resources and preserves a missing-dependency draft', async () => {
  const service = await openService(':memory:')
  const control = service.control
  for (const invalid of [{}, { ...file, version: 2 }, { ...file, content: { ...file.content, modelVersion: 999 } }]) {
    await expect(control.flows.importFlow('operator', invalid, 'invalid')).rejects.toMatchObject({ code: 'flow.invalid' })
  }
  expect(control.flows.listFlows('operator', 100).page.flows).toEqual([])
  const imported = await control.flows.importFlow(
    'operator',
    {
      ...file,
      content: {
        ...file.content,
        document: {
          bindings: {},
          graph: {
            nodes: {
              action: {
                kind: 'task',
                inputs: {},
                task: { name: 'Missing', inputs: [], outputs: [], executor: { kind: 'connector', action: 'absent.action', connectionId: 'private' } },
              },
            },
            edges: [],
          },
        },
      },
    },
    'valid',
  )
  expect(control.drafts.getDraft('operator', imported.flow.flowId).content.document.graph.nodes.action).toMatchObject({
    task: { executor: { kind: 'connector', action: 'absent.action' } },
  })
})

it('rolls back Flow, Revision and Presentation together if the creation transaction fails', () => {
  const db = Database.open(':memory:')
  onTestFinished(() => db.close())
  const store = new Store(db, runEnvironment(isolatedVmEngineDigest))
  db.connection.exec("CREATE TRIGGER reject_presentation BEFORE INSERT ON flow_presentations BEGIN SELECT RAISE(ABORT, 'test failure'); END")
  const create = () =>
    store.flows.createFlow({
      actorId: 'operator',
      content: new TextDecoder().decode(encodeRevision(file.content)),
      createdAt: 1,
      digest: 'digest',
      flowId: 'flow',
      idempotencyKey: 'key',
      modelVersion: 6,
      name: 'Imported',
      requestDigest: 'request',
      revisionId: 'revision',
      presentation: file.presentation,
    })
  expect(create).toThrow('test failure')
  expect(store.flows.list(100).flows).toEqual([])
  expect(db.connection.prepare('SELECT * FROM flow_revisions').all()).toEqual([])
  expect(db.connection.prepare('SELECT * FROM flow_presentations').all()).toEqual([])
  db.connection.exec('DROP TRIGGER reject_presentation')
  expect(create()).toMatchObject({ created: true })
})

it('binds only the selected target Team and rejects unavailable Teams before creating a Flow', async () => {
  const connector = new ConnectorClient('https://connector.oomol.com', 'test-runtime-token')
  vi.spyOn(connector, 'listTeams').mockResolvedValue([
    { id: 'selected', name: 'selected_team', systemCreated: false },
    { id: 'default', name: 'default_team', systemCreated: true },
  ])
  const service = await openService(':memory:', { capabilities: { connector: () => connector } })
  const created = await service.control.flows.importFlow('operator', file, 'selected-import', undefined, 'selected')
  expect(await service.control.connectors.resolveConnectorScope('operator', created.flow.flowId)).toBe('selected')
  await expect(service.control.flows.importFlow('operator', file, 'denied-import', undefined, 'missing')).rejects.toThrow('Team')
  expect(service.control.flows.listFlows('operator', 100).page.flows.map((flow) => flow.flowId)).toEqual([created.flow.flowId])
})

it.each(['create', 'import'] as const)('replays an accepted %s without consulting unavailable external Team services', async (operation) => {
  const connector = new ConnectorClient('https://connector.oomol.com', 'test-runtime-token')
  const teams = vi.spyOn(connector, 'listTeams').mockResolvedValue([{ id: 'team', name: 'team', systemCreated: true }])
  const service = await openService(':memory:', { capabilities: { connector: () => connector } })
  const create = (key: string, name = 'Template') =>
    operation == 'import'
      ? service.control.flows.importFlow('operator', file, key, name, 'team')
      : service.control.flows.createFlow('operator', name, key, 'team')
  const accepted = await create('stable')
  teams.mockRejectedValue(new Error('Team service is offline'))
  expect(await create('stable')).toEqual({ ...accepted, created: false })
  await expect(create('stable', 'Changed')).rejects.toMatchObject({ code: 'flow.conflict' })
  expect(teams).toHaveBeenCalledOnce()
  await expect(create('new')).rejects.toThrow('Team service is offline')
  expect(service.control.flows.listFlows('operator', 100).page.flows).toHaveLength(1)
})

it('keeps an import receipt stable when the localized default name changes', async () => {
  const service = await openService(':memory:')
  const { name: _, ...unnamed } = file
  const accepted = await service.control.flows.importFlow('operator', unnamed, 'unnamed', undefined, undefined, 'Imported workflow')
  const replay = await service.control.flows.importFlow('operator', unnamed, 'unnamed', undefined, undefined, '导入的工作流')
  expect(replay).toEqual({ ...accepted, created: false })
  expect(replay.flow.name).toBe('Imported workflow')
})
