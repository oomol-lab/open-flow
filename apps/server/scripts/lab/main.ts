import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { Attempt } from './report.ts'
import type { Manifest } from './session.ts'

import { runLabCli } from '@oomol-lab/open-flow-command/lab'
import { spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, mkdtemp, writeFile, copyFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'
import { frontendConfig } from '../../vite.config.ts'
import { labFetch, labOrigins } from './network.ts'
import { servePreview } from './preview.ts'
import { compare, summary, reportText } from './report.ts'
import { scenarios, scenario, referenceChanges } from './scenarios.ts'
import { LabSession, jsonFile, saveJson } from './session.ts'
import { startupMessage } from './terminal.ts'

const root = path.resolve(import.meta.dirname, '../../../..')
const stateRoot = path.join(root, '.open-flow-lab')
async function command(manifest: Manifest, args: string[], stdin?: string, capture = false) {
  const id = randomUUID()
  const begin = await control<{ attemptId: string }>(manifest, 'begin', { id })
  let stdout = ''
  const record = await runLabCli(args, {
    id,
    origin: manifest.origin,
    token: manifest.token,
    ...(stdin == null ? {} : { stdin: async () => stdin }),
    output: (stream, value) => {
      appendFileSync(path.join(manifest.directory, `${begin.attemptId}.${id}.${stream}`), value)
      process[stream].write(value)
      // Reference scripts consume bounded inspect/schema responses, never event streams.
      if (capture && stream == 'stdout' && stdout.length < 5_000_000) stdout += value
    },
  })
  await control(manifest, 'record', record)
  return { record, stdout }
}
async function control<T = unknown>(manifest: Manifest, action: string, body?: unknown): Promise<T> {
  const response = await fetch(`${manifest.origin}/__lab/${action}`, {
    headers: { 'authorization': `Bearer ${manifest.token}`, 'content-type': 'application/json' },
    ...(body == null ? {} : { method: 'POST', body: JSON.stringify(body) }),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(JSON.stringify(result))
  return result as T
}
async function selected(id?: string) {
  const selectedId = id ?? (await readFile(path.join(stateRoot, 'current'), 'utf8')).trim()
  if (!/^[\w-]+$/.test(selectedId)) throw new Error('Invalid session ID')
  return await jsonFile<Manifest>(path.join(stateRoot, selectedId, 'session.json'))
}
async function openBrowser(url: string) {
  const executable = process.platform == 'darwin' ? 'open' : process.platform == 'win32' ? 'rundll32' : 'xdg-open'
  const args = process.platform == 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  const child = spawn(executable, args, { stdio: 'ignore' })
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => (code == 0 ? resolve() : reject(new Error('Browser could not be opened'))))
  })
}
async function start(id: string) {
  scenario(id)
  const directory = path.join(stateRoot, randomUUID())
  const lab = new LabSession(directory, id)
  let frontend: Awaited<ReturnType<typeof createServer>> | undefined
  const http = createHttpServer((request, response) => {
    if (servePreview(lab, request, response)) return
    if (frontend == null) {
      response.statusCode = 503
      response.end()
      return
    }
    frontend.middlewares(request, response, () => {
      response.statusCode = 404
      response.end()
    })
  })
  try {
    await lab.open()
    frontend = await createServer({
      ...frontendConfig(),
      root: path.join(import.meta.dirname, 'browser'),
      configFile: false,
      optimizeDeps: { entries: ['index.html'] },
      envDir: false,
      server: { middlewareMode: true, ws: { server: http } },
    })
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(0, '127.0.0.1', resolve)
    })
    const address = http.address()
    if (address == null || typeof address == 'string') throw new Error('Preview has no address')
    lab.manifest.preview = `http://127.0.0.1:${address.port}/`
    await lab.saveManifest()
    await writeFile(path.join(stateRoot, 'current'), lab.manifest.id)
    console.log(startupMessage(lab.manifest, scenario(id), process.stdout.columns))
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve)
      process.once('SIGTERM', resolve)
    })
  } finally {
    await lab.close()
    await frontend?.close()
    http.closeAllConnections()
    await new Promise<void>((resolve) => http.close(() => resolve()))
  }
}
async function reference(lab: LabSession) {
  const run = async (args: string[], stdin?: string) => {
    const output = await command(lab.manifest, args, stdin, true)
    if (output.record.exitCode != 0) throw new Error(`Reference command failed: ${args.join(' ')}`)
    return JSON.parse(output.stdout)
  }
  const flowId = lab.manifest.flowId
  const inspected = (await run(['inspect', flowId, '--full', '--json'])) as { draft: { revisionId: string; content: RevisionContent } }
  if (lab.scenarioId == 'create-flow') {
    await run(['connector', 'search', 'notification', '--flow', flowId, '--json'])
    await run(['connector', 'show', 'lab-notifications.send', '--flow', flowId, '--json'])
    await run(['connector', 'connections', 'lab-notifications', '--flow', flowId, '--json'])
  }
  const operations = referenceChanges(lab.scenarioId, inspected.draft.content)
  for (const kind of new Set(operations.map((operation) => operation.kind))) await run(['schema', kind, '--json'])
  await run(
    ['apply', flowId, '--file', '-', '--expected-revision', inspected.draft.revisionId, '--idempotency-key', `reference-${lab.attempt.id}`, '--json'],
    JSON.stringify({ version: 1, operations }),
  )
  await run(['check', flowId, '--json'])
  const result = await lab.verify()
  if (!result.passed) throw new Error(JSON.stringify(result))
}
async function test(id?: string, keepFailed = false) {
  const source = await readFile(import.meta.filename)
  let failures = 0
  for (const item of id == null ? scenarios : [scenario(id)]) {
    const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-lab-'))
    const lab = new LabSession(directory, item.id)
    let passed = false
    try {
      await lab.open()
      lab.attempt.script = `reference-v1:${createHash('sha256')
        .update(source)
        .update(await readFile(path.join(import.meta.dirname, 'scenarios.ts')))
        .digest('hex')}`
      await reference(lab)
      passed = true
    } catch (error) {
      failures++
      console.error(`${item.id}: ${String(error)}`)
      if (lab.attempt != null) {
        lab.finish(false)
        await lab.persist()
      }
    } finally {
      if (lab.attempt != null) {
        await mkdir(path.join(stateRoot, 'reports'), { recursive: true })
        await saveJson(path.join(stateRoot, 'reports', `${lab.attempt.id}.json`), lab.attempt)
        const artifacts = path.join(stateRoot, 'reports', lab.attempt.id)
        await mkdir(artifacts, { recursive: true })
        for (const file of await readdir(directory))
          if (file.endsWith('.stdout') || file.endsWith('.stderr')) await copyFile(path.join(directory, file), path.join(artifacts, file))
        console.log(JSON.stringify({ scenario: item.id, passed, attemptId: lab.attempt.id, totals: summary(lab.attempt) }, null, 2))
      }
      await lab.close()
      if (passed || !keepFailed) await rm(directory, { recursive: true, force: true })
      else console.error(`Stopped failure session retained at ${directory}`)
    }
  }
  return failures == 0 ? 0 : 1
}
async function findAttempt(id: string): Promise<Attempt> {
  if (!/^[\w-]+$/.test(id)) throw new Error('Invalid attempt ID')
  for (const entry of await readdir(stateRoot, { withFileTypes: true }))
    if (entry.isDirectory()) {
      try {
        return await jsonFile<Attempt>(path.join(stateRoot, entry.name, `${id}.json`))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code != 'ENOENT') throw error
      }
    }
  throw new Error(`Attempt not found: ${id}`)
}
async function main() {
  const args = process.argv.slice(2)
  let sessionId: string | undefined
  // Lab flags precede the delegated command; all following flow arguments are untouched.
  if (args[0] == '--session') {
    args.shift()
    sessionId = args.shift()
    if (sessionId == null) throw new Error('Missing session ID')
  }
  const action = args.shift()
  if (action == 'list') {
    console.log(JSON.stringify(scenarios, null, 2))
    return 0
  }
  if (action == 'start') {
    await start(args[0] ?? 'fix-notification')
    return 0
  }
  if (action == 'test')
    return await test(
      args.find((arg) => !arg.startsWith('--')),
      args.includes('--keep-failed'),
    )
  if (action == null || action == '--help') {
    console.log(
      'bun run lab [--session ID] list|start SCENARIO|open|flow ...|diff|verify|report [--attempt ID] [--compare ID]|reset|test [SCENARIO] [--keep-failed]|clean SESSION_ID\nreport supports --json; other Lab results are JSON. flow preserves production CLI output and exit codes.',
    )
    return 0
  }
  if (action == 'report' && args.includes('--attempt')) {
    const attempt = await findAttempt(args[args.indexOf('--attempt') + 1] ?? '')
    const otherId = args[args.indexOf('--compare') + 1]
    const result = { attempt, totals: summary(attempt), ...(args.includes('--compare') ? { comparison: compare(attempt, await findAttempt(otherId!)) } : {}) }
    console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : reportText(result))
    return 0
  }
  const manifest = await selected(action == 'clean' ? args[0] : sessionId)
  if (action == 'clean') {
    if (!manifest.stopped) {
      try {
        process.kill(manifest.pid, 0)
        throw new Error('Session process is still running')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code != 'ESRCH') throw error
      }
    }
    await rm(manifest.directory, { recursive: true, force: true })
    return 0
  }
  labOrigins.add(manifest.origin)
  if (manifest.stopped) throw new Error('Session is stopped. Use report --attempt ID or start a new session.')
  if (action == 'flow') return (await command(manifest, args)).record.exitCode
  if (action == 'open') {
    await openBrowser(manifest.preview!)
    return 0
  }
  if (action == 'report') {
    const result = await control<{ attempt: Attempt }>(manifest, 'report')
    const report = {
      ...result,
      ...(args.includes('--compare') ? { comparison: compare(result.attempt, await findAttempt(args[args.indexOf('--compare') + 1]!)) } : {}),
    }
    console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : reportText(report))
    return 0
  }
  if (['diff', 'verify', 'reset'].includes(action)) {
    const result = await control<{ passed?: boolean }>(manifest, action, action == 'diff' ? undefined : {})
    console.log(JSON.stringify(result, null, 2))
    return result.passed === false ? 1 : 0
  }
  throw new Error('Unknown Lab command. Use --help.')
}
if (import.meta.main) {
  globalThis.fetch = labFetch(globalThis.fetch, labOrigins)
  try {
    process.exitCode = await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
