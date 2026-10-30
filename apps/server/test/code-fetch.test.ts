import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { AddressInfo } from 'node:net'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { prepareFlow } from '@oomol-lab/open-flow/flow-semantics'
import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CodeFetchDeniedError, executeCodeFetch } from '../node/deployment/code-fetch.ts'
import { acceptRun } from './runFixture.ts'
import { closeOpenServices, closeService, openService, startService } from './serviceFixture.ts'

const server = createServer(async (request, response) => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  const url = new URL(request.url!, 'http://127.0.0.1')
  if (url.pathname == '/echo') {
    response.setHeader('content-type', 'application/octet-stream')
    response.setHeader('set-cookie', 'session=secret')
    response.end(Buffer.concat([Buffer.from(`${request.method} ${request.headers['x-trace']} `), ...chunks]))
  } else if (url.pathname == '/redirect') {
    response.writeHead(302, { location: '/echo' }).end()
  } else if (url.pathname == '/large') {
    response.end(Buffer.alloc(1024 * 1024 + 1))
  } else response.writeHead(404).end('missing')
})
let origin: string
const directories: string[] = []
const signal = () => AbortSignal.timeout(5000)
const reset = async () => {
  throw new TypeError('connection reset')
}
const payload = (route: string, extra: Record<string, unknown> = {}) => ({ url: `${origin}${route}`, method: 'GET', headers: [], ...extra })

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))
afterEach(async () => {
  await closeOpenServices()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe('Code fetch transport', () => {
  it('sends bytes to a declared host and returns the buffered response without cookies', async () => {
    const result = await executeCodeFetch(
      ['127.0.0.1'],
      payload('/echo', { method: 'POST', headers: [['x-trace', '7']], body: Buffer.from([0, 255, 1]).toString('base64') }),
      signal(),
    )
    expect(result).toMatchObject({ status: 200, url: `${origin}/echo` })
    expect(Buffer.from(result.body as string, 'base64')).toEqual(Buffer.concat([Buffer.from('POST 7 '), Buffer.from([0, 255, 1])]))
    expect((result.headers as [string, string][]).map(([name]) => name)).not.toContain('set-cookie')
  })

  it('accepts HEAD responses that declare a length above the body limit', async () => {
    const response = new Response(null, { headers: { 'content-length': String(4 * 1024 * 1024) } })
    await expect(executeCodeFetch(['127.0.0.1'], payload('/echo', { method: 'HEAD' }), signal(), async () => response)).resolves.toMatchObject({
      status: 200,
      body: '',
    })
  })

  it('retries failed requests only for idempotent methods', async () => {
    await expect(executeCodeFetch(['127.0.0.1'], payload('/echo'), signal(), reset)).rejects.toMatchObject({ code: 'http.http-failed', retryable: true })
    await expect(executeCodeFetch(['127.0.0.1'], payload('/echo', { method: 'POST' }), signal(), reset)).rejects.toMatchObject({
      code: 'http.http-failed',
      retryable: false,
    })
  })

  it('returns redirects instead of following them', async () => {
    const result = await executeCodeFetch(['127.0.0.1'], payload('/redirect'), signal())
    expect(result.status).toBe(302)
    expect(result.headers).toContainEqual(['location', '/echo'])
  })

  it('denies undeclared hosts and rejects reserved headers and oversized bodies', async () => {
    await expect(executeCodeFetch(['*.example.com'], payload('/echo'), signal())).rejects.toBeInstanceOf(CodeFetchDeniedError)
    await expect(executeCodeFetch(['127.0.0.1'], payload('/echo', { headers: [['Host', 'evil.test']] }), signal())).rejects.toMatchObject({
      code: 'http.input-invalid',
    })
    await expect(
      executeCodeFetch(['127.0.0.1'], payload('/echo', { method: 'POST', body: Buffer.alloc(1024 * 1024 + 1).toString('base64') }), signal()),
    ).rejects.toMatchObject({ code: 'http.limit-exceeded' })
    await expect(executeCodeFetch(['127.0.0.1'], payload('/large'), signal())).rejects.toMatchObject({ code: 'http.limit-exceeded' })
  })
})

function fetchFlow(hosts: readonly string[] | undefined, route: string): RevisionContent {
  return {
    document: {
      bindings: {},
      graph: {
        edges: [],
        nodes: {
          call: {
            inputs: {},
            kind: 'task',
            task: {
              ...(hosts == null ? {} : { capabilities: [{ kind: 'http' as const, hosts }] }),
              inputs: [],
              moduleId: 'call',
              name: 'Call',
              outputs: [{ jsonSchema: {}, nullable: false, handle: 'result' }],
            },
          },
        },
      },
    },
    modelVersion: currentFlowModelVersion,
    modules: {
      call: {
        imports: [],
        name: 'Call',
        source: `export default async (_inputs, context) => {
  const response = await context.fetch('${origin}${route}', { method: 'PUT', headers: { 'x-trace': 'run' }, body: 'hello' })
  return { result: { status: response.status, text: await response.text(), type: response.headers.get('content-type') } }
}`,
      },
    },
  }
}

describe('Code fetch in a Run', () => {
  it('calls a declared host from Code and fails closed without the declaration', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-code-fetch-'))
    directories.push(directory)
    const service = await openService(path.join(directory, 'open-flow.sqlite'))
    await startService(service)
    const runs = []
    for (const [index, hosts] of [['127.0.0.1'], undefined, ['example.com']].entries()) {
      const accepted = await acceptRun(service, {
        flowId: 'main',
        idempotencyKey: `fetch-${index}`,
        revision: fetchFlow(hosts, '/echo'),
        revisionId: `fetch-${index}`,
      })
      if (accepted.kind != 'accepted') throw new Error('Run was not accepted.')
      runs.push(accepted.runId)
    }
    await service.waitForIdle()
    expect(service.control.runs.getRunResult('test', runs[0]!)).toMatchObject({
      status: 'completed',
      result: { nodes: [{ nodeId: 'call', outputs: { result: { status: 200, text: 'PUT run hello', type: 'application/octet-stream' } } }] },
    })
    expect(service.control.runs.getRunResult('test', runs[1]!)).toMatchObject({
      status: 'failed',
      error: { code: 'capability.denied', message: 'HTTP access is not declared for this Code node.' },
    })
    expect(service.control.runs.getRunResult('test', runs[2]!)).toMatchObject({
      status: 'failed',
      error: { code: 'capability.denied', message: 'The host "127.0.0.1" is not declared for this Code node.' },
    })
    await closeService(service)
  })

  it('requires Engine v9 for Code HTTP access', async () => {
    await expect(prepareFlow(fetchFlow(['127.0.0.1'], '/echo'), 'open-flow-engine/v8/nodejs-compat-v1')).resolves.toEqual({ kind: 'engine-unsupported' })
  })
})
