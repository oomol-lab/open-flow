import type { CommandRecord } from '@oomol-lab/open-flow-command/lab'
import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { Attempt } from './report.ts'

import { serve } from '@hono/node-server'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Scope from 'effect/Scope'
import { Hono } from 'hono'
import { execFileSync } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { once } from 'node:events'
import { copyFile, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises'
import path from 'node:path'
import { ServerService } from '../../node/application/service.ts'
import { createLlm } from '../../node/deployment/llm.ts'
import { OperatorSession } from '../../node/deployment/operator.ts'
import { Settings } from '../../node/deployment/settings.ts'
import { Database } from '../../node/storage/database.ts'
import { OperatorStore } from '../../node/storage/operator-store.ts'
import { SettingsStore } from '../../node/storage/settings-store.ts'
import { createServerApp } from '../../node/transport/http.ts'
import { createMocks } from './mocks.ts'
import { labOrigins } from './network.ts'
import { diff, summary } from './report.ts'
import { assertions, initialOperations, scenario } from './scenarios.ts'

export interface Manifest {
  id: string
  scenario: string
  origin: string
  token: string
  flowId: string
  preview?: string
  pid: number
  directory: string
  startedAt: string
  stopped?: boolean
}
export async function jsonFile<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T
}
export async function saveJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(temporary, file)
}
export class LabSession {
  readonly directory: string
  readonly scenarioId: string
  readonly token = randomUUID() + randomUUID()
  service!: ServerService
  database!: Database
  scope!: Scope.Closeable
  mocks = createMocks()
  manifest!: Manifest
  attempt!: Attempt
  baseline!: RevisionContent
  presentation: unknown
  app!: ReturnType<typeof createServerApp>
  server?: ReturnType<typeof serve>
  modelServer?: ReturnType<typeof serve>
  modelOrigin = ''
  active = new Set<string>()
  private saving: Promise<void> = Promise.resolve()
  busy = false
  resetting = false
  shutdown = new AbortController()

