import type { ChangeOperation, RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { UiLanguage } from '@oomol-lab/open-flow/localization'

import { applyFlowChanges } from '@oomol-lab/open-flow/flow-change'
import { uiLanguages } from '@oomol-lab/open-flow/localization'
import { describe, expect, it, vi } from 'vitest'
import { runCli } from './cli.ts'
import { locales } from './i18n.ts'

/** Reads one help message straight from the locale bundle the CLI ships. */
function helpMessage(language: UiLanguage, key: 'options' | 'title'): string {
  const help = locales[language].help
  if (typeof help == 'string') throw new Error(`Locale ${language} must nest help messages.`)
  return String(help[key])
}

const flow = {
  createdAt: '2026-08-14T00:00:00.000Z',
  draftRevisionId: 'revision-1',
  flowId: 'flow-1',
  name: 'Main',
  status: 'active',
  updatedAt: '2026-08-14T00:00:00.000Z',
  version: 1,
} as const

function runtime(language: UiLanguage = 'en') {
  let stdout = ''
  let stderr = ''
  const opened: string[] = []
  return {
    opened,
    stderr: () => stderr,
    stdout: () => stdout,
    value: {
      env: {},
      language,
      openUrl: async (url: string) => void opened.push(url),
      readFile: async () => '',
      readStdin: async () => '',
      stderr: { write: (value: string) => (stderr += value) },
      stdout: { write: (value: string) => (stdout += value) },
      wait: async () => {},
    },
  }
}

describe('CLI', () => {
  it('edits execution order and input sources independently through revision changes', async () => {
    let content: RevisionContent = {
      modelVersion: 1,
      modules: {},
      document: {
        bindings: {},
        tasks: {},
        subflows: {},
        graph: {
          edges: [],
          nodes: {
            a: { kind: 'value', inputs: {}, values: [{ handle: 'value', jsonSchema: {}, nullable: false, value: 42 }] },
            b: { kind: 'condition', inputs: {}, input: { handle: 'input', jsonSchema: {}, nullable: false }, cases: [] },
          },
        },
      },
    }
    let sequence = 1
    const operations: ChangeOperation[][] = []
    const metadata = () => ({
      actorId: 'operator',
      createdAt: flow.createdAt,
      digest: 'digest',
      flowId: flow.flowId,
      modelVersion: 1,
      parentRevisionId: null,
      revisionId: `revision-${sequence}`,
      version: 1,
    })
    const request = async (path: string, init?: RequestInit) => {
      if (path == '/v1/flows/flow-1') return Response.json({ ...flow, draftRevisionId: `revision-${sequence}` })
      if (path == `/v1/flows/flow-1/revisions/revision-${sequence}`) return Response.json({ ...metadata(), content })
      if (path == '/v1/flows/flow-1/draft/changes') {
        const body = JSON.parse(String(init?.body)) as { expectedRevisionId: string; operations: ChangeOperation[] }
        expect(body.expectedRevisionId).toBe(`revision-${sequence}`)
        expect(new Headers(init?.headers).get('idempotency-key')).toBeTruthy()
        operations.push(body.operations)
        content = applyFlowChanges(content, body.operations)
        sequence++
        return Response.json({ revision: metadata(), version: 1 })
      }
      throw new Error(`Unexpected request ${path}`)
    }
    for (const args of [
      ['connect', 'flow-1', 'a', 'b'],
      ['node', 'input', 'flow-1', 'b', 'input', 'a', 'value'],
      ['disconnect', 'flow-1', 'a', 'b'],
    ]) {
      const output = runtime()
      expect(await runCli([...args, '--json'], { request }, output.value), output.stderr()).toBe(0)
    }
    expect(operations.map((batch) => batch.map((operation) => operation.kind))).toEqual([
      ['graph.edge.connect'],
      ['graph.node.input.set'],
      ['graph.edge.disconnect'],
    ])
    expect(content.document.graph.edges).toEqual([])
    expect(content.document.graph.nodes.b).toMatchObject({ inputs: { input: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'a', output: 'value' }] } } })
  })

  it('prints help without making a Control API request', async () => {
    const output = runtime()
    const request = vi.fn()

    await expect(runCli([], { request }, output.value)).resolves.toBe(0)

    expect(output.stdout()).toContain('Open Flow commands')
    expect(request).not.toHaveBeenCalled()
  })

  it('prints the full command listing in every supported language', async () => {
    for (const language of uiLanguages) {
      const output = runtime(language)

      await expect(runCli([], { request: vi.fn() }, output.value)).resolves.toBe(0)

      const text = output.stdout()
      expect([language, text.includes(helpMessage(language, 'title'))]).toEqual([language, true])
      expect([language, text.includes('oo flow list')]).toEqual([language, true])
      expect([language, text.includes(helpMessage(language, 'options'))]).toEqual([language, true])
    }
  })

  it('prints the localized usage line for a code subcommand', async () => {
    const output = runtime('fr')

    await expect(runCli(['code', 'list', '--help'], { request: vi.fn() }, output.value)).resolves.toBe(0)

    expect(output.stdout()).toContain('oo flow code list <flow> [--json]')
    expect(output.stdout()).not.toContain('oo flow code edit <flow>')
  })

  it('creates a top-level Flow through POST /v1/flows', async () => {
    const output = runtime()
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe('/v1/flows')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ name: 'Main', version: 1 })
      expect(new Headers(init?.headers).has('idempotency-key')).toBe(true)
      return Response.json(flow, { status: 201 })
    })

    await expect(runCli(['create', 'Main', '--json'], { request }, output.value)).resolves.toBe(0)

    expect(JSON.parse(output.stdout())).toEqual({ flow, idempotencyKey: expect.any(String), kind: 'flow.create', version: 1 })
    expect(request).toHaveBeenCalledOnce()
  })

  it('lists top-level Flows without Project context', async () => {
    const output = runtime()
    const request = vi.fn(async (path: string) => {
      expect(path).toBe('/v1/flows?limit=100')
      return Response.json({ flows: [flow], version: 1 })
    })

    await expect(runCli(['list', '--json'], { request }, output.value)).resolves.toBe(0)

    expect(JSON.parse(output.stdout())).toEqual({ flows: [flow], kind: 'flow.list', version: 1 })
  })

  it('checks the selected Flow Draft revision', async () => {
    const output = runtime()
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows/Main') return Response.json({ error: { code: 'flow.not-found', message: 'Missing.' }, version: 1 }, { status: 404 })
      if (path == '/v1/flows?limit=100') return Response.json({ flows: [flow], version: 1 })
      if (path == '/v1/flows/flow-1/revisions/revision-1/check') {
        return Response.json({
          closureDigest: 'closure-1',
          diagnostics: [],
          engineContract: 'open-flow-engine/v2',
          flowId: flow.flowId,
          modelVersion: 1,
          revisionDigest: 'digest-1',
          revisionId: flow.draftRevisionId,
          valid: true,
          version: 1,
        })
      }
      throw new Error(path)
    })

    await expect(runCli(['check', 'Main', '--json'], { request }, output.value)).resolves.toBe(0)
    expect(JSON.parse(output.stdout())).toMatchObject({ check: { flowId: 'flow-1', valid: true }, kind: 'flow.check' })
  })

  it('rejects invalid Flow names before making a request', async () => {
    const output = runtime()
    const request = vi.fn()

    await expect(runCli(['create', 'flow&&', '--json'], { request }, output.value)).resolves.toBe(1)

    expect(JSON.parse(output.stderr())).toMatchObject({ error: { code: 'cli.invalid-arguments' } })
    expect(request).not.toHaveBeenCalled()
  })

  it('does not expose the removed Project command', async () => {
    const output = runtime()
    const request = vi.fn()

    await expect(runCli(['project', 'list', '--json'], { request }, output.value)).resolves.toBe(1)

    expect(JSON.parse(output.stderr())).toMatchObject({ error: { code: 'cli.invalid-arguments' } })
    expect(request).not.toHaveBeenCalled()
  })

  it('opens a Flow-scoped Workbench URL', async () => {
    const output = runtime()
    const request = vi.fn(async (path: string) =>
      path == '/v1/flows/Main'
        ? Response.json({ error: { code: 'flow.not-found', message: 'Missing.' }, version: 1 }, { status: 404 })
        : Response.json({ flows: [flow], version: 1 }),
    )
    const getWorkbenchUrl = vi.fn(async (flowId?: string) => `https://console.example/flows/${flowId ?? ''}`)

    await expect(runCli(['open', 'Main'], { getWorkbenchUrl, request }, output.value)).resolves.toBe(0)

    expect(getWorkbenchUrl).toHaveBeenCalledWith(flow.flowId)
    expect(output.opened).toEqual(['https://console.example/flows/flow-1'])
  })
})

