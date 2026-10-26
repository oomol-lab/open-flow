import type { JsonValue, RevisionContent, WebhookOptions } from '@oomol-lab/open-flow/flow-change'
import type { RunRecord } from '../node/storage/run-view-store.ts'

import { serve } from '@hono/node-server'
import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
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
  await service.control.publications.publishFlow('test', stored.flowId, stored.revisionId, currentEngineContract, null, 'publish')
  await service.tickMaintenance()
  if (start) await startService(service)
  const url = service.control.publications.getFlowTriggerBinding('test', stored.flowId, 'hook', 'http://server.local').endpointUrl!
  const app = createServerApp(service)
  const request = (extra: RequestInit = {}) =>
    app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }), ...extra })
  return { service, stored, app, url, request }
}

function headerRevision(schema: JsonValue): (content: RevisionContent) => RevisionContent {
  return (content) => {
    const echo = content.document.graph.nodes.echo!
    const outputs = content.document.graph.nodes.outputs!
    if (echo.kind !== 'task' || outputs.kind !== 'outputs') throw new Error('Expected header fixture')
    const ports = [{ handle: 'value', jsonSchema: schema, nullable: true }]
    return {
      ...content,
      document: {
        ...content.document,
        graph: {
          ...content.document.graph,
          nodes: { ...content.document.graph.nodes, echo: { ...echo, task: { ...echo.task, outputs: ports } }, outputs: { ...outputs, outputDefs: ports } },
        },
      },
    }
  }
}

