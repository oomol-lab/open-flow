import { expect, it } from 'vitest'
import { runCli } from './cli.ts'

const flow = {
  flowId: 'flow',
  name: 'Main',
  createdAt: '2026-10-12T00:00:00Z',
  updatedAt: '2026-10-12T00:00:00Z',
  draftRevisionId: 'draft',
  status: 'active',
  version: 1,
  resourceReferences: {
    draft: { variableNames: [], connections: [], errorSourceFlowIds: [] },
    sharedAccess: { accessRevision: 0, providerIds: [], bindings: [] },
  },
}
const publication = {
  flowId: 'flow',
  publicationId: 'published',
  revisionId: 'fixed',
  actorId: 'actor',
  createdAt: flow.createdAt,
  operation: 'publish',
  closureDigest: 'closure',
  revisionDigest: 'revision',
  sharedAccessDigest: 'access',
  engineContract: 'open-flow-engine/v6',
  modelVersion: 6,
  version: 1,
}
const binding = {
  flowId: 'flow',
  currentPublicationId: 'published',
  currentRevisionId: 'fixed',
  triggerNodeId: 'hook',
  kind: 'webhook',
  health: 'healthy',
  runtimeVersion: 1,
  updatedAt: flow.updatedAt,
  version: 1,
  endpointUrl: 'https://server.test/v1/webhooks/endpoint_123',
}
const live = {
  flowId: 'flow',
  publication,
  inputDefs: { message: { schema: { type: 'string' }, nullable: false } },
  enabled: true,
  status: 'runnable',
  entries: [
    {
      nodeId: 'hook',
      name: 'Receive',
      type: 'webhook',
      config: { method: 'POST', body: { message: { schema: { type: 'string' }, nullable: false } } },
      binding,
    },
  ],
  version: 1,
}
const operation = {
  flowId: 'flow',
  operationId: 'operation',
  revisionId: 'fixed',
  publicationId: 'published',
  status: 'succeeded',
  createdAt: flow.createdAt,
  updatedAt: flow.updatedAt,
  version: 1,
}
function io() {
  let stdout = '',
    stderr = ''
  return {
    stdout: () => stdout,
    stderr: () => stderr,
    value: {
      env: {},
      language: 'en' as const,
      commandPrefix: 'test flow',
      openUrl: async () => {},
      readFile: async () => '',
      readStdin: async () => '',
      stdout: {
        write: (value: string) => {
          stdout += value
        },
      },
      stderr: {
        write: (value: string) => {
          stderr += value
        },
      },
      wait: async () => {},
    },
  }
}
function host(options: { live?: unknown; metadataFailure?: boolean; detailsFailure?: boolean; pending?: boolean; failed?: boolean } = {}) {
  const paths: string[] = []
  return {
    paths,
    request: async (path: string) => {
      paths.push(path)
      if (path == '/v1/flows/Main') return Response.json({ version: 1, error: { code: 'flow.not-found', message: 'Missing' } }, { status: 404 })
      if (path == '/v1/flows?limit=100') return Response.json({ flows: [{ ...flow, referenceCount: 0 }], version: 1 })
      if (path == '/v1/flows/flow') return Response.json(flow)
      if (path == '/v1/flows/flow/live/details') {
        if (options.detailsFailure) throw new Error('Offline')
        return Response.json(options.live ?? live)
      }
      if (path == '/v1/flows/flow/publications?limit=100') {
        if (options.metadataFailure) throw new Error('Offline')
        return Response.json({ publications: [publication], version: 1 })
      }
      if (path.endsWith('/revisions/fixed/publications') || path.includes('/publish-operations/')) {
        if (options.pending || options.failed) {
          const { publicationId: _publicationId, ...pending } = operation
          return Response.json({
            ...pending,
            status: options.failed ? 'failed' : 'pending',
            ...(options.failed ? { issue: { code: 'provider.failed', message: 'Subscription failed' } } : {}),
          })
        }
        return Response.json(operation)
      }
      throw new Error(`Unexpected ${path}`)
    },
  }
}
const publish = ['publish', 'flow', '--expected-revision', 'fixed', '--expected-publication', 'none', '--idempotency-key', 'retry-key', '--json']

