import { once } from 'node:events'
import { createServer, request } from 'node:http'
import { createServer as createViteServer } from 'vite'
import { afterEach, expect, it, vi } from 'vitest'
import { developmentBackendAgent } from '../scripts/dev.ts'

afterEach(() => vi.restoreAllMocks())

it('waits for a restarting backend and forwards the complete request exactly once', async () => {
  const received: string[] = []
  const backend = createServer(async (incoming, response) => {
    let body = ''
    for await (const chunk of incoming) body += chunk
    received.push(body)
    response.writeHead(503).end('application error')
  })
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const address = backend.address()
  if (address == null || typeof address == 'string') throw new Error('Expected TCP address.')
  await new Promise<void>((resolve) => backend.close(() => resolve()))

  const agent = developmentBackendAgent()
  const proxy = await createViteServer({
    configFile: false,
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
    server: { host: '127.0.0.1', port: 0, proxy: { '/v1': { target: `http://127.0.0.1:${address.port}`, agent } } },
  })
  await proxy.listen()
  const proxyAddress = proxy.httpServer?.address()
  if (proxyAddress == null || typeof proxyAddress == 'string') throw new Error('Expected TCP address.')
  const pending = request({ host: '127.0.0.1', port: proxyAddress.port, path: '/v1/flows', method: 'POST' })
  const response = once(pending, 'response')
  pending.end('draft contents')
  try {
    // Keep the port closed long enough for the initial connection to be refused.
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(received).toEqual([])
    backend.listen(address.port, '127.0.0.1')
    const [incoming] = await response
    let body = ''
    for await (const chunk of incoming) body += chunk
    expect(incoming.statusCode).toBe(503)
    expect(body).toBe('application error')
    expect(received).toEqual(['draft contents'])
  } finally {
    pending.destroy()
    await proxy.close()
    agent.destroy()
    backend.closeAllConnections()
    await new Promise<void>((resolve) => backend.close(() => resolve()))
  }
})

it('does not replay a request when the backend disconnects after receiving it', async () => {
  let received = 0
  const backend = createServer((incoming) => {
    received++
    incoming.socket.destroy()
  })
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const address = backend.address()
  if (address == null || typeof address == 'string') throw new Error('Expected TCP address.')
  const agent = developmentBackendAgent()
  const pending = request({ host: '127.0.0.1', port: address.port, method: 'POST', agent })
  const error = once(pending, 'error')
  pending.end('draft contents')
  try {
    expect((await error)[0]).toMatchObject({ code: 'ECONNRESET' })
    expect(received).toBe(1)
  } finally {
    pending.destroy()
    agent.destroy()
    await new Promise<void>((resolve) => backend.close(() => resolve()))
  }
})

it('reports connection refusal when the backend does not recover within the deadline', async () => {
  const backend = createServer()
  backend.listen(0, '127.0.0.1')
  await once(backend, 'listening')
  const address = backend.address()
  if (address == null || typeof address == 'string') throw new Error('Expected TCP address.')
  await new Promise<void>((resolve) => backend.close(() => resolve()))

  const agent = developmentBackendAgent()
  vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(10_001)
  const pending = request({ host: '127.0.0.1', port: address.port, agent })
  const error = once(pending, 'error')
  pending.end()
  try {
    expect((await error)[0]).toMatchObject({ code: 'ECONNREFUSED' })
  } finally {
    pending.destroy()
    agent.destroy()
  }
})
