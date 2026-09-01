import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { DestinationStream, Logger } from 'pino'

import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectorClient } from '../node/connector.ts'
import { createLogger } from '../node/logger.ts'
import { ServerService } from '../node/service.ts'
import { acceptRun } from './runFixture.ts'
import { closeService, openService, startService as startRuntime } from './serviceFixture.ts'

const directories: string[] = []
const servers: Server[] = []
const services: ServerService[] = []
const port = { jsonSchema: {}, nullable: false } as const

afterEach(async () => {
  vi.unstubAllGlobals()
  const currentServers = servers.splice(0)
  for (const server of currentServers) server.closeAllConnections()
  await Promise.allSettled(currentServers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  await Promise.allSettled(services.splice(0).map(closeService))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function databaseFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-connector-'))
  directories.push(directory)
  return path.join(directory, 'open-flow.sqlite')
}

function connectorFlow(options: { readonly action?: string; readonly connectionId?: string; readonly timeoutMs?: number } = {}): RevisionContent {
  return {
    document: {
      bindings: {},
      graph: {
        nodes: {
          connector: {
            concurrency: 1,
            inputs: { message: { kind: 'value', value: 'hello' } },
            kind: 'task',
            taskId: 'connector',
            ...(options.timeoutMs == null ? {} : { timeoutMs: options.timeoutMs }),
          },
        },
      },
      subflows: {},
      tasks: {
        connector: {
          executor: {
            action: options.action ?? 'example.echo',
            connectionId: options.connectionId ?? 'connection-work',
            kind: 'connector',
          },
          inputs: [{ ...port, handle: 'message' }],
          name: 'Echo',
          outputs: [{ ...port, handle: 'message' }],
        },
      },
    },
    modelVersion: 1,
    modules: {},
  }
}

function capabilityFlow(declared = true): RevisionContent {
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
        source:
          "export default async (input, capability) => (await capability.connector({ action: 'example.echo', connectionId: 'connection-work', input })).body",
      },
    },
  }
}

async function startConnector(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): Promise<string> {
  const server = createServer((request, response) => void handler(request, response))
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address == null || typeof address == 'string') throw new Error('Test Connector did not bind a TCP address.')
  return `http://127.0.0.1:${address.port}`
}

async function startService(origin: string, token = 'runtime-token', timeoutMs = 30_000, logger?: Logger): Promise<{ file: string; service: ServerService }> {
  const file = await databaseFile()
  const service = await openService(file, new ConnectorClient(origin, token, timeoutMs, logger))
  services.push(service)
  await startRuntime(service)
  return { file, service }
}

function captureLogger(): { readonly logger: Logger; readonly output: () => string } {
  let output = ''
  const destination: DestinationStream = {
    write(chunk) {
      output += chunk
    },
  }
  return { logger: createLogger('trace', destination), output: () => output }
}

