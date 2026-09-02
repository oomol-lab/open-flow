import type { ConnectorAction, ConnectorConnection, ConnectorProvider } from '@oomol-lab/open-flow/control-api'
import type { JsonValue, RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { ConnectorHost } from '../node/connector.ts'

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectorClient, ConnectorTaskError } from '../node/connector.ts'
import { ServerService } from '../node/service.ts'
import { createConnectorHost } from './connectorHost.ts'
import { acceptRun } from './runFixture.ts'
import { closeService, openService, startService } from './serviceFixture.ts'

const directories: string[] = []
const services: ServerService[] = []
const port = { jsonSchema: {}, nullable: false } as const

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.allSettled(services.splice(0).map(closeService))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function databaseFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-connector-'))
  directories.push(directory)
  return path.join(directory, 'open-flow.sqlite')
}

function connectorFlow(timeoutMs?: number, optionalNull = false): RevisionContent {
  return {
    document: {
      bindings: {},
      graph: {
        nodes: {
          connector: {
            concurrency: 1,
            inputs: {
              message: { kind: 'value', value: 'hello' },
              ...(optionalNull ? { tags: { kind: 'value' as const, value: null } } : {}),
            },
            kind: 'task',
            taskId: 'connector',
            ...(timeoutMs == null ? {} : { timeoutMs }),
          },
        },
      },
      subflows: {},
      tasks: {
        connector: {
          executor: { action: 'example.echo', connectionId: 'connection-work', kind: 'connector' },
          inputs: [
            { ...port, handle: 'message' },
            ...(optionalNull ? [{ handle: 'tags', jsonSchema: { items: { type: 'string' }, type: 'array' }, nullable: true }] : []),
          ],
          name: 'Echo',
          outputs: [{ ...port, handle: 'message' }],
        },
      },
    },
    modelVersion: 1,
    modules: {},
  }
}

function capabilityFlow(
  declared = true,
  invocation = "capability.connector({ action: 'example.echo', connectionId: 'connection-work', input })",
): RevisionContent {
  return {
    document: {
      bindings: {},
      graph: {
        nodes: {
          capability: {
            concurrency: 1,
            inputs: { message: { kind: 'value', value: 'hello' } },
            kind: 'task',
            task: {
              ...(declared ? { capabilities: [{ action: 'example.echo', connectionId: 'connection-work', kind: 'connector' as const }] } : {}),
              inputs: [{ ...port, handle: 'message' }],
              moduleId: 'capability',
              name: 'Capability',
              outputs: [{ ...port, handle: 'message' }],
            },
          },
        },
      },
      subflows: {},
      tasks: {},
    },
    modelVersion: 1,
    modules: {
      capability: {
        imports: [],
        name: 'Capability',
        source: `export default async (input, capability) => (await ${invocation}).body`,
      },
    },
  }
}

async function open(connector?: ConnectorHost, connectorConsoleOrigin?: string): Promise<ServerService> {
  const service = await openService(await databaseFile(), {
    capabilities: {
      connector: connector == null ? undefined : () => connector,
      connectorConsoleOrigin: connectorConsoleOrigin == null ? undefined : () => new URL(connectorConsoleOrigin),
    },
    clock: Date.now,
  })
  services.push(service)
  await startService(service)
  return service
}

async function run(service: ServerService, revision: RevisionContent): Promise<string> {
  const accepted = await acceptRun(service, { flowId: 'main', idempotencyKey: crypto.randomUUID(), revision, revisionId: crypto.randomUUID() })
  if (accepted.kind != 'accepted') throw new Error('Connector Run acceptance conflicted.')
  await service.waitForIdle()
  return accepted.runId
}