it.each([
  { multiple: false, options: [], selected: 'start', status: 0 },
  { multiple: true, options: [], selected: undefined, status: 1 },
  { multiple: true, options: ['--trigger', 'Other'], selected: 'other', status: 0 },
  { multiple: true, options: ['--trigger=other', '--payload={}'], selected: 'other', status: 0 },
])('runs only an explicit entry or the sole manual trigger: %j', async ({ multiple, options, selected, status }) => {
  const output = runtime()
  const bodies: unknown[] = []
  const request = async (path: string, init?: RequestInit) => {
    if (path == '/v1/flows/flow-1') return Response.json(flow)
    if (path == '/v1/flows/flow-1/revisions/revision-1')
      return Response.json({
        actorId: 'operator',
        createdAt: flow.createdAt,
        digest: 'digest',
        flowId: flow.flowId,
        modelVersion: 1,
        parentRevisionId: null,
        revisionId: 'revision-1',
        version: 1,
        content: {
          modelVersion: 1,
          modules: {},
          document: {
            bindings: {},
            tasks: {},
            subflows: {},
            graph: {
              edges: [],
              nodes: {
                start: { kind: 'manual', name: 'Start' },
                ...(multiple ? { other: { kind: 'manual', name: 'Other' } } : {}),
              },
            },
          },
        },
      })
    if (path == '/v1/flows/flow-1/revisions/revision-1/runs') {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({
        createdAt: flow.createdAt,
        flowId: flow.flowId,
        revisionId: 'revision-1',
        runId: 'run',
        source: 'draft',
        status: 'queued',
        version: 1,
        closureDigest: 'closure',
        engineContract: 'open-flow-engine/v2',
        engineDigest: 'engine',
        modelVersion: 1,
        revisionDigest: 'digest',
      })
    }
    throw new Error(`Unexpected request ${path}`)
  }
  expect(await runCli(['run', 'flow-1', '--source', 'draft', '--json', ...options], { request }, output.value), output.stderr()).toBe(status)
  if (selected == null) {
    expect(bodies).toEqual([])
    expect(JSON.parse(output.stderr())).toMatchObject({ error: { code: 'run.trigger-required' } })
  } else {
    expect(bodies).toEqual([expect.objectContaining({ trigger: { nodeId: selected, payload: {} } })])
  }
})

