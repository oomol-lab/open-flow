import type { ConnectorProxyResult } from '../src/connector/common/proxy.ts'
import type { JsonValue } from '../src/flow/common/change.ts'
import type { PollContext } from '../src/trigger/common/poll.ts'

import { describe, expect, it, vi } from 'vitest'
import { PermanentPollError, PollConnectionError, TransientPollError } from '../src/trigger/common/poll.ts'
import { linearIssueChanged as definition } from '../src/trigger/providers/linear/on-issue-changed.ts'

const teamId = '72b2a2dc-6f4f-4423-9d34-24b5bd10634a'
const start = '2026-09-11T00:00:00.000Z'
const now = new Date('2026-09-11T00:05:00.000Z')
const issue = {
  id: '2174add1-f7c8-44e3-bbf3-2d60b5ea8bc9',
  identifier: 'ENG-114',
  title: 'Ship changes',
  url: 'https://linear.app/team/issue/ENG-114',
  createdAt: '2026-09-11T00:01:00.000Z',
  updatedAt: '2026-09-11T00:02:00.000Z',
  state: { id: '539068e2-ae88-4d09-bd75-22eb4a59612f', name: 'Done', type: 'completed' },
}
function page(nodes: readonly unknown[] = [issue], hasNextPage = false, endCursor: string | null = null): ConnectorProxyResult {
  return { status: 200, data: { data: { team: { id: teamId, issues: { nodes, pageInfo: { hasNextPage, endCursor } } } } } }
}
function setup(result = page(), checkpoint: JsonValue = { startedAt: start, since: start }) {
  const execute = vi.fn(async () => result)
  const context: PollContext = { checkpoint, config: { teamId }, connector: { execute }, now }
  return { context, execute }
}

