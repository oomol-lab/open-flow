import type { DecisionTaskInvocation } from '@oomol-lab/open-flow/runtime-contract'

import { afterEach, expect, it, vi } from 'vitest'
import { createLlm } from '../node/deployment/llm.ts'

const invocation: DecisionTaskInvocation = {
  questions: [{ name: 'needs_support', type: 'noul', instructions: 'Does the customer need support?' }],
  state: { message: '付款成功了，但是订单没有生成，请帮我处理。' },
  invocationId: 'decision-1',
  signal: new AbortController().signal,
  version: 1,
}
afterEach(() => vi.unstubAllGlobals())
it('rejects invalid configuration before contacting the gateway', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(createLlm('https://llm.oomol.com', 'token').decision!({ ...invocation, questions: [] })).resolves.toMatchObject({
    kind: 'failed',
    code: 'llm.unavailable',
    message: 'Add at least one question.',
  })
  expect(fetch).not.toHaveBeenCalled()
})
it('rejects non-JSON gateway responses', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('not json', { status: 200 })),
  )
  await expect(createLlm('https://llm.oomol.com', 'token').decision!(invocation)).resolves.toMatchObject({ kind: 'failed', code: 'llm.output-invalid' })
})
it.each(['AbortError', 'TimeoutError'])('propagates %s while reading the response body', async (name) => {
  const controller = new AbortController()
  const reason = new DOMException('Stopped', name)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => {
        controller.abort(reason)
        throw reason
      },
    })),
  )
  await expect(createLlm('https://llm.oomol.com', 'token').decision!({ ...invocation, signal: controller.signal })).rejects.toBe(reason)
})
it('calls systemone with deployment credentials and returns complete answer ports', async () => {
  const answers = { needs_support: { type: 'noul', noul: 0.96 } }
  const fetch = vi.fn(async () => Response.json({ answers }))
  vi.stubGlobal('fetch', fetch)
  const host = createLlm('https://llm.oomol.com', 'test-token')
  await expect(host.decision!(invocation)).resolves.toEqual({ kind: 'completed', version: 1, value: answers })
  const [url, request] = fetch.mock.calls[0] as unknown as [URL, RequestInit]
  expect(String(url)).toBe('https://llm.oomol.com/v1/systemone')
  expect(new Headers(request.headers).get('authorization')).toBe('Bearer test-token')
  expect(JSON.parse(String(request.body))).toEqual({
    model: 'typesafe/jev',
    state: invocation.state,
    questions: { needs_support: { type: 'noul', instructions: invocation.questions[0]!.instructions } },
  })
  expect(request.signal).toBe(invocation.signal)
  expect(fetch).toHaveBeenCalledTimes(1)
})
it.each([401, 422, 429, 529])('propagates HTTP %s as failure without retrying', async (status) => {
  const fetch = vi.fn(async () => new Response('', { status }))
  vi.stubGlobal('fetch', fetch)
  await expect(createLlm('https://llm.oomol.com', 'token').decision!(invocation)).resolves.toMatchObject({ kind: 'failed', code: 'llm.unavailable' })
  expect(fetch).toHaveBeenCalledTimes(1)
})
it.each([{ answers: {} }, { answers: { needs_support: { type: 'noul', noul: 2 } } }, { answers: { needs_support: { type: 'choice', choice: 'yes' } } }])(
  'rejects malformed answers without producing partial outputs',
  async (response) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(response)),
    )
    await expect(createLlm('https://llm.oomol.com', 'token').decision!(invocation)).resolves.toMatchObject({ kind: 'failed', code: 'llm.output-invalid' })
  },
)
it.each(['AbortError', 'TimeoutError'])('propagates %s', async (name) => {
  const controller = new AbortController()
  const reason = new DOMException('Stopped', name)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      controller.abort(reason)
      throw reason
    }),
  )
  await expect(createLlm('https://llm.oomol.com', 'token').decision!({ ...invocation, signal: controller.signal })).rejects.toBe(reason)
})