describe('published HTTP responses', () => {
  it.each([undefined, 'application/json; charset=utf-8', 'text/custom'])(
    'preserves fixed response Content-Type %s with the existing text fallback',
    async (contentType) => {
      const body = '{"ok":true}'
      const f = await fixture(null, { responseData: body, responseHeaders: contentType == null ? {} : { 'Content-Type': contentType } }, false)
      const response = await f.request()
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe(contentType ?? 'text/plain;charset=UTF-8')
      expect(await response.text()).toBe(body)
      expect(f.service.control.runs.listRuns('test', f.stored.flowId, 100, {}).page.runs[0]?.status).toBe('queued')
    },
  )

  it.each([201, 400, 599, 199, 204, 205, 304, 600, 200.5, null])('returns a selected numeric status %s or a fixed error', async (value) => {
    const f = await fixture(
      value,
      { responseBody: { kind: 'workflow-outputs', output: 'value' }, responseStatusCode: 202, responseStatusCodeOutput: 'value' },
      true,
      false,
      (content) => {
        const echo = content.document.graph.nodes.echo!
        if (echo.kind !== 'task') throw new Error('Expected task fixture')
        return {
          ...content,
          document: {
            ...content.document,
            graph: {
              ...content.document.graph,
              nodes: {
                ...content.document.graph.nodes,
                echo: { ...echo, task: { ...echo.task, outputs: [{ handle: 'value', jsonSchema: { type: 'number' }, nullable: true }] } },
                outputs: {
                  kind: 'outputs',
                  name: 'Outputs',
                  outputDefs: [{ handle: 'value', jsonSchema: { type: 'number' }, nullable: true }],
                  outputMappings: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'echo', output: 'value' }] } },
                },
              },
            },
          },
        }
      },
    )
    const reply = await f.request()
    if (value === 201 || value === 400 || value === 599) {
      expect(reply.status).toBe(value)
      expect(await reply.json()).toBe(value)
    } else {
      expect(reply.status).toBe(500)
      expect(await reply.json()).toEqual({
        error: { code: 'webhook.response-status-invalid', message: 'The workflow response status code is unavailable or invalid.' },
      })
    }
  })
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
      const admitted = f.service.control.runs.listRuns('test', f.stored.flowId, 100, {}).page.runs
      expect(admitted).toHaveLength(1)
      expect(admitted[0]!.status).toBe('queued')
      await startService(f.service)
      const response = await fetch(url, input)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ value: 'hello' })
      expect(f.service.control.runs.listRuns('test', f.stored.flowId, 100, {}).page.runs.map((run) => run.runId)).toEqual([admitted[0]!.runId])
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

  it.each<JsonValue>(['hello', '', 0, false, null])('projects a published per-header source %j', async (value) => {
    const f = await fixture(
      value,
      {
        responseBody: { kind: 'workflow-outputs', output: 'value' },
        responseHeaders: { 'x-value': 'saved', 'X-Fixed': 'kept' },
        responseHeaderOutputs: { 'X-Value': 'value' },
      },
      true,
      false,
      headerRevision({ type: ['string', 'number', 'boolean'] }),
    )
    const response = await f.request()
    if (value == null) {
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({ error: { code: 'webhook.response-headers-invalid' } })
      expect(response.headers.get('x-value')).toBeNull()
    } else {
      expect(response.status).toBe(200)
      expect(response.headers.get('x-value')).toBe(String(value))
      expect(response.headers.get('x-fixed')).toBe('kept')
    }
  })

  it.each<JsonValue>([
    {},
    { 'X-Count': 3, 'X-Enabled': false, 'X-Label': 'text', 'Content-Type': 'text/html', 'Set-Cookie': 'bad', 'Access-Control-Allow-Origin': '*' },
    { 'bad name': 'text' },
    { 'X-Value': 'bad\r\nInjected: value' },
    { 'X-Count': 1, 'x-count': 2 },
    null,
  ])('projects a published whole header object %j with deployment policy', async (value) => {
    const f = await fixture(
      value,
      {
        responseBody: { kind: 'workflow-outputs', output: 'value' },
        responseHeadersSource: { kind: 'workflow-outputs', output: 'value' },
        responseHeaders: { 'X-Inactive': 'saved' },
        responseHeaderOutputs: { 'X-Inactive': 'missing' },
      },
      true,
      false,
      headerRevision({ type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } }),
    )
    const response = await f.request()
    expect(response.headers.get('x-inactive')).toBeNull()
    if (value == null || Object.keys(value as object).some((key) => key === 'bad name' || key === 'X-Value' || key === 'x-count')) {
      expect(response.status).toBe(500)
      expect(await response.json()).toMatchObject({ error: { code: 'webhook.response-headers-invalid' } })
    } else {
      expect(response.status).toBe(200)
      if ('X-Count' in (value as object)) {
        expect(response.headers.get('x-count')).toBe('3')
        expect(response.headers.get('x-enabled')).toBe('false')
        expect(response.headers.get('x-label')).toBe('text')
      }
      expect(response.headers.get('content-type')).toBe('application/json')
      expect(response.headers.get('set-cookie')).toBeNull()
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
  })

  it('shares one Run for concurrent keyed requests and replays the completed business result', async () => {
    const f = await fixture('hello')
    const init = { headers: { 'idempotency-key': 'same' } }
    const replies = await Promise.all([f.request(init), f.request(init)])
    for (const reply of replies) expect(await reply.json()).toEqual({ value: 'hello' })
    const runs = f.service.control.runs.listRuns('test', f.stored.flowId, 100, {}).page.runs
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
    expect(f.service.control.runs.listRuns('test', f.stored.flowId, 100, {}).page.runs[0]!.status).toBe('completed')
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
    const before = f.service.control.runs.listRuns('test', f.stored.flowId, 100, {}).page.runs
    expect(before).toHaveLength(1)
    expect(before[0]!.status).toBe('queued')
    await startService(f.service)
    expect(await (await f.request(init)).json()).toEqual({ value: 'hello' })
    expect(f.service.control.runs.listRuns('test', f.stored.flowId, 100, {}).page.runs.map((run) => run.runId)).toEqual([before[0]!.runId])
  })

  it('releases a waiting connection on shutdown without canceling the admitted Run', async () => {
    const f = await fixture('hello', undefined, false)
    const controller = new AbortController()
    const app = createServerApp(f.service, { shutdownSignal: controller.signal })
    const waiting = app.request(f.url, { method: 'POST', body: JSON.stringify({ value: 'hello' }) })
    await vi.waitFor(() => expect(f.service.control.runs.listRuns('test', f.stored.flowId, 100, {}).page.runs).toHaveLength(1))
    controller.abort()
    expect((await waiting).status).toBe(503)
    expect(f.service.control.runs.listRuns('test', f.stored.flowId, 100, {}).page.runs[0]!.status).toBe('queued')
  })

  it('pins response configuration to the accepted publication during a republish', async () => {
    const f = await fixture('hello', { responseBody: { kind: 'workflow-outputs', output: 'value' } }, false)
    const waiting = f.request()
    await vi.waitFor(() => expect(f.service.control.runs.listRuns('test', f.stored.flowId, 100, {}).page.runs).toHaveLength(1))
    const hook = f.service.control.drafts.getRevision('test', f.stored.flowId, f.stored.revisionId).content.document.graph.nodes.hook!
    const edited = await f.service.control.drafts.changeDraft('test', f.stored.flowId, f.stored.revisionId, [
      { kind: 'graph.node.replace', nodeId: 'hook', before: hook, node: { ...hook, options: { responseData: 'new publication' } } as typeof hook },
    ])
    const live = f.service.control.publications.getLiveDetails('test', f.stored.flowId, 'http://server.local')
    await f.service.control.publications.publishFlow(
      'test',
      f.stored.flowId,
      edited.revision.revisionId,
      currentEngineContract,
      live.publication!.publicationId,
      'republish',
    )
    await startService(f.service)
    expect(await (await waiting).text()).toBe('hello')
    await f.service.tickMaintenance()
    expect(await (await f.request()).text()).toBe('new publication')
  })
})