async function run(service: ServerService, revision = connectorFlow()) {
  const accepted = await acceptRun(service, { flowId: 'main', idempotencyKey: crypto.randomUUID(), revision, revisionId: crypto.randomUUID() })
  if (accepted.kind != 'accepted') throw new Error('Connector Run acceptance conflicted.')
  await service.waitForIdle()
  return accepted.runId
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

function success(data: unknown): unknown {
  return { data, message: 'OK', meta: {}, success: true }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

const app = { alias: 'work', id: 'connection-work', service: 'example', status: 'active' }

describe('Server Connector client', () => {
  it('lists OOMOL Teams and scopes Connector requests to the selected Team', async () => {
    const requests: { readonly authorization: string | null; readonly teamId: string | null; readonly url: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        const url = String(input)
        requests.push({ authorization: headers.get('authorization'), teamId: headers.get('x-oo-team-id'), url })
        return url.startsWith('https://relation-control.oomol.dev/')
          ? Response.json({ extra: true, teams: [{ id: 'team-1', name: 'Engineering', status: 'normal', system_created: true }] })
          : Response.json(success([]))
      }),
    )
    const connector = new ConnectorClient('https://connector.oomol.dev', 'runtime-token')

    expect(connector.teamSupported()).toBe(true)
    await expect(connector.listTeams()).resolves.toEqual([{ id: 'team-1', name: 'Engineering', systemCreated: true }])
    await expect(connector.listProviders(undefined, 'team-1')).resolves.toEqual([])

    expect(requests).toEqual([
      {
        authorization: 'Bearer runtime-token',
        teamId: null,
        url: 'https://relation-control.oomol.dev/v1/me/teams',
      },
      {
        authorization: 'Bearer runtime-token',
        teamId: 'team-1',
        url: 'https://connector.oomol.dev/v1/providers',
      },
    ])
    expect(new ConnectorClient('https://connector.example.com', 'runtime-token').teamSupported()).toBe(false)
    expect(new ConnectorClient('https://connector.oomol.com', '').teamSupported()).toBe(false)
  })

  it('checks Connector readiness without using the runtime token', async () => {
    let status = 200
    const requests: { readonly authorization?: string; readonly path: string }[] = []
    const origin = await startConnector((request, response) => {
      requests.push({ authorization: request.headers.authorization, path: request.url! })
      send(response, status, { ok: status == 200 })
    })
    const connector = new ConnectorClient(origin, 'runtime-token')

    await expect(connector.ready()).resolves.toBe(true)
    status = 503
    await expect(connector.ready()).resolves.toBe(false)
    expect(requests).toEqual([
      { authorization: undefined, path: '/health' },
      { authorization: undefined, path: '/health' },
    ])
  })

  it('omits authorization when the local Connector token is empty', async () => {
    let authorization: string | undefined
    const origin = await startConnector((request, response) => {
      authorization = request.headers.authorization
      send(response, 200, success([]))
    })
    const connector = new ConnectorClient(origin, '')

    await expect(connector.listProviders()).resolves.toEqual([])
    expect(authorization).toBeUndefined()
  })

  it('projects runtime discovery through the restricted server token', async () => {
    const requests: { readonly authorization?: string; readonly path: string }[] = []
    const provider = {
      authTypes: ['api_key'],
      categories: [{ displayName: 'Examples', id: 'Examples' }],
      displayName: 'Example',
      homepageUrl: 'https://example.test',
      iconUrl: 'https://example.test/icon.svg',
      scenario: 'developer',
      service: 'example',
    }
    const action = {
      asyncLifecycle: null,
      description: 'Echo one message.',
      followUpActions: [],
      id: 'example.echo',
      inputSchema: {
        properties: { message: { default: 'hello', description: 'Message.', type: 'string' } },
        type: 'object',
      },
      name: 'echo',
      outputSchema: { properties: { message: { type: 'string' } }, required: ['message'], type: 'object' },
      providerPermissions: [],
      requiredScopes: [],
      service: 'example',
    }
    const connectedApp = {
      accountLabel: 'Work account',
      alias: 'work',
      authType: 'api_key',
      displayName: 'Work account',
      id: 'connection-work',
      isDefault: true,
      scopes: [],
      service: 'example',
      status: 'active',
    }
    const origin = await startConnector((request, response) => {
      requests.push({ authorization: request.headers.authorization, path: request.url! })
      if (request.url == '/v1/providers') return send(response, 200, success([provider]))
      if (request.url == '/v1/apps' || request.url == '/v1/apps/services/example') return send(response, 200, success([connectedApp]))
      if (request.url == '/v1/actions/search?q=echo') {
        return send(
          response,
          200,
          success([
            {
              description: action.description,
              id: action.id,
              inputSchema: action.inputSchema,
              name: action.name,
              outputSchema: action.outputSchema,
              service: action.service,
            },
          ]),
        )
      }
      return send(response, 200, success(request.url == '/v1/actions/example.echo' ? action : [action]))
    })
    const connector = new ConnectorClient(origin, 'runtime-token')

    await expect(connector.listProviders()).resolves.toEqual([
      {
        homepageUrl: 'https://example.test',
        icon: 'https://example.test/icon.svg',
        serviceId: 'example',
        serviceName: 'Example',
      },
    ])
    await expect(connector.listActions('example')).resolves.toEqual([
      expect.objectContaining({
        actionId: 'example.echo',
        authenticated: true,
        defaultConnection: expect.objectContaining({ connectionId: 'connection-work' }),
        homepageUrl: 'https://example.test',
        inputs: {
          message: { description: 'Message.', jsonSchema: { default: 'hello', description: 'Message.', type: 'string' }, nullable: true, value: 'hello' },
        },
        outputs: { message: { jsonSchema: { type: 'string' }, nullable: false } },
        serviceName: 'Example',
      }),
    ])
    await expect(connector.searchActions('echo')).resolves.toHaveLength(1)
    await expect(connector.getAction('example.echo')).resolves.toMatchObject({ actionId: 'example.echo', serviceId: 'example' })
    await expect(connector.listConnections('example')).resolves.toEqual([
      {
        connectionId: 'connection-work',
        displayName: 'Work account',
        isDefault: true,
        serviceId: 'example',
        status: 'active',
      },
    ])

    expect(requests.every((request) => request.authorization == 'Bearer runtime-token')).toBe(true)
    expect(requests.map((request) => request.path)).toEqual(
      expect.arrayContaining([
        '/v1/actions/example.echo',
        '/v1/actions/search?q=echo',
        '/v1/actions?service=example',
        '/v1/apps',
        '/v1/apps/services/example',
        '/v1/providers',
      ]),
    )
  })

  it('projects Hosted Connector discovery responses without requiring exact keys', async () => {
    const provider = {
      authTypes: ['api_key'],
      credential: 'must-not-cross-boundary',
      displayName: 'Example',
      iconUrl: null,
      searchAliases: ['sample'],
      service: 'example',
    }
    const action = {
      description: 'Echo one message.',
      id: 'example.echo',
      inputSchema: { properties: {}, type: 'object' },
      name: 'echo',
      operationType: 'action',
      outputSchema: { properties: {}, type: 'object' },
      service: 'example',
    }
    const connectedApp = {
      alias: 'work',
      createdAt: '2026-08-29T00:00:00.000Z',
      credentialFields: { apiKey: 'must-not-cross-boundary' },
      displayName: 'Work account',
      id: 'connection-work',
      isDefault: true,
      service: 'example',
      status: 'active',
      userId: 'user-private',
    }
    const origin = await startConnector((request, response) => {
      if (request.url == '/v1/providers') return send(response, 200, { data: [provider], requestId: 'request-1', success: true })
      if (request.url == '/v1/actions?service=example') return send(response, 200, { data: [action], success: true })
      return send(response, 200, { data: [connectedApp], success: true })
    })
    const connector = new ConnectorClient(origin, 'runtime-token')

    await expect(connector.listProviders()).resolves.toEqual([{ serviceId: 'example', serviceName: 'Example' }])
    await expect(connector.listActions('example')).resolves.toEqual([
      {
        actionId: 'example.echo',
        authenticated: true,
        defaultConnection: {
          connectionId: 'connection-work',
          displayName: 'Work account',
          isDefault: true,
          serviceId: 'example',
          status: 'active',
        },
        description: 'Echo one message.',
        inputs: {},
        name: 'echo',
        outputs: {},
        serviceId: 'example',
        serviceName: 'Example',
      },
    ])
    await expect(connector.listConnections('example')).resolves.toEqual([
      {
        connectionId: 'connection-work',
        displayName: 'Work account',
        isDefault: true,
        serviceId: 'example',
        status: 'active',
      },
    ])
  })

  it('loads the full Action catalog with bounded concurrency and stable order', async () => {
    const providers = Array.from({ length: 18 }, (_, index) => ({
      authTypes: ['no_auth'],
      displayName: `Service ${index}`,
      service: `service-${index}`,
    }))
    let active = 0
    let maximumActive = 0
    const origin = await startConnector(async (request, response) => {
      if (request.url == '/v1/providers') return send(response, 200, success(providers))
      if (request.url == '/v1/apps') return send(response, 200, success([]))
      if (request.url == null) throw new Error('Action catalog request omitted its URL.')
      const service = new URL(request.url, 'http://connector.test').searchParams.get('service')
      if (service == null) throw new Error('Action catalog request omitted its Provider service.')
      const index = Number(service.slice('service-'.length))
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, (index % 3) + 1))
      active -= 1
      send(
        response,
        200,
        success([
          {
            description: `Run Service ${index}.`,
            id: `${service}.run`,
            inputSchema: { properties: {}, type: 'object' },
            name: 'Run',
            outputSchema: { properties: {}, type: 'object' },
            service,
          },
        ]),
      )
    })
    const connector = new ConnectorClient(origin, 'runtime-token')

    const actions = await connector.listActions()

    expect(maximumActive).toBeGreaterThan(1)
    expect(maximumActive).toBeLessThanOrEqual(16)
    expect(actions.map((action) => action.actionId)).toEqual(providers.map((provider) => `${provider.service}.run`))
    expect(actions.every((action) => !action.authenticated)).toBe(true)
  })

  it('stops concurrent Action responses when the shared catalog budget is exhausted', async () => {
    const providers = Array.from({ length: 16 }, (_, index) => ({
      authTypes: ['no_auth'],
      displayName: `Service ${index}`,
      service: `service-${index}`,
    }))
    const firstChunkBytes = 512 * 1024
    const releases: (() => void)[] = []
    let abortedBodies = 0
    let finishedBodies = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.pathname == '/v1/providers') return new Response(JSON.stringify(success(providers)))
        if (url.pathname == '/v1/apps') return new Response(JSON.stringify(success([])))
        const service = url.searchParams.get('service')
        if (service == null) throw new Error('Action catalog request omitted its Provider service.')
        const body = new TextEncoder().encode(
          JSON.stringify(
            success([
              {
                description: 'x'.repeat(600 * 1024),
                id: `${service}.run`,
                inputSchema: { properties: {}, type: 'object' },
                name: 'Run',
                outputSchema: { properties: {}, type: 'object' },
                service,
              },
            ]),
          ),
        )
        let closed = false
        let first = true
        let resolvePull: (() => void) | undefined
        const stream = new ReadableStream<Uint8Array>(
          {
            start(controller) {
              init?.signal?.addEventListener(
                'abort',
                () => {
                  if (closed) return
                  closed = true
                  abortedBodies += 1
                  controller.error(init.signal?.reason)
                  resolvePull?.()
                },
                { once: true },
              )
            },
            pull(controller) {
              if (first) {
                first = false
                controller.enqueue(body.slice(0, firstChunkBytes))
                return
              }
              return new Promise<void>((resolve) => {
                resolvePull = resolve
                releases.push(() => {
                  if (!closed) {
                    closed = true
                    finishedBodies += 1
                    controller.enqueue(body.slice(firstChunkBytes))
                    controller.close()
                  }
                  resolve()
                })
                if (releases.length == providers.length) {
                  const [release, ...rest] = releases
                  release?.()
                  queueMicrotask(() => {
                    for (const current of rest) current()
                  })
                }
              })
            },
          },
          { highWaterMark: 0 },
        )
        return new Response(stream)
      }),
    )
    const captured = captureLogger()
    const connector = new ConnectorClient('https://connector.test', 'runtime-token', 30_000, captured.logger)

    await expect(connector.listActions()).rejects.toMatchObject({ code: 'connector.unavailable' })
    await Promise.resolve()

    expect(finishedBodies).toBeLessThan(providers.length)
    expect(abortedBodies).toBeGreaterThan(0)
    expect(captured.output().match(/"failure":"response-too-large"/g)).toHaveLength(1)
    expect(captured.output()).toContain('"limitBytes":8388608')
  })

  it('projects public Connector Actions without a Connection', async () => {
    const origin = await startConnector((request, response) => {
      if (request.url == '/v1/providers') {
        return send(response, 200, success([{ authTypes: ['api_key', 'no_auth'], displayName: 'Hacker News', service: 'hacker-news' }]))
      }
      if (request.url == '/v1/apps/services/hacker-news') {
        return send(
          response,
          200,
          success([
            {
              displayName: 'Reader',
              id: 'hacker-news-reader',
              isDefault: true,
              service: 'hacker-news',
              status: 'active',
            },
          ]),
        )
      }
      return send(
        response,
        200,
        success([
          {
            description: 'Get Ask HN stories.',
            id: 'hacker-news.get-ask-stories',
            inputSchema: { properties: {}, type: 'object' },
            name: 'Get Ask Stories',
            outputSchema: { properties: {}, type: 'object' },
            service: 'hacker-news',
          },
        ]),
      )
    })
    const connector = new ConnectorClient(origin, 'runtime-token')

    await expect(connector.listActions('hacker-news')).resolves.toEqual([
      {
        actionId: 'hacker-news.get-ask-stories',
        authenticated: false,
        description: 'Get Ask HN stories.',
        inputs: {},
        name: 'Get Ask Stories',
        outputs: {},
        serviceId: 'hacker-news',
        serviceName: 'Hacker News',
      },
    ])
  })

  it('rejects a Connector Action without a stable id', async () => {
    const origin = await startConnector((request, response) => {
      if (request.url == '/v1/providers') {
        return send(response, 200, { data: [{ authTypes: ['no_auth'], displayName: 'Example', service: 'example' }], success: true })
      }
      if (request.url == '/v1/apps') return send(response, 200, { data: [], success: true })
      return send(response, 200, {
        data: [
          {
            description: 'Echo one message.',
            inputSchema: { properties: {}, type: 'object' },
            name: 'echo',
            outputSchema: { properties: {}, type: 'object' },
            service: 'example',
          },
        ],
        success: true,
      })
    })
    const connector = new ConnectorClient(origin, 'runtime-token')

    await expect(connector.searchActions('echo')).rejects.toMatchObject({ code: 'connector.unavailable' })
  })

  it('maps malformed Connector Action schemas to the stable unavailable error', async () => {
    const origin = await startConnector((request, response) => {
      if (request.url == '/v1/providers') {
        return send(
          response,
          200,
          success([
            {
              authTypes: ['no_auth'],
              categories: [],
              displayName: 'Example',
              homepageUrl: null,
              iconUrl: null,
              scenario: 'developer',
              service: 'example',
            },
          ]),
        )
      }
      if (request.url == '/v1/apps/services/example') return send(response, 200, success([]))
      return send(
        response,
        200,
        success([
          {
            asyncLifecycle: null,
            description: 'Invalid schema.',
            followUpActions: [],
            id: 'example.invalid',
            inputSchema: null,
            name: 'invalid',
            outputSchema: {},
            providerPermissions: [],
            requiredScopes: [],
            service: 'example',
          },
        ]),
      )
    })
    const captured = captureLogger()
    const connector = new ConnectorClient(origin, 'runtime-token', 30_000, captured.logger)

    await expect(connector.listActions('example')).rejects.toMatchObject({ code: 'connector.unavailable' })
    expect(captured.output()).toContain('"category":"connector.request.failed"')
    expect(captured.output()).toContain('"failure":"response-invalid"')
    expect(captured.output()).toContain('"operation":"actions.list"')
    expect(captured.output()).not.toContain('Invalid schema.')
  })

  it('uses only the explicit public Console origin for Connection pages', async () => {
    const configured = await openService(await databaseFile(), undefined, Date.now, {}, 'https://connector.example')
    services.push(configured)
    expect(configured.control.connectorConnectionPage('mail/work')).toBe('https://connector.example/providers/mail%2Fwork')

    const unconfigured = await openService(await databaseFile())
    services.push(unconfigured)
    expect(() => unconfigured.control.connectorConnectionPage('mail')).toThrow(expect.objectContaining({ code: 'connector.unavailable', status: 503 }))

    const insecureFile = await databaseFile()
    await expect(openService(insecureFile, undefined, Date.now, {}, 'http://connector.example')).rejects.toThrow(
      'Connector Console origin must be an HTTPS origin without credentials, a path, query, or fragment, except on loopback.',
    )
  })

  it('resolves the stable Connection id and executes an action with the runtime grant', async () => {
    const calls: {
      readonly alias?: string
      readonly authorization?: string
      readonly body?: unknown
      readonly idempotencyKey?: string
      readonly path: string
    }[] = []
    const origin = await startConnector(async (request, response) => {
      calls.push({
        alias: request.headers['x-oo-connector-alias'] as string | undefined,
        authorization: request.headers.authorization,
        body: request.method == 'POST' ? await readBody(request) : undefined,
        idempotencyKey: request.headers['idempotency-key'] as string | undefined,
        path: request.url!,
      })
      if (request.url == '/v1/apps') return send(response, 200, { data: [app], success: true })
      send(response, 200, { data: { message: 'hello' }, success: true })
    })
    const { service } = await startService(origin)
    const runId = await run(service)

    expect(service.run(runId)).toMatchObject({
      result: { kind: 'node-results', nodes: [{ jobs: [{ outputs: { message: 'hello' } }], nodeId: 'connector' }] },
      status: 'completed',
    })
    expect(calls).toEqual([
      { alias: undefined, authorization: 'Bearer runtime-token', body: undefined, idempotencyKey: undefined, path: '/v1/apps' },
      {
        alias: 'work',
        authorization: 'Bearer runtime-token',
        body: { input: { message: 'hello' } },
        idempotencyKey: expect.any(String),
        path: '/v1/actions/example.echo',
      },
    ])
  })

  it('executes a public action without resolving a Connection', async () => {
    const calls: { readonly alias?: string; readonly path: string }[] = []
    const origin = await startConnector((request, response) => {
      calls.push({ alias: request.headers['x-oo-connector-alias'] as string | undefined, path: request.url! })
      send(response, 200, { data: { stories: [] }, success: true })
    })
    const connector = new ConnectorClient(origin, 'runtime-token')

    await expect(connector.execute('hacker-news.get-ask-stories', undefined, {}, 'public-action', AbortSignal.timeout(30_000))).resolves.toEqual({
      stories: [],
    })
    expect(calls).toEqual([{ alias: undefined, path: '/v1/actions/hacker-news.get-ask-stories' }])
  })

  it('preserves safe Connector input diagnostics in the Run event', async () => {
    const origin = await startConnector((request, response) => {
      if (request.url == '/v1/apps') return send(response, 200, { data: [app], success: true })
      send(response, 400, {
        data: [
          { error: 'Property "tags" does not match schema.', instanceLocation: '#', keyword: 'properties' },
          { error: 'Instance type "null" is invalid. Expected "array".', instanceLocation: '#/tags', keyword: 'type' },
        ],
        errorCode: 'invalid_input',
        message: 'Action input does not match the action schema.',
        success: false,
      })
    })
    const { service } = await startService(origin)
    const runId = await run(service)

    expect(service.events(runId).find((event) => event.kind == 'node.failed')).toMatchObject({
      payload: {
        error: {
          code: 'connector.unavailable',
          message: 'The Connector Action input is invalid. Property "tags" does not match schema. Instance type "null" is invalid. Expected "array".',
        },
      },
    })
  })

  it('executes only Connector Capabilities declared by the current inline Task', async () => {
    const calls: string[] = []
    const origin = await startConnector((request, response) => {
      calls.push(request.url!)
      if (request.url == '/v1/apps') return send(response, 200, { data: [app], success: true })
      send(response, 200, { data: { message: 'hello' }, success: true })
    })
    const { service } = await startService(origin)
    const allowedRunId = await run(service, capabilityFlow())

    expect(service.run(allowedRunId)).toMatchObject({
      result: { kind: 'node-results', nodes: [{ jobs: [{ outputs: { message: 'hello' } }], nodeId: 'capability' }] },
      status: 'completed',
    })
    expect(calls).toEqual(['/v1/apps', '/v1/actions/example.echo'])

    calls.length = 0
    const deniedRunId = await run(service, capabilityFlow(false))
    expect(service.events(deniedRunId).find((event) => event.kind == 'node.failed')).toMatchObject({
      payload: { error: { code: 'capability.denied', message: 'The Runtime Capability is not declared for this Task.' } },
    })
    expect(calls).toEqual([])
  })

  it('proxies a Provider request through the resolved stable Connection', async () => {
    const calls: {
      readonly alias?: string
      readonly authorization?: string
      readonly body?: unknown
      readonly path: string
      readonly rateLimitId?: string
    }[] = []
    const origin = await startConnector(async (request, response) => {
      calls.push({
        alias: request.headers['x-oo-connector-alias'] as string | undefined,
        authorization: request.headers.authorization,
        body: request.method == 'POST' ? await readBody(request) : undefined,
        path: request.url!,
        rateLimitId: request.headers['x-oomol-rate-limit-id'] as string | undefined,
      })
      if (request.url == '/v1/apps') return send(response, 200, { data: [app], success: true })
      send(response, 200, { data: { data: { items: [1, 2] }, status: 200 }, success: true })
    })
    const connector = new ConnectorClient(origin, 'runtime-token')

    await expect(
      connector.proxy('example', 'connection-work', 'binding-main', { endpoint: '/items', method: 'GET', query: { limit: 2 } }, new AbortController().signal),
    ).resolves.toEqual({ data: { items: [1, 2] }, status: 200 })
    expect(calls).toEqual([
      { alias: undefined, authorization: 'Bearer runtime-token', body: undefined, path: '/v1/apps', rateLimitId: undefined },
      {
        alias: 'work',
        authorization: 'Bearer runtime-token',
        body: { endpoint: '/items', method: 'GET', query: { limit: 2 } },
        path: '/v1/proxy/example',
        rateLimitId: 'binding-main',
      },
    ])
  })

  it('fails closed when an alias now belongs to a different stable Connection id', async () => {
    let actionCalls = 0
    const origin = await startConnector((request, response) => {
      if (request.url == '/v1/apps') return send(response, 200, { data: [{ ...app, id: 'connection-replacement' }], success: true })
      actionCalls += 1
      send(response, 200, { data: {}, success: true })
    })
    const { service } = await startService(origin)
    const runId = await run(service)

    expect(actionCalls).toBe(0)
    expect(service.run(runId)?.status).toBe('failed')
    expect(service.events(runId).find((event) => event.kind == 'node.failed')).toMatchObject({
      payload: { error: { code: 'connector.connection-required', message: 'The selected Connector Connection must be reconnected or replaced.' } },
    })
  })

  it('does not persist the runtime token or an upstream credential error', async () => {
    const token = 'runtime-token-private'
    const upstreamSecret = 'provider-secret-private'
    const captured = captureLogger()
    const origin = await startConnector((request, response) => {
      if (request.url == '/v1/apps') return send(response, 200, { data: [app], success: true })
      send(response, 403, { data: {}, errorCode: 'connection_not_allowed', message: `credential=${upstreamSecret}`, success: false })
    })
    const { file, service } = await startService(origin, token, 30_000, captured.logger)
    const runId = await run(service)

    expect(service.run(runId)?.status).toBe('failed')
    expect(service.events(runId).find((event) => event.kind == 'node.failed')).toMatchObject({
      payload: { error: { code: 'connector.connection-required' } },
    })
    const database = new DatabaseSync(file, { readOnly: true })
    const stored = JSON.stringify({
      events: database.prepare('SELECT payload, value FROM events').all(),
      revisions: database.prepare('SELECT content FROM revisions').all(),
      runs: database.prepare('SELECT inputs, result FROM runs').all(),
    })
    database.close()
    expect(stored).not.toContain(token)
    expect(stored).not.toContain(upstreamSecret)
    expect(captured.output()).toContain('"category":"connector.request.failed"')
    expect(captured.output()).toContain('"operation":"action.execute"')
    expect(captured.output()).toContain('"status":403')
    expect(captured.output()).not.toContain(token)
    expect(captured.output()).not.toContain(upstreamSecret)
  })

  it('propagates the node timeout into an in-flight Connector request', async () => {
    const origin = await startConnector((request, response) => {
      if (request.url == '/v1/apps') return send(response, 200, { data: [app], success: true })
    })
    const { service } = await startService(origin)
    const runId = await run(service, connectorFlow({ timeoutMs: 20 }))

    expect(service.run(runId)?.status).toBe('failed')
    expect(service.events(runId).find((event) => event.kind == 'node.failed')).toMatchObject({
      payload: { error: { code: 'node.failed', message: 'Node "connector" timed out.' } },
    })
  })

  it('rejects an oversized Connector response', async () => {
    const origin = await startConnector((request, response) => {
      if (request.url == '/v1/apps') return send(response, 200, { data: [app], success: true })
      send(response, 200, { data: { value: 'x'.repeat(1024 * 1024) }, success: true })
    })
    const { service } = await startService(origin)
    const runId = await run(service)

    expect(service.run(runId)?.status).toBe('failed')
    expect(service.events(runId).find((event) => event.kind == 'node.failed')).toMatchObject({
      payload: { error: { code: 'connector.unavailable', message: 'The Connector request could not be completed.' } },
    })
  })
})
