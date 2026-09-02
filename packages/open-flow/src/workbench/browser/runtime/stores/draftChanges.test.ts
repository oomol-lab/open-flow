import type { Draft } from '../api.ts'

import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { createI18n } from '../i18n.ts'
import { DraftChanges } from './draftChanges.ts'

const target = { kind: 'flow' } as const

function draft(revisionId: string, name?: string, description?: string): Draft {
  return {
    actorId: 'actor',
    content: {
      document: {
        bindings: {},
        graph: {
          nodes: {
            task: {
              concurrency: 1,
              description,
              inputs: {},
              kind: 'task',
              name,
              task: { inputs: [], moduleId: 'module', name: 'Task', outputs: [] },
            },
          },
        },
        subflows: {},
        tasks: {},
      },
      modelVersion: 1,
      modules: { module: { imports: [], name: 'Task', source: 'export default () => ({})' } },
    },
    createdAt: '2026-09-02T00:00:00.000Z',
    digest: `digest-${revisionId}`,
    flowId: 'flow',
    modelVersion: 1,
    parentRevisionId: null,
    revisionId,
    version: 1,
  }
}

function conflict(): Response {
  return Response.json({ error: { code: 'flow.revision-conflict', message: 'The Draft changed.' }, version: 1 }, { status: 412 })
}

