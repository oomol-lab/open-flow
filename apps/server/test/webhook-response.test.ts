import type { JsonValue, RevisionContent, WebhookOptions } from '@oomol-lab/open-flow/flow-change'
import type { RunRecord } from '../node/storage/run-view-store.ts'

import { serve } from '@hono/node-server'
import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForWebhookRun } from '../node/application/webhook-response.ts'
import { createServerApp } from '../node/transport/http.ts'
import { storeRevision } from './runFixture.ts'
import { openService, startService } from './serviceFixture.ts'

afterEach(() => vi.useRealTimers())

describe('HTTP Run completion observer', () => {
  it('reads after subscribing and cleans up synchronous completion', async () => {
    const unsubscribe = vi.fn()
    const run: RunRecord = { runId: 'run', status: 'completed', eventsTruncated: false, result: { outputs: {} } }
    await expect(
      waitForWebhookRun(
        () => run,
        (changed) => {
          changed()
          return unsubscribe
        },
        1000,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ kind: 'completed', result: run.result })
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it.each(['failed', 'canceled', 'indeterminate'] as const)('observes committed %s without exposing its error', async (status) => {
    await expect(
      waitForWebhookRun(
        () => ({ runId: 'run', status, eventsTruncated: false, result: { error: { message: 'private' } } }),
        () => vi.fn(),
        1000,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ kind: 'failed' })
  })

  it('distinguishes the Run execution deadline from ordinary failures', async () => {
    await expect(
      waitForWebhookRun(
        () => ({ runId: 'run', status: 'failed', eventsTruncated: false, result: { error: { code: 'run.timeout' } } }),
        () => vi.fn(),
        1000,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ kind: 'timeout' })
  })

  it('continues through waiting, resolves a terminal update, and removes timers and listeners', async () => {
    vi.useFakeTimers()
    let run: RunRecord = { runId: 'run', status: 'waiting', eventsTruncated: false }
    let changed: () => void = vi.fn()
    const unsubscribe = vi.fn()
    const controller = new AbortController()
    const pending = waitForWebhookRun(
      () => run,
      (listener) => {
        changed = listener
        return unsubscribe
      },
      1000,
      controller.signal,
    )
    run = { ...run, status: 'completed', result: { outputs: {} } }
    changed()
    await expect(pending).resolves.toEqual({ kind: 'completed', result: run.result })
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    controller.abort()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('expires only the HTTP wait and releases the observer', async () => {
    vi.useFakeTimers()
    const unsubscribe = vi.fn()
    const run: RunRecord = { runId: 'run', status: 'queued', eventsTruncated: false }
    const pending = waitForWebhookRun(
      () => run,
      () => unsubscribe,
      1000,
      new AbortController().signal,
    )
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toEqual({ kind: 'timeout' })
    expect(run.status).toBe('queued')
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([true, false])('cleans up an aborted request (already aborted: %s)', async (alreadyAborted) => {
    vi.useFakeTimers()
    const unsubscribe = vi.fn()
    const controller = new AbortController()
    if (alreadyAborted) controller.abort()
    const pending = waitForWebhookRun(
      () => ({ runId: 'run', status: 'running', eventsTruncated: false }),
      () => unsubscribe,
      1000,
      controller.signal,
    )
    controller.abort()
    await expect(pending).resolves.toEqual({ kind: 'aborted' })
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})

function revision(options: WebhookOptions, fail = false): RevisionContent {
  return {
    modelVersion: currentFlowModelVersion,
    modules: {
      echo: {
        name: 'Echo',
        imports: [],
        source: fail ? 'export default () => {throw new Error("private details")}' : 'export default ({body}) => ({value: body.value})',
      },
    },
    document: {
      bindings: {},
      graph: {
        nodes: {
          hook: { kind: 'webhook', name: 'Hook', method: 'POST', bodyFields: [{ handle: 'value', jsonSchema: {}, nullable: true }], options },
          echo: {
            kind: 'task',
            name: 'Echo',
            inputs: { body: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'hook', output: 'body' }] } },
            task: {
              name: 'Echo',
              moduleId: 'echo',
              inputs: [{ handle: 'body', jsonSchema: { type: 'object' }, nullable: false }],
              outputs: [{ handle: 'value', jsonSchema: {}, nullable: true }],
            },
          },
          outputs: {
            kind: 'outputs',
            name: 'Outputs',
            outputDefs: [{ handle: 'value', jsonSchema: {}, nullable: true }],
            outputMappings: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'echo', output: 'value' }] } },
          },
        },
        edges: [
          { source: 'hook', target: 'echo' },
          { source: 'echo', target: 'outputs' },
        ],
      },
    },
  }
}

async function fixture(
  value: JsonValue,
  options: WebhookOptions = { responseBody: { kind: 'workflow-outputs' } },
  start = true,
  fail = false,
  transform: (content: RevisionContent) => RevisionContent = (content) => content,
) {
  const service = await openService(':memory:')
  const stored = await storeRevision(service, transform(revision(options, fail)), 'response')
  await service.control.publishFlow('test', stored.flowId, stored.revisionId, 'open-flow-engine/v6', null, 'publish')
  await service.tickMaintenance()
  if (start) await startService(service)
  const url = service.control.getFlowTriggerBinding(stored.flowId, 'hook', 'http://server.local').endpointUrl!
  const app = createServerApp(service)
  const request = (extra: RequestInit = {}) =>
    app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }), ...extra })
  return { service, stored, app, url, request }
}

