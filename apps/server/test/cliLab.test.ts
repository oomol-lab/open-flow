import { runLabCli } from '@oomol-lab/open-flow-command/lab'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile, readFile, realpath } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { servePreview } from '../scripts/lab/preview.ts'
import { summary, compare } from '../scripts/lab/report.ts'
import { assertions, referenceChanges } from '../scripts/lab/scenarios.ts'
import { LabSession } from '../scripts/lab/session.ts'

const sessions: LabSession[] = []
afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await session.close()
    await rm(session.directory, { recursive: true, force: true })
  }
})
async function fixture(id = 'fix-notification') {
  const session = new LabSession(await mkdtemp(path.join(tmpdir(), 'cli-lab-test-')), id)
  sessions.push(session)
  await session.open()
  return session
}
async function cli(lab: LabSession, args: string[], stdin?: string, registered = true) {
  let stdout = '',
    stderr = ''
  const id = randomUUID()
  if (registered) lab.active.add(id)
  const record = await runLabCli(args, {
    id,
    origin: lab.manifest.origin,
    token: lab.token,
    stdin: async () => stdin ?? '',
    output: (stream, value) => {
      if (stream == 'stdout') stdout += value
      else stderr += value
    },
  })
  lab.active.delete(id)
  return { record, stdout, stderr }
}
describe('CLI Lab', () => {
  it('serves read-only snapshots, pushes CLI edits and reconnects to the reset attempt without charging reads', async () => {
    const lab = await fixture()
    const server = createServer((request, response) => {
      if (!servePreview(lab, request, response)) response.writeHead(404).end()
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address == null || typeof address == 'string') throw new Error('Missing address')
    const origin = `http://127.0.0.1:${address.port}`
    const controller = new AbortController()
    try {
      for (const route of ['/v1/flows', '/__lab/reset', '/__lab/state']) expect((await fetch(`${origin}${route}`)).status).toBe(404)
      expect((await fetch(`${origin}/__lab/view`, { method: 'POST' })).status).toBe(405)
      expect((await fetch(`${origin}/__lab/view`, { headers: { origin: 'https://example.com' } })).status).toBe(403)
      const response = await fetch(`${origin}/__lab/view`, { signal: controller.signal })
      let reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      async function snapshot() {
        while (true) {
          const split = buffer.indexOf('\n\n')
          if (split >= 0) {
            const message = buffer.slice(0, split)
            buffer = buffer.slice(split + 2)
            if (message.startsWith('data: ')) return JSON.parse(message.slice(6))
          } else {
            const part = await reader.read()
            if (part.done) throw new Error('Snapshot stream ended')
            buffer += part.value
          }
        }
      }
      const initial = await snapshot()
      expect(initial.draft.revisionId).toBe(lab.head())
      expect(JSON.stringify(initial)).not.toContain(lab.token)
      const changed = await cli(lab, ['node', 'input', lab.manifest.flowId, 'notify', 'text', 'format', 'text', '--json'])
      expect(changed.record.exitCode, changed.stderr).toBe(0)
      const updated = await snapshot()
      expect(updated.draft.revisionId).toBe(lab.head())
      expect(updated.draft.revisionId).not.toBe(initial.draft.revisionId)
      expect(lab.attempt.mixed).toBe(false)
      expect(lab.attempt.commands).toHaveLength(0)
      await lab.reset()
      expect((await reader.read()).done).toBe(true)
      const reconnected = await fetch(`${origin}/__lab/view`, { signal: controller.signal })
      reader = reconnected.body!.pipeThrough(new TextDecoderStream()).getReader()
      buffer = ''
      const restored = await snapshot()
      expect(restored.attemptId).toBe(lab.attempt.id)
      expect(restored.draft.revisionId).toBe(initial.draft.revisionId)
      expect(lab.attempt.id).not.toBe(initial.attemptId)
    } finally {
      controller.abort()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('counts Unicode stdin and visible output separately from internal HTTP and verification', async () => {
    const lab = await fixture()
    const before = lab.current()
    const input = JSON.stringify({ version: 1, operations: referenceChanges(lab.scenarioId, before.content) })
    const args = ['apply', lab.manifest.flowId, '--file', '-', '--expected-revision', before.revisionId, '--json']
    const { record, stdout, stderr } = await cli(lab, args, input)
    expect(record.exitCode, stderr).toBe(0)
    expect(record.inputs).toEqual([{ source: 'stdin', bytes: Buffer.byteLength(input) }])
    expect(record.argumentBytes).toBe(Buffer.byteLength(args.join(' ')))
    expect(record.stdoutBytes).toBe(Buffer.byteLength(stdout))
    expect(record.stderrBytes).toBe(Buffer.byteLength(stderr))
    expect(record.requests.length).toBeGreaterThan(1)
    expect(record.requests.reduce((sum, item) => sum + item.outputBytes, 0)).toBeGreaterThan(record.stdoutBytes)
    expect(record.requests.some((item) => item.retryIdentity != null)).toBe(true)
    lab.attempt.commands.push(record)
    const totals = summary(lab.attempt)
    const verified = await lab.verify()
    expect(verified, JSON.stringify(verified)).toMatchObject({ passed: true })
    expect(summary(lab.attempt).httpRequests).toBe(totals.httpRequests)
    expect(summary(lab.attempt).operations).toBe(1)
  })
  it('counts file bytes and preserves streamed event output', async () => {
    const lab = await fixture('create-flow')
    const input = JSON.stringify({ version: 1, operations: referenceChanges('create-flow', lab.current().content) })
    const file = path.join(lab.directory, 'changes.json')
    await writeFile(file, input)
    const result = await cli(lab, ['apply', lab.manifest.flowId, '--file', file, '--json'])
    expect(result.record.exitCode, result.stderr).toBe(0)
    expect(result.record.inputs).toEqual([{ source: await realpath(file), bytes: Buffer.byteLength(input) }])
    const run = await cli(lab, ['run', lab.manifest.flowId, '--wait', '--json'])
    expect(run.record.exitCode, run.stderr).toBe(0)
    const runId = JSON.parse(run.stdout).run.runId
    const events = await cli(lab, ['runs', 'events', runId, '--follow', '--json'])
    expect(events.record.exitCode, events.stderr).toBe(0)
    expect(events.record.stdoutBytes).toBe(Buffer.byteLength(events.stdout))
    expect(events.record.stdoutBytes).toBeGreaterThan(0)
  })
  it('preserves atomicity and idempotency and rejects stale heads', async () => {
    const lab = await fixture()
    const base = lab.current()
    const changes = referenceChanges(lab.scenarioId, base.content)
    const first = await lab.service.control.changeDraft('operator', lab.manifest.flowId, base.revisionId, changes, 'same')
    expect(await lab.service.control.changeDraft('operator', lab.manifest.flowId, base.revisionId, changes, 'same')).toEqual(first)
    await expect(lab.service.control.changeDraft('operator', lab.manifest.flowId, base.revisionId, changes, 'new')).rejects.toThrow()
    const head = lab.current()
    await expect(
      lab.service.control.changeDraft(
        'operator',
        lab.manifest.flowId,
        head.revisionId,
        [
          { kind: 'graph.node.field.set', target: { kind: 'flow' }, nodeId: 'notify', field: 'name', before: 'Send notification', value: 'Partial' },
          { kind: 'task.delete', taskId: 'missing' },
        ],
        'bad',
      ),
    ).rejects.toThrow()
    expect(lab.current()).toEqual(head)
  })
  it('restores identity and baseline, clears runs, and isolates sessions', async () => {
    const lab = await fixture(),
      other = await fixture()
    const before = lab.current(),
      flowId = lab.manifest.flowId,
      attempt = lab.attempt.id
    await lab.service.control.changeDraft('operator', flowId, before.revisionId, referenceChanges(lab.scenarioId, before.content), 'edit')
    const run = await lab.service.control.runs.createDraftRun(flowId, lab.current().revisionId, currentEngineContract, {}, 'test-run', {
      nodeId: 'start',
      outputs: {},
    })
    await lab.reset()
    expect(lab.manifest.flowId).toBe(flowId)
    expect(lab.current()).toEqual(before)
    expect(lab.attempt.id).not.toBe(attempt)
    expect(lab.mocks.calls).toEqual([])
    expect(() => lab.service.control.runs.getRun(run.run.runId)).toThrow()
    expect(other.current().content).toEqual(before.content)
    expect(await readFile(path.join(lab.directory, `${attempt}.json`), 'utf8')).toContain('endedAt')
  })
  it('detects unmet goals and unrelated edits, and rejects unknown external actions', async () => {
    const lab = await fixture()
    expect((await lab.verify()).passed).toBe(false)
    const base = lab.current()
    await lab.service.control.changeDraft(
      'operator',
      lab.manifest.flowId,
      base.revisionId,
      [
        ...referenceChanges(lab.scenarioId, base.content),
        { kind: 'graph.node.field.set', target: { kind: 'flow' }, nodeId: 'notify', field: 'name', before: 'Send notification', value: 'Unexpected rename' },
      ],
      'edit',
    )
    expect(assertions(lab.scenarioId, lab.baseline, lab.current().content)).toContain('Content outside the requested edit changed.')
    await expect(lab.mocks.connector.execute('unknown', undefined, {}, 'x', new AbortController().signal)).rejects.toThrow('Unsupported Lab')
  })
  it('marks unregistered client writes and excludes mixed attempts from comparison', async () => {
    const lab = await fixture()
    const result = await cli(lab, ['node', 'set', lab.manifest.flowId, 'notify', '--name', 'Browser edit', '--json'], undefined, false)
    expect(result.record.exitCode).toBe(0)
    expect(lab.attempt.mixed).toBe(true)
    expect(() => compare(lab.attempt, lab.attempt)).toThrow('successful')
  })
})

it('deduplicates a shared code file within a command and counts it again across commands', async () => {
  const lab = await fixture('create-flow')
  const file = path.join(lab.directory, 'code.js')
  const source = 'export default async function () { return { value: "你好 🌏" } }'
  await writeFile(file, source)
  const spec = JSON.stringify({ version: 1, nodes: { a: { kind: 'code', name: 'A', code: `@${file}` }, b: { kind: 'code', name: 'B', code: `@${file}` } } })
  const first = await cli(lab, ['apply', lab.manifest.flowId, '--file', '-', '--json'], spec)
  expect(first.record.exitCode, first.stderr).toBe(0)
  const fileInputs = first.record.inputs.filter((input) => input.source != 'stdin')
  expect(fileInputs).toEqual([{ source: await realpath(file), bytes: Buffer.byteLength(source) }])
  await lab.reset()
  const second = await cli(lab, ['apply', lab.manifest.flowId, '--file', '-', '--json'], spec)
  expect(second.record.inputs).toEqual(first.record.inputs)
})

it('counts exact replays, excludes post-completion commands and rejects mixed comparisons', async () => {
  const lab = await fixture()
  const before = lab.current()
  const input = JSON.stringify({ version: 1, operations: referenceChanges(lab.scenarioId, before.content) })
  const args = ['apply', lab.manifest.flowId, '--file', '-', '--expected-revision', before.revisionId, '--idempotency-key', 'repeat', '--json']
  const a = await cli(lab, args, input),
    b = await cli(lab, args, input)
  expect(a.record.exitCode).toBe(0)
  expect(b.record.exitCode).toBe(0)
  lab.attempt.commands.push(a.record, b.record)
  expect(summary(lab.attempt).retries).toBe(1)
  expect((await lab.verify()).passed).toBe(true)
  lab.attempt.after.push(a.record)
  expect(summary(lab.attempt).operations).toBe(2)
  expect(compare(lab.attempt, lab.attempt).delta.operations).toBe(0)
  lab.attempt.mixed = true
  expect(() => compare(lab.attempt, lab.attempt)).toThrow()
})

it('blocks unknown HTTP destinations before contacting them', async () => {
  const { labFetch } = await import('../scripts/lab/network.ts')
  let contacted = false
  const guarded = labFetch(
    async () => {
      contacted = true
      return new Response('ok')
    },
    new Set(['http://127.0.0.1:1234']),
  )
  await expect(guarded('https://example.com')).rejects.toThrow('blocked')
  expect(contacted).toBe(false)
  expect(await (await guarded('http://127.0.0.1:1234/v1/actions')).text()).toBe('ok')
})

it('serves the same mock Action through the browser proxy without counting reads as edits', async () => {
  const lab = await fixture()
  const response = await fetch(`${lab.manifest.origin}/v1/connector/proxy/actions?service=lab-notifications`, {
    headers: { authorization: `Bearer ${lab.token}` },
  })
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.data[0].id).toBe((await lab.mocks.connector.getAction('lab-notifications.send')).actionId)
  expect(lab.attempt.mixed).toBe(false)
})

it('rejects verification while an existing Run is waiting, and reset removes that Run', async () => {
  const lab = await fixture('create-flow')
  const base = lab.current()
  const changed = await lab.service.control.changeDraft(
    'operator',
    lab.manifest.flowId,
    base.revisionId,
    [
      { kind: 'graph.node.create', target: { kind: 'flow' }, nodeId: 'start', node: { kind: 'manual', name: 'Start' } },
      {
        kind: 'graph.node.create',
        target: { kind: 'flow' },
        nodeId: 'wait',
        node: { kind: 'wait', name: 'Pause', inputs: {}, inputDefinitions: [], prompt: 'Wait' },
      },
      { kind: 'graph.edge.connect', target: { kind: 'flow' }, edge: { source: 'start', target: 'wait' } },
    ],
    'waiting',
  )
  const { run } = await lab.service.control.runs.createDraftRun(lab.manifest.flowId, changed.revision.revisionId, currentEngineContract, {}, 'wait-run', {
    nodeId: 'start',
    outputs: {},
  })
  await expect.poll(() => lab.service.control.runs.getRun(run.runId).waits.length).toBe(1)
  await expect(lab.verify()).rejects.toThrow('existing Run')
  await lab.reset()
  expect(() => lab.service.control.runs.getRun(run.runId)).toThrow()
})
