import type { LookupAddress } from 'node:dns'
import type { AddressInfo } from 'node:net'

import { createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectorClient } from './connector.ts'

const resolved = vi.hoisted(() => new Map<string, readonly LookupAddress[] | Error>())

vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>()
  return {
    ...actual,
    lookup: (hostname: string, options: unknown, callback: (error: Error | null, addresses?: readonly LookupAddress[]) => void) => {
      const result = resolved.get(hostname)
      if (result === undefined) return actual.lookup(hostname, options as never, callback as never)
      queueMicrotask(() => (result instanceof Error ? callback(result) : callback(null, result)))
    },
  }
})

describe('Connector transit file download address checks', () => {
  let hits = 0
  let port = 0
  const server = createServer((_request, response) => {
    hits += 1
    response.end('internal secret')
  })

  beforeEach(async () => {
    hits = 0
    resolved.clear()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  const client = new ConnectorClient('https://connector.example', 'tok')

  it('rejects a public host name that resolves to a loopback address before connecting', async () => {
    resolved.set('files.rebind.example', [{ address: '127.0.0.1', family: 4 }])

    await expect(client.downloadTransitFile(`http://files.rebind.example:${port}/secret`, new AbortController().signal)).rejects.toMatchObject({
      code: 'connector.unavailable',
      retryable: false,
      message: 'Connector transit download URL resolved to a restricted address.',
    })
    expect(hits).toBe(0)
  })

  it('rejects when any resolved address is restricted', async () => {
    resolved.set('mixed.rebind.example', [
      { address: '93.184.215.14', family: 4 },
      { address: 'fd00::1', family: 6 },
    ])

    await expect(client.downloadTransitFile(`http://mixed.rebind.example:${port}/secret`, new AbortController().signal)).rejects.toMatchObject({
      message: 'Connector transit download URL resolved to a restricted address.',
    })
    expect(hits).toBe(0)
  })

  it('does not treat host names that merely start with IPv6 private prefixes as restricted', async () => {
    resolved.set('fdroid.example', new Error('ENOTFOUND'))

    await expect(client.downloadTransitFile('https://fdroid.example/file.apk', new AbortController().signal)).rejects.toMatchObject({
      message: 'Connector transit download host could not be resolved.',
    })
  })

  it('rejects restricted IPv6 literals', async () => {
    for (const url of ['http://[::1]/x', 'http://[fe80::1]/x', 'http://[::ffff:127.0.0.1]/x', 'http://[fc00::1]/x']) {
      await expect(client.downloadTransitFile(url, new AbortController().signal)).rejects.toMatchObject({
        message: 'Connector transit download URL targets a restricted host.',
      })
    }
  })
})