const runFixture = {
  createdAt: flow.createdAt,
  flowId: flow.flowId,
  revisionId: 'revision-1',
  runId: 'run-1',
  source: 'draft',
  status: 'running',
  version: 1,
  closureDigest: 'closure',
  engineContract: 'open-flow-engine/v2',
  engineDigest: 'engine',
  modelVersion: 1,
  revisionDigest: 'digest',
} as const
const revisionFixture = {
  actorId: 'operator',
  createdAt: flow.createdAt,
  digest: 'digest',
  flowId: flow.flowId,
  modelVersion: 1,
  parentRevisionId: null,
  revisionId: 'revision-1',
  version: 1,
  content: {
    modelVersion: 1,
    modules: {},
    document: { bindings: {}, tasks: {}, subflows: {}, graph: { edges: [], nodes: { start: { kind: 'manual', name: 'Start' } } } },
  },
} as const

describe('agent command contract', () => {
  it.each(['failed', 'canceled', 'indeterminate'])('returns failure when a waited run is %s', async (status) => {
    const output = runtime()
    const request = async (path: string) => {
      if (path == '/v1/flows/flow-1') return Response.json(flow)
      if (path.endsWith('/revisions/revision-1')) return Response.json(revisionFixture)
      if (path.endsWith('/runs')) return Response.json({ ...runFixture, status })
      throw new Error(path)
    }
    expect(await runCli(['run', 'flow-1', '--wait', '--json'], { request }, output.value)).toBe(1)
    expect(JSON.parse(output.stdout())).toMatchObject({ run: { runId: 'run-1', status }, timedOut: false })
    expect(output.stderr()).toBe('')
  })

  it('returns pending Wait actions without polling indefinitely', async () => {
    const output = runtime()
    const waiting = {
      actions: ['approve', 'reject'],
      expiresAt: flow.createdAt,
      nodeId: 'approval',
      prompt: 'Approve?',
      waitId: 'wait-1',
      waitingSince: flow.createdAt,
    }
    const request = vi.fn(async () => Response.json({ ...runFixture, status: 'waiting', waiting }))
    expect(await runCli(['runs', 'wait', 'run-1', '--json'], { request }, output.value)).toBe(2)
    expect(JSON.parse(output.stdout())).toMatchObject({ run: { waiting }, timedOut: false })
    expect(request).toHaveBeenCalledOnce()
  })

  it('expires only the wait budget and preserves the run identity', async () => {
    const output = runtime()
    let now = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      output.value.wait = async (ms?: number) => {
        now += ms ?? 0
      }
      const request = vi.fn(async () => Response.json(runFixture))
      expect(await runCli(['runs', 'wait', 'run-1', '--timeout=10', '--json'], { request }, output.value)).toBe(3)
      expect(JSON.parse(output.stdout())).toMatchObject({ run: { runId: 'run-1', status: 'running' }, timedOut: true })
      expect(request.mock.calls).toHaveLength(1)
    } finally {
      clock.mockRestore()
    }
  })

  it('streams event pages before asking for the next page', async () => {
    const output = runtime()
    let pages = 0
    const request = async (path: string) => {
      if (!path.includes('/events')) return Response.json(runFixture)
      pages++
      if (pages == 2) expect(output.stdout()).toContain('run.started')
      return Response.json({
        runId: 'run-1',
        version: 1,
        done: pages == 2,
        historyComplete: true,
        nextAfter: pages,
        events: [
          {
            createdAt: flow.createdAt,
            kind: pages == 1 ? 'run.started' : 'run.completed',
            sequence: pages,
            payload: pages == 1 ? { flowId: 'flow', scopeId: 'scope' } : { result: {} },
          },
        ],
      })
    }
    expect(await runCli(['runs', 'events', 'run-1', '--follow', '--json'], { request }, output.value)).toBe(0)
    expect(
      output
        .stdout()
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).nextAfter),
    ).toEqual([1, 2])
  })

  it('resolves the exact Wait selected by the caller', async () => {
    const output = runtime()
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe('/v1/runs/run-1/waits/wait-1/resolve')
      expect(JSON.parse(String(init?.body))).toEqual({ action: 'approve', version: 1 })
      return Response.json({
        action: 'approve',
        resolutionAccepted: true,
        resolvedAt: flow.createdAt,
        runId: 'run-1',
        status: 'queued',
        version: 1,
        waitId: 'wait-1',
      })
    })
    expect(await runCli(['runs', 'resolve', 'run-1', 'wait-1', 'approve', '--json'], { request }, output.value)).toBe(0)
  })

  it.each([
    ['list', '--unknown', '--json'],
    ['list', '--wait', '--json'],
    ['list', '--limit=0', '--json'],
    ['run', 'flow-1', '--timeout=1', '--json'],
    ['node', 'add', 'flow-1', 'code', 'Code', '--idempotency-key=edit', '--json'],
  ])('reports argument errors as JSON before contacting the host: %j', async (...args) => {
    const output = runtime()
    const request = vi.fn()
    expect(await runCli(args, { request }, output.value)).toBe(1)
    expect(JSON.parse(output.stderr())).toMatchObject({ error: { code: 'cli.invalid-arguments' } })
    expect(request).not.toHaveBeenCalled()
  })

  it('provides command-specific machine help without a host', async () => {
    const output = runtime()
    const request = vi.fn()
    expect(await runCli(['node', 'add', '--help', '--json'], { request }, output.value)).toBe(0)
    expect(JSON.parse(output.stdout())).toMatchObject({
      commands: [{ command: 'node add', options: expect.arrayContaining([expect.objectContaining({ name: '--code', repeatable: false, value: true })]) }],
      exitCodes: { 2: expect.any(String) },
    })
    expect(request).not.toHaveBeenCalled()
  })

  it('returns one page and its continuation cursor', async () => {
    const output = runtime()
    const request = vi.fn(async (path: string) => {
      expect(path).toBe('/v1/flows?cursor=before&limit=2')
      return Response.json({ flows: [flow], nextCursor: 'after', version: 1 })
    })
    expect(await runCli(['list', '--cursor=before', '--limit', '2', '--json'], { request }, output.value)).toBe(0)
    expect(JSON.parse(output.stdout())).toMatchObject({ nextCursor: 'after' })
    expect(request).toHaveBeenCalledOnce()
  })

  it('keeps a repeatable edit identical after the head advances and its first response is lost', async () => {
    const bodies: unknown[] = []
    const keys: string[] = []
    const request = async (path: string, init?: RequestInit) => {
      if (path == '/v1/flows/flow-1') return Response.json({ ...flow, draftRevisionId: bodies.length == 0 ? 'revision-1' : 'revision-2' })
      if (path.endsWith('/revisions/revision-1')) return Response.json(revisionFixture)
      if (path.endsWith('/draft/changes')) {
        bodies.push(JSON.parse(String(init?.body)))
        keys.push(new Headers(init?.headers).get('idempotency-key') ?? '')
        if (bodies.length == 1) throw new Error('Lost response')
        return Response.json({ version: 1, revision: { ...revisionFixture, content: undefined, revisionId: 'revision-2', parentRevisionId: 'revision-1' } })
      }
      throw new Error(path)
    }
    const args = ['node', 'add', 'flow-1', 'code', 'Code', '--expected-revision=revision-1', '--idempotency-key=edit-1', '--json']
    const first = runtime()
    expect(await runCli(args, { request }, first.value)).toBe(1)
    expect(JSON.parse(first.stderr())).toMatchObject({
      error: { code: 'flow.mutation-outcome-unknown', details: { baseRevisionId: 'revision-1', idempotencyKey: 'edit-1' } },
    })
    const second = runtime()
    expect(await runCli(args, { request }, second.value), second.stderr()).toBe(0)
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toEqual(bodies[0])
    expect(keys).toEqual(['edit-1', 'edit-1'])
    expect(JSON.parse(second.stdout())).toMatchObject({ revisionId: 'revision-2', baseRevisionId: 'revision-1', changed: true })
  })

  it('passes Flow scope to connector discovery', async () => {
    const output = runtime()
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows/flow-1') return Response.json(flow)
      const url = new URL(path, 'https://example.test')
      expect(url.searchParams.get('flowId')).toBe('flow-1')
      return Response.json({ actions: [], version: 1 })
    })
    expect(await runCli(['connector', 'search', 'email', '--flow=flow-1', '--json'], { request }, output.value), output.stderr()).toBe(0)
  })

  it('keeps an invalid check as one structured result with a failure exit code', async () => {
    const output = runtime()
    const request = async (path: string) =>
      Response.json(
        path.endsWith('/check')
          ? {
              closureDigest: 'closure',
              diagnostics: [],
              engineContract: 'open-flow-engine/v2',
              flowId: flow.flowId,
              modelVersion: 1,
              revisionDigest: 'digest',
              revisionId: 'revision-1',
              valid: false,
              version: 1,
            }
          : flow,
      )
    expect(await runCli(['check', 'flow-1', '--json'], { request }, output.value)).toBe(1)
    expect(JSON.parse(output.stdout())).toMatchObject({ check: { valid: false } })
    expect(output.stderr()).toBe('')
  })

  it('can resume a bounded publication wait by operation ID', async () => {
    const output = runtime()
    let now = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      output.value.wait = async (ms?: number) => {
        now += ms ?? 0
      }
      const request = async (path: string) =>
        Response.json(
          path.endsWith('/flow-1')
            ? flow
            : {
                createdAt: flow.createdAt,
                updatedAt: flow.createdAt,
                flowId: flow.flowId,
                operationId: 'pub-op',
                revisionId: 'revision-1',
                status: 'pending',
                version: 1,
              },
        )
      expect(await runCli(['publications', 'wait', 'flow-1', 'pub-op', '--timeout=10', '--json'], { request }, output.value), output.stderr()).toBe(3)
      expect(JSON.parse(output.stdout())).toMatchObject({ operation: { operationId: 'pub-op', status: 'pending' }, timedOut: true })
    } finally {
      clock.mockRestore()
    }
  })
})

