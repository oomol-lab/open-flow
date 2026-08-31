import { describe, expect, it, vi } from 'vitest'
import { ControlClient } from './api.ts'

const flow = {
  createdAt: '2026-08-14T00:00:00.000Z',
  draftRevisionId: 'revision-1',
  flowId: 'flow/1',
  name: 'Main',
  status: 'active',
  updatedAt: '2026-08-14T00:00:00.000Z',
  version: 1,
} as const

describe('ControlClient Flow API', () => {
  it('creates and lists top-level Flows', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path == '/v1/flows' && init?.method == 'POST') return Response.json(flow, { status: 201 })
      if (path == '/v1/flows?limit=50&includeTotal=true') return Response.json({ flows: [flow], total: 1, version: 1 })
      throw new Error(path)
    })
    const client = new ControlClient(request)

    await expect(client.createFlow('Main', 'flow-create')).resolves.toEqual(flow)
    await expect(client.listFlows({ includeTotal: true, limit: 50 })).resolves.toEqual({ flows: [flow], total: 1, version: 1 })
    expect(JSON.parse(String(request.mock.calls[0]![1]?.body))).toEqual({ name: 'Main', version: 1 })
    expect(new Headers(request.mock.calls[0]![1]?.headers).get('idempotency-key')).toBe('flow-create')
  })

  it('changes the top-level Flow Draft graph', async () => {
    const request = vi.fn(async () =>
      Response.json({
        revision: {
          actorId: 'actor-1',
          createdAt: flow.updatedAt,
          digest: 'digest-2',
          flowId: flow.flowId,
          modelVersion: 1,
          parentRevisionId: flow.draftRevisionId,
          revisionId: 'revision-2',
          version: 1,
        },
        version: 1,
      }),
    )
    const client = new ControlClient(request)
    const operations = [
      {
        kind: 'graph.node.create' as const,
        node: { concurrency: 1, inputs: {}, kind: 'value' as const, values: [] },
        nodeId: 'value',
        target: { kind: 'flow' as const },
      },
    ]

    await client.changeDraft(flow.flowId, flow.draftRevisionId, operations)

    expect(request).toHaveBeenCalledWith(
      '/v1/flows/flow%2F1/draft/changes',
      expect.objectContaining({ body: JSON.stringify({ expectedRevisionId: 'revision-1', operations, version: 1 }), method: 'POST' }),
    )
  })

  it('scopes Connector resources to an encoded Flow identity', async () => {
    const request = vi.fn(async (path: string, _init?: RequestInit) => {
      if (path == '/v1/connector/providers?flowId=flow%2F1') {
        return Response.json({ providers: [{ serviceId: 'mail', serviceName: 'Mail' }], version: 1 })
      }
      if (path == '/v1/connector/connections/mail/page?flowId=flow%2F1') return Response.json({ url: 'https://connector.example/providers/mail', version: 1 })
      throw new Error(path)
    })
    const client = new ControlClient(request)

    await expect(client.listConnectorProviders(undefined, flow.flowId)).resolves.toEqual([{ serviceId: 'mail', serviceName: 'Mail' }])
    await expect(client.createConnectorConnectionPage('mail', flow.flowId)).resolves.toBe('https://connector.example/providers/mail')
  })

  it('preserves structured Diagnostic values', async () => {
    const checked = {
      closureDigest: 'closure-1',
      diagnostics: [
        {
          code: 'graph.target-missing',
          column: 0,
          line: 1,
          message: 'Task "missing" does not exist.',
          path: '/document/graph/nodes/task/taskId',
          values: { taskId: 'missing', variant: 'task' },
        },
      ],
      engineContract: 'open-flow-engine/v1',
      flowId: flow.flowId,
      modelVersion: 1,
      revisionDigest: 'revision-digest-1',
      revisionId: flow.draftRevisionId,
      valid: false,
      version: 1,
    } as const
    const client = new ControlClient(async () => Response.json(checked))

    await expect(client.checkFlow(flow.flowId, flow.draftRevisionId)).resolves.toEqual(checked)

    const invalid = new ControlClient(async () =>
      Response.json({ ...checked, diagnostics: [{ ...checked.diagnostics[0], values: { taskId: true, variant: 'task' } }] }),
    )
    await expect(invalid.checkFlow(flow.flowId, flow.draftRevisionId)).rejects.toMatchObject({ code: 'response.invalid', status: 502 })
  })
})

