import type { FlowCatalogEvent, FlowChangeEvent, WorkbenchHost, WorkbenchNotification } from '@oomol-lab/open-flow/workbench'

import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'

const reconnectDelayMs = 1_000
const initialConnectionTimeoutMs = 5_000

export function createBrowserHost(notify: (notification: WorkbenchNotification | undefined) => void, sessionExpired: () => void): WorkbenchHost {
  return {
    async openExternalPage(resolveUrl) {
      const tab = window.open('about:blank', '_blank')
      if (tab == null) return false
      tab.opener = null
      try {
        tab.location.href = await resolveUrl()
        return true
      } catch (error) {
        tab.close()
        throw error
      }
    },
    notify,
    request: async (input, init) => {
      const response = await fetch(input, { ...init, credentials: 'same-origin' })
      if (response.status == 401) sessionExpired()
      return response
    },
    subscribeFlow(flowId, listener) {
      return follow(`/v1/flows/${encodeURIComponent(flowId)}/notifications`, listener, decodeFlowEvent, sessionExpired)
    },
    subscribeFlowCatalog(listener) {
      return follow('/v1/flows/notifications', listener, decodeCatalogEvent, sessionExpired)
    },
  }
}

function follow<Event>(path: string, listener: (event?: Event) => void, decode: (value: unknown) => Event | undefined, sessionExpired: () => void) {
  const ready = Deferred.makeUnsafe<void>()
  let initial = true
  const finish = Effect.gen(function* () {
    initial = false
    yield* Deferred.succeed(ready, undefined)
  })
  const fiber = Effect.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.forkChild(Effect.sleep(initialConnectionTimeoutMs).pipe(Effect.andThen(finish)))
        while (true) {
          const reconnect = yield* Effect.tryPromise({
            try: async (signal) => {
              const response = await fetch(path, { credentials: 'same-origin', headers: { accept: 'text/event-stream' }, signal })
              signal.throwIfAborted()
              if (response.status == 401) {
                sessionExpired()
                return false
              }
              if (!response.ok || response.body == null) throw new Error(`Notification request returned ${response.status}.`)
              if (initial) Effect.runSync(finish)
              else listener()
              await readEvents(response.body, listener, decode, signal)
              return true
            },
            catch: (error) => error,
          }).pipe(Effect.catch(() => Effect.succeed(true)))
          yield* finish
          if (!reconnect) return
          yield* Effect.sleep(reconnectDelayMs)
        }
      }),
    ).pipe(Effect.ensuring(finish)),
  )
  return {
    ready: Effect.runPromise(Deferred.await(ready)),
    stop() {
      fiber.interruptUnsafe()
    },
  }
}

async function readEvents<Event>(
  body: ReadableStream<Uint8Array>,
  listener: (event: Event) => void,
  decode: (value: unknown) => Event | undefined,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  const decoder = new TextDecoder()
  let buffered = ''
  try {
    while (!signal.aborted) {
      const chunk = await reader.read()
      if (signal.aborted || chunk.done) return
      buffered += decoder.decode(chunk.value, { stream: true })
      let boundary: number
      while (!signal.aborted && (boundary = buffered.indexOf('\n\n')) >= 0) {
        const frame = buffered.slice(0, boundary)
        buffered = buffered.slice(boundary + 2)
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data.length == 0) continue
        const event = decode(JSON.parse(data) as unknown)
        if (event != null) listener(event)
      }
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function decodeCatalogEvent(value: unknown): FlowCatalogEvent | undefined {
  const event = value as Partial<FlowCatalogEvent>
  if (event.version == 1 && event.kind == 'flows.changed') return event as FlowCatalogEvent
}

function decodeFlowEvent(value: unknown): FlowChangeEvent | undefined {
  const event = value as Partial<FlowChangeEvent>
  if (event.version != 1 || typeof event.flowId != 'string') return
  if (event.kind == 'draft.changed' && typeof event.revisionId == 'string') return event as FlowChangeEvent
  if (event.kind == 'run.created' && typeof event.runId == 'string') return event as FlowChangeEvent
}