it('applies a complete operation batch atomically and reports validation separately from acceptance', async () => {
  const output = runtime()
  const operations = [
    {
      kind: 'graph.node.create',
      target: { kind: 'flow' },
      nodeId: 'value',
      node: { kind: 'value', name: 'Value', inputs: {}, values: [{ handle: 'value', jsonSchema: {}, nullable: false, value: 42 }] },
    },
    { kind: 'graph.edge.connect', target: { kind: 'flow' }, edge: { source: 'start', target: 'value' } },
    { kind: 'graph.node.field.set', target: { kind: 'flow' }, nodeId: 'value', field: 'name', before: 'Value', value: 'Answer' },
  ]
  output.value.readFile = async () => JSON.stringify({ version: 1, operations })
  let changes = 0
  const request = async (path: string, init?: RequestInit) => {
    if (path == '/v1/flows/flow-1') return Response.json(flow)
    if (path.endsWith('/revisions/revision-1')) return Response.json(revisionFixture)
    if (path.endsWith('/draft/changes')) {
      changes++
      expect(JSON.parse(String(init?.body))).toEqual({ version: 1, expectedRevisionId: 'revision-1', operations })
      return Response.json({ version: 1, revision: { ...revisionFixture, content: undefined, revisionId: 'revision-2', parentRevisionId: 'revision-1' } })
    }
    if (path.endsWith('/check'))
      return Response.json({
        closureDigest: 'closure',
        diagnostics: [],
        engineContract: 'open-flow-engine/v2',
        flowId: flow.flowId,
        modelVersion: 1,
        revisionDigest: 'digest',
        revisionId: 'revision-2',
        valid: false,
        version: 1,
      })
    throw new Error(path)
  }
  expect(await runCli(['apply', 'flow-1', '--file=changes.json', '--json'], { request }, output.value), output.stderr()).toBe(0)
  expect(changes).toBe(1)
  expect(JSON.parse(output.stdout())).toMatchObject({ changed: true, valid: false, revisionId: 'revision-2' })
})

