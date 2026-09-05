import type { FlowChangeEvent } from '@oomol-lab/open-flow/workbench'

import { afterEach, expect, it, vi } from 'vitest'
import { createBrowserHost } from '../browser/host.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('uses independent catalog and current Flow SSE connections', async () => {
  const requests: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      requests.push(String(input))
      return new Response(': connected\n\n', { status: 200 })
    }),
  )
  const host = createBrowserHost(
    () => {},
    () => {},
  )
  const stopCatalog = host.subscribeFlowCatalog(() => {})
  const stopFlow = host.subscribeFlow('flow/1', () => {})

  await vi.waitFor(() => expect(requests).toHaveLength(2))
  stopCatalog.stop()
  stopFlow.stop()
  expect(requests).toEqual(['/v1/flows/notifications', '/v1/flows/flow%2F1/notifications'])
})

it('reads flow invalidations from the same-origin SSE stream and stops cleanly', async () => {
  const event = { kind: 'run.created', flowId: 'main', runId: 'run-1', version: 1 } as const
  const fetcher = vi.fn(async () => new Response(`: connected\n\ndata: ${JSON.stringify(event)}\n\n`, { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  const opened = vi.fn()
  let stop: { readonly ready: Promise<void>; stop(): void } | undefined
  const received = new Promise<FlowChangeEvent>((resolve) => {
    stop = createBrowserHost(
      () => {},
      () => {},
    ).subscribeFlow('flow/1', (value) => {
      if (value == null) opened()
      else {
        stop?.stop()
        resolve(value)
      }
    })
  })

  await expect(received).resolves.toEqual(event)
  expect(opened).not.toHaveBeenCalled()
  expect(fetcher).toHaveBeenCalledWith('/v1/flows/flow%2F1/notifications', {
    credentials: 'same-origin',
    headers: { accept: 'text/event-stream' },
    signal: expect.any(AbortSignal),
  })
})

it('reconnects after an SSE stream ends and reads the next stream', async () => {
  vi.useFakeTimers()
  const event = { flowId: 'flow-1', kind: 'draft.changed', revisionId: 'revision-2', version: 1 } as const
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(': connected\n\n', { status: 200 }))
    .mockResolvedValueOnce(new Response(`: connected\n\ndata: ${JSON.stringify(event)}\n\n`, { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  const opened = vi.fn()
  let stop: { readonly ready: Promise<void>; stop(): void } | undefined
  const received = new Promise<FlowChangeEvent>((resolve) => {
    stop = createBrowserHost(
      () => {},
      () => {},
    ).subscribeFlow('flow-1', (value) => {
      if (value == null) opened()
      else {
        stop?.stop()
        resolve(value)
      }
    })
  })

  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(opened).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(999)
    expect(fetcher).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1)
    await expect(received).resolves.toEqual(event)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(opened).toHaveBeenCalledOnce()
  } finally {
    stop?.stop()
    vi.useRealTimers()
  }
})

it('retries a failed SSE request and reads the recovered stream', async () => {
  vi.useFakeTimers()
  const event = { flowId: 'flow-1', kind: 'draft.changed', revisionId: 'revision-2', version: 1 } as const
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error('Connection failed.'))
    .mockResolvedValueOnce(new Response(`: connected\n\ndata: ${JSON.stringify(event)}\n\n`, { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  let stop: { readonly ready: Promise<void>; stop(): void } | undefined
  const received = new Promise<FlowChangeEvent>((resolve) => {
    stop = createBrowserHost(
      () => {},
      () => {},
    ).subscribeFlow('flow-1', (value) => {
      if (value != null) {
        stop?.stop()
        resolve(value)
      }
    })
  })

  try {
    await vi.advanceTimersByTimeAsync(999)
    expect(fetcher).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)

    await expect(received).resolves.toEqual(event)
    expect(fetcher).toHaveBeenCalledTimes(2)
  } finally {
    stop?.stop()
    vi.useRealTimers()
  }
})

it('cancels an SSE reconnect while waiting after the stream ends', async () => {
  vi.useFakeTimers()
  const fetcher = vi.fn(async () => new Response(': connected\n\n', { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  const opened = vi.fn()
  const stop = createBrowserHost(
    () => {},
    () => {},
  ).subscribeFlow('flow-1', (value) => {
    if (value == null) opened()
  })

  try {
    await vi.advanceTimersByTimeAsync(0)
    expect(opened).not.toHaveBeenCalled()
    stop.stop()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetcher).toHaveBeenCalledOnce()
  } finally {
    stop.stop()
    vi.useRealTimers()
  }
})

it('reports an expired session instead of retrying an unauthorized SSE request', async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 401 }))
  vi.stubGlobal('fetch', fetcher)
  let expired!: () => void
  const sessionExpired = new Promise<void>((resolve) => {
    expired = resolve
  })

  createBrowserHost(() => {}, expired).subscribeFlow('flow-1', () => {})
  await sessionExpired
  expect(fetcher).toHaveBeenCalledOnce()
})

it('settles readiness without an invalidation on the first connection', async () => {
  const response = Promise.withResolvers<Response>()
  const changed = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response.promise),
  )
  const subscription = createBrowserHost(
    () => {},
    () => {},
  ).subscribeFlowCatalog(changed)
  const ready = vi.fn()
  void subscription.ready.then(ready)
  try {
    await Promise.resolve()
    expect(ready).not.toHaveBeenCalled()
    response.resolve(new Response(new ReadableStream(), { status: 200 }))
    await subscription.ready
    expect(ready).toHaveBeenCalledOnce()
    expect(changed).not.toHaveBeenCalled()
  } finally {
    subscription.stop()
  }
})

it('allows loading after the first connection fails and invalidates when it recovers', async () => {
  vi.useFakeTimers()
  const changed = vi.fn()
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(new Response(new ReadableStream())))
  const subscription = createBrowserHost(
    () => {},
    () => {},
  ).subscribeFlowCatalog(changed)
  try {
    await subscription.ready
    expect(changed).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(changed).toHaveBeenCalledExactlyOnceWith()
  } finally {
    subscription.stop()
    vi.useRealTimers()
  }
})

it('bounds the initial connection wait and reconciles when a delayed connection arrives', async () => {
  vi.useFakeTimers()
  const response = Promise.withResolvers<Response>()
  const changed = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response.promise),
  )
  const subscription = createBrowserHost(
    () => {},
    () => {},
  ).subscribeFlow('flow-1', changed)
  try {
    await vi.advanceTimersByTimeAsync(5_000)
    await subscription.ready
    expect(changed).not.toHaveBeenCalled()
    response.resolve(new Response(new ReadableStream()))
    await vi.advanceTimersByTimeAsync(0)
    expect(changed).toHaveBeenCalledExactlyOnceWith()
  } finally {
    subscription.stop()
    vi.useRealTimers()
  }
})

it('settles a cancelled initial subscription and ignores a late response', async () => {
  const response = Promise.withResolvers<Response>()
  const changed = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response.promise),
  )
  const subscription = createBrowserHost(
    () => {},
    () => {},
  ).subscribeFlow('flow-1', changed)
  subscription.stop()
  await subscription.ready
  response.resolve(new Response(`data: ${JSON.stringify({ flowId: 'flow-1', kind: 'draft.changed', revisionId: 'stale', version: 1 })}\n\n`))
  await Promise.resolve()
  await Promise.resolve()
  expect(changed).not.toHaveBeenCalled()
})