describe('DraftChanges', () => {
  it('coalesces an unstarted continuous field edit', async () => {
    const request = vi.fn(async (_path: string, _init?: RequestInit) =>
      Response.json({
        revision: {
          actorId: 'actor',
          createdAt: '2026-09-02T00:00:01.000Z',
          digest: 'digest-revision-2',
          flowId: 'flow',
          modelVersion: 1,
          parentRevisionId: 'revision-1',
          revisionId: 'revision-2',
          version: 1,
        },
        version: 1,
      }),
    )
    let applied = draft('revision-1')
    const changes = new DraftChanges(new WorkbenchClient(request), vi.fn(), createI18n('en'), {
      apply: (value) => {
        applied = value
      },
      beforeChange: () => {},
      check: () => {},
      current: () => true,
      diagnostics: () => undefined,
      finishChanges: () => {},
      headChanged: () => {},
      recover: async () => false,
    })
    changes.reset(applied)
    const context = { current: () => true, flowId: 'flow' }

    const first = changes.change(context, applied, [{ before: undefined, field: 'name', kind: 'graph.node.field.set', nodeId: 'task', target, value: 'L' }])
    const second = changes.change(context, applied, [{ before: 'L', field: 'name', kind: 'graph.node.field.set', nodeId: 'task', target, value: 'Local' }])
    await Promise.all([first, second])

    expect(applied.content.document.graph.nodes.task).toMatchObject({ name: 'Local' })
    expect(request).toHaveBeenCalledOnce()
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body))
    expect(body.operations).toEqual([{ field: 'name', kind: 'graph.node.field.set', nodeId: 'task', target, value: 'Local' }])
  })

  it('rebases an independent pending field onto the latest snapshot', async () => {
    const remote = draft('revision-2', undefined, 'Remote')
    const request = vi.fn(async (_path: string, _init?: RequestInit) => {
      if (request.mock.calls.length == 1) return conflict()
      return Response.json({
        revision: {
          actorId: 'actor',
          createdAt: remote.createdAt,
          digest: 'digest-revision-3',
          flowId: remote.flowId,
          modelVersion: 1,
          parentRevisionId: remote.revisionId,
          revisionId: 'revision-3',
          version: 1,
        },
        version: 1,
      })
    })
    let applied = draft('revision-1')
    let changes: DraftChanges
    changes = new DraftChanges(new WorkbenchClient(request), vi.fn(), createI18n('en'), {
      apply: (value) => {
        applied = value
      },
      beforeChange: () => {},
      check: () => {},
      current: () => true,
      diagnostics: () => undefined,
      finishChanges: () => {},
      headChanged: () => {},
      recover: async () => {
        applied = changes.replaceCommitted(remote)
        return true
      },
    })
    changes.reset(applied)

    await changes.change({ current: () => true, flowId: 'flow' }, applied, [
      { before: undefined, field: 'name', kind: 'graph.node.field.set', nodeId: 'task', target, value: 'Local' },
    ])

    expect(applied.content.document.graph.nodes.task).toMatchObject({ description: 'Remote', name: 'Local' })
    expect(request).toHaveBeenCalledTimes(2)
    const requests = request.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).expectedRevisionId)
    expect(requests).toEqual(['revision-1', 'revision-2'])
  })

  it('retries an uncertain request with the same change identity', async () => {
    const request = vi.fn(async (_path: string, _init?: RequestInit) => {
      if (request.mock.calls.length == 1) throw new Error('Response lost')
      return Response.json({
        revision: {
          actorId: 'actor',
          createdAt: '2026-09-02T00:00:01.000Z',
          digest: 'digest-revision-2',
          flowId: 'flow',
          modelVersion: 1,
          parentRevisionId: 'revision-1',
          revisionId: 'revision-2',
          version: 1,
        },
        version: 1,
      })
    })
    let applied = draft('revision-1')
    let changes: DraftChanges
    changes = new DraftChanges(new WorkbenchClient(request), vi.fn(), createI18n('en'), {
      apply: (value) => {
        applied = value
      },
      beforeChange: () => {},
      check: () => {},
      current: () => true,
      diagnostics: () => undefined,
      finishChanges: () => {},
      headChanged: () => {},
      recover: async () => {
        applied = changes.replaceCommitted(draft('revision-1'))
        return true
      },
    })
    changes.reset(applied)

    await changes.change({ current: () => true, flowId: 'flow' }, applied, [
      { before: undefined, field: 'name', kind: 'graph.node.field.set', nodeId: 'task', target, value: 'Local' },
    ])

    expect(request).toHaveBeenCalledTimes(2)
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('idempotency-key')).toBe(
      new Headers(request.mock.calls[1]?.[1]?.headers).get('idempotency-key'),
    )
  })

  it('uses a new change identity after an uncertain request rebases', async () => {
    const remote = draft('revision-2', undefined, 'Remote')
    const request = vi.fn(async (_path: string, _init?: RequestInit) => {
      if (request.mock.calls.length == 1) throw new Error('Request failed')
      return Response.json({
        revision: {
          actorId: 'actor',
          createdAt: '2026-09-02T00:00:02.000Z',
          digest: 'digest-revision-3',
          flowId: 'flow',
          modelVersion: 1,
          parentRevisionId: 'revision-2',
          revisionId: 'revision-3',
          version: 1,
        },
        version: 1,
      })
    })
    let applied = draft('revision-1')
    let changes: DraftChanges
    changes = new DraftChanges(new WorkbenchClient(request), vi.fn(), createI18n('en'), {
      apply: (value) => {
        applied = value
      },
      beforeChange: () => {},
      check: () => {},
      current: () => true,
      diagnostics: () => undefined,
      finishChanges: () => {},
      headChanged: () => {},
      recover: async () => {
        applied = changes.replaceCommitted(remote)
        return true
      },
    })
    changes.reset(applied)

    await changes.change({ current: () => true, flowId: 'flow' }, applied, [
      { before: undefined, field: 'name', kind: 'graph.node.field.set', nodeId: 'task', target, value: 'Local' },
    ])

    expect(applied.content.document.graph.nodes.task).toMatchObject({ description: 'Remote', name: 'Local' })
    expect(request).toHaveBeenCalledTimes(2)
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('idempotency-key')).not.toBe(
      new Headers(request.mock.calls[1]?.[1]?.headers).get('idempotency-key'),
    )
  })

  it('silently drops a pending field changed by the latest snapshot', async () => {
    const remote = draft('revision-2', 'Remote')
    const request = vi.fn(async () => conflict())
    let applied = draft('revision-1')
    let changes: DraftChanges
    changes = new DraftChanges(new WorkbenchClient(request), vi.fn(), createI18n('en'), {
      apply: (value) => {
        applied = value
      },
      beforeChange: () => {},
      check: () => {},
      current: () => true,
      diagnostics: () => undefined,
      finishChanges: () => {},
      headChanged: () => {},
      recover: async () => {
        applied = changes.replaceCommitted(remote)
        return true
      },
    })
    changes.reset(applied)

    await changes.change({ current: () => true, flowId: 'flow' }, applied, [
      { before: undefined, field: 'name', kind: 'graph.node.field.set', nodeId: 'task', target, value: 'Local' },
    ])

    expect(applied.content.document.graph.nodes.task).toMatchObject({ name: 'Remote' })
    expect(changes.pendingCount).toBe(0)
    expect(request).toHaveBeenCalledOnce()
  })
})