it('inspects complete editable content without invoking check', async () => {
  const output = runtime()
  const request = vi.fn(async (path: string) => {
    if (path == '/v1/flows/flow-1') return Response.json(flow)
    if (path.endsWith('/revisions/revision-1')) return Response.json(revisionFixture)
    throw new Error(`Unexpected inspection request: ${path}`)
  })
  expect(await runCli(['inspect', 'flow-1', '--json'], { request }, output.value)).toBe(0)
  expect(JSON.parse(output.stdout())).toMatchObject({ content: revisionFixture.content, revisionId: 'revision-1' })
  expect(request).toHaveBeenCalledTimes(2)
})

it('reports a followed event timeout with a reusable cursor without canceling the run', async () => {
  const output = runtime()
  let now = 0
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
  try {
    output.value.wait = async (ms?: number) => {
      now += ms ?? 0
    }
    const request = vi.fn(async (path: string) =>
      Response.json(path.includes('/events') ? { runId: 'run-1', version: 1, events: [], done: false, nextAfter: 7, historyComplete: true } : runFixture),
    )
    expect(await runCli(['runs', 'events', 'run-1', '--after=7', '--follow', '--timeout=10', '--json'], { request }, output.value)).toBe(3)
    expect(JSON.parse(output.stdout().trim().split('\n').at(-1)!)).toMatchObject({ runId: 'run-1', nextAfter: 7, timedOut: true })
    expect(request).toHaveBeenCalledTimes(2)
  } finally {
    clock.mockRestore()
  }
})

