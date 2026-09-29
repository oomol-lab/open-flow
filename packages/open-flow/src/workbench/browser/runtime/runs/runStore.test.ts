import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, WorkbenchClient } from '../api.ts'
import { RunStore } from './runStore.ts'

const timestamp = '2026-09-04T00:00:00.000Z'
const run = {
  createdAt: timestamp,
  finishedAt: timestamp,
  flowId: 'flow-1',
  revisionId: 'revision-1',
  runId: 'run-1',
  source: 'draft',
  status: 'completed',
  version: 1,
} as const
const details = {
  ...run,
  waits: [],
  closureDigest: 'closure-1',
  engineContract: 'open-flow-engine/v5',
  engineDigest: 'engine-1',
  modelVersion: currentFlowModelVersion,
  sharedAccessDigest: 'implicit:1',
  revisionDigest: 'digest-1',
} as const

const terminalEvent = { createdAt: timestamp, kind: 'run.completed', payload: { result: null }, sequence: 1 } as const

describe('RunStore', () => {
  it('backs off idle polling, caps the delay, and resets on events or status changes', async () => {
    vi.useFakeTimers()
    const client = new WorkbenchClient(vi.fn())
    let status: 'running' | 'waiting' = 'running'
    let sequence = 0
    let hasEvent = false
    vi.spyOn(client, 'getRun').mockImplementation(async () => ({ ...details, status }))
    const readEvents = vi.spyOn(client, 'getRunEvents').mockImplementation(async () => ({
      done: false,
      events: hasEvent ? [{ createdAt: timestamp, kind: 'run.started' as const, payload: { flowId: run.flowId, scopeId: 'scope' }, sequence: ++sequence }] : [],
      historyComplete: true,
      nextAfter: sequence,
      runId: run.runId,
      version: 1,
    }))
    const store = new RunStore(client, vi.fn())
    const advancePoll = async (delay: number) => {
      const count = readEvents.mock.calls.length
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(readEvents).toHaveBeenCalledTimes(count)
      await vi.advanceTimersByTimeAsync(1)
      expect(readEvents).toHaveBeenCalledTimes(count + 1)
    }
    try {
      store.follow({ ...run, status }, store.prepareStart())
      await vi.advanceTimersByTimeAsync(0)
      expect(readEvents).toHaveBeenCalledTimes(1)
      for (const delay of [1200, 2400, 4800, 9600, 10_000, 10_000]) await advancePoll(delay)
      hasEvent = true
      await advancePoll(10_000)
      hasEvent = false
      await advancePoll(1200)
      await advancePoll(1200)
      status = 'waiting'
      await advancePoll(2400)
      status = 'running'
      await advancePoll(60_000)
      await advancePoll(1200)
    } finally {
      store.dispose()
      vi.useRealTimers()
    }
  })

  it.each(['expired', 'unavailable'] as const)('handles %s event history without treating it as a terminal event', async (failure) => {
    const client = new WorkbenchClient(vi.fn())
    vi.spyOn(client, 'getRun').mockResolvedValue(details)
    const readEvents = vi
      .spyOn(client, 'getRunEvents')
      .mockRejectedValue(failure == 'expired' ? new ApiError(410, 'run.events-expired', 'Expired') : new Error('Offline'))
    vi.spyOn(client, 'getRunResult').mockResolvedValue({ finishedAt: timestamp, result: null, runId: run.runId, status: 'completed', version: 1 })
    const store = new RunStore(client, vi.fn())
    try {
      store.follow(run, store.prepareStart())
      if (failure == 'expired') {
        await vi.waitFor(() => expect(store.$.result.value?.status).toBe('completed'))
        expect(store.$.historyComplete.value).toBe(false)
        expect(store.$.observationFailed.value).toBe(false)
      } else {
        await vi.waitFor(() => expect(store.$.observationFailed.value).toBe(true))
        expect(store.$.result.value).toBeUndefined()
      }
      expect(store.$.events.value).toEqual([])
      expect(readEvents).toHaveBeenCalledTimes(1)
    } finally {
      store.dispose()
    }
  })

  it.each((['completed', 'failed', 'canceled', 'indeterminate'] as const).flatMap((status) => [200, 201].map((count) => ({ status, count }))))(
    'reads $count events through run.$status even when earlier pages report done',
    async ({ status, count }) => {
      const events = [
        ...Array.from({ length: count - 1 }, (_, index) => ({
          createdAt: timestamp,
          kind: 'node.completed',
          payload: { flowId: run.flowId, scopeId: 'scope', nodeId: 'node', executionId: `execution-${index}`, outputs: {} },
          sequence: index + 1,
        })),
        { ...terminalEvent, kind: `run.${status}`, sequence: count },
      ]
      const cursors: number[] = []
      const request = vi.fn(async (path: string) => {
        if (path == '/v1/runs/run-1') return Response.json({ ...details, status })
        if (path.startsWith('/v1/runs/run-1/events?')) {
          const after = Number(new URLSearchParams(path.split('?')[1]).get('after'))
          cursors.push(after)
          return Response.json({
            done: true,
            events: events.slice(after, after + 100),
            historyComplete: false,
            nextAfter: Math.min(after + 100, count),
            runId: run.runId,
            version: 1,
          })
        }
        if (path == '/v1/runs/run-1/result')
          return Response.json({
            finishedAt: timestamp,
            result: null,
            error: { code: 'run.failed', message: 'Execution ended.' },
            runId: run.runId,
            status,
            version: 1,
          })
        throw new Error(`Unexpected request: ${path}`)
      })
      const notice = vi.fn()
      const store = new RunStore(new WorkbenchClient(request), notice)
      try {
        store.follow({ ...run, status: 'running' }, store.prepareStart())
        await vi.waitFor(() => expect(store.$.events.value).toEqual(events))
        expect(cursors).toEqual(count == 200 ? [0, 100] : [0, 100, 200])
        expect(store.$.result.value?.status).toBe(status)
        expect(notice).not.toHaveBeenCalled()
        // Retrying at the terminal cursor must retain the already observed end marker.
        store.retryObservation()
        await vi.waitFor(() => expect(cursors).toEqual(count == 200 ? [0, 100, count] : [0, 100, 200, count]))
        expect(store.$.events.value).toEqual(events)
      } finally {
        store.dispose()
      }
    },
  )

  it('preserves terminal events when refreshing a stale Run fails and retries from the saved cursor', async () => {
    const client = new WorkbenchClient(vi.fn())
    vi.spyOn(client, 'getRun')
      .mockResolvedValueOnce({ ...details, status: 'running' })
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue(details)
    const readEvents = vi
      .spyOn(client, 'getRunEvents')
      .mockResolvedValueOnce({ done: true, events: [terminalEvent], historyComplete: true, nextAfter: 1, runId: run.runId, version: 1 })
      .mockResolvedValue({ done: true, events: [], historyComplete: true, nextAfter: 1, runId: run.runId, version: 1 })
    vi.spyOn(client, 'getRunResult').mockResolvedValue({ finishedAt: timestamp, result: null, runId: run.runId, status: 'completed', version: 1 })
    const store = new RunStore(client, vi.fn())
    try {
      store.follow({ ...run, status: 'running' }, store.prepareStart())
      await vi.waitFor(() => expect(store.$.observationFailed.value).toBe(true))
      expect(store.$.events.value).toEqual([terminalEvent])
      store.retryObservation()
      await vi.waitFor(() => expect(store.$.result.value?.status).toBe('completed'))
      expect(readEvents.mock.calls.map(([, options]) => options?.after)).toEqual([0, 1])
      expect(store.$.events.value).toEqual([terminalEvent])
      expect(store.$.observationFailed.value).toBe(false)
    } finally {
      store.dispose()
    }
  })

  it('refreshes a stale Run snapshot when the parallel event read observes completion', async () => {
    let runReads = 0
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/runs/run-1') return Response.json({ ...details, status: ++runReads == 1 ? 'running' : 'completed' })
      if (path == '/v1/runs/run-1/events?after=0&limit=100') {
        return Response.json({ done: true, events: [terminalEvent], historyComplete: true, nextAfter: 1, runId: run.runId, version: 1 })
      }
      if (path == '/v1/runs/run-1/result') return Response.json({ finishedAt: timestamp, result: null, runId: run.runId, status: 'completed', version: 1 })
      throw new Error(`Unexpected request: ${path}`)
    })
    const store = new RunStore(new WorkbenchClient(request), vi.fn())
    try {
      store.follow({ ...run, status: 'running' }, store.prepareStart())
      await vi.waitFor(() => expect(store.$.result.value?.status).toBe('completed'))
      expect(store.$.run.value?.status).toBe('completed')
      expect(store.$.events.value).toEqual([terminalEvent])
      expect(runReads).toBe(2)
    } finally {
      store.dispose()
    }
  })

  it('keeps the selected Run visible while a notification refreshes the loaded history', async () => {
    const refreshed = Promise.withResolvers<Response>()
    let listReads = 0
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows/flow-1/runs?limit=50') {
        listReads += 1
        if (listReads == 1) return Response.json({ flowId: 'flow-1', runs: [run], version: 1 })
        return await refreshed.promise
      }
      if (path == '/v1/runs/run-1') return Response.json(details)
      if (path.startsWith('/v1/runs/run-1/events?')) {
        const events = path.includes('after=0&') ? [terminalEvent] : []
        return Response.json({ done: true, events, historyComplete: true, nextAfter: 1, runId: run.runId, version: 1 })
      }
      if (path == '/v1/runs/run-1/result') {
        return Response.json({ finishedAt: timestamp, result: null, runId: run.runId, status: 'completed', version: 1 })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const store = new RunStore(new WorkbenchClient(request), vi.fn())

    try {
      await store.load('flow-1')
      await vi.waitFor(() => expect(store.$.run.value).toEqual(details))

      store.changed(run.runId)
      expect(store.$.loading.value).toBe(false)
      expect(store.$.refreshing.value).toBe(true)
      expect(store.$.runs.value).toEqual([details])

      const newer = { ...run, runId: 'run-2' }
      refreshed.resolve(Response.json({ flowId: 'flow-1', runs: [newer], version: 1 }))
      await vi.waitFor(() => expect(store.$.refreshing.value).toBe(false))

      expect(store.$.runs.value.map((item) => item.runId)).toEqual(['run-1', 'run-2'])
      expect(store.$.runs.value[0]).toBe(store.$.run.value)
      expect(store.$.run.value).toEqual(details)
    } finally {
      store.dispose()
    }
  })

  it('shows a newly started Run without waiting for an older history request', async () => {
    const listed = Promise.withResolvers<Response>()
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows/flow-1/runs?limit=50') return await listed.promise
      if (path == '/v1/runs/run-1') return Response.json(details)
      if (path.startsWith('/v1/runs/run-1/events?')) {
        const events = path.includes('after=0&') ? [terminalEvent] : []
        return Response.json({ done: true, events, historyComplete: true, nextAfter: 1, runId: run.runId, version: 1 })
      }
      if (path == '/v1/runs/run-1/result') {
        return Response.json({ finishedAt: timestamp, result: null, runId: run.runId, status: 'completed', version: 1 })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const store = new RunStore(new WorkbenchClient(request), vi.fn())

    try {
      const loading = store.load('flow-1')
      expect(store.$.loading.value).toBe(true)

      const current = store.prepareStart()
      expect(store.follow(run, current)).toBe(true)
      expect(store.$.loading.value).toBe(false)
      expect(store.$.run.value).toEqual(run)
      expect(store.$.runs.value).toEqual([run])

      listed.resolve(Response.json({ flowId: 'flow-1', runs: [], version: 1 }))
      await loading

      expect(store.$.run.value?.runId).toBe(run.runId)
      expect(store.$.runs.value.map((item) => item.runId)).toEqual([run.runId])
    } finally {
      store.dispose()
    }
  })

  it('allows pagination after a notification refresh replaces it and fails', async () => {
    const pendingPage = Promise.withResolvers<Response>()
    const next = { ...run, runId: 'run-2' }
    let listReads = 0
    let pageReads = 0
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows/flow-1/runs?limit=50') {
        listReads += 1
        if (listReads == 1) return Response.json({ flowId: 'flow-1', nextCursor: 'page-2', runs: [run], version: 1 })
        throw new Error('Refresh failed')
      }
      if (path == '/v1/flows/flow-1/runs?cursor=page-2&limit=50') {
        pageReads += 1
        if (pageReads == 1) return await pendingPage.promise
        return Response.json({ flowId: 'flow-1', runs: [next], version: 1 })
      }
      if (path == '/v1/runs/run-1') return Response.json(details)
      if (path.startsWith('/v1/runs/run-1/events?')) {
        const events = path.includes('after=0&') ? [terminalEvent] : []
        return Response.json({ done: true, events, historyComplete: true, nextAfter: 1, runId: run.runId, version: 1 })
      }
      if (path == '/v1/runs/run-1/result') {
        return Response.json({ finishedAt: timestamp, result: null, runId: run.runId, status: 'completed', version: 1 })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const store = new RunStore(new WorkbenchClient(request), vi.fn())

    try {
      await store.load('flow-1')

      const stalePage = store.loadMore()
      expect(store.$.loadingMore.value).toBe(true)

      store.changed('another-run')
      expect(store.$.refreshing.value).toBe(true)
      await vi.waitFor(() => expect(store.$.refreshing.value).toBe(false))
      expect(store.$.loadingMore.value).toBe(false)

      await store.loadMore()
      expect(pageReads).toBe(2)
      expect(store.$.runs.value.map((item) => item.runId)).toEqual(['run-1', 'run-2'])

      pendingPage.resolve(Response.json({ flowId: 'flow-1', runs: [], version: 1 }))
      await stalePage
      expect(store.$.runs.value.map((item) => item.runId)).toEqual(['run-1', 'run-2'])
    } finally {
      store.dispose()
    }
  })

  it('resets pagination, ignores stale filter responses, and preserves filters when loading more', async () => {
    const stale = Promise.withResolvers<Response>()
    const completed = { ...run, runId: 'run-completed' }
    const older = { ...run, runId: 'run-older' }
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows/flow-1/runs?limit=50') return Response.json({ flowId: 'flow-1', runs: [], version: 1 })
      if (path == '/v1/flows/flow-1/runs?limit=50&status=failed') return await stale.promise
      if (path == '/v1/flows/flow-1/runs?limit=50&status=completed') {
        return Response.json({ flowId: 'flow-1', nextCursor: 'completed-next', runs: [completed], version: 1 })
      }
      if (path == '/v1/flows/flow-1/runs?cursor=completed-next&limit=50&status=completed') {
        return Response.json({ flowId: 'flow-1', runs: [older], version: 1 })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const store = new RunStore(new WorkbenchClient(request), vi.fn())

    try {
      await store.load('flow-1')
      const failed = store.applyFilter({ status: 'failed' })
      await store.applyFilter({ status: 'completed' })
      stale.resolve(Response.json({ flowId: 'flow-1', runs: [run], version: 1 }))
      await failed

      expect(store.$.filter.value).toEqual({ status: 'completed' })
      expect(store.$.runs.value).toEqual([completed])
      expect(store.$.nextCursor.value).toBe('completed-next')

      await store.loadMore()
      expect(store.$.runs.value).toEqual([completed, older])
    } finally {
      store.dispose()
    }
  })

  it('clears details when a filtered refresh removes the selected Run', async () => {
    let filteredReads = 0
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows/flow-1/runs?limit=50') return Response.json({ flowId: 'flow-1', runs: [run], version: 1 })
      if (path == '/v1/flows/flow-1/runs?limit=50&status=completed') {
        filteredReads += 1
        return Response.json({ flowId: 'flow-1', runs: filteredReads == 1 ? [run] : [], version: 1 })
      }
      if (path == '/v1/runs/run-1') return Response.json(details)
      if (path.startsWith('/v1/runs/run-1/events?')) {
        const events = path.includes('after=0&') ? [terminalEvent] : []
        return Response.json({ done: true, events, historyComplete: true, nextAfter: 1, runId: run.runId, version: 1 })
      }
      if (path == '/v1/runs/run-1/result') {
        return Response.json({ finishedAt: timestamp, result: null, runId: run.runId, status: 'completed', version: 1 })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const store = new RunStore(new WorkbenchClient(request), vi.fn())

    try {
      await store.load('flow-1')
      await vi.waitFor(() => expect(store.$.run.value).toEqual(details))
      await store.applyFilter({ status: 'completed' })

      store.changed(run.runId)
      await vi.waitFor(() => expect(store.$.refreshing.value).toBe(false))

      expect(store.$.runs.value).toEqual([])
      expect(store.$.run.value).toBeUndefined()
      expect(store.$.result.value).toBeUndefined()
      expect(store.$.events.value).toEqual([])
      await store.applyFilter({})
      await vi.waitFor(() => expect(store.$.run.value).toEqual(details))
      await store.applyFilter({ status: 'completed' })
      expect(store.$.run.value).toBeUndefined()
    } finally {
      store.dispose()
    }
  })

  it('retries a failed filtered request with the same filter', async () => {
    let filteredReads = 0
    const failedRun = { ...run, status: 'failed' as const }
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows/flow-1/runs?limit=50') return Response.json({ flowId: 'flow-1', runs: [], version: 1 })
      if (path == '/v1/flows/flow-1/runs?limit=50&status=failed') {
        filteredReads += 1
        if (filteredReads == 1) throw new Error('Unavailable')
        return Response.json({ flowId: 'flow-1', runs: [failedRun], version: 1 })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const store = new RunStore(new WorkbenchClient(request), vi.fn())

    try {
      await store.load('flow-1')
      await store.applyFilter({ status: 'failed' })
      expect(store.$.loadFailed.value).toBe(true)

      await store.retryLoad()
      expect(store.$.loadFailed.value).toBe(false)
      expect(store.$.filter.value).toEqual({ status: 'failed' })
      expect(store.$.runs.value).toEqual([failedRun])
    } finally {
      store.dispose()
    }
  })
})

it('aborts both pending Run reads on reset and ignores their late responses', async () => {
  const signals: AbortSignal[] = []
  const pending = Promise.withResolvers<Response>()
  const notice = vi.fn()
  const request = vi.fn(async (_path: string, init?: RequestInit) => {
    if (init?.signal == null) throw new Error('Missing observation signal')
    signals.push(init.signal)
    return await pending.promise
  })
  const store = new RunStore(new WorkbenchClient(request), notice)
  try {
    store.follow(run, store.prepareStart())
    await vi.waitFor(() => expect(signals).toHaveLength(2))
    store.reset()
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    pending.resolve(Response.json(details))
    await Promise.resolve()
    await Promise.resolve()
    expect(store.$.run.value).toBeUndefined()
    expect(store.$.observationFailed.value).toBe(false)
    expect(request).toHaveBeenCalledTimes(2)
  } finally {
    store.dispose()
  }
})

it('loads the route source on first entry and overrides an earlier source while preserving other filters', async () => {
  const request = vi.fn(async (_path: string) => Response.json({ flowId: 'flow-1', runs: [], version: 1 }))
  const store = new RunStore(new WorkbenchClient(request), vi.fn())
  try {
    await store.load('flow-1', { source: 'live' })
    expect(request.mock.calls[0]?.[0]).toBe('/v1/flows/flow-1/runs?limit=50&source=live')
    expect(store.$.filter.value).toEqual({ source: 'live' })
    await store.applyFilter({ source: 'draft', status: 'failed' })
    await store.load('flow-1', { source: 'live' })
    expect(store.$.filter.value).toEqual({ source: 'live', status: 'failed' })
    expect(request.mock.calls.at(-1)?.[0]).toBe('/v1/flows/flow-1/runs?limit=50&status=failed&source=live')
    await store.load('flow-1', { source: undefined })
    expect(store.$.filter.value.source).toBeUndefined()
    expect(request.mock.calls.at(-1)?.[0]).toBe('/v1/flows/flow-1/runs?limit=50&status=failed')
  } finally {
    store.dispose()
  }
})