it('executes upstream data → Decision → Condition using answer fields in the real runtime', async () => {
  const { decisionTask } = await import('@oomol-lab/open-flow/decision')
  const { currentFlowModelVersion } = await import('@oomol-lab/open-flow/flow-change')
  const { openService, startService, closeService } = await import('./serviceFixture.ts')
  const { acceptRun } = await import('./runFixture.ts')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const directory = await mkdtemp(`${tmpdir()}/decision-test-`)
  const questions: DecisionTaskInvocation['questions'] = [
    ...invocation.questions,
    {
      name: 'department',
      type: 'choice',
      instructions: 'Choose a department',
      criteria: [
        { name: 'billing', description: 'Payment problems' },
        { name: 'other', description: '' },
      ],
    },
    { name: 'urgency', type: 'score', instructions: 'Rate urgency', criteria: ['Low', 'High'] },
  ]
  const answer = {
    needs_support: { type: 'noul', noul: 0.96 },
    department: { type: 'choice', choice: 'billing', probabilities: { billing: 0.9, other: 0.1 }, confidence: 0.8 },
    urgency: { type: 'score', score: 0.9, legend: { '0': 'Low', '1': 'High' }, probabilities: { '0': 0.1, '1': 0.9 }, confidence: 0.8 },
  }
  const fetch = vi.fn(async () => Response.json({ answers: answer }))
  vi.stubGlobal('fetch', fetch)
  const service = await openService(`${directory}/flow.sqlite`, { capabilities: { llm: () => createLlm('https://llm.oomol.com', 'token') } })
  try {
    await startService(service)
    const accepted = await acceptRun(service, {
      flowId: 'flow',
      revisionId: 'decision',
      idempotencyKey: 'decision',
      revision: {
        modelVersion: currentFlowModelVersion,
        modules: {},
        document: {
          bindings: {},
          subflows: {},
          tasks: { decision: decisionTask(questions) },
          graph: {
            nodes: {
              input: { kind: 'value', inputs: {}, values: [{ handle: 'message', jsonSchema: { type: 'object' }, nullable: false, value: invocation.state }] },
              decision: {
                kind: 'task',
                taskId: 'decision',
                inputs: { target: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'input', output: 'message' }] } },
              },
              route: {
                kind: 'condition',
                inputs: {},
                matchMode: 'first',
                cases: [
                  {
                    output: 'support',
                    groups: [
                      {
                        expressions: [
                          {
                            left: { kind: 'source', source: { kind: 'node', nodeId: 'decision', output: 'needs_support', field: 'noul' } },
                            operator: '>=',
                            right: { kind: 'value', value: 0.8 },
                          },
                          {
                            left: { kind: 'source', source: { kind: 'node', nodeId: 'decision', output: 'department', field: 'choice' } },
                            operator: '==',
                            right: { kind: 'value', value: 'billing' },
                          },
                          {
                            left: { kind: 'source', source: { kind: 'node', nodeId: 'decision', output: 'urgency', field: 'score' } },
                            operator: '>=',
                            right: { kind: 'value', value: 0.8 },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              support: { kind: 'value', inputs: {}, values: [{ handle: 'team', jsonSchema: { type: 'string' }, nullable: false, value: 'Support' }] },
              other: { kind: 'value', inputs: {}, values: [{ handle: 'team', jsonSchema: { type: 'string' }, nullable: false, value: 'Other' }] },
            },
            edges: [
              { source: 'input', target: 'decision' },
              { source: 'decision', target: 'route' },
              { source: 'route', sourceHandle: 'support', target: 'support' },
              { source: 'route', sourceHandle: 'otherwise', target: 'other' },
            ],
          },
        },
      },
    })
    if (accepted.kind !== 'accepted') throw new Error('Run was not accepted')
    await service.waitForIdle()
    expect(service.run(accepted.runId)?.status).toBe('completed')
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [unknown, RequestInit])[1].body)).state).toEqual(invocation.state)
    const events = service.events(accepted.runId)
    expect(events.some((event) => event.kind === 'node.started' && event.payload.nodeKind === 'decision')).toBe(true)
    expect(events.filter((event) => event.kind === 'node.completed').map((event) => event.payload.nodeId)).toContain('support')
    expect(events.some((event) => event.kind === 'node.started' && event.payload.nodeId === 'other')).toBe(false)
  } finally {
    await closeService(service)
    await rm(directory, { recursive: true, force: true })
  }
})

it('ignores excess categories and score levels before gateway submission and validates only retained answers', async () => {
  const categories = Array.from({ length: 255 }, (_, i) => ({ name: `c${i}`, description: '' }))
  const levels = Array.from({ length: 10 }, (_, i) => `Level ${i}`)
  const answers = {
    category: { type: 'choice', choice: 'c0', confidence: 1, probabilities: Object.fromEntries(categories.map((c, i) => [c.name, i === 0 ? 1 : 0])) },
    rating: {
      type: 'score',
      score: 9,
      confidence: 1,
      probabilities: Object.fromEntries(levels.map((_, i) => [String(i), i === 9 ? 1 : 0])),
      legend: Object.fromEntries(levels.map((level, i) => [String(i), level])),
    },
  }
  const fetch = vi.fn(async () => Response.json({ answers }))
  vi.stubGlobal('fetch', fetch)
  const result = await createLlm('https://llm.oomol.com', 'token').decision!({
    ...invocation,
    questions: [
      { name: 'category', type: 'choice', instructions: 'Classify', criteria: [...categories, { name: '', description: '' }] },
      { name: 'rating', type: 'score', instructions: 'Rate', criteria: [...levels, ''] },
    ],
  })
  expect(result).toEqual({ kind: 'completed', version: 1, value: answers })
  const request = JSON.parse(String((fetch.mock.calls[0] as unknown as [URL, RequestInit])[1].body))
  expect(Object.keys(request.questions.category.criteria)).toEqual(categories.map((c) => c.name))
  expect(request.questions.rating.criteria).toEqual(levels)
})