describe('published dynamic HTTP responses', () => {
  it('releases a disconnected TCP request and serves its keyed retry from the same Run', async () => {
    const f = await fixture('hello', undefined, false)
    const observe = vi.spyOn(f.service, 'waitForWebhookRun')
    const http = serve({ fetch: f.app.fetch, hostname: '127.0.0.1', port: 0, overrideGlobalObjects: false })
    try {
      await once(http, 'listening')
      const address = http.address()
      if (address == null || typeof address == 'string') throw new Error('HTTP listener is unavailable.')
      const url = `http://127.0.0.1:${address.port}${new URL(f.url).pathname}`
      const controller = new AbortController()
      const input = { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'tcp' }, body: JSON.stringify({ value: 'hello' }) }
      const pending = fetch(url, { ...input, signal: controller.signal })
      await vi.waitFor(() => expect(observe).toHaveBeenCalledOnce())
      controller.abort()
      await expect(pending).rejects.toThrow()
      await expect(observe.mock.results[0]!.value).resolves.toEqual({ kind: 'aborted' })
      const admitted = f.service.control.runs.listRuns(f.stored.flowId, 100, {}).page.runs
      expect(admitted).toHaveLength(1)
      expect(admitted[0]!.status).toBe('queued')
      await startService(f.service)
      const response = await fetch(url, input)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ value: 'hello' })
      expect(f.service.control.runs.listRuns(f.stored.flowId, 100, {}).page.runs.map((run) => run.runId)).toEqual([admitted[0]!.runId])
    } finally {
      if ('closeAllConnections' in http) http.closeAllConnections()
      await new Promise<void>((resolve, reject) => http.close((error) => (error == null ? resolve() : reject(error))))
    }
  })

  it.each<JsonValue>(['hello', '', { answer: 42 }, [1, null], 0, false, null])('returns selected business output %j', async (value) => {
    const f = await fixture(value, {
      responseBody: { kind: 'workflow-outputs', output: 'value' },
      responseData: 'inactive',
      responseHeaders: { 'X-Test': 'yes', 'Content-Type': 'text/html', 'Set-Cookie': 'bad' },
      allowedOrigins: ['https://client.example'],
      responseStatusCode: 201,
    })
    const response = await f.request({ headers: { origin: 'https://client.example' } })
    expect(response.status).toBe(201)
    expect(await response.text()).toBe(typeof value == 'string' ? value : JSON.stringify(value))
    expect(response.headers.get('content-type')).toBe(typeof value == 'string' ? 'text/plain;charset=UTF-8' : 'application/json')
    expect(response.headers.get('access-control-allow-origin')).toBe('https://client.example')
    expect(response.headers.get('x-test')).toBe('yes')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('shares one Run for concurrent keyed requests and replays the completed business result', async () => {
    const f = await fixture('hello')
    const init = { headers: { 'idempotency-key': 'same' } }
    const replies = await Promise.all([f.request(init), f.request(init)])
    for (const reply of replies) expect(await reply.json()).toEqual({ value: 'hello' })
    const runs = f.service.control.runs.listRuns(f.stored.flowId, 100, {}).page.runs
    expect(runs).toHaveLength(1)
    expect(runs[0]!.status).toBe('completed')
    expect(await (await f.request(init)).json()).toEqual({ value: 'hello' })
    expect((await f.request({ headers: init.headers, body: JSON.stringify({ value: 'changed' }) })).status).toBe(409)
  })

  it('returns an empty object when Outputs executes without fields', async () => {
    const f = await fixture(null, undefined, true, false, (content) => ({
      ...content,
      document: {
        ...content.document,
        graph: {
          ...content.document.graph,
          nodes: {
            ...content.document.graph.nodes,
            outputs: { kind: 'outputs', name: 'Outputs', outputDefs: [], outputMappings: {} },
          },
        },
      },
    }))
    const response = await f.request()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({})
  })

  it('returns a missing-output error when the successful execution skips Outputs', async () => {
    const f = await fixture('hello', undefined, true, false, (content) => ({
      ...content,
      document: {
        ...content.document,
        graph: {
          ...content.document.graph,
          nodes: {
            ...content.document.graph.nodes,
            gate: {
              kind: 'condition',
              name: 'Never select',
              inputs: {},
              matchMode: 'first',
              cases: [
                {
                  output: 'selected',
                  groups: [{ expressions: [{ left: { kind: 'value', value: false }, operator: '==', right: { kind: 'value', value: true } }] }],
                },
              ],
            },
          },
          edges: [
            { source: 'hook', target: 'echo' },
            { source: 'echo', target: 'gate' },
            { source: 'gate', sourceHandle: 'selected', target: 'outputs' },
          ],
        },
      },
    }))
    const response = await f.request()
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: { code: 'webhook.response-missing' } })
    expect(f.service.control.runs.listRuns(f.stored.flowId, 100, {}).page.runs[0]!.status).toBe('completed')
  })

  it('returns a sanitized failure with HTTP 500', async () => {
    const f = await fixture('hello', { responseBody: { kind: 'workflow-outputs' } }, true, true)
    const response = await f.request()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: { code: 'webhook.run-failed', message: 'The workflow did not complete successfully.' } })
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'; sandbox")
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
  })

  it('returns 504 while queued and allows a keyed retry to receive the same Run after execution', async () => {
    const f = await fixture('hello', { responseBody: { kind: 'workflow-outputs', timeoutMs: 1000 } }, false)
    const init = { headers: { 'idempotency-key': 'timeout' } }
    const response = await f.request(init)
    expect(response.status).toBe(504)
    const before = f.service.control.runs.listRuns(f.stored.flowId, 100, {}).page.runs
    expect(before).toHaveLength(1)
    expect(before[0]!.status).toBe('queued')
    await startService(f.service)
    expect(await (await f.request(init)).json()).toEqual({ value: 'hello' })
    expect(f.service.control.runs.listRuns(f.stored.flowId, 100, {}).page.runs.map((run) => run.runId)).toEqual([before[0]!.runId])
  })

  it('releases a waiting connection on shutdown without canceling the admitted Run', async () => {
    const f = await fixture('hello', undefined, false)
    const controller = new AbortController()
    const app = createServerApp(f.service, { shutdownSignal: controller.signal })
    const waiting = app.request(f.url, { method: 'POST', body: JSON.stringify({ value: 'hello' }) })
    await vi.waitFor(() => expect(f.service.control.runs.listRuns(f.stored.flowId, 100, {}).page.runs).toHaveLength(1))
    controller.abort()
    expect((await waiting).status).toBe(503)
    expect(f.service.control.runs.listRuns(f.stored.flowId, 100, {}).page.runs[0]!.status).toBe('queued')
  })

  it('pins response configuration to the accepted publication during a republish', async () => {
    const f = await fixture('hello', { responseBody: { kind: 'workflow-outputs', output: 'value' } }, false)
    const waiting = f.request()
    await vi.waitFor(() => expect(f.service.control.runs.listRuns(f.stored.flowId, 100, {}).page.runs).toHaveLength(1))
    const hook = f.service.control.getRevision(f.stored.flowId, f.stored.revisionId).content.document.graph.nodes.hook!
    const edited = await f.service.control.changeDraft('test', f.stored.flowId, f.stored.revisionId, [
      { kind: 'graph.node.replace', nodeId: 'hook', before: hook, node: { ...hook, options: { responseData: 'new publication' } } as typeof hook },
    ])
    const live = f.service.control.getLiveDetails(f.stored.flowId, 'http://server.local')
    await f.service.control.publishFlow(
      'test',
      f.stored.flowId,
      edited.revision.revisionId,
      'open-flow-engine/v6',
      live.publication!.publicationId,
      'republish',
    )
    await startService(f.service)
    expect(await (await waiting).text()).toBe('hello')
    await f.service.tickMaintenance()
    expect(await (await f.request()).text()).toBe('new publication')
  })
})