describe('Server Connector host', () => {
  it('distinguishes an unconfigured Connector from an unavailable Connector', async () => {
    const service = await open()

    await expect(service.control.listConnectorProviders()).rejects.toMatchObject({
      code: 'connector.unconfigured',
      message: 'Connector is not configured for this deployment.',
      status: 503,
    })
  })

  it('projects discovery and the explicit external Connection page from the injected host', async () => {
    const providers: readonly ConnectorProvider[] = [{ serviceId: 'example', serviceName: 'Example' }]
    const actions: readonly ConnectorAction[] = [
      {
        actionId: 'example.echo',
        authenticated: true,
        description: 'Echo.',
        inputs: {},
        name: 'Echo',
        outputs: {},
        serviceId: 'example',
        serviceName: 'Example',
      },
    ]
    const connections: readonly ConnectorConnection[] = [
      { connectionId: 'connection-work', displayName: 'Work', isDefault: true, serviceId: 'example', status: 'active' },
    ]
    const connector = createConnectorHost({
      getAction: async () => actions[0]!,
      listActions: async () => actions,
      listConnections: async () => connections,
      listProviders: async () => providers,
      searchActions: async () => actions,
    })
    const service = await open(connector, 'https://connector.example')

    await expect(service.control.listConnectorProviders()).resolves.toEqual(providers)
    await expect(service.control.listConnectorActions('example')).resolves.toEqual(actions)
    await expect(service.control.searchConnectorActions('echo')).resolves.toEqual(actions)
    await expect(service.control.getConnectorAction('example.echo')).resolves.toEqual(actions[0])
    await expect(service.control.listConnectorConnections('example')).resolves.toEqual(connections)
    expect(service.control.connectorConnectionPage('example')).toBe('https://connector.example/providers/example')
  })

  it('executes managed Connector Tasks through the injected host', async () => {
    const execute = vi.fn(async (_action: string, _connectionId: string | undefined, input: Readonly<Record<string, JsonValue>>) => input)
    const service = await open(createConnectorHost({ execute }))
    const runId = await run(service, connectorFlow())

    expect(execute).toHaveBeenCalledWith('example.echo', 'connection-work', { message: 'hello' }, expect.any(String), expect.any(AbortSignal), undefined)
    expect(service.run(runId)).toMatchObject({
      result: { kind: 'node-results', nodes: [{ jobs: [{ outputs: { message: 'hello' } }], nodeId: 'connector' }] },
      status: 'completed',
    })
  })

  it('executes public Connector Tasks without a Connection', async () => {
    const execute = vi.fn(async (_action: string, _connectionId: string | undefined, input: Readonly<Record<string, JsonValue>>) => input)
    const service = await open(createConnectorHost({ execute }))
    const source = connectorFlow()
    const task = source.document.tasks.connector!
    const revision: RevisionContent = {
      ...source,
      document: {
        ...source.document,
        tasks: { ...source.document.tasks, connector: { ...task, executor: { action: 'example.echo', kind: 'connector' } } },
      },
    }
    const runId = await run(service, revision)

    expect(execute).toHaveBeenCalledWith('example.echo', undefined, { message: 'hello' }, expect.any(String), expect.any(AbortSignal), undefined)
    expect(service.run(runId)?.status).toBe('completed')
  })

  it('allows an unconnected Connector Task in Draft but rejects Publish when its action requires authorization', async () => {
    const action: ConnectorAction = {
      actionId: 'example.echo',
      authenticated: true,
      description: 'Echo.',
      inputs: {},
      name: 'Echo',
      outputs: {},
      serviceId: 'example',
      serviceName: 'Example',
    }
    const service = await open(
      createConnectorHost({
        getAction: async () => action,
        listConnections: async () => [],
      }),
    )
    const source = connectorFlow()
    const task = source.document.tasks.connector
    if (task == null) throw new Error('Connector Task fixture is missing.')
    const revision: RevisionContent = {
      ...source,
      document: {
        ...source.document,
        tasks: { ...source.document.tasks, connector: { ...task, executor: { action: 'example.echo', kind: 'connector' } } },
      },
    }

    await expect(
      service.publishFlow({
        expectedLivePublicationId: null,
        flowId: 'main',
        idempotencyKey: 'unconnected-connector',
        revision,
        revisionId: 'revision-unconnected-connector',
      }),
    ).rejects.toMatchObject({ code: 'connector.connection-required' })
  })

  it('publishes a public Connector Task without a Connection', async () => {
    const service = await open(
      createConnectorHost({
        getAction: async () => ({
          actionId: 'example.echo',
          authenticated: false,
          description: 'Echo.',
          inputs: {},
          name: 'Echo',
          outputs: {},
          serviceId: 'example',
          serviceName: 'Example',
        }),
      }),
    )
    const source = connectorFlow()
    const task = source.document.tasks.connector
    if (task == null) throw new Error('Connector Task fixture is missing.')
    const revision: RevisionContent = {
      ...source,
      document: {
        ...source.document,
        tasks: { ...source.document.tasks, connector: { ...task, executor: { action: 'example.echo', kind: 'connector' } } },
      },
    }

    await expect(
      service.publishFlow({
        expectedLivePublicationId: null,
        flowId: 'main',
        idempotencyKey: 'public-connector',
        revision,
        revisionId: 'revision-public-connector',
      }),
    ).resolves.toMatchObject({ kind: 'published' })
  })

  it('uses the Flow Team fixed when a Run is admitted', async () => {
    const requests: { readonly teamId: string | null; readonly url: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        requests.push({ teamId: new Headers(init?.headers).get('x-oo-team-id'), url })
        if (url.startsWith('https://relation-control.oomol.dev/')) {
          return Response.json({ teams: [{ id: 'team-a', name: 'Team A', system_created: false }] })
        }
        if (url.endsWith('/v1/apps')) {
          return Response.json({
            data: [{ alias: 'work', displayName: 'Work', id: 'connection-work', isDefault: true, service: 'example', status: 'active' }],
            success: true,
          })
        }
        return Response.json({ data: { message: 'hello' }, success: true })
      }),
    )
    const service = await open(new ConnectorClient('https://connector.oomol.dev', 'runtime-token'))
    const created = await service.control.createFlow('test', 'Team Run', 'create-team-run', 'team-a')
    const revision = connectorFlow()
    const changed = await service.control.changeDraft('test', created.flow.flowId, created.flow.draftRevisionId, [
      { kind: 'task.create', task: revision.document.tasks.connector!, taskId: 'connector' },
      { kind: 'graph.node.create', node: revision.document.graph.nodes.connector!, nodeId: 'connector', target: { kind: 'flow' } },
    ])
    const accepted = await service.control.createDraftRun(created.flow.flowId, changed.revision.revisionId, 'open-flow-engine/v1', {}, 'team-run')
    await service.waitForIdle()

    expect(service.run(accepted.run.runId)?.status).toBe('completed')
    expect(requests.filter((request) => request.url.startsWith('https://connector.oomol.dev/'))).toEqual([
      { teamId: 'team-a', url: 'https://connector.oomol.dev/v1/apps' },
      { teamId: 'team-a', url: 'https://connector.oomol.dev/v1/actions/example.echo' },
    ])
  })

  it('omits an unset optional Connector input that does not accept null', async () => {
    const execute = vi.fn(async (_action: string, _connectionId: string, input: Readonly<Record<string, JsonValue>>) => input)
    const service = await open(createConnectorHost({ execute }))
    const runId = await run(service, connectorFlow(undefined, true))

    expect(execute).toHaveBeenCalledWith('example.echo', 'connection-work', { message: 'hello' }, expect.any(String), expect.any(AbortSignal), undefined)
    expect(service.run(runId)?.status).toBe('completed')
  })

  it('allows only Connector Capabilities declared by the current inline Task', async () => {
    const execute = vi.fn(async (_action: string, _connectionId: string, input: Readonly<Record<string, JsonValue>>) => input)
    const service = await open(createConnectorHost({ execute }))
    const allowedRunId = await run(service, capabilityFlow())
    expect(service.run(allowedRunId)?.status).toBe('completed')
    expect(execute).toHaveBeenCalledTimes(1)

    const deniedRunId = await run(service, capabilityFlow(false))
    expect(service.events(deniedRunId).find((event) => event.kind == 'node.failed')).toMatchObject({
      payload: { error: { code: 'capability.denied', message: 'The Runtime Capability is not declared for this Task.' } },
    })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it.each([
    'null',
    "{ action: '', connectionId: 'connection-work', input }",
    "{ action: 'example.echo', input }",
    "{ action: 'example.echo', connectionId: 'connection-work', input: [] }",
    "{ action: 'example.echo', connectionId: 'connection-work', extra: true, input }",
  ])('rejects malformed Connector Capability payload %s', async (payload) => {
    const execute = vi.fn(async () => ({}))
    const service = await open(createConnectorHost({ execute }))
    const runId = await run(service, capabilityFlow(true, `capability.connector(${payload})`))

    expect(service.events(runId).find((event) => event.kind == 'node.failed')).toMatchObject({
      payload: { error: { code: 'capability.invalid', message: 'The Runtime Capability request is invalid.' } },
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('denies a Runtime Capability kind that was not declared by the Task', async () => {
    const execute = vi.fn(async () => ({}))
    const service = await open(createConnectorHost({ execute }))
    const runId = await run(service, capabilityFlow(true, "capability.egress('https://example.com')"))

    expect(service.events(runId).find((event) => event.kind == 'node.failed')).toMatchObject({
      payload: { error: { code: 'capability.denied', message: 'The Runtime Capability is not declared for this Task.' } },
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('fails closed when no Connector host is injected', async () => {
    const service = await open()
    const runId = await run(service, connectorFlow())

    expect(service.run(runId)?.status).toBe('failed')
    expect(service.events(runId).find((event) => event.kind == 'node.failed')).toMatchObject({
      payload: { error: { code: 'connector.unconfigured', message: 'Connector is not configured for this deployment.' } },
    })
  })

  it('preserves stable host errors and propagates Task cancellation', async () => {
    const disconnected = await open(
      createConnectorHost({
        execute: async () => {
          throw new ConnectorTaskError('connector.connection-required', 'The selected Connector Connection must be reconnected or replaced.')
        },
      }),
    )
    const disconnectedRunId = await run(disconnected, connectorFlow())
    expect(disconnected.events(disconnectedRunId).find((event) => event.kind == 'node.failed')).toMatchObject({
      payload: { error: { code: 'connector.connection-required' } },
    })

    const waiting = await open(
      createConnectorHost({
        execute: async (_action, _connectionId, _input, _invocationId, signal) =>
          await new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
      }),
    )
    const timedOutRunId = await run(waiting, connectorFlow(20))
    expect(waiting.events(timedOutRunId).find((event) => event.kind == 'node.failed')).toMatchObject({
      payload: { error: { code: 'node.failed', message: 'Node "connector" timed out.' } },
    })
  })
})
