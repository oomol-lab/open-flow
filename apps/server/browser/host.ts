import type { FlowCatalogEvent, FlowChangeEvent, WorkbenchHost, WorkbenchNotification } from '@oomol-lab/open-flow/workbench'

const reconnectBaseMs = 1_000
const reconnectMaxMs = 30_000

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

function follow<Event>(path: string, listener: (event?: Event) => void, decode: (value: unknown) => Event | undefined, sessionExpired: () => void): () => void {
  const cancellation = new AbortController()
  void readConnections(path, listener, decode, cancellation.signal, sessionExpired)
  return () => cancellation.abort()
}

async function readConnections<Event>(
  path: string,
  listener: (event?: Event) => void,
  decode: (value: unknown) => Event | undefined,
  signal: AbortSignal,
  sessionExpired: () => void,
): Promise<void> {
  let attempt = 0
  while (!signal.aborted) {
    try {
      const response = await fetch(path, { credentials: 'same-origin', headers: { accept: 'text/event-stream' }, signal })
      if (response.status == 401) {
        sessionExpired()
        return
      }
      if (!response.ok || response.body == null) throw new Error(`Notification request returned ${response.status}.`)
      attempt = 0
      listener()
      await readEvents(response.body, listener, decode, signal)
    } catch {
      if (signal.aborted) return
    }
    await reconnectDelay(signal, attempt)
    attempt++
  }
}

async function readEvents<Event>(
  body: ReadableStream<Uint8Array>,
  listener: (event: Event) => void,
  decode: (value: unknown) => Event | undefined,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  try {
    while (!signal.aborted) {
      const chunk = await reader.read()
      if (chunk.done) return
      buffered += decoder.decode(chunk.value, { stream: true })
      let boundary: number
      while ((boundary = buffered.indexOf('\n\n')) >= 0) {
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

async function reconnectDelay(signal: AbortSignal, attempt: number): Promise<void> {
  const delay = Math.min(reconnectBaseMs * 2 ** attempt, reconnectMaxMs)
  const jitter = delay * 0.5 * Math.random()
  const ms = Math.round(delay + jitter)
  await new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}