describe('ControlClient Publish API', () => {
  const pending = {
    createdAt: '2026-08-31T00:00:00.000Z',
    flowId: flow.flowId,
    operationId: 'publish-1',
    revisionId: flow.draftRevisionId,
    status: 'pending',
    updatedAt: '2026-08-31T00:00:00.000Z',
    version: 1,
  } as const

  it('starts and reads one Publish operation', async () => {
    const succeeded = { ...pending, publicationId: 'publication-1', status: 'succeeded', updatedAt: '2026-08-31T00:00:01.000Z' } as const
    const request = vi.fn(async (path: string, _init?: RequestInit) => {
      if (path.endsWith('/publications')) return Response.json(pending, { status: 202 })
      if (path.endsWith('/publish-operations/publish-1')) return Response.json(succeeded)
      throw new Error(path)
    })
    const client = new ControlClient(request)

    await expect(client.publishFlow(flow.flowId, flow.draftRevisionId, null, { idempotencyKey: 'publish-key' })).resolves.toEqual(pending)
    await expect(client.getPublishOperation(flow.flowId, pending.operationId)).resolves.toEqual(succeeded)
    expect(request).toHaveBeenNthCalledWith(
      1,
      '/v1/flows/flow%2F1/revisions/revision-1/publications',
      expect.objectContaining({
        body: JSON.stringify({ engineContract: 'open-flow-engine/v1', expectedLivePublicationId: null, version: 1 }),
        method: 'POST',
      }),
    )
    expect(new Headers(request.mock.calls[0]![1]?.headers).get('idempotency-key')).toBe('publish-key')
    expect(request).toHaveBeenNthCalledWith(2, '/v1/flows/flow%2F1/publish-operations/publish-1', expect.anything())
  })

  it.each([
    ['an extra pending field', { ...pending, extra: true }],
    ['a succeeded result without a Publication', { ...pending, status: 'succeeded' }],
    ['a failed result with an unsafe issue shape', { ...pending, issue: { code: 'provider.failed', message: 'Failed.', response: {} }, status: 'failed' }],
  ])('rejects %s', async (_name, response) => {
    const client = new ControlClient(async () => Response.json(response))
    await expect(client.getPublishOperation(flow.flowId, pending.operationId)).rejects.toMatchObject({ code: 'response.invalid', status: 502 })
  })
})

describe('ControlClient Variable API', () => {
  const variable = {
    name: 'TOKEN',
    updatedAt: '2026-08-27T00:00:00.000Z',
    value: '',
    version: 1,
  } as const

  it('lists, reads, writes, and deletes Variables with encoded names', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path == '/v1/variables') return Response.json({ variables: [variable], version: 1 })
      if (path == '/v1/variables/Token%2FName' && init?.method == null) return Response.json(variable)
      if (path == '/v1/variables/Token%2FName' && init?.method == 'PUT') return Response.json({ ...variable, value: 'next' })
      if (path == '/v1/variables/Token%2FName' && init?.method == 'DELETE') return Response.json({ version: 1 })
      throw new Error(path)
    })
    const client = new ControlClient(request)

    await expect(client.listVariables()).resolves.toEqual({ variables: [variable], version: 1 })
    await expect(client.getVariable('Token/Name')).resolves.toEqual(variable)
    await expect(client.putVariable('Token/Name', 'next')).resolves.toEqual({ ...variable, value: 'next' })
    await expect(client.deleteVariable('Token/Name')).resolves.toBeUndefined()
    expect(request).toHaveBeenNthCalledWith(
      3,
      '/v1/variables/Token%2FName',
      expect.objectContaining({ body: JSON.stringify({ value: 'next' }), method: 'PUT' }),
    )
  })

  it.each([
    ['extra field', { ...variable, extra: true }],
    ['missing field', { name: variable.name, updatedAt: variable.updatedAt, version: 1 }],
    ['invalid timestamp', { ...variable, updatedAt: 'today' }],
    ['invalid value', { ...variable, value: null }],
    ['invalid version', { ...variable, version: 2 }],
  ])('rejects a Variable response with an %s', async (_name, response) => {
    const client = new ControlClient(async () => Response.json(response))
    await expect(client.getVariable('TOKEN')).rejects.toMatchObject({ code: 'response.invalid', status: 502 })
  })

  it('rejects malformed Variable list and delete responses', async () => {
    const responses = [Response.json({ variables: {}, version: 1 }), Response.json({ version: 1, extra: true })]
    const client = new ControlClient(async () => responses.shift()!)

    await expect(client.listVariables()).rejects.toMatchObject({ code: 'response.invalid', status: 502 })
    await expect(client.deleteVariable('TOKEN')).rejects.toMatchObject({ code: 'response.invalid', status: 502 })
  })
})
