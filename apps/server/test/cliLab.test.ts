import { runLabCli } from '@oomol-lab/open-flow-command/lab'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { driver } from '../scripts/lab/driver.ts'
import { servePreview } from '../scripts/lab/preview.ts'
import { reference } from '../scripts/lab/reference.ts'
import { summary, compare, reportText } from '../scripts/lab/report.ts'
import { scenarios, stageCount } from '../scripts/lab/scenarios.ts'
import { LabSession } from '../scripts/lab/session.ts'
import { agentPrompt, startupMessage } from '../scripts/lab/terminal.ts'

const sessions: LabSession[] = []
afterEach(async () => {
  for (const session of sessions.splice(0)) {
    await session.close()
    await rm(session.directory, { recursive: true, force: true })
  }
})
async function fixture(id = 'customer-redaction') {
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
  it('provides a complete public task prompt without credentials or fixture identities', async () => {
    const lab = await fixture('specialize-summary')
    const task = scenarios.find((item) => item.id == lab.scenarioId)!
    const workingDirectory = '/workspace/open-flow'
    const prompt = agentPrompt(lab.manifest, task, workingDirectory)
    expect(prompt).toContain(task.task)
    expect(prompt).toContain(`Working directory: ${workingDirectory}`)
    expect(prompt).toContain(`Flow: ${lab.manifest.flowId}`)
    expect(prompt).toContain(`bun run lab --session ${lab.manifest.id} flow ...`)
    expect(prompt).not.toContain(lab.token)
    expect(prompt).not.toContain(lab.directory)
    expect(prompt).not.toContain(lab.manifest.origin)
    expect(startupMessage(lab.manifest, task, workingDirectory, 80)).toContain(prompt)
  })

  it('records concurrent offline discovery separately while keeping deployment commands and verification exclusive', async () => {
    const lab = await fixture('specialize-summary')
    const control = (action: string, body: unknown) =>
      fetch(`${lab.manifest.origin}/__lab/${action}`, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${lab.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    const help = { id: randomUUID(), args: ['read', '--help', '--json'] }
    const schema = { id: randomUUID(), args: ['schema', 'read', '--json'] }
    const online = { id: randomUUID(), args: ['read', lab.manifest.flowId, '--json'] }
    const registrations = await Promise.all([help, schema, online].map((command) => control('begin', command)))
    expect(registrations.map((response) => response.status)).toEqual([200, 200, 200])
    const rejected = { id: randomUUID(), args: ['schema', '--flow', lab.manifest.flowId, '--json'] }
    const rejectedResponse = await control('begin', rejected)
    expect(rejectedResponse.status).toBe(409)
    const rejectedBody = await rejectedResponse.text()
    expect(lab.attempt.admissionFailures).toEqual([
      expect.objectContaining({
        ...rejected,
        reason: JSON.parse(rejectedBody).error,
        argumentBytes: Buffer.byteLength(rejected.args.join(' ')),
        outputBytes: Buffer.byteLength(rejectedBody + '\n'),
      }),
    ])
    expect(JSON.parse(await readFile(path.join(lab.directory, `${lab.attempt.id}.json`), 'utf8')).admissionFailures).toEqual(lab.attempt.admissionFailures)
    expect((await control('begin', help)).status).toBe(409)
    expect((await control('begin', { id: randomUUID(), args: [false] })).status).toBe(409)
    expect((await control('verify', {})).status).toBe(409)
    expect((await control('reset', {})).status).toBe(409)
    const records = await Promise.all(
      [help, schema, online].map(async ({ id, args }) => {
        const record = await runLabCli(args, { id, origin: lab.manifest.origin, token: lab.token, output: () => {} })
        expect(record.exitCode).toBe(0)
        expect((await control('record', record)).status).toBe(200)
        return record
      }),
    )
    expect(records[0]!.requests).toHaveLength(0)
    expect(records[1]!.requests).toHaveLength(0)
    expect(records[2]!.requests.length).toBeGreaterThan(0)
    expect(lab.attempt.commands.map((record) => record.id).toSorted()).toEqual([help.id, schema.id, online.id].toSorted())
    expect(summary(lab.attempt).stdoutBytes).toBe(records.reduce((sum, record) => sum + record.stdoutBytes, 0))
    const totals = summary(lab.attempt)
    expect(totals.admissionRejections).toBe(2)
    expect(totals.operations).toBe(3)
    expect(totals.toolCalls).toBe(5)
    expect(totals.failures).toBe(0)
    expect(totals.repairAttempts).toBe(0)
    expect(totals.httpRequests).toBe(records.reduce((sum, record) => sum + record.requests.length, 0))
    expect(totals.visibleInputBytes).toBe(totals.argumentBytes + totals.inputContentBytes + totals.admissionArgumentBytes)
    expect(totals.visibleOutputBytes).toBe(totals.stdoutBytes + totals.stderrBytes + totals.admissionOutputBytes)
    expect(reportText({ attempt: lab.attempt })).toContain('Lab admission rejections: 2 (no production HTTP request or edit submission)')
    expect(reportText({ attempt: lab.attempt })).toContain(JSON.parse(rejectedBody).error)
    expect(lab.active.size).toBe(0)
    // Competing deployments must still serialize, even when their registrations arrive together.
    const writes = await Promise.all([1, 2].map(() => control('begin', { id: randomUUID(), args: ['edit', lab.manifest.flowId] })))
    expect(writes.map((response) => response.status).toSorted()).toEqual([200, 409])
    lab.active.clear()
    lab.finish(true)
    const completed = summary(lab.attempt)
    lab.busy = true
    expect((await control('begin', { id: randomUUID(), args: help.args })).status).toBe(409)
    expect(lab.attempt.afterAdmissionFailures).toHaveLength(1)
    expect(summary(lab.attempt)).toEqual(completed)
    const saved = JSON.parse(await readFile(path.join(lab.directory, `${lab.attempt.id}.json`), 'utf8'))
    expect(saved.afterAdmissionFailures).toEqual(lab.attempt.afterAdmissionFailures)
    expect(reportText({ attempt: lab.attempt })).toContain('0 post-completion commands and 1 admission rejections excluded.')
    lab.busy = false
    expect((await control('reset', {})).status).toBe(200)
  })

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
      const changed = await cli(lab, [
        'edit',
        lab.manifest.flowId,
        '--input',
        JSON.stringify({
          baseRevision: lab.head(),
          requestId: 'preview-edit',
          edits: [{ op: 'node.update', node: 'notify', set: { description: 'Preview edit' } }],
        }),
        '--json',
      ])
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

  it.each(['cli', 'mcp'] as const)(
    'solves every redesigned scenario through %s using independent acceptance',
    async (transport) => {
      for (const scenario of scenarios) {
        const lab = await fixture(scenario.id)
        for (let stage = 0; stage < stageCount(scenario.id); stage++) {
          await reference(driver(lab, transport), scenario.id, lab.manifest.flowId, stage)
          const before = summary(lab.attempt)
          const result = await lab.verify()
          expect(result, `${scenario.id}/${stage}: ${JSON.stringify(result)}`).toMatchObject({ passed: true })
          expect(summary(lab.attempt).httpRequests).toBe(before.httpRequests)
          expect(lab.attempt.mixed).toBe(false)
          expect(lab.attempt.excluded?.some((event) => event.kind == 'verification')).toBe(true)
          if (stage + 1 < stageCount(scenario.id)) {
            const previous = lab.attempt
            await lab.next()
            expect(lab.attempt.previousAttemptId).toBe(previous.id)
            expect(lab.attempt.startRevision).toBe(previous.endRevision)
            expect(lab.attempt.commands).toHaveLength(0)
          }
        }
        await lab.close()
        sessions.splice(sessions.indexOf(lab), 1)
        await rm(lab.directory, { recursive: true, force: true })
      }
    },
    120_000,
  )
  it('gates continuing tasks on an unchanged accepted draft and resets the whole journey', async () => {
    const lab = await fixture('fulfillment-ops')
    const initial = lab.head()
    await expect(lab.next()).rejects.toThrow('Verify')
    await reference(driver(lab, 'cli'), lab.scenarioId, lab.manifest.flowId, 0)
    expect((await lab.verify()).passed).toBe(true)
    lab.active.add('in-flight')
    await expect(lab.next()).rejects.toThrow('active')
    lab.active.clear()
    const before = lab.current()
    await cli(lab, [
      'edit',
      lab.manifest.flowId,
      '--input',
      JSON.stringify({
        baseRevision: before.revisionId,
        requestId: 'after-acceptance',
        edits: [{ op: 'node.update', node: Object.keys(before.content.document.graph.nodes)[0], set: { description: 'Changed after acceptance' } }],
      }),
      '--json',
    ])
    await expect(lab.next()).rejects.toThrow('Verify')
    await lab.reset()
    expect(lab.stage).toBe(0)
    expect(lab.head()).toBe(initial)
    expect(lab.attempt.previousAttemptId).toBeUndefined()
    expect(lab.attempt.commands).toHaveLength(0)
  })
  it('rejects the unmodified privacy fixture and detects archive damage after a valid edit', async () => {
    const lab = await fixture()
    expect((await lab.verify()).passed).toBe(false)
    expect(lab.attempt.excludedWallMs).toBeGreaterThan(0)
    await reference(driver(lab, 'cli'), lab.scenarioId, lab.manifest.flowId)
    const current = lab.current()
    await lab.service.control.changeDraft(
      'test',
      lab.manifest.flowId,
      current.revisionId,
      [{ kind: 'graph.node.field.set', nodeId: 'archive', field: 'name', before: 'Internal archive', value: 'Changed archive' }],
      'damage',
    )
    expect((await lab.verify()).errors).toContain('Unrelated node archive changed.')
  })
  it('resets conflict gates and seeds a discoverable failure after reset', async () => {
    const lab = await fixture('repair-amount')
    expect(lab.service.control.runs.listRuns(lab.manifest.flowId, 10, {}).page.runs.some((r) => r.status == 'failed')).toBe(true)
    await lab.reset()
    expect(lab.service.control.runs.listRuns(lab.manifest.flowId, 10, {}).page.runs.some((r) => r.status == 'failed')).toBe(true)
    expect(lab.attempt.commands).toHaveLength(0)
  })
  it('preserves versioned comparison boundaries and counts bytes independently', async () => {
    const lab = await fixture('concurrent-edit')
    await reference(driver(lab, 'cli'), lab.scenarioId, lab.manifest.flowId)
    expect((await lab.verify()).passed).toBe(true)
    const totals = summary(lab.attempt)
    expect(totals.argumentBytes).toBeGreaterThan(0)
    expect(totals.httpOutputBytes).toBeGreaterThan(0)
    expect(totals.revisionConflicts).toBe(1)
    expect(() => compare(lab.attempt, { ...lab.attempt, scenarioVersion: 99 })).toThrow('same scenario and version')
    expect(() => compare(lab.attempt, { ...lab.attempt, mixed: true })).toThrow('controlled attempts')
    expect(() => compare(lab.attempt, { ...lab.attempt, scenarioIdentity: 'changed' })).toThrow('same fixture and verifier')
  })
})