function responseNodeRevision(after: 'wait' | 'fail' | 'none' = 'none', headerSource = false): (source: RevisionContent) => RevisionContent {
  return (source) => ({
    ...source,
    modules: {
      ...source.modules,
      failure: { name: 'Failure after response', imports: [], source: 'export default () => { throw new Error("private failure after response") }' },
    },
    document: {
      ...source.document,
      graph: {
        nodes: {
          ...source.document.graph.nodes,
          reply: {
            kind: 'webhook-response',
            name: 'Reply',
            inputs: {
              body: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'echo', output: 'value' }] },
              statusCode: { kind: 'value', value: 201 },
              headers: headerSource
                ? { kind: 'sources', sources: [{ kind: 'node', nodeId: 'headerData', output: 'value' }] }
                : { kind: 'value', value: { 'X-Reply': 'selected', 'Content-Type': 'text/html', 'X-Frame-Options': 'ALLOWALL' } },
            },
          },
          other: { kind: 'webhook-response', name: 'Other', inputs: { body: { kind: 'value', value: 'unselected' } } },
          ...(headerSource
            ? {
                headerData: {
                  kind: 'value' as const,
                  name: 'Headers',
                  inputs: {},
                  values: [
                    {
                      handle: 'value',
                      jsonSchema: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } },
                      nullable: false,
                      value: { 'X-Count': 3, 'X-Enabled': false, 'X-Text': 'ok' },
                    },
                  ],
                },
              }
            : {}),
          ...(after === 'wait'
            ? { later: { kind: 'wait' as const, name: 'Later', inputDefinitions: [], inputs: {}, prompt: 'Continue after response' } }
            : after === 'fail'
              ? { later: { kind: 'task' as const, name: 'Later', inputs: {}, task: { name: 'Later', moduleId: 'failure', inputs: [], outputs: [] } } }
              : {}),
        },
        edges: [
          ...source.document.graph.edges,
          { source: 'echo', target: 'reply' },
          { source: 'hook', target: 'other' },
          ...(headerSource
            ? [
                { source: 'hook', target: 'headerData' },
                { source: 'headerData', target: 'reply' },
              ]
            : []),
          ...(after === 'none' ? [] : [{ source: 'reply', target: 'later' }]),
        ],
      },
    },
  })
}

