import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
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

describe('RunStore', () => {
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
      if (path == '/v1/runs/run-1/events?after=0&limit=100') {
        return Response.json({ done: true, events: [], historyComplete: true, nextAfter: 0, runId: run.runId, version: 1 })
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
      if (path == '/v1/runs/run-1/events?after=0&limit=100') {
        return Response.json({ done: true, events: [], historyComplete: true, nextAfter: 0, runId: run.runId, version: 1 })
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
      if (path == '/v1/runs/run-1/events?after=0&limit=100') {
        return Response.json({ done: true, events: [], historyComplete: true, nextAfter: 0, runId: run.runId, version: 1 })
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

  it('removes a selected Run from a filtered list without closing its details', async () => {
    let filteredReads = 0
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows/flow-1/runs?limit=50') return Response.json({ flowId: 'flow-1', runs: [run], version: 1 })
      if (path == '/v1/flows/flow-1/runs?limit=50&status=completed') {
        filteredReads += 1
        return Response.json({ flowId: 'flow-1', runs: filteredReads == 1 ? [run] : [], version: 1 })
      }
      if (path == '/v1/runs/run-1') return Response.json(details)
      if (path == '/v1/runs/run-1/events?after=0&limit=100') {
        return Response.json({ done: true, events: [], historyComplete: true, nextAfter: 0, runId: run.runId, version: 1 })
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
      expect(store.$.run.value).toEqual(details)
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
