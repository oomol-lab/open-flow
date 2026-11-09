import type { ConnectorActionMetadata, ControlCacheDelegate, JsonValue } from '@oomol-lab/open-flow/control-api'
import type { AuthoringRequest } from '@oomol-lab/open-flow/control-requests'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { createWorkflowAuthoring } from '@oomol-lab/open-flow/control-requests'
import { encodeRevision, encodeWorkflowFile, parseWorkflowFile } from '@oomol-lab/open-flow/flow-encoding'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createServerApp } from '../node/transport/http.ts'
import { createConnectorHost } from './connectorHost.ts'
import { closeService, openService } from './serviceFixture.ts'

it('compiles the same public edit through the Server and local SDK using cached Flow metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'open-flow-file-authoring-'))
  const schema = { type: 'object', properties: { name: { type: 'string' } }, additionalProperties: true } satisfies JsonValue
  const action: ConnectorActionMetadata = {
    actionId: 'example.read',
    name: 'Read',
    description: 'Read a record',
    serviceId: 'example',
    serviceName: 'Example',
    authenticated: true,
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    outputSchema: schema,
    inputs: { query: { jsonSchema: { type: 'string' }, nullable: false, description: 'A server-owned input' } },
    outputs: { output: { jsonSchema: schema, nullable: false, description: 'A server-owned complete response' } },
  }
  const connector = createConnectorHost({
    ready: async () => true,
    getAction: async () => action,
    listAllConnections: async () => [],
  })
  const service = await openService(join(directory, 'flow.sqlite'), { capabilities: { connector: () => connector } })
  try {
    const app = createServerApp(service, { resolveControlActor: () => 'operator' })
    const request = vi.fn(async (path: string, init?: RequestInit) => app.request('http://flow.local' + path, init))
    const control = new ControlClient(request)
    const flow = await control.createFlow('File parity')
    const edits: AuthoringRequest['edits'] = [
      { op: 'node.add', type: 'start', as: 'start', name: 'Start' },
      {
        op: 'node.add',
        type: 'connector',
        as: 'read',
        name: 'Read',
        config: { action: action.actionId, connectionId: '' },
        inputs: { query: { kind: 'value', value: 'record' } },
      },
      {
        op: 'node.add',
        type: 'outputs',
        as: 'outputs',
        name: 'Result',
        config: { outputDefs: { record: { schema, nullable: false } } },
        inputs: { record: { kind: 'output', node: '$read' } },
      },
      { op: 'edge.connect', source: '$start', target: '$read' },
      { op: 'edge.connect', source: '$read', target: '$outputs' },
    ]
    const remote = await control.editAuthoring(flow.flowId, { baseRevision: flow.draftRevisionId, requestId: 'create', edits })
    expect(remote.validation).toEqual({ status: 'valid', diagnostics: [] })
    const exported = await control.exportFlow(flow.flowId)
    const records = new Map<string, JsonValue>()
    const delegate: ControlCacheDelegate = {
      get: async (key) => records.get(key),
      set: async (key, value) => {
        records.set(key, value)
      },
      delete: async (key) => {
        records.delete(key)
      },
    }
    const cached = new ControlClient(request, 'api', { cache: { scope: 'flow.local/operator', delegate } })
    await cached.getConnectorActionMetadata(action.actionId, undefined, undefined, 'en')
    const offline = new ControlClient(
      async () => {
        throw new Error('Local authoring must use the Flow response cache')
      },
      'api',
      { cache: { scope: 'flow.local/operator', delegate, mode: 'offline' } },
    )
    const local = createWorkflowAuthoring({
      client: offline,
      id: (label) => (label.startsWith('node:') ? remote.nodes[label.slice(5)]! : `unused:${label}`),
    })
    const file = local.create({ name: exported.name, presentation: exported.presentation })
    const created = await local.edit(file, { baseRevision: (await local.read(file)).revision, requestId: 'create', edits })
    const portable = parseWorkflowFile(encodeWorkflowFile(created.file))
    expect({ ...portable, content: undefined }).toEqual({ ...exported, content: undefined })
    expect(encodeRevision(portable.content)).toEqual(encodeRevision(exported.content))
    expect(created.validation).toEqual(remote.validation)
    expect((await local.check(created.file)).diagnostics).toEqual((await control.checkAuthoring(flow.flowId, remote.revision)).diagnostics)
    expect(request.mock.calls.filter(([path]) => path.startsWith('/v1/connector/action-metadata/'))).toHaveLength(1)
  } finally {
    await closeService(service)
    await rm(directory, { recursive: true, force: true })
  }
})