describe('Linear Issue Trigger', () => {
  it('validates Team access and establishes a baseline without fetching historical issues', async () => {
    const { context, execute } = setup({ status: 200, data: { data: { team: { id: teamId } } } }, null)
    expect(await definition.poll(context)).toEqual({ checkpoint: { startedAt: now.toISOString(), since: now.toISOString() }, events: [] })
    expect(execute).toHaveBeenCalledWith(
      {
        endpoint: '/graphql',
        method: 'POST',
        body: {
          query: expect.not.stringContaining('issues('),
          variables: { teamId },
        },
      },
      undefined,
    )
  })

  it('returns new and updated current states with stable per-Issue version identities', async () => {
    const changed = { ...issue, id: '539068e2-ae88-4d09-bd75-22eb4a59612f', createdAt: '2026-09-10T00:00:00.000Z' }
    const { context, execute } = setup(page([issue, changed]))
    const result = await definition.poll(context)
    expect(result.events).toEqual([issue, changed].map((value) => ({ dedupeKey: `${value.id}:${value.updatedAt}`, payload: { ...value, teamId } })))
    expect(result.checkpoint).toEqual({ startedAt: start, since: now.toISOString() })
    expect(await definition.poll(context)).toEqual(result)
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          variables: {
            teamId,
            after: null,
            filter: { updatedAt: { gte: start, lte: now.toISOString() } },
          },
        }),
      }),
      undefined,
    )
  })

  it('pins the time window across pages and resumes from saved progress after a failure', async () => {
    const { context, execute } = setup(page([issue], true, 'page-2'))
    const first = await definition.poll(context)
    expect(first.hasMore).toBe(true)
    expect(first.checkpoint).toEqual({ startedAt: start, since: start, until: now.toISOString(), after: 'page-2' })
    const resumed = { ...context, checkpoint: first.checkpoint, now: new Date('2026-09-11T00:10:00.000Z') }
    execute.mockRejectedValueOnce(new Error('offline'))
    await expect(definition.poll(resumed)).rejects.toThrow('offline')
    expect(resumed.checkpoint).toEqual(first.checkpoint)
    execute.mockResolvedValue(page([]))
    const last = await definition.poll(resumed)
    expect(last).toEqual({ checkpoint: { startedAt: start, since: now.toISOString() }, events: [], hasMore: false })
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          variables: {
            teamId,
            after: 'page-2',
            filter: { updatedAt: { gte: start, lte: now.toISOString() } },
          },
        }),
      }),
      undefined,
    )
  })

  it('overlaps completed windows without changing duplicate identities, even at equal timestamps', async () => {
    const value = { ...issue, updatedAt: '2026-09-11T00:05:00.000Z' }
    const { context, execute } = setup(page([value]))
    const first = await definition.poll(context)
    const second = await definition.poll({ ...context, checkpoint: first.checkpoint, now: new Date('2026-09-11T00:06:00.000Z') })
    expect(second.events).toEqual(first.events)
    expect(execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          variables: {
            teamId,
            after: null,
            filter: { updatedAt: { gte: '2026-09-11T00:04:00.000Z', lte: '2026-09-11T00:06:00.000Z' } },
          },
        }),
      }),
      undefined,
    )
    execute.mockResolvedValue(page([{ ...value, updatedAt: '2026-09-11T00:05:30.000Z' }]))
    const third = await definition.poll({ ...context, checkpoint: first.checkpoint, now: new Date('2026-09-11T00:06:00.000Z') })
    expect(third.events[0]!.dedupeKey).not.toEqual(first.events[0]!.dedupeKey)
  })

  it('filters by stable status IDs even after a status is renamed', async () => {
    const { context, execute } = setup(page([{ ...issue, state: { ...issue.state, name: 'Completed' } }]))
    await definition.poll({ ...context, config: { teamId, stateIds: ['539068e2-ae88-4d09-bd75-22eb4a59612f'] } })
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          variables: expect.objectContaining({
            filter: {
              updatedAt: { gte: start, lte: now.toISOString() },
              state: { id: { in: ['539068e2-ae88-4d09-bd75-22eb4a59612f'] } },
            },
          }),
        }),
      }),
      undefined,
    )
  })

  it.each([
    [401, {}, PollConnectionError],
    [403, {}, PollConnectionError],
    [429, {}, TransientPollError],
    [500, {}, TransientPollError],
    [400, { errors: [{ extensions: { code: 'RATELIMITED' } }] }, TransientPollError],
    [200, { data: { team: { id: teamId } }, errors: [{ extensions: { code: 'FORBIDDEN' } }] }, PollConnectionError],
    [200, { errors: [{ extensions: { code: 'BAD_USER_INPUT' } }] }, PermanentPollError],
    [200, { data: { team: null } }, PermanentPollError],
    [200, { errors: [{ message: 'temporary' }] }, TransientPollError],
  ] as const)('retains progress for HTTP %s and GraphQL errors %j', async (status, data, error) => {
    const { context } = setup({ status, data })
    const checkpoint = context.checkpoint
    await expect(definition.poll(context)).rejects.toBeInstanceOf(error)
    expect(context.checkpoint).toBe(checkpoint)
  })

  it.each([
    page([{ ...issue, updatedAt: 'not-a-date' }]),
    page([{ ...issue, state: null }]),
    page([{ ...issue, updatedAt: '2026-09-11T00:06:00.000Z' }]),
    page([{ ...issue, updatedAt: '2026-09-10T00:00:00.000Z' }]),
    page(Array.from({ length: 51 }, () => issue)),
    page([], true, 'page-2'),
    page([issue], true, null),
    { status: 200, data: { data: { team: { id: 'another-team' } } } },
    { status: 200, data: { data: { team: { id: teamId, issues: { nodes: [] } } } } },
  ])('rejects malformed responses without accepting partial progress', async (response) => {
    const { context } = setup(response)
    await expect(definition.poll(context)).rejects.toBeInstanceOf(TransientPollError)
  })

  it('rejects a repeated pagination cursor', async () => {
    const { context } = setup(page([issue], true, 'same'), { startedAt: start, since: start, until: now.toISOString(), after: 'same' })
    await expect(definition.poll(context)).rejects.toThrow('continuation cursor')
  })

  it.each<JsonValue>([{}, { startedAt: start, since: 'bad' }, { startedAt: start, since: start, after: 'lost-window' }])(
    'rejects corrupt checkpoints without reseeding: %j',
    async (checkpoint) => {
      const { context, execute } = setup(page(), checkpoint)
      await expect(definition.poll(context)).rejects.toBeInstanceOf(PermanentPollError)
      expect(execute).not.toHaveBeenCalled()
    },
  )

  it('loads every Team options page and preserves status identity, labels and colors', async () => {
    const { context, execute } = setup({
      status: 200,
      data: { data: { teams: { nodes: [{ id: teamId, name: 'Engineering', key: 'ENG' }], pageInfo: { hasNextPage: true, endCursor: 'next' } } } },
    })
    execute
      .mockResolvedValueOnce({
        status: 200,
        data: { data: { teams: { nodes: [{ id: teamId, name: 'Engineering', key: 'ENG' }], pageInfo: { hasNextPage: true, endCursor: 'next' } } } },
      })
      .mockResolvedValueOnce({ status: 200, data: { data: { teams: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } })
    expect(await definition.configOptions!({ ...context, field: 'teamId' })).toEqual([{ value: teamId, label: 'Engineering (ENG)' }])
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.objectContaining({ variables: { after: 'next' } }) }), undefined)
    execute.mockResolvedValue({
      status: 200,
      data: {
        data: {
          team: {
            id: teamId,
            states: { nodes: [{ ...issue.state, name: 'Completed', color: '#123abc', position: 1 }], pageInfo: { hasNextPage: false, endCursor: null } },
          },
        },
      },
    })
    expect(await definition.configOptions!({ ...context, field: 'stateIds' })).toEqual([{ value: issue.state.id, label: 'Completed', color: '#123abc' }])
  })

  it('does not return a truncated options list or accept invalid colors', async () => {
    const { context, execute } = setup({
      status: 200,
      data: { data: { teams: { nodes: [{ id: teamId, name: 'Team', key: 'T' }], pageInfo: { hasNextPage: true, endCursor: 'repeat' } } } },
    })
    await expect(definition.configOptions!({ ...context, field: 'teamId' })).rejects.toThrow('options cursor')
    execute.mockResolvedValue({
      status: 200,
      data: { data: { team: { id: teamId, states: { nodes: [{ ...issue.state, color: 'url(https://invalid.test)' }], pageInfo: { hasNextPage: false } } } } },
    })
    await expect(definition.configOptions!({ ...context, field: 'stateIds' })).rejects.toThrow('invalid configuration option')
  })

  it('propagates cancellation before and after external reads', async () => {
    const { context, execute } = setup()
    const controller = new AbortController()
    const canceled = { ...context, signal: controller.signal }
    execute.mockImplementation(async () => {
      controller.abort(new Error('canceled'))
      return page()
    })
    await expect(definition.poll(canceled)).rejects.toThrow('canceled')
    expect(execute).toHaveBeenCalledWith(expect.anything(), controller.signal)
    execute.mockClear()
    await expect(definition.poll(canceled)).rejects.toThrow('canceled')
    expect(execute).not.toHaveBeenCalled()
  })
})
