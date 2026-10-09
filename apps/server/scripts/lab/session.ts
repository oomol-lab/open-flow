import type { CommandRecord } from '@oomol-lab/open-flow-command/lab'
import type { JsonValue, RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { Attempt } from './report.ts'

import { serve } from '@hono/node-server'
import { isLabCliOffline } from '@oomol-lab/open-flow-command/lab'
import { authoringNode } from '@oomol-lab/open-flow/control-requests'
import { validateFlowInputs } from '@oomol-lab/open-flow/flow-semantics'
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
import { runtimeAssertions } from './acceptance.ts'
import { fulfillmentRuntimeAssertions } from './fulfillmentAcceptance.ts'
import { createMocks } from './mocks.ts'
import { labOrigins } from './network.ts'
import { diff, summary } from './report.ts'
import { assertions, initialOperations, scenario, samples, stageCount } from './scenarios.ts'

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
  stage?: number
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
  private offlineCommands = new Set<string>()
  private saving: Promise<void> = Promise.resolve()
  busy = false
  stage = 0
  resetting = false
  shutdown = new AbortController()

  constructor(directory: string, scenarioId: string) {
    this.directory = directory
    this.scenarioId = scenario(scenarioId).id
  }
  async open() {
    const initializationStart = performance.now()
    await mkdir(this.directory, { recursive: true })
    this.modelServer = serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => this.mocks.model.fetch(request) })
    await once(this.modelServer, 'listening')
    this.modelOrigin = origin(this.modelServer)
    labOrigins.add(this.modelOrigin)
    await this.openService()
    const flow = (await this.service.control.createFlow('operator', `Lab ${this.scenarioId}`, 'lab-initial')).flow
    const operations = initialOperations(this.scenarioId)
    if (operations.length > 0) await this.service.control.changeDraft('operator', flow.flowId, flow.draftRevisionId, operations, 'lab-seed')
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
      const body =
        context.req.method == 'POST'
          ? ((await context.req.raw
              .clone()
              .json()
              .catch(() => null)) as Record<string, unknown> | null)
          : null
      await next()
      let injected = false
      if (this.scenarioId == 'concurrent-edit' && this.attempt != null && !this.attempt.excluded?.some((e) => e.kind == 'operator-edit')) {
        const args = context.req.path.endsWith('/authoring/read')
          ? body
          : body?.method == 'tools/call' && (body.params as Record<string, unknown>)?.name == 'flow_read'
            ? (body.params as { arguments: Record<string, unknown> }).arguments
            : null
        if (
          context.res.status < 400 &&
          args != null &&
          !(await context.res.clone().text()).includes('"isError":true') &&
          (Array.isArray(args.nodes) ? args.nodes.includes('notify') : args.text == null || (args.text as { node?: string }).node == 'notify')
        ) {
          const start = performance.now()
          const before = this.current()
          await this.service.control.changeDraft(
            'lab-operator',
            this.manifest.flowId,
            before.revisionId,
            [
              {
                kind: 'graph.node.field.set',
                nodeId: 'notes',
                field: 'description',
                before: before.content.document.graph.nodes.notes?.description,
                value: 'Operator reviewed',
              },
            ],
            `operator-${this.attempt.id}`,
          )
          const durationMs = performance.now() - start
          this.attempt.excluded!.push({ kind: 'operator-edit', durationMs, revision: this.head() })
          context.header('x-lab-excluded-ms', String(durationMs))
          injected = true
          await this.persist()
        }
      }
      if (
        this.scenarioId == 'concurrent-edit' &&
        (context.req.path.endsWith('/authoring/edit') || (body?.method == 'tools/call' && (body.params as Record<string, unknown>)?.name == 'flow_edit'))
      ) {
        const responseText = await context.res.clone().text()
        if (responseText.includes('flow.revision-conflict') && beforeRevision == this.head()) this.attempt.rejectedEdits = (this.attempt.rejectedEdits ?? 0) + 1
      }
      if (
        context.req.path.startsWith('/v1/') &&
        !injected &&
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
          return context.json({ ...this.manifest, attemptId: this.attempt.id, task: scenario(this.scenarioId, this.stage).task })
        if (action == 'begin' && context.req.method == 'POST') {
          const { id, args } = await context.req.json<{ id: unknown; args?: unknown }>()
          if (typeof id != 'string' || id.length == 0 || (args != null && (!Array.isArray(args) || !args.every((arg) => typeof arg == 'string'))))
            throw new Error('Invalid command registration')
          const offline = Array.isArray(args) && isLabCliOffline(args)
          const reason =
            this.busy || (!offline && [...this.active].some((command) => !this.offlineCommands.has(command)))
              ? 'Lab is busy; deployment commands in a session run sequentially. Offline help and schema commands may run concurrently.'
              : this.active.has(id)
                ? 'Command is already registered'
                : undefined
          if (reason != null) {
            const failures = this.attempt.endedAt == null ? (this.attempt.admissionFailures ??= []) : (this.attempt.afterAdmissionFailures ??= [])
            const commandArgs = Array.isArray(args) ? args : []
            failures.push({
              id,
              args: commandArgs,
              reason,
              at: new Date().toISOString(),
              argumentBytes: Buffer.byteLength(commandArgs.join(' ')),
              outputBytes: Buffer.byteLength(JSON.stringify({ error: reason }) + '\n'),
            })
            await this.persist()
            throw new Error(reason)
          }
          this.active.add(id)
          if (offline) this.offlineCommands.add(id)
          return context.json({ attemptId: this.attempt.id })
        }
        if (action == 'record' && context.req.method == 'POST') {
          const record = await context.req.json<CommandRecord>()
          if (!this.active.delete(record.id)) throw new Error('Unknown command registration')
          this.offlineCommands.delete(record.id)
          ;(this.attempt.endedAt == null ? this.attempt.commands : this.attempt.after).push(record)
          await this.persist()
          return context.json({ recorded: true })
        }
        if (action == 'diff') return context.json(this.changes())
        if (action == 'report') return context.json({ attempt: this.attempt, totals: summary(this.attempt) })
        if (action == 'verify' && context.req.method == 'POST') return context.json(await this.verify())
        if (action == 'next' && context.req.method == 'POST') {
          await this.next()
          return context.json({ ...this.manifest, attemptId: this.attempt.id, task: scenario(this.scenarioId, this.stage).task })
        }
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
    await this.seedFailure()
    this.attempt.excluded!.push({ kind: 'initialization', durationMs: performance.now() - initializationStart })
    this.attempt.startedAt = new Date().toISOString()
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
  async newAttempt(previousAttemptId?: string) {
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
    const identity = createHash('sha256')
      .update(JSON.stringify([scenario(this.scenarioId, this.stage), this.baseline, samples(this.scenarioId, this.stage)]))
      .update(await readFile(new URL('./acceptance.ts', import.meta.url)))
      .update(await readFile(new URL('./scenarios.ts', import.meta.url)))
    if (this.scenarioId == 'fulfillment-ops')
      identity
        .update(await readFile(new URL('./fulfillment.ts', import.meta.url)))
        .update(await readFile(new URL('./fulfillmentAcceptance.ts', import.meta.url)))
    this.attempt = {
      id: randomUUID(),
      scenario: this.scenarioId,
      scenarioVersion: scenario(this.scenarioId).version,
      scenarioIdentity: identity.digest('hex'),
      ...(stageCount(this.scenarioId) == 1 ? {} : { stage: this.stage, stageName: scenario(this.scenarioId, this.stage).name }),
      ...(previousAttemptId == null ? {} : { previousAttemptId }),
      startedAt: new Date().toISOString(),
      startRevision: this.current().revisionId,
      mixed: false,
      git: { head, dirty, diffDigest },
      commands: [],
      excluded: [],
      rejectedEdits: 0,
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
    const verificationStart = performance.now()
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
      const runIds: string[] = []
      if (this.scenarioId == 'concurrent-edit') {
        if (!this.attempt.rejectedEdits) errors.push('No stale edit was rejected without changing the Draft.')
        if (this.service.control.runs.listRuns(this.manifest.flowId, 1, {}).page.runs.length > 0) errors.push('Unexpected run before verification.')
      }
      if (errors.length == 0) {
        const entry = scenario(this.scenarioId).entry
        const triggers = Object.entries(revision.content.document.graph.nodes).filter(([id, node]) =>
          'node' in entry ? id == entry.node : node.kind == entry.kind,
        )
        if (triggers.length != 1 || triggers[0]![1].kind != 'manual') errors.push('The scenario entry must resolve to one Manual trigger.')
        else
          for (const sample of samples(this.scenarioId, this.stage)) {
            Object.assign(this.mocks.sample, sample)
            const offset = this.mocks.calls.length,
              modelOffset = this.mocks.modelCalls.length,
              started = performance.now()
            const inputs: Record<string, Record<string, JsonValue>> = {}
            let inputsValid = true
            for (const [handle, value] of Object.entries(sample.parameters ?? {})) {
              const candidates = Object.keys(revision.content.document.graph.nodes)
                .map((id) => authoringNode(revision.content, id))
                .filter((node) => node.inputPorts[handle] != null && (handle != 'batch' || (node.config as { action?: string }).action == 'lab-orders.batch'))
              if (candidates.length != 1) {
                errors.push(`Expose ${handle} as one unbound ${handle == 'batch' ? 'batch query' : 'calculation'} run input.`)
                inputsValid = false
                break
              }
              ;(inputs[candidates[0]!.ref] ??= {})[handle] = value
            }
            if (!inputsValid) break
            if (validateFlowInputs(revision.content, inputs) != 'valid') {
              errors.push('Run parameters must be unbound node inputs without configured values or port defaults.')
              break
            }
            const run = await this.runSample(revision.revisionId, triggers[0]![0], sample.outputs, inputs)
            runIds.push(run.runId)
            const events = this.service.control.runs.getRunEvents(run.runId, 0, 1000).events
            const actual = [sample, run.status, this.mocks.calls.slice(offset), this.mocks.modelCalls.slice(modelOffset), events] as const
            errors.push(
              ...(this.scenarioId == 'fulfillment-ops'
                ? fulfillmentRuntimeAssertions(this.stage, ...actual)
                : runtimeAssertions(this.scenarioId, ...actual)
              ).map((error) => `${sample.name}: ${error}`),
            )
            this.attempt.excluded!.push({ kind: 'verification', sample: sample.name, durationMs: performance.now() - started, runId: run.runId })
          }
      }
      const runId = runIds[0]
      const result = { revisionId: revision.revisionId, passed: errors.length == 0, errors, runIds, ...(runId == null ? {} : { runId }) }
      this.attempt.verifications.push(result)
      if (result.passed && this.attempt.endedAt == null) {
        this.finish(true)
        this.attempt.endedAt = taskEndedAt
      }
      if (!result.passed && this.attempt.endedAt == null)
        this.attempt.excludedWallMs = (this.attempt.excludedWallMs ?? 0) + performance.now() - verificationStart
      await this.persist()
      return result
    } finally {
      this.busy = false
    }
  }
  async runSample(revisionId: string, nodeId: string, outputs: Record<string, JsonValue> = {}, inputs: Record<string, Record<string, JsonValue>> = {}) {
    const accepted = await this.service.control.runs.createDraftRun(this.manifest.flowId, revisionId, currentEngineContract, inputs, randomUUID(), {
      nodeId,
      outputs,
    })
    const deadline = Date.now() + 20_000
    let run = this.service.control.runs.getRun(accepted.run.runId)
    while (!['completed', 'failed', 'canceled', 'indeterminate'].includes(run.status) && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 30))
      run = this.service.control.runs.getRun(run.runId)
    }
    return run
  }
  async seedFailure() {
    if (this.scenarioId != 'repair-amount') return
    Object.assign(this.mocks.sample, { orders: [{ amount: null }] })
    const start = performance.now(),
      run = await this.runSample(this.current().revisionId, 'start')
    if (run.status != 'failed') throw new Error('Expected the initial amount formatter to fail.')
    this.attempt.excluded!.push({ kind: 'seed-failure', durationMs: performance.now() - start, runId: run.runId })
  }
  async closeService() {
    this.shutdown.abort()
    await Effect.runPromise(Scope.close(this.scope, Exit.void))
    this.database.close()
  }
  async next() {
    if (this.busy || this.active.size > 0) throw new Error('Wait for active commands before advancing.')
    if (this.stage + 1 >= stageCount(this.scenarioId)) throw new Error('No next stage.')
    if (!this.attempt.passed || this.head() != this.attempt.endRevision) throw new Error('Verify the current draft successfully before advancing.')
    for (const status of ['queued', 'starting', 'running', 'waiting'] as const)
      if (this.service.control.runs.listRuns(this.manifest.flowId, 1, { status }).page.runs.length > 0)
        throw new Error('Finish the active Run before advancing.')
    this.busy = true
    try {
      const previous = this.attempt.id
      await this.persist()
      this.manifest.stage = ++this.stage
      await this.newAttempt(previous)
      await this.saveManifest()
    } finally {
      this.busy = false
    }
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
      this.stage = 0
      this.manifest.stage = 0
      this.mocks = createMocks()
      await this.openService()
      await Effect.runPromise(this.service.start().pipe(Scope.provide(this.scope)))
      await this.newAttempt()
      await this.seedFailure()
      this.attempt.startedAt = new Date().toISOString()
      await this.saveManifest()
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
