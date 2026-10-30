import type { TaskCapability, WorkflowCapability, JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { PreparedFlow } from '@oomol-lab/open-flow/flow-semantics'
import type { ProjectedRunEvent } from '@oomol-lab/open-flow/run-events'
import type { RuntimeCapabilityCall, RuntimeCapabilityResponse } from '@oomol-lab/open-flow/runtime-contract'
import type { FlowRunOutcome, FlowRunResult, RunLaunch, TaskInvocation } from '@oomol-lab/open-flow/scheduler'
import type { Logger } from 'pino'
import type { ConnectorAccessContext, ConnectorHost } from '../deployment/connector-contract.ts'
import type { LlmHost } from '../deployment/llm.ts'
import type { StoredRun } from '../storage/run-store.ts'
import type { Store } from '../storage/store.ts'
import type { ArtifactEvent } from './run-artifacts.ts'
import type { RunControl } from './run-control.ts'

import { normalizeConnectorRuntimeInputs } from '@oomol-lab/open-flow/connector-action'
import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { decodeRevision, digestBytes } from '@oomol-lab/open-flow/flow-encoding'
import { agentActions, codeActions, prepareFlow, variableBindings } from '@oomol-lab/open-flow/flow-semantics'
import { createEventProjector } from '@oomol-lab/open-flow/run-events'
import { resolveAction } from '@oomol-lab/open-flow/runtime-contract'
import * as Effect from 'effect/Effect'
import { executeCode } from '../deployment/agent-code.ts'
import { executeAgent } from '../deployment/agent.ts'
import { assertConnectionNotDeferred, ConnectorTaskError } from '../deployment/connector-contract.ts'
import { executeHttpRequest } from '../deployment/http-request.ts'
import { HttpTaskError } from '../deployment/http-transport.ts'
import { executeOpenApi } from '../deployment/openapi.ts'
import { WorkflowToolError } from '../deployment/workflow-contract.ts'
import { errorKind } from '../logger.ts'
import { supportsIsolatedVmEngine, IsolatedVmHost } from '../runtime/isolated-vm.ts'
import { checkCodeActions, checkCodePermissions } from './connector-capabilities.ts'
import { ArtifactHostError, RunArtifacts } from './run-artifacts.ts'
import { workflowRunOutcome } from './workflow.ts'

const encoder = new TextEncoder()
const nodeFailureCodes: ReadonlySet<string> = new Set([
  'capability.denied',
  'capability.invalid',
  'connector.access-invalid',
  'connector.access-required',
  'connector.action-not-found',
  'connector.connection-required',
  'connector.input-invalid',
  'connector.indeterminate',
  'connector.unavailable',
  'connector.unconfigured',
  'llm.output-invalid',
  'llm.unavailable',
  'workflow.failed',
  'workflow.canceled',
  'workflow.indeterminate',
  'workflow.unavailable',
  'node.failed',
  'node.input-invalid',
  'webhook.response-status-invalid',
  'webhook.response-headers-invalid',
  'node.output-invalid',
  'http-request.input-invalid',
  'http-request.response-invalid',
  'http-request.http-failed',
  'http-request.indeterminate',
  'http-request.limit-exceeded',
  'openapi.input-invalid',
  'openapi.response-invalid',
  'openapi.http-failed',
  'openapi.indeterminate',
  'openapi.limit-exceeded',
])

type TaskErrorCode = 'capability.denied' | 'capability.invalid' | 'llm.output-invalid' | 'llm.unavailable'

class TaskHostError extends Error {
  readonly code: TaskErrorCode

  readonly catchable: boolean
  readonly retryable: boolean
  constructor(code: TaskErrorCode, message: string, retryable = false, catchable = false) {
    super(message)
    this.code = code
    this.name = 'TaskHostError'
    this.retryable = retryable
    this.catchable = catchable
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
  readonly #invokeWorkflow: RunControl['invokeWorkflow']
  readonly #invokeWorkflowTarget: RunControl['invokeWorkflowTarget']
  readonly #subscribeRun: (flowId: string, runId: string, changed: () => void) => () => void
  readonly waitingWorkflows = new Set<string>()
  readonly #pendingWorkflowCalls = new Map<string, number>()
  readonly workflowResumptions = new Map<string, () => void>()
  readonly #workflowResumeWaiters = new Map<string, Set<() => void>>()
  readonly #toolCalls = new Map<string, { runId: string; jobId: string; abort: AbortController }>()
  readonly #artifacts: RunArtifacts

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
    invokeWorkflow: RunControl['invokeWorkflow'],
    invokeWorkflowTarget: RunControl['invokeWorkflowTarget'],
    subscribeRun: (flowId: string, runId: string, changed: () => void) => () => void,
  ) {
    this.#invokeWorkflowTarget = invokeWorkflowTarget
    this.#subscribeRun = subscribeRun
    this.#invokeWorkflow = invokeWorkflow
    this.#store = store
    this.#artifacts = new RunArtifacts(store.runs)
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
      if (!supportsIsolatedVmEngine(run.engineContract, run.engineDigest)) {
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
          checkCodeActions(agentActions(prepared.flow), this.#resolveConnector(), this.#connectorContext(run, 'eligibility', 'selected'), signal),
        catch: (error) => error,
      })
      yield* Effect.tryPromise({
        try: (signal) => checkCodePermissions(codeActions(prepared.flow), this.#resolveConnector(), this.#connectorContext(run, 'eligibility'), signal),
        catch: (error) => error,
      })
      const projectEvent = createEventProjector(run.runId, nodeFailureCodes)
      const started = yield* Effect.tryPromise({
        try: () => projectEvent({ flowId: run.flowId, runId: run.runId, type: 'run.started' }),
        catch: (error) => error,
      })
      if (run.resume != null) {
        return {
          bindingValues: run.resume.checkpoint.bindingValues,
          flow: prepared.flow,
          kind: 'prepared' as const,
          projectEvent,
          started,
        }
      }
      if (
        Object.values(prepared.flow.graph.nodes)
          .flatMap((node) => (node.kind == 'task' && 'executor' in node.task ? [node.task] : []))
          .some((task) => task.executor.kind == 'agent') &&
        run.bindingValues == null
      )
        return yield* Effect.fail(new Error('The fixed Agent variable snapshot is unavailable.'))
      const bindingValues =
        run.bindingValues ?? this.#store.variables.resolve(run.flowId, variableBindings(revision, prepared.validation.closure.dependencies.bindings))
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
          error: { code: controlErrorCode.bindingUnresolved, message: 'A required variable is unresolved.' },
        })
        return
      }
      if (start == null || start.started == null) return
      const started = run.resume == null ? this.#store.runs.start(run.runId, start.started) : this.#store.runs.resume(run.runId)
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
      const emit = async (event: Parameters<NonNullable<Parameters<IsolatedVmHost['run']>[1]['emit']>>[0] | ArtifactEvent): Promise<void> => {
        if (event.type == 'run.started' && event.runId == run.runId) return
        if ((event.type == 'node.completed' || event.type == 'node.failed') && 'jobId' in event) {
          this.#cancelNodeTools(run.runId, event.jobId)
          this.#artifacts.discard(run.runId, event.jobId)
        }
        const projected = await projectEvent(event)
        if (projected != null && this.#store.runs.append(run.runId, projected)) this.#runChanged(run.flowId, run.runId)
      }
      yield* this.#isolatedVm
        .run(flow, {
          capability: (capabilities, call) => this.#invokeCapability(capabilities, call, this.#connectorContext(run, 'execute'), run, flow, emit),
          emit,
          flowId: run.flowId,
          ...launch,
          remainingMs: budgetMs,
          wait: async (operation, signal) => {
            if (operation.kind == 'resolutions')
              return operation.block
                ? await this.#store.runs.waitForResolutions(run.runId, operation.waitIds, signal)
                : this.#store.runs.resolutions(run.runId, operation.waitIds)
            const request = operation.wait
            const node = flow.graph.nodes[request.nodeId]
            if (node == null || !('inputs' in node)) throw new Error('Wait node is unavailable.')
            let notification: { action: string; connectionId?: string; input: Readonly<Record<string, JsonValue>>; messageHandle: string } | undefined
            if (request.notification != null) {
              const task = node.kind == 'task' && 'executor' in node.task && node.task.executor.kind == 'agent' ? node.task.executor.notification : undefined
              if (task == null) throw new Error('Agent notification is unavailable.')
              notification = {
                action: task.action,
                connectionId: task.connectionId,
                messageHandle: request.notification.messageHandle,
                input: normalizeConnectorRuntimeInputs(task.inputDefinitions, request.notification.input),
              }
            }
            const output = this.#store.runs.createWait(run.runId, request, this.#resolveWaitPublicOrigin()?.href, notification)
            this.#runChanged(run.flowId, run.runId)
            this.#wakeMaintenance()
            return output
          },
          invokeTask: (invocation) => {
            if (!('kind' in invocation)) throw new Error('Runtime Executor returned a Code Task to the Host.')
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
            })
          },
          projectFailure: (error) => {
            if (error instanceof ConnectorTaskError || error instanceof HttpTaskError || error instanceof WorkflowToolError)
              indeterminate ||= error.indeterminate
            if (
              error instanceof ConnectorTaskError ||
              error instanceof TaskHostError ||
              error instanceof HttpTaskError ||
              error instanceof WorkflowToolError ||
              error instanceof ArtifactHostError
            )
              return { code: error.code, message: error.message, retryable: error.retryable, catchable: error.catchable }
            return { code: 'node.failed', message: error instanceof Error ? error.message : String(error) }
          },
          runId: run.runId,
        })
        .pipe(
          Effect.matchEffect({
            onFailure: (error) => Effect.sync(() => this.#failRun(run, startedAt, error.message.includes('execution deadline'), error, indeterminate)),
            onSuccess: (output) =>
              Effect.try({ try: () => this.#commitOutcome(run, startedAt, budgetMs, output), catch: (error) => error }).pipe(
                Effect.catch((error) => Effect.sync(() => this.#failRun(run, startedAt, false, error))),
              ),
          }),
          Effect.ensuring(Effect.sync(() => this.#artifacts.discard(run.runId))),
        )
    })
  }

  #commitOutcome(run: StoredRun, startedAt: number, budgetMs: number, output: FlowRunOutcome): void {
    if (output.kind == 'waiting') {
      if (!this.#store.runs.wait(run.runId, output, Math.max(0, Math.floor(output.remainingMs ?? budgetMs)))) return
      this.#runChanged(run.flowId, run.runId)
      this.#wakeMaintenance()
      this.#logger.info(
        { category: 'run.waiting', durationMs: Math.round(performance.now() - startedAt), flowId: run.flowId, runId: run.runId },
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
    this.#wakeMaintenance()
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
    invocation: Extract<TaskInvocation, { readonly kind: 'managed' }> & { readonly signal: AbortSignal },
    run: StoredRun,
    report: (event: Readonly<Record<string, JsonValue>>) => Promise<void>,
  ): Promise<unknown> {
    const access = this.#connectorContext(run, 'execute', 'selected')
    const node = prepared.graph.nodes[invocation.nodeId]
    if (node?.kind != 'task' || !('executor' in node.task)) throw new Error('Managed Task node is unavailable.')
    const task = node.task
    const executor = task.executor
    switch (executor.kind) {
      case 'workflow':
        return this.#invokeWorkflow(run, invocation.nodeId, invocation.jobId, invocation.input, node, invocation.workflowRunId)
      case 'http-request':
        return executeHttpRequest(executor, invocation.input, invocation.signal)
      case 'openapi':
        return executeOpenApi(executor, invocation.input, invocation.signal)
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
            if (tool.kind == 'workflow') return this.#invokeWorkflowTool(run, invocation.nodeId, invocation.jobId, callId, tool, input, signal, node.timeoutMs)
            if (connector == null) throw new ConnectorTaskError('connector.unconfigured', 'Connector is not configured for this deployment.')
            await checkCodeActions(
              [{ kind: 'connector', action: tool.action, connections: tool.connectionId == null ? [] : [{ connectionId: tool.connectionId }] }],
              connector,
              access,
              signal,
            )
            return connector.execute(tool.action, tool.connectionId, normalizeConnectorRuntimeInputs(tool.inputs, input), callId, signal, {
              ...access,
              scope: 'action',
              action: tool.action,
              connectionId: tool.connectionId,
            })
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
        assertConnectionNotDeferred(executor.connectionId)
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
          { ...access, scope: 'action', action: executor.action, connectionId: executor.connectionId },
        )
      case 'decision': {
        const decision = this.#resolveLlm()?.decision
        if (decision == null) throw new TaskHostError('llm.unavailable', 'AI Decision is not configured for this deployment.')
        let result
        try {
          result = await decision({
            questions: executor.questions,
            state: invocation.input.target!,
            invocationId: invocation.invocationId,
            signal: invocation.signal,
            version: 1,
          })
        } catch {
          if (invocation.signal.aborted) throw invocation.signal.reason
          throw new TaskHostError('llm.unavailable', 'The AI Decision request could not be completed.', true, true)
        }
        if (result.kind == 'failed') throw new TaskHostError(result.code, result.message, result.retryable !== false, true)
        return result.value
      }
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
          throw new TaskHostError('llm.unavailable', 'The LLM request could not be completed.', true, true)
        }
        if (result.kind == 'failed') throw new TaskHostError(result.code, result.message, result.retryable !== false, true)
        return result.value
    }
  }

  async #invokeCapability(
    capabilities: readonly TaskCapability[],
    call: RuntimeCapabilityCall,
    access: Exclude<ConnectorAccessContext, { readonly scope: 'catalog' }>,
    run: StoredRun,
    flow: PreparedFlow,
    emit: (event: ArtifactEvent) => Promise<void>,
  ): Promise<RuntimeCapabilityResponse> {
    if (call.kind.startsWith('artifact.')) {
      const node = call.nodeId == null ? undefined : flow.graph.nodes[call.nodeId]
      if (node?.kind != 'task' || !('moduleId' in node.task)) throw new TaskHostError('capability.denied', 'Artifacts require a Code node invocation.')
      return await this.#artifacts.invoke(run.runId, call, emit)
    }
    if (call.kind == 'workflow') {
      const node = call.nodeId == null ? undefined : flow.graph.nodes[call.nodeId]
      if (node?.kind != 'task' || !('moduleId' in node.task) || call.jobId == null)
        throw new TaskHostError('capability.denied', 'Workflow tools require a Code node invocation.')
      const payload = call.payload as { name?: unknown; input?: unknown } | null
      if (
        payload == null ||
        typeof payload != 'object' ||
        Array.isArray(payload) ||
        typeof payload.name != 'string' ||
        payload.input == null ||
        typeof payload.input != 'object' ||
        Array.isArray(payload.input)
      )
        throw new TaskHostError('capability.invalid', 'Workflow name and input object are required.')
      const target = node.task.capabilities?.find((item) => item.kind == 'workflow' && item.name == payload.name)
      if (target?.kind != 'workflow') throw new TaskHostError('capability.denied', 'The workflow is not declared for this Code node.')
      return {
        status: 200,
        body: await this.#invokeWorkflowTool(
          run,
          call.nodeId!,
          call.jobId,
          call.callId,
          target,
          payload.input as Readonly<Record<string, JsonValue>>,
          call.signal,
          node.timeoutMs,
        ),
      }
    }

    if (call.kind != 'connector') throw new TaskHostError('capability.denied', 'The Runtime Capability is not declared for this Task.')
    let payload: ReturnType<typeof resolveAction>
    try {
      payload = resolveAction(
        capabilities.filter((item) => item.kind == 'connector'),
        call.payload,
      )
    } catch (error) {
      const failure = error as Error & { code: TaskErrorCode }
      if (failure.code == 'capability.denied' || failure.code == 'capability.invalid') throw new TaskHostError(failure.code, failure.message)
      throw new ConnectorTaskError('connector.connection-required', failure.message)
    }
    assertConnectionNotDeferred(payload.connectionId)
    const connector = this.#resolveConnector()
    if (connector == null) throw new ConnectorTaskError('connector.unconfigured', 'Connector is not configured for this deployment.')
    access = capabilities.some((capability) => 'mode' in capability && capability.mode == 'independent')
      ? { ...access, scope: 'action', action: payload.action, connectionId: payload.connectionId }
      : { ...access, scope: 'shared' }
    if (
      !capabilities.some((capability) => 'mode' in capability && capability.mode == 'shared') &&
      payload.connectionId == null &&
      (await connector.getAction(payload.action, call.signal, { ...access, providerId: payload.action.split('.')[0] })).authenticated
    ) {
      throw new ConnectorTaskError('connector.connection-required', 'Choose a Connector Connection for this Action.')
    }
    this.#logger.debug(
      { category: 'connector.action', invocationId: call.invocationId, callId: call.callId, action: payload.action, connectionId: payload.connectionId },
      'Code Action started.',
    )
    return {
      body: await connector.execute(payload.action, payload.connectionId, payload.input, call.callId, call.signal, {
        ...access,
        providerId: payload.action.split('.')[0],
      }),
      status: 200,
    }
  }

  #resumeWorkflowCaller(runId: string, signal: AbortSignal): Promise<void> {
    if (!this.waitingWorkflows.has(runId)) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const waiters = this.#workflowResumeWaiters.get(runId) ?? new Set<() => void>()
      const finish = () => {
        signal.removeEventListener('abort', finish)
        waiters.delete(finish)
        if (!waiters.size) {
          this.#workflowResumeWaiters.delete(runId)
          this.workflowResumptions.delete(runId)
          if (!this.#pendingWorkflowCalls.has(runId)) this.waitingWorkflows.delete(runId)
        }
        resolve()
      }
      waiters.add(finish)
      this.#workflowResumeWaiters.set(runId, waiters)
      this.workflowResumptions.set(runId, () => {
        if (!this.#pendingWorkflowCalls.has(runId)) this.waitingWorkflows.delete(runId)
        for (const resume of waiters) resume()
      })
      signal.addEventListener('abort', finish, { once: true })
      if (signal.aborted) finish()
      this.#wakeMaintenance()
    })
  }

  #cancelNodeTools(runId: string, jobId: string): void {
    for (const call of this.#toolCalls.values()) if (call.runId == runId && call.jobId == jobId) call.abort.abort(new Error('Calling node ended.'))
  }

  async #invokeWorkflowTool(
    run: StoredRun,
    nodeId: string,
    jobId: string,
    callId: string,
    target: WorkflowCapability,
    input: Readonly<Record<string, JsonValue>>,
    parentSignal: AbortSignal,
    timeoutMs?: number,
  ): Promise<Readonly<Record<string, JsonValue>>> {
    const key = JSON.stringify([run.runId, jobId, callId])
    const abort = new AbortController()
    const signal = AbortSignal.any([parentSignal, abort.signal])
    this.#toolCalls.set(key, { runId: run.runId, jobId, abort })
    let childRunId: string | undefined
    try {
      signal.throwIfAborted()
      const result = await this.#invokeWorkflowTarget(run, nodeId, jobId, input, target, { callId, timeoutMs })
      if (result.kind == 'completed') return result.outputs
      childRunId = result.childRunId
      signal.throwIfAborted()
      this.#pendingWorkflowCalls.set(run.runId, (this.#pendingWorkflowCalls.get(run.runId) ?? 0) + 1)
      this.waitingWorkflows.add(run.runId)
      this.#wakeMaintenance()
      try {
        return await new Promise<Readonly<Record<string, JsonValue>>>((resolve, reject) => {
          let unsubscribe: (() => void) | undefined
          let settled = false
          const finish = (error?: Error, output?: Readonly<Record<string, JsonValue>>) => {
            if (settled) return
            settled = true
            unsubscribe?.()
            signal.removeEventListener('abort', canceled)
            if (error) reject(error)
            else resolve(output ?? {})
          }
          const canceled = () => finish(new WorkflowToolError('workflow.canceled', 'Workflow tool call was canceled.'))
          const inspect = () => {
            const child = this.#store.runViews.controlRun(childRunId!)
            if (child == null) return finish(new WorkflowToolError('workflow.unavailable', 'Called Run is unavailable.'))
            const outcome = workflowRunOutcome(child)
            if (outcome.kind == 'completed') return finish(undefined, outcome.outputs)
            if (outcome.kind != 'calling') finish(new WorkflowToolError(`workflow.${outcome.kind}`, outcome.message))
          }
          unsubscribe = this.#subscribeRun(target.flowId, childRunId!, inspect)
          if (settled) unsubscribe()
          else {
            signal.addEventListener('abort', canceled, { once: true })
            if (signal.aborted) canceled()
            else inspect()
          }
        })
      } finally {
        const pending = (this.#pendingWorkflowCalls.get(run.runId) ?? 1) - 1
        if (pending == 0) this.#pendingWorkflowCalls.delete(run.runId)
        else this.#pendingWorkflowCalls.set(run.runId, pending)
        await this.#resumeWorkflowCaller(run.runId, signal)
      }
    } finally {
      this.#toolCalls.delete(key)
      if (childRunId != null && this.#store.runs.cancel(childRunId)) {
        this.#runChanged(target.flowId, childRunId)
        this.#wakeMaintenance()
      }
    }
  }

  #connectorContext(
    run: StoredRun,
    purpose: ConnectorAccessContext['purpose'],
    scope: 'selected' | 'shared' = 'shared',
  ): Exclude<ConnectorAccessContext, { readonly scope: 'catalog' }> {
    return {
      flowId: run.flowId,
      providerAccess: run.providerAccess,
      scope,
      purpose,
      source: 'run',
      ...(run.connectorTeamId == null ? {} : { teamId: run.connectorTeamId }),
    }
  }
}
