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
