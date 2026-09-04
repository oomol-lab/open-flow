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
  closureDigest: 'closure-1',
  engineContract: 'open-flow-engine/v1',
  engineDigest: 'engine-1',
  modelVersion: 1,
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
})