  constructor(directory: string, scenarioId: string) {
    this.directory = directory
    this.scenarioId = scenario(scenarioId).id
  }
  async open() {
    await mkdir(this.directory, { recursive: true })
    this.modelServer = serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => this.mocks.model.fetch(request) })
    await once(this.modelServer, 'listening')
    this.modelOrigin = origin(this.modelServer)
    labOrigins.add(this.modelOrigin)
    await this.openService()
    const flow = (await this.service.control.createFlow('lab', `Lab ${this.scenarioId}`, 'lab-initial')).flow
    const operations = initialOperations(this.scenarioId)
    if (operations.length > 0) await this.service.control.changeDraft('lab', flow.flowId, flow.draftRevisionId, operations, 'lab-seed')
    const content = this.current(flow.flowId).content
    const positions = {
      start: { x: 40, y: 160 },
      format: { x: 420, y: 160 },
      notify: { x: 800, y: 160 },
      summary: { x: 420, y: 420 },
      archive: { x: 800, y: 420 },
    }
    const nodes = Object.fromEntries(Object.entries(positions).filter(([id]) => content.document.graph.nodes[id] != null))
    this.service.control.updatePresentation(flow.flowId, this.service.control.getPresentation(flow.flowId).revision, {
      designer: { version: 1, flow: { nodes, viewport: { x: 0, y: 0, zoom: 0.6 } } },
    })
    this.baseline = content
    this.presentation = this.service.control.getPresentation(flow.flowId).value
    this.database.connection.prepare('VACUUM INTO ?').run(path.join(this.directory, 'baseline.sqlite'))
    const router = new Hono()
    router.use('*', async (context, next) => {
      const incoming = context.req.header('origin')
      if (incoming != null && incoming != new URL(context.req.url).origin) return context.text('Origin rejected', 403)
      if ((this.resetting || (this.busy && !['GET', 'HEAD'].includes(context.req.method))) && !context.req.path.startsWith('/__lab/'))
        return context.text('Lab is resetting or verifying', 503)
      const beforeRevision = this.manifest == null ? undefined : this.head()
      await next()
      if (
        context.req.path.startsWith('/v1/') &&
        !['GET', 'HEAD', 'OPTIONS'].includes(context.req.method) &&
        context.res.status < 400 &&
        this.head() != beforeRevision &&
        !this.active.has(context.req.header('x-lab-command') ?? '')
      ) {
        if (this.attempt.endedAt == null) this.attempt.mixed = true
        await this.persist()
      }
    })
    router.all('/__lab/:action', async (context) => {
      if (context.req.header('authorization') != `Bearer ${this.token}`) return context.text('Unauthorized', 401)
      const action = context.req.param('action')
      try {
        if (action == 'state' && context.req.method == 'GET')
          return context.json({ ...this.manifest, attemptId: this.attempt.id, task: scenario(this.scenarioId).task })
        if (action == 'begin' && context.req.method == 'POST') {
          if (this.busy || this.active.size > 0) throw new Error('Lab is busy; commands in a session run sequentially.')
          const { id } = await context.req.json<{ id: string }>()
          this.active.add(id)
          return context.json({ attemptId: this.attempt.id })
        }
        if (action == 'record' && context.req.method == 'POST') {
          const record = await context.req.json<CommandRecord>()
          if (!this.active.delete(record.id)) throw new Error('Unknown command registration')
          ;(this.attempt.endedAt == null ? this.attempt.commands : this.attempt.after).push(record)
          await this.persist()
          return context.json({ recorded: true })
        }
        if (action == 'diff') return context.json(this.changes())
        if (action == 'report') return context.json({ attempt: this.attempt, totals: summary(this.attempt) })
        if (action == 'verify' && context.req.method == 'POST') return context.json(await this.verify())
        if (action == 'reset' && context.req.method == 'POST') {
          await this.reset()
          return context.json({ attemptId: this.attempt.id, refreshBrowser: false })
        }
        if (action == 'fail' && context.req.method == 'POST') {
          this.finish(false)
          await this.persist()
          return context.json({ ended: true })
        }
        return context.text('Unknown Lab operation', 404)
      } catch (error) {
        return context.json({ error: error instanceof Error ? error.message : String(error) }, 409)
      }
    })
    router.all('*', (context) => this.app.fetch(context.req.raw))
    this.server = serve({ hostname: '127.0.0.1', port: 0, fetch: router.fetch, overrideGlobalObjects: false })
    await once(this.server, 'listening')
    this.manifest = {
      id: path.basename(this.directory),
      directory: this.directory,
      scenario: this.scenarioId,
      origin: origin(this.server),
      token: this.token,
      flowId: flow.flowId,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    }
    labOrigins.add(this.manifest.origin)
    await this.newAttempt()
    await this.saveManifest()
    await Effect.runPromise(this.service.start().pipe(Scope.provide(this.scope)))
    return this
  }
  head(): string | undefined {
    try {
      return this.current().revisionId
    } catch {
      return undefined
    }
  }
  current(flowId = this.manifest.flowId) {
    return this.service.control.getRevision(flowId, this.service.control.getFlow(flowId).draftRevisionId)
  }
  async openService() {
    this.database = Database.open(path.join(this.directory, 'flow.sqlite'))
    this.scope = await Effect.runPromise(Scope.make())
    this.shutdown = new AbortController()
    this.service = await Effect.runPromise(
      ServerService.open(this.database, {
        capabilities: { connector: () => this.mocks.connector, llm: () => createLlm(this.modelOrigin, 'lab-only') },
        runtime: { runTimeoutMs: 15_000 },
        triggerDefinitions: [],
      }).pipe(Scope.provide(this.scope)),
    )
    const operator = new OperatorSession(new OperatorStore(this.database), this.token, false)
    this.app = createServerApp(this.service, {
      operator,
      settings: new Settings(new SettingsStore(this.database), {
        connectorOrigin: this.modelOrigin,
        connectorToken: 'lab-only',
        llmOrigin: this.modelOrigin,
        llmToken: 'lab-only',
      }),
      shutdownSignal: this.shutdown.signal,
    })
  }
  async newAttempt() {
    let head = 'unavailable',
      dirty = true,
      diffDigest = ''
    try {
      head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
      dirty = status.length > 0
      diffDigest = createHash('sha256')
        .update(execFileSync('git', ['diff', 'HEAD']))
        .update(status)
        .digest('hex')
    } catch {
      /* report unavailable source identity */
    }
    this.attempt = {
      id: randomUUID(),
      scenario: this.scenarioId,
      scenarioVersion: scenario(this.scenarioId).version,
      startedAt: new Date().toISOString(),
      startRevision: this.current().revisionId,
      mixed: false,
      git: { head, dirty, diffDigest },
      commands: [],
      after: [],
      verifications: [],
    }
    await this.persist()
  }
  async persist() {
    const file = path.join(this.directory, `${this.attempt.id}.json`)
    const snapshot = structuredClone(this.attempt)
    this.saving = this.saving.then(() => saveJson(file, snapshot))
    await this.saving
  }
  async saveManifest() {
    await saveJson(path.join(this.directory, 'session.json'), this.manifest)
  }
  changes() {
    return {
      revisionId: this.current().revisionId,
      semantic: diff(this.baseline, this.current().content),
      presentation: diff(this.presentation, this.service.control.getPresentation(this.manifest.flowId).value),
    }
  }
  finish(passed: boolean) {
    if (this.attempt.endedAt != null) return
    this.attempt.endedAt = new Date().toISOString()
    this.attempt.endRevision = this.head()
    this.attempt.passed = passed
  }
  async verify() {
    const taskEndedAt = new Date().toISOString()
    if (this.busy || this.active.size > 0) throw new Error('Wait for active commands before verifying.')
    for (const status of ['queued', 'starting', 'running', 'waiting'] as const) {
      if (this.service.control.runs.listRuns(this.manifest.flowId, 1, { status }).page.runs.length > 0)
        throw new Error('Finish, cancel, or reset the existing Run before verifying.')
    }
    this.busy = true
    try {
      const revision = this.current()
      const errors = assertions(this.scenarioId, this.baseline, revision.content)
      const check = await this.service.control.checkFlow(this.manifest.flowId, revision.revisionId, currentEngineContract)
      if (!check.valid) errors.push(`Flow check failed: ${JSON.stringify(check)}`)
      let runId: string | undefined
      if (errors.length == 0) {
        const trigger = Object.entries(revision.content.document.graph.nodes).find(([, node]) => node.kind == 'manual')
        if (trigger == null) errors.push('Missing Manual trigger')
        else {
          const offset = this.mocks.calls.length
          const accepted = await this.service.control.runs.createDraftRun(this.manifest.flowId, revision.revisionId, currentEngineContract, {}, randomUUID(), {
            nodeId: trigger[0],
            outputs: {},
          })
          runId = accepted.run.runId
          const deadline = Date.now() + 20_000
          let run = this.service.control.runs.getRun(runId)
          while (!['completed', 'failed', 'canceled', 'indeterminate'].includes(run.status) && Date.now() < deadline) {
            await new Promise((done) => setTimeout(done, 30))
            run = this.service.control.runs.getRun(runId)
          }
          if (run.status != 'completed') errors.push(`Run ${runId}: ${run.status}; ${JSON.stringify(run)}`)
          const expected = scenario(this.scenarioId).expectedText
          if (expected != null && (this.mocks.calls.length - offset != 1 || this.mocks.calls[offset]?.input.text !== expected))
            errors.push(`Expected recorded notification: ${expected}`)
          if (this.scenarioId == 'edit-code') {
            const events = this.service.control.runs.getRunEvents(runId, 0, 100)
            if (
              !events.events.some(
                (event) =>
                  event.kind == 'node.completed' &&
                  event.payload.nodeId == 'format' &&
                  event.payload.outputs.text === 'Original content' &&
                  event.payload.outputs.revised === 'Weekly summary: 3 updates',
              )
            )
              errors.push('Format must preserve text=Original content and produce the requested revised output.')
          }
        }
      }
      const result = { revisionId: revision.revisionId, passed: errors.length == 0, errors, ...(runId == null ? {} : { runId }) }
      this.attempt.verifications.push(result)
      if (result.passed && this.attempt.endedAt == null) {
        this.finish(true)
        this.attempt.endedAt = taskEndedAt
      }
      await this.persist()
      return result
    } finally {
      this.busy = false
    }
  }
  async closeService() {
    this.shutdown.abort()
    await Effect.runPromise(Scope.close(this.scope, Exit.void))
    this.database.close()
  }
  async reset() {
    if (this.busy || this.active.size > 0) throw new Error('Wait for active commands before resetting.')
    this.busy = true
    this.resetting = true
    try {
      this.finish(false)
      await this.persist()
      await this.closeService()
      for (const suffix of ['', '-wal', '-shm']) await rm(path.join(this.directory, `flow.sqlite${suffix}`), { force: true })
      await copyFile(path.join(this.directory, 'baseline.sqlite'), path.join(this.directory, 'flow.sqlite'))
      this.mocks = createMocks()
      await this.openService()
      await Effect.runPromise(this.service.start().pipe(Scope.provide(this.scope)))
      await this.newAttempt()
    } finally {
      this.resetting = false
      this.busy = false
    }
  }
  async close() {
    if (this.attempt != null) {
      this.finish(false)
      await this.persist()
    }
    if (this.scope != null) await this.closeService()
    for (const server of [this.server, this.modelServer])
      if (server != null) {
        if ('closeAllConnections' in server) server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    labOrigins.delete(this.modelOrigin)
    if (this.manifest != null) {
      labOrigins.delete(this.manifest.origin)
      this.manifest.stopped = true
      await this.saveManifest()
    }
  }
}
function origin(server: ReturnType<typeof serve>) {
  const address = server.address()
  if (address == null || typeof address == 'string') throw new Error('Server has no address')
  return `http://127.0.0.1:${address.port}`
}
