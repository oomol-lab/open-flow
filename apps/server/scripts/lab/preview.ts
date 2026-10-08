import type { Draft, Presentation } from '@oomol-lab/open-flow/preview'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LabSession } from './session.ts'

import { scenario } from './scenarios.ts'

export interface PreviewSnapshot {
  attemptId: string
  flowId: string
  name: string
  task: string
  draft: Draft
  presentation: Presentation
}

/** The browser gets snapshots only, never the operator token or a Control API proxy. */
export function servePreview(lab: LabSession, request: IncomingMessage, response: ServerResponse): boolean {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  if (!pathname.startsWith('/__lab/') && !pathname.startsWith('/v1/')) return false
  response.setHeader('Cache-Control', 'no-store')
  const address = request.socket.localAddress
  const expectedHost = `${address}:${request.socket.localPort}`
  if (request.headers.host !== expectedHost || (request.headers.origin != null && request.headers.origin !== `http://${expectedHost}`)) {
    response.writeHead(403).end()
    return true
  }
  if (pathname !== '/__lab/view') {
    response.writeHead(404).end()
    return true
  }
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    response.writeHead(405).end()
    return true
  }
  if (lab.resetting) {
    response.writeHead(503).end()
    return true
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Content-Type-Options': 'nosniff' })
  response.write('retry: 1000\n\n')
  let buffered = false
  response.on('drain', () => {
    buffered = false
  })
  const send = () => {
    if (buffered) {
      response.end()
      return
    }
    const snapshot: PreviewSnapshot = {
      attemptId: lab.attempt.id,
      flowId: lab.manifest.flowId,
      name: scenario(lab.scenarioId).name,
      task: scenario(lab.scenarioId).task,
      draft: lab.service.control.getDraft(lab.manifest.flowId),
      presentation: lab.service.control.getPresentation(lab.manifest.flowId),
    }
    // Disconnect slow consumers instead of accumulating snapshots in memory.
    buffered = !response.write(`data: ${JSON.stringify(snapshot)}\n\n`)
  }
  const unsubscribe = lab.service.subscribeFlow(lab.manifest.flowId, send)
  const shutdown = lab.shutdown.signal
  const close = () => response.end()
  shutdown.addEventListener('abort', close, { once: true })
  response.once('close', () => {
    unsubscribe()
    shutdown.removeEventListener('abort', close)
  })
  send()
  return true
}
