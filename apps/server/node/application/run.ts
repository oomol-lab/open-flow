import type { ConnectorCapability, JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { PreparedFlow } from '@oomol-lab/open-flow/flow-semantics'
import type { ProjectedRunEvent } from '@oomol-lab/open-flow/run-events'
import type { RuntimeCapabilityCall, RuntimeCapabilityResponse } from '@oomol-lab/open-flow/runtime-contract'
import type { FlowRunOutcome, FlowRunResult, RunLaunch, TaskInvocation } from '@oomol-lab/open-flow/scheduler'
import type { Logger } from 'pino'
import type { ConnectorHost } from '../deployment/connector.ts'
import type { LlmHost } from '../deployment/llm.ts'
import type { StoredRun } from '../storage/run-store.ts'
import type { Store } from '../storage/store.ts'

import { normalizeConnectorRuntimeInputs } from '@oomol-lab/open-flow/connector-action'
import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { decodeRevision, digestBytes } from '@oomol-lab/open-flow/flow-encoding'
import { agentActions, codeActions, prepareFlow, variableBindings } from '@oomol-lab/open-flow/flow-semantics'
import { createEventProjector } from '@oomol-lab/open-flow/run-events'
import { resolveAction } from '@oomol-lab/open-flow/runtime-contract'
import * as Effect from 'effect/Effect'
import { executeCode } from '../deployment/agent-code.ts'
import { executeAgent } from '../deployment/agent.ts'
import { checkCodeActions, ConnectorTaskError } from '../deployment/connector.ts'
import { errorKind } from '../logger.ts'
import { isolatedVmEngineDigest, IsolatedVmHost } from '../runtime/isolated-vm.ts'

const encoder = new TextEncoder()
const nodeFailureCodes: ReadonlySet<string> = new Set([
  'capability.denied',
  'capability.invalid',
  'connector.connection-required',
  'connector.input-invalid',
  'connector.indeterminate',
  'connector.unavailable',
  'connector.unconfigured',
  'llm.output-invalid',
  'llm.unavailable',
  'node.failed',
])

type TaskErrorCode = 'capability.denied' | 'capability.invalid' | 'llm.output-invalid' | 'llm.unavailable'

class TaskHostError extends Error {
  readonly code: TaskErrorCode

  constructor(code: TaskErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'TaskHostError'
  }
}

export class RunExecutor {
  readonly #store: Store
  readonly #isolatedVm: IsolatedVmHost
  readonly #resolveConnector: () => ConnectorHost | undefined
  readonly #resolveLlm: () => LlmHost | undefined
  readonly #resolveWaitPublicOrigin: () => URL | undefined
  readonly #runTimeoutMs: number
  readonly #logger: Logger
  readonly #runChanged: (flowId: string, runId: string) => void
  readonly #wakeMaintenance: () => void

  constructor(
    store: Store,
    isolatedVm: IsolatedVmHost,
    resolveConnector: () => ConnectorHost | undefined,
    resolveLlm: () => LlmHost | undefined,
    resolveWaitPublicOrigin: () => URL | undefined,
    runTimeoutMs: number,
    logger: Logger,
    runChanged: (flowId: string, runId: string) => void,
    wakeMaintenance: () => void,
  ) {
    this.#store = store
    this.#isolatedVm = isolatedVm
    this.#resolveConnector = resolveConnector
    this.#resolveLlm = resolveLlm
    this.#resolveWaitPublicOrigin = resolveWaitPublicOrigin
    this.#runTimeoutMs = runTimeoutMs
    this.#logger = logger
    this.#runChanged = runChanged
    this.#wakeMaintenance = wakeMaintenance
  }

  run(run: StoredRun): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const prepared = yield* this.#prepareRun(run)
      if (prepared == null) return
      yield* this.#executeRun(run, prepared.flow, prepared.bindingValues, prepared.projectEvent)
    })
  }

  #loadRun(run: StoredRun): Effect.Effect<
    | { readonly kind: 'binding-unresolved' }
    | {
        readonly bindingValues: Readonly<Record<string, string>>
        readonly flow: PreparedFlow
        readonly kind: 'prepared'
        readonly projectEvent: ReturnType<typeof createEventProjector>
        readonly started: ProjectedRunEvent | undefined
      },
    unknown
  > {
    return Effect.gen({ self: this }, function* () {
      if (run.engineDigest != isolatedVmEngineDigest) {
        return yield* Effect.fail(new Error('Fixed Run Engine implementation is not available.'))
      }
      const revisionDigest = yield* Effect.tryPromise({
        try: () => digestBytes(encoder.encode(run.content)),
        catch: (error) => error,
      })
      if (revisionDigest != run.revisionDigest) {
        return yield* Effect.fail(new Error('Fixed Flow Revision digest does not match stored content.'))
      }
      const revision = decodeRevision(new TextEncoder().encode(run.content))
      const prepared = yield* Effect.tryPromise({
        try: () => prepareFlow(revision, run.engineContract, run.source == 'draft' ? run.trigger?.nodeId : undefined),
        catch: (error) => error,
      })
      if (prepared.kind != 'prepared') {
        return yield* Effect.fail(new Error(`Fixed Flow Revision can no longer be prepared: ${prepared.kind}.`))
      }
      yield* Effect.tryPromise({
        try: (signal) =>
          checkCodeActions([...codeActions(prepared.flow), ...agentActions(prepared.flow)], this.#resolveConnector(), run.connectorTeamId, signal),
        catch: (error) => error,
      })
      const projectEvent = createEventProjector(run.runId, nodeFailureCodes)
      const started = yield* Effect.tryPromise({
        try: () => projectEvent({ flowId: run.flowId, runId: run.runId, type: 'run.started' }),
        catch: (error) => error,
      })
      if (run.resume != null) {
        const resume = run.resume
        const saved = resume.checkpoint.wait
        const wait = prepared.flow.graph.nodes[saved.nodeId]
        const actions =
          wait?.kind == 'wait'
            ? wait.actions
            : wait?.kind == 'task' && wait.taskId != null && prepared.flow.tasks[wait.taskId]?.executor.kind == 'agent'
              ? ['approve', 'reject']
              : []
        if (!actions.some((action) => action == resume.action)) {
          return yield* Effect.fail(new Error('Stored Wait resolution does not match the fixed Flow Revision.'))
        }
        return {
          bindingValues: run.resume.checkpoint.bindingValues,
          flow: prepared.flow,
          kind: 'prepared' as const,
          projectEvent,
          started,
        }
      }
      if (Object.values(prepared.flow.tasks).some((task) => task.executor.kind == 'agent') && run.bindingValues == null)
        return yield* Effect.fail(new Error('The fixed Agent Variable snapshot is unavailable.'))
      const bindingValues =
        run.bindingValues ?? this.#store.variables.resolve(variableBindings(revision, prepared.validation.closure.dependencies.inputBindings))
      if (bindingValues == null) return { kind: 'binding-unresolved' as const }
      return { bindingValues, flow: prepared.flow, kind: 'prepared' as const, projectEvent, started }
    })
  }

  #prepareRun(run: StoredRun): Effect.Effect<
    | {
        readonly bindingValues: Readonly<Record<string, string>>
        readonly flow: PreparedFlow
        readonly projectEvent: ReturnType<typeof createEventProjector>
      }
    | undefined
  > {
    return Effect.gen({ self: this }, function* () {
      if (run.resumeUnavailable) {
        if (
          this.#store.runs.failResume(run.runId, {
            error: { code: 'execution.resume-unavailable', message: 'The stored Wait checkpoint is unavailable.' },
          })
        ) {
          this.#runChanged(run.flowId, run.runId)
        }
        return
      }
      const start = yield* this.#loadRun(run).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.sync(() => {
              const committed =
                run.resume == null
                  ? this.#store.runs.failStarting(run.runId, {
                      error:
                        error instanceof ConnectorTaskError
                          ? { code: error.code, message: error.message }
                          : { code: 'execution.unavailable', message: 'The fixed Run could not be started by this deployment.' },
                    })
                  : this.#store.runs.failResume(run.runId, {
                      error: { code: 'execution.resume-unavailable', message: 'The stored Wait checkpoint cannot resume against the fixed Flow.' },
                    })
              if (committed) {
                this.#runChanged(run.flowId, run.runId)
                this.#logger.error({ category: 'run.start_failed', flowId: run.flowId, runId: run.runId, ...errorKind(error) }, 'Run could not be started.')
              }
            }).pipe(Effect.as(undefined)),
          onSuccess: Effect.succeed,
        }),
      )
      if (start?.kind == 'binding-unresolved') {
        this.#store.runs.failStarting(run.runId, {
          error: { code: controlErrorCode.bindingUnresolved, message: 'A required Variable is unresolved.' },
        })
        return
      }
      if (start == null || start.started == null) return
      const started =
        run.resume == null ? this.#store.runs.start(run.runId, start.started) : this.#store.runs.resume(run.runId, run.resume.checkpoint.wait.waitId)
      if (!started) return
      return { bindingValues: start.bindingValues, flow: start.flow, projectEvent: start.projectEvent }
    })
  }

  #executeRun(
    run: StoredRun,
    flow: PreparedFlow,
    bindingValues: Readonly<Record<string, string>>,
    projectEvent: ReturnType<typeof createEventProjector>,
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const startedAt = performance.now()
      const budgetMs = run.remainingMs ?? this.#runTimeoutMs
      this.#logger.info({ category: 'run.started', flowId: run.flowId, runId: run.runId }, 'Run started.')

      const timeoutReason = new Error('Run exceeded its execution deadline.')
      let timedOut = false
      let indeterminate = false
      let launch: RunLaunch
      if (run.resume != null) launch = { resume: run.resume }
      else {
        if (run.trigger == null) {
          this.#failRun(run, startedAt, false, new Error('Stored Run is missing its Trigger seed.'))
          return
        }
        launch = { bindingValues, inputs: run.inputs, trigger: run.trigger }
      }
      yield* this.#isolatedVm
        .run(flow, {
          capability: (capabilities, call) => this.#invokeCapability(capabilities, call, run.connectorTeamId),
          emit: async (event) => {
            if (event.type == 'run.started' && event.runId == run.runId) return
            const projected = await projectEvent(event)
            if (projected != null) this.#store.runs.append(run.runId, projected)
          },
          flowId: run.flowId,
          ...launch,
          invokeTask: (invocation) => {
            if (!('taskId' in invocation)) throw new Error('Runtime Executor returned a Code Task to the Host.')
            return this.#invokeTask(flow, invocation, run, async (data) => {
              const event = await projectEvent({
                type: 'node.log',
                runId: invocation.runId,
                jobId: invocation.jobId,
                nodeId: invocation.nodeId,
                level: 'info',
                message: JSON.stringify(data),
              })
              if (event != null) this.#store.runs.append(run.runId, event)
            }).catch((error: unknown) => {
              if (error instanceof ConnectorTaskError && error.code == 'connector.indeterminate') indeterminate = true
              throw error
            })
          },
          projectFailure: (error) => {
            if (error instanceof ConnectorTaskError) return { code: error.code, message: error.message }
            if (error instanceof TaskHostError) return { code: error.code, message: error.message }
            return { code: 'node.failed', message: error instanceof Error ? error.message : String(error) }
          },
          runId: run.runId,
        })
        .pipe(
          Effect.timeoutOrElse({
            duration: budgetMs,
            orElse: () =>
              Effect.sync(() => {
                timedOut = true
              }).pipe(Effect.andThen(Effect.fail(timeoutReason))),
          }),
          Effect.matchEffect({
            onFailure: (error) => Effect.sync(() => this.#failRun(run, startedAt, timedOut, error, indeterminate)),
            onSuccess: (output) =>
              Effect.try({ try: () => this.#commitOutcome(run, flow, startedAt, budgetMs, output), catch: (error) => error }).pipe(
                Effect.catch((error) => Effect.sync(() => this.#failRun(run, startedAt, false, error))),
              ),
          }),
        )
    })
  }

  #commitOutcome(run: StoredRun, flow: PreparedFlow, startedAt: number, budgetMs: number, output: FlowRunOutcome): void {
    if (output.kind == 'waiting') {
      const remainingMs = Math.max(0, budgetMs - Math.round(performance.now() - startedAt))
      let notification:
        | {
            readonly action: string
            readonly connectionId?: string
            readonly input: Readonly<Record<string, JsonValue>>
            readonly messageHandle: string
            readonly prompt: string
            readonly publicOrigin: string
            readonly taskId: string
          }
        | undefined
      if (output.notification != null) {
        const task = flow.tasks[output.notification.taskId]
        const publicOrigin = this.#resolveWaitPublicOrigin()
        if (task == null || task.executor.kind != 'connector' || publicOrigin == null) {
          this.#failRun(run, startedAt, false, new Error('Wait notification is unavailable.'))
          return
        }
        notification = {
          action: task.executor.action,
          connectionId: task.executor.connectionId,
          input: normalizeConnectorRuntimeInputs(
            task.inputs.filter((input) => 'handle' in input),
            output.notification.input,
          ),
          messageHandle: output.notification.messageHandle,
          prompt: output.wait.prompt,
          publicOrigin: publicOrigin.href,
          taskId: output.notification.taskId,
        }
      }
      if (this.#store.runs.wait(run.runId, output, remainingMs, notification) == null) return
      this.#runChanged(run.flowId, run.runId)
      this.#wakeMaintenance()
      this.#logger.info(
        { category: 'run.waiting', durationMs: Math.round(performance.now() - startedAt), flowId: run.flowId, runId: run.runId, waitId: output.wait.waitId },
        'Run is waiting.',
      )
      return
    }
    this.#completeRun(run, startedAt, output)
  }

  #failRun(run: StoredRun, startedAt: number, timedOut: boolean, error: unknown, indeterminate = false): void {
    const result = indeterminate
      ? { error: { code: 'execution.terminal-unknown', message: 'A Connector action outcome is unknown.' } }
      : timedOut
        ? { error: { code: 'run.timeout', message: 'The Run exceeded its execution deadline.' } }
        : { error: { code: 'run.failed', message: 'The Flow could not be completed.' } }
    if (!this.#store.runs.commit(run.runId, indeterminate ? 'indeterminate' : 'failed', result)) return
    this.#runChanged(run.flowId, run.runId)
    this.#logger.error(
      {
        category: timedOut ? 'run.timed_out' : 'run.failed',
        durationMs: Math.round(performance.now() - startedAt),
        flowId: run.flowId,
        runId: run.runId,
        ...errorKind(error),
      },
      'Run failed.',
    )
  }

  #completeRun(run: StoredRun, startedAt: number, output: FlowRunResult): void {
    if (!this.#store.runs.commit(run.runId, 'completed', output)) return
    this.#runChanged(run.flowId, run.runId)
    this.#logger.info(
      { category: 'run.completed', durationMs: Math.round(performance.now() - startedAt), flowId: run.flowId, runId: run.runId },
      'Run completed.',
    )
  }

  async #invokeTask(
    prepared: PreparedFlow,
    invocation: Extract<TaskInvocation, { readonly taskId: string }> & { readonly signal: AbortSignal },
    run: StoredRun,
    report: (event: Readonly<Record<string, JsonValue>>) => Promise<void>,
  ): Promise<unknown> {
    const teamId = run.connectorTeamId
    const task = prepared.tasks[invocation.taskId]!
    const executor = task.executor
    switch (executor.kind) {
      case 'agent': {
        const model = run.llmConfig
        if (model == null) throw new TaskHostError('llm.unavailable', 'The fixed Agent model configuration is unavailable.')
        const connector = this.#resolveConnector()
        return executeAgent(
          task,
          {
            input: invocation.input,
            invocationId: invocation.invocationId,
            signal: invocation.signal,
            ...(invocation.agent == null ? {} : { resume: invocation.agent }),
          },
          { providerId: 'gateway', modelId: executor.model, url: new URL('v1/', model.origin).href, apiKey: model.token },
          async (tool, input, callId, signal) => {
            if (connector == null) throw new ConnectorTaskError('connector.unconfigured', 'Connector is not configured for this deployment.')
            await checkCodeActions(
              [{ kind: 'connector', action: tool.action, connections: tool.connectionId == null ? [] : [{ connectionId: tool.connectionId }] }],
              connector,
              teamId,
              signal,
            )
            return connector.execute(tool.action, tool.connectionId, normalizeConnectorRuntimeInputs(tool.inputs, input), callId, signal, teamId)
          },
          report,
          {
            find: (callId, tool, input) => this.#store.results.find(run.runId, invocation.invocationId, callId, tool, input),
            save: (callId, tool, input, output) => this.#store.results.put(run.runId, invocation.invocationId, callId, tool, input, output),
            get: (resultId) => this.#store.results.get(run.runId, resultId, invocation.invocationId),
          },
          (code, input, callId, signal) => executeCode(this.#isolatedVm, code, input, callId, signal),
        )
      }
      case 'connector':
        const connector = this.#resolveConnector()
        if (connector == null) throw new ConnectorTaskError('connector.unconfigured', 'Connector is not configured for this deployment.')
        return await connector.execute(
          executor.action,
          executor.connectionId,
          normalizeConnectorRuntimeInputs(
            task.inputs.filter((input) => 'handle' in input),
            invocation.input,
          ),
          invocation.invocationId,
          invocation.signal,
          teamId,
        )
      case 'llm':
        const llm = this.#resolveLlm()
        if (llm == null) throw new TaskHostError('llm.unavailable', 'The LLM request could not be completed.')
        let result
        try {
          result = await llm({
            input: Object.assign({}, invocation.additionalInputs, invocation.input),
            invocationId: invocation.invocationId,
            mode: executor.mode,
            signal: invocation.signal,
            version: 1,
          })
        } catch {
          if (invocation.signal.aborted) throw invocation.signal.reason
          throw new TaskHostError('llm.unavailable', 'The LLM request could not be completed.')
        }
        if (result.kind == 'failed') throw new TaskHostError(result.code, result.message)
        return result.value
    }
  }

  async #invokeCapability(capabilities: readonly ConnectorCapability[], call: RuntimeCapabilityCall, teamId?: string): Promise<RuntimeCapabilityResponse> {
    if (call.kind != 'connector') throw new TaskHostError('capability.denied', 'The Runtime Capability is not declared for this Task.')
    let payload: ReturnType<typeof resolveAction>
    try {
      payload = resolveAction(capabilities, call.payload)
    } catch (error) {
      const failure = error as Error & { code: TaskErrorCode }
      if (failure.code == 'capability.denied' || failure.code == 'capability.invalid') throw new TaskHostError(failure.code, failure.message)
      throw new ConnectorTaskError('connector.connection-required', failure.message)
    }
    const connector = this.#resolveConnector()
    if (connector == null) throw new ConnectorTaskError('connector.unconfigured', 'Connector is not configured for this deployment.')
    if (payload.connectionId == null && (await connector.getAction(payload.action, call.signal, teamId)).authenticated) {
      throw new ConnectorTaskError('connector.connection-required', 'Choose a Connector Connection for this Action.')
    }
    this.#logger.debug(
      { category: 'connector.action', invocationId: call.invocationId, callId: call.callId, action: payload.action, connectionId: payload.connectionId },
      'Code Action started.',
    )
    return {
      body: await connector.execute(payload.action, payload.connectionId, payload.input, call.callId, call.signal, teamId),
      status: 200,
    }
  }
}