it.each(['flow', 'Main'])('queries Live by ID or unique name: %s', async (ref) => {
  const output = io(),
    server = host()
  expect(await runCli(['live', ref, '--json'], server, output.value), output.stderr()).toBe(0)
  expect(JSON.parse(output.stdout())).toEqual({ kind: 'flow.live', live, version: 1 })
  expect(server.paths.some((path) => path.includes('revisions') || path.endsWith('/draft'))).toBe(false)
})
it('prints entry URLs, request contracts and independent states as text', async () => {
  const output = io()
  expect(await runCli(['live', 'flow'], host(), output.value)).toBe(0)
  expect(output.stdout()).toContain(binding.endpointUrl)
  expect(output.stdout()).toContain('inputDefs={"message":{"schema":{"type":"string"},"nullable":false}}')
  expect(output.stdout()).toContain('"message":{"schema":{"type":"string"},"nullable":false}')
  expect(output.stdout()).toContain('enabled=true')
  expect(output.stdout()).toContain('health=healthy')
})
it('treats unpublished as a normal query and read failures as errors', async () => {
  const empty = { flowId: 'flow', publication: null, inputDefs: null, entries: [], status: 'not-published', version: 1 }
  const output = io()
  expect(await runCli(['live', 'flow', '--json'], host({ live: empty }), output.value)).toBe(0)
  expect(JSON.parse(output.stdout()).live).toEqual(empty)
  const failed = io()
  expect(await runCli(['live', 'flow', '--json'], host({ detailsFailure: true }), failed.value)).toBe(1)
  expect(failed.stdout()).toBe('')
})
it('includes the same Live view after successful publication', async () => {
  const output = io()
  const server = host({ metadataFailure: true })
  expect(await runCli(publish, server, output.value), output.stderr()).toBe(0)
  expect(server.paths).not.toContain('/v1/flows/flow/publications?limit=100')
  expect(JSON.parse(output.stdout())).toMatchObject({ publication, operation, live })
  expect(JSON.parse(output.stdout())).not.toHaveProperty('warnings')
})
it.each([
  [false, true],
  [true, true],
])('preserves publish success when metadata=%s or details=%s fail', async (metadataFailure, detailsFailure) => {
  const output = io()
  expect(await runCli(publish, host({ metadataFailure, detailsFailure }), output.value), output.stderr()).toBe(0)
  const result = JSON.parse(output.stdout())
  expect(result.operation).toEqual(operation)
  expect(result.warnings).toHaveLength(Number(metadataFailure) + Number(detailsFailure))
  if (!metadataFailure) expect(result.publication).toEqual(publication)
  if (!detailsFailure) expect(result.live).toEqual(live)
  expect(result.warnings[0].message).toContain('test flow live flow --json')
  expect(output.stderr()).toBe('')
})
it('identifies a newer Live version on concurrent publication or idempotent replay', async () => {
  const newer = {
    ...live,
    publication: { ...publication, publicationId: 'newer' },
    entries: [{ ...live.entries[0], binding: { ...binding, currentPublicationId: 'newer' } }],
  }
  const output = io()
  expect(await runCli(publish, host({ live: newer }), output.value)).toBe(0)
  expect(JSON.parse(output.stdout())).toMatchObject({
    operation: { publicationId: 'published' },
    publication: { publicationId: 'published' },
    live: { publication: { publicationId: 'newer' } },
    warnings: [{ code: 'live.publication-changed' }],
  })
})
it.each([false, true])('never reads online entries for pending/failed publication (failed=%s)', async (failed) => {
  const output = io(),
    server = host({ pending: !failed, failed })
  expect(await runCli([...publish, '--timeout', '1'], server, output.value)).toBe(failed ? 1 : 3)
  expect(server.paths).not.toContain('/v1/flows/flow/live/details')
  if (!failed) expect(JSON.parse(output.stdout())).toHaveProperty('operation.operationId', 'operation')
})
it('provides offline help for Live and rejects unsupported options before requests', async () => {
  const server = host(),
    output = io()
  expect(await runCli(['live', '--help', '--json'], server, output.value)).toBe(0)
  expect(JSON.parse(output.stdout()).commands[0].usage).toContain('test flow live <flow>')
  for (const args of [
    ['live', 'flow', '--source', 'draft'],
    ['resources', 'flow'],
    ['live', 'flow', 'hook'],
    ['live', 'flow', '--publication', 'published'],
  ])
    expect(await runCli(args, server, io().value)).toBe(1)
  expect(server.paths).toEqual([])
})