describe('published early response nodes', () => {
  it('responds before a durable wait, replays concurrent keys, and lets the workflow continue', async () => {
    const f = await fixture(
      'early',
      {
        responseBody: { kind: 'webhook-response', nodeId: 'reply' },
        responseData: 'ignored',
        responseStatusCode: 599,
        responseHeaders: { 'X-Ignored': 'yes' },
      },
      true,
      false,
      responseNodeRevision('wait'),
    )
    const requests = Array.from({ length: 3 }, () => f.request({ headers: { 'content-type': 'application/json', 'idempotency-key': 'early' } }))
    const replies = await Promise.all(requests)
    for (const reply of replies) {
      expect(reply.status).toBe(201)
      expect(await reply.text()).toBe('early')
      expect(reply.headers.get('x-reply')).toBe('selected')
      expect(reply.headers.get('x-ignored')).toBeNull()
      expect(reply.headers.get('content-type')).toBe('text/plain;charset=UTF-8')
      expect(reply.headers.get('x-frame-options')).toBe('DENY')
    }
    const runs = () => f.service.control.runs.listRuns('test', f.stored.flowId, 100, {}).page.runs
    await expect.poll(() => f.service.control.runs.getRun('test', runs()[0]!.runId).waits.length).toBe(1)
    expect(runs()[0]?.status).not.toBe('completed')
    expect(runs()).toHaveLength(1)
    const run = f.service.control.runs.getRun('test', runs()[0]!.runId)
    const replay = await f.request({ headers: { 'content-type': 'application/json', 'idempotency-key': 'early' } })
    expect(await replay.text()).toBe('early')
    f.service.control.runs.resolveRunWait('test', run.runId, run.waits[0]!.waitId, 'continue')
    await expect.poll(() => runs()[0]?.status).toBe('completed')
    const events = f.service.control.runs.getRunEvents('test', run.runId, 0, 1000).events
    expect(events).toContainEqual(expect.objectContaining({ kind: 'node.completed', payload: expect.objectContaining({ nodeId: 'reply', outputs: {} }) }))
  })

  it('keeps the accepted response after later failure and converts whole-object scalar headers', async () => {
    const f = await fixture({ ok: true }, { responseBody: { kind: 'webhook-response', nodeId: 'reply' } }, true, false, responseNodeRevision('fail', true))
    const request = () => f.request({ headers: { 'content-type': 'application/json', 'idempotency-key': 'failed-later' } })
    const response = await request()
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ ok: true })
    expect(response.headers.get('x-count')).toBe('3')
    expect(response.headers.get('x-enabled')).toBe('false')
    await expect.poll(() => f.service.control.runs.listRuns('test', f.stored.flowId, 1, {}).page.runs[0]?.status).toBe('failed')
    expect(await (await request()).json()).toEqual({ ok: true })
  })

  it('returns unavailable when a reachable response node is skipped by a branch', async () => {
    const f = await fixture('skip', { responseBody: { kind: 'webhook-response', nodeId: 'reply' } }, true, false, (source) => {
      const changed = responseNodeRevision()(source)
      return {
        ...changed,
        document: {
          ...changed.document,
          graph: {
            nodes: {
              ...changed.document.graph.nodes,
              gate: {
                kind: 'condition',
                name: 'Gate',
                inputs: {},
                matchMode: 'first',
                cases: [{ name: 'Selected', output: 'selected', groups: [{ expressions: [{ left: { kind: 'value', value: false }, operator: 'isTrue' }] }] }],
              },
            },
            edges: [
              ...changed.document.graph.edges.filter((edge) => edge.target !== 'reply'),
              { source: 'echo', target: 'gate' },
              { source: 'gate', sourceHandle: 'selected', target: 'reply' },
            ],
          },
        },
      }
    })
    const response = await f.request()
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: { code: 'webhook.response-unavailable' } })
  })
})

it('keeps an early-response Run alive after HTTP timeout and reuses its eventual response', async () => {
  const f = await fixture(
    'after HTTP timeout',
    { responseBody: { kind: 'webhook-response', nodeId: 'reply', timeoutMs: 1000 } },
    false,
    false,
    responseNodeRevision(),
  )
  const request = () => f.request({ headers: { 'content-type': 'application/json', 'idempotency-key': 'timeout-early' } })
  const timedOut = await request()
  expect(timedOut.status).toBe(504)
  const run = f.service.control.runs.listRuns('test', f.stored.flowId, 10, {}).page.runs[0]!
  expect(run.status).toBe('queued')
  await startService(f.service)
  await expect.poll(() => f.service.control.runs.getRun('test', run.runId).status).toBe('completed')
  const replay = await request()
  expect(replay.status).toBe(201)
  expect(await replay.text()).toBe('after HTTP timeout')
  expect(f.service.control.runs.listRuns('test', f.stored.flowId, 10, {}).page.runs).toHaveLength(1)
})

it.each([{ 'X-Bad': '\r\nprivate' }, { 'X-Test': 'one', 'x-test': 'two' }, { 'X-Value': '你好' }])(
  'returns a fixed error for invalid runtime response headers %j',
  async (headers) => {
    const f = await fixture('hello', { responseBody: { kind: 'webhook-response', nodeId: 'reply' } }, true, false, (source) => {
      const changed = responseNodeRevision('none', true)(source)
      const headerData = changed.document.graph.nodes.headerData
      if (headerData?.kind !== 'value') throw new Error('Expected header fixture')
      return {
        ...changed,
        document: {
          ...changed.document,
          graph: {
            ...changed.document.graph,
            nodes: {
              ...changed.document.graph.nodes,
              headerData: { ...headerData, values: headerData.values.map((port) => Object.assign({}, port, { value: headers })) },
            },
          },
        },
      }
    })
    const response = await f.request()
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: { code: 'webhook.response-headers-invalid' } })
  },
)