it('preserves identity when the initial wait lookup itself times out', async () => {
  const output = runtime()
  const request = vi.fn(async (_path: string, init?: RequestInit) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    throw new DOMException('Timed out', 'TimeoutError')
  })
  expect(await runCli(['runs', 'wait', 'run-1', '--timeout=10', '--json'], { request }, output.value)).toBe(3)
  expect(JSON.parse(output.stdout())).toMatchObject({ runId: 'run-1', timedOut: true })
})

it('reads and downloads saved results through the public API', async () => {
  const result = {
    resultId: 'result',
    callId: 'call',
    toolId: 'tool',
    source: { kind: 'connector', action: 'mail.fetch' },
    bytes: 11,
    digest: 'a'.repeat(64),
    createdAt: flow.createdAt,
  }
  const routes: string[] = []
  const host = {
    request: async (route: string) => {
      routes.push(route)
      if (route.endsWith('/content')) return new Response('{"ok":true}')
      if (route.endsWith('/results')) return Response.json({ version: 1, runId: 'run', results: [result] })
      return Response.json({ version: 1, runId: 'run', result, page: { pointer: '/ok', type: 'boolean', complete: true, value: true, offset: 0 } })
    },
  }
  for (const command of [
    ['runs', 'results', 'run', '--json'],
    ['runs', 'read-result', 'run', 'result', '/ok', '0', '--json'],
    ['runs', 'download-result', 'run', 'result'],
  ]) {
    const io = runtime()
    expect(await runCli(command, host, io.value)).toBe(0)
    expect(io.stderr()).toBe('')
    if (command[1] == 'download-result') expect(io.stdout()).toBe('{"ok":true}')
    else expect(JSON.parse(io.stdout()).runId).toBe('run')
  }
  expect(routes).toEqual(['/v1/runs/run/results', '/v1/runs/run/results/result?pointer=%2Fok&offset=0', '/v1/runs/run/results/result/content'])
})
