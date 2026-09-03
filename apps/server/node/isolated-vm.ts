import type { ConnectorCapability, JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { PreparedFlow } from '@oomol-lab/open-flow/flow-semantics'
import type { RuntimeCapabilityResponse, RuntimeInvocation, RuntimeProgram } from '@oomol-lab/open-flow/runtime-contract'
import type { FlowRunOptions, FlowRunOutcome, SchedulerEvent, SchedulerFailure, TaskInvocation, TriggerSeed } from '@oomol-lab/open-flow/scheduler'
import type { ChildProcess, ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'

import { findEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export interface IsolatedVmLimits {
  readonly cpuMs: number
  readonly maxCapabilityCalls: number
  readonly maxCapabilityResponseBytes: number
  readonly maxInputBytes: number
  readonly maxProgramBytes: number
  readonly maxResultBytes: number
  readonly memoryMb: number
  readonly wallMs: number
}

export const isolatedVmLimits: IsolatedVmLimits = {
  cpuMs: 1_000,
  maxCapabilityCalls: 100,
  maxCapabilityResponseBytes: 1024 * 1024,
  maxInputBytes: 1024 * 1024,
  maxProgramBytes: 4 * 1024 * 1024,
  maxResultBytes: 1024 * 1024,
  memoryMb: 128,
  wallMs: 30_000,
}

export const isolatedVmEngineDigest = `sha256:${createHash('sha256').update('open-flow-isolated-vm/2 isolated-vm/7.0.1 node/26 web-globals/2').digest('hex')}`

export class IsolatedVmError extends Error {
  readonly code: 'canceled' | 'executor-crashed' | 'invalid-program' | 'limit-exceeded' | 'task-failed'

  constructor(code: IsolatedVmError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'IsolatedVmError'
  }
}

export type InvokeContext = {
  readonly blockId: string | undefined
  readonly flowId: string | undefined
  readonly runId: string | undefined
}

export type InvokeRequest =
  | {
      readonly context?: InvokeContext
      readonly executionId: number
      readonly input: JsonValue
      readonly invocationId: string
      readonly limits: IsolatedVmLimits
      readonly program: RuntimeProgram
      readonly type: 'invoke'
    }
  | {
      readonly executionId: number
      readonly flow: {
        readonly bindingValues?: FlowRunOptions['bindingValues']
        readonly flowId: string
        readonly inputs?: FlowRunOptions['inputs']
        readonly prepared: PreparedFlow
        readonly resume?: FlowRunOptions['resume']
        readonly runId: string
        readonly trigger?: TriggerSeed
      }
      readonly limits: IsolatedVmLimits
      readonly type: 'invoke'
    }

export type ParentMessage = InvokeRequest | { readonly executionId: number; readonly type: 'cancel' } | CapabilityResult

export interface CapabilityResult {
  readonly code?: string
  readonly error?: string
  readonly executionId: number
  readonly id: number
  readonly ok: boolean
  readonly type: 'capability.result'
  readonly value?: unknown
}

export type ExecutorMessage =
  | {
      readonly capabilities?: readonly ConnectorCapability[]
      readonly executionId: number
      readonly id: number
      readonly invocationId: string
      readonly kind: string
      readonly payload: JsonValue
      readonly type: 'capability'
    }
  | { readonly event: SchedulerEvent; readonly executionId: number; readonly id: number; readonly type: 'event' }
  | { readonly executionId: number; readonly id: number; readonly invocation: TaskInvocation; readonly type: 'task' }
  | { readonly executionId: number; readonly id: number; readonly type: 'call.cancel' }
  | {
      readonly code: IsolatedVmError['code']
      readonly executionId: number
      readonly message: string
      readonly ok: false
      readonly retire?: true
      readonly type: 'result'
    }
  | {
      readonly executionId: number
      readonly ok: true
      readonly retire?: true
      readonly type: 'result'
      readonly value: FlowRunOutcome | JsonValue | undefined
    }

interface PendingInvocation {
  readonly capability: (
    capabilities: readonly ConnectorCapability[],
    call: Parameters<RuntimeInvocation['capability']>[0],
  ) => Promise<RuntimeCapabilityResponse>
  readonly capabilityCalls: Map<string, number>
  readonly activeCalls: Map<number, Fiber.Fiber<void, never>>
  readonly cancel: () => void
  readonly emit?: (event: SchedulerEvent) => void | Promise<void>
  readonly invokeTask?: (invocation: TaskInvocation & { readonly signal: AbortSignal }) => Promise<unknown>
  readonly limits: IsolatedVmLimits
  readonly projectFailure: (error: unknown) => SchedulerFailure
  readonly reject: (error: unknown) => void
  readonly resolve: (value: FlowRunOutcome | JsonValue | undefined) => void
  readonly signal?: AbortSignal
}

const encoder = new TextEncoder()

export function serializedBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength
}

export function normalizedError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function programError(program: RuntimeProgram): IsolatedVmError | undefined {
  const contract = findEngineContract(program.engineContract)
  if (contract == null) return new IsolatedVmError('invalid-program', `Unsupported Engine Contract "${program.engineContract}".`)
  if (program.engineDigest != isolatedVmEngineDigest)
    return new IsolatedVmError('invalid-program', 'Runtime program Engine digest does not match this Executor.')
  if (Object.keys(program.modules).some((moduleId) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(moduleId))) {
    return new IsolatedVmError('invalid-program', 'Runtime program contains an invalid module ID.')
  }
  if (program.modules[program.entryModuleId] == null) return new IsolatedVmError('invalid-program', 'Runtime entry module is not part of the fixed closure.')
}

export class IsolatedVmHost {
  #child?: ChildProcess
  #closed = false
  #executionId = 0
  readonly #pending = new Map<number, PendingInvocation>()
  #stderr = ''

  async invoke(invocation: RuntimeInvocation, limits: IsolatedVmLimits = isolatedVmLimits): Promise<JsonValue | undefined> {
    return await Effect.runPromise(
      Effect.suspend(() => {
        if (this.#closed) return Effect.fail(new IsolatedVmError('executor-crashed', 'Runtime Host is closed.'))
        const invalid = programError(invocation.program)
        if (invalid != null) return Effect.fail(invalid)
        if (serializedBytes(invocation.input) > limits.maxInputBytes) {
          return Effect.fail(new IsolatedVmError('limit-exceeded', 'Runtime input exceeds the configured byte limit.'))
        }
        if (serializedBytes(invocation.program) > limits.maxProgramBytes) {
          return Effect.fail(new IsolatedVmError('limit-exceeded', 'Runtime program exceeds the configured byte limit.'))
        }
        if (invocation.signal?.aborted) return Effect.fail(normalizedError(invocation.signal.reason))

        return Effect.callback<JsonValue | undefined, Error>((resume, signal) => {
          const child = this.#child ?? this.#start()
          const executionId = ++this.#executionId
          const cancel = (): void => {
            this.#send(child, { executionId, type: 'cancel' })
            this.#finish(executionId, () =>
              resume(Effect.fail(normalizedError(invocation.signal?.reason ?? new IsolatedVmError('canceled', 'Runtime invocation was canceled.')))),
            )
          }
          const interrupt = (): void => {
            this.#send(child, { executionId, type: 'cancel' })
            this.#finish(executionId, () => {})
          }
          this.#pending.set(executionId, {
            capability: (_capabilities, call) => invocation.capability(call),
            capabilityCalls: new Map(),
            activeCalls: new Map(),
            cancel,
            limits,
            projectFailure: (error) => ({ code: 'node.failed', message: normalizedError(error).message }),
            reject: (error) => resume(Effect.fail(normalizedError(error))),
            resolve: (value) => resume(Effect.succeed(value as JsonValue | undefined)),
            signal: invocation.signal,
          })
          invocation.signal?.addEventListener('abort', cancel, { once: true })
          signal.addEventListener('abort', interrupt, { once: true })
          this.#send(child, {
            executionId,
            input: invocation.input,
            invocationId: invocation.invocationId,
            limits,
            program: invocation.program,
            type: 'invoke',
          })
          return Effect.sync(() => signal.removeEventListener('abort', interrupt))
        }).pipe(
          Effect.timeoutOrElse({
            duration: limits.wallMs,
            orElse: () => Effect.fail(new IsolatedVmError('limit-exceeded', 'Runtime invocation exceeded its wall-clock limit.')),
          }),
        )
      }),
    )
  }

  run(
    prepared: PreparedFlow,
    options: {
      readonly capability: (
        capabilities: readonly ConnectorCapability[],
        call: Parameters<RuntimeInvocation['capability']>[0],
      ) => Promise<RuntimeCapabilityResponse>
      readonly emit?: (event: SchedulerEvent) => void | Promise<void>
      readonly bindingValues?: FlowRunOptions['bindingValues']
      readonly flowId: string
      readonly inputs?: FlowRunOptions['inputs']
      readonly invokeTask: (invocation: TaskInvocation & { readonly signal: AbortSignal }) => Promise<unknown>
      readonly projectFailure: (error: unknown) => SchedulerFailure
      readonly resume?: FlowRunOptions['resume']
      readonly runId: string
      readonly trigger?: TriggerSeed
    },
    limits: IsolatedVmLimits = isolatedVmLimits,
  ): Effect.Effect<FlowRunOutcome, Error> {
    return Effect.suspend(() => {
      if (this.#closed) return Effect.fail(new IsolatedVmError('executor-crashed', 'Runtime Host is closed.'))
      if (serializedBytes(prepared) > limits.maxProgramBytes) {
        return Effect.fail(new IsolatedVmError('limit-exceeded', 'Fixed Flow exceeds the configured byte limit.'))
      }
      return Effect.callback<FlowRunOutcome, Error>((resume, signal) => {
        const child = this.#child ?? this.#start()
        const executionId = ++this.#executionId
        const interrupt = (): void => {
          this.#send(child, { executionId, type: 'cancel' })
          this.#finish(executionId, () => {})
        }
        this.#pending.set(executionId, {
          capability: options.capability,
          capabilityCalls: new Map(),
          activeCalls: new Map(),
          cancel: interrupt,
          emit: options.emit,
          invokeTask: options.invokeTask,
          limits,
          projectFailure: options.projectFailure,
          reject: (error) => resume(Effect.fail(normalizedError(error))),
          resolve: (value) => resume(Effect.succeed(value as FlowRunOutcome)),
        })
        signal.addEventListener('abort', interrupt, { once: true })
        this.#send(child, {
          executionId,
          flow: {
            ...(options.bindingValues == null ? {} : { bindingValues: options.bindingValues }),
            flowId: options.flowId,
            ...(options.inputs == null ? {} : { inputs: options.inputs }),
            prepared,
            ...(options.resume == null ? {} : { resume: options.resume }),
            runId: options.runId,
            ...(options.trigger == null ? {} : { trigger: options.trigger }),
          },
          limits,
          type: 'invoke',
        })
        return Effect.sync(() => signal.removeEventListener('abort', interrupt))
      })
    })
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    const child = this.#child
    const reason = new IsolatedVmError('canceled', 'Runtime Host is closed.')
    for (const [executionId, pending] of this.#pending) this.#finish(executionId, () => pending.reject(reason))
    if (child == null) return
    this.#child = undefined
    if (child.exitCode != null || child.signalCode != null) return
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
    child.kill()
    await closed
  }

  #start(): ChildProcess {
    const modulePath = fileURLToPath(import.meta.url)
    const executorPath = fileURLToPath(new URL(modulePath.endsWith('.ts') ? './isolated-vm-executor.ts' : './isolated-vm-executor.js', import.meta.url))
    const child = spawn(process.execPath, ['--no-node-snapshot', executorPath, '--executor'], {
      env: { NODE_ENV: 'production' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    }) as ChildProcessByStdio<null, null, Readable>
    this.#child = child
    this.#stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (this.#child == child && this.#stderr.length < 4_096) this.#stderr += chunk
    })
    child.once('error', (error) => this.#fail(child, normalizedError(error)))
    child.once('disconnect', () =>
      this.#fail(child, new IsolatedVmError('executor-crashed', 'Runtime Executor IPC channel disconnected before completing its work.')),
    )
    child.once('close', (code, signal) => {
      const detail = this.#stderr.trim()
      this.#fail(
        child,
        new IsolatedVmError(
          'executor-crashed',
          `Runtime Executor exited before completing its work (${signal ?? code ?? 'unknown'}${detail.length == 0 ? '' : `: ${detail}`}).`,
        ),
      )
    })
    child.on('message', (message) => this.#receive(child, message as ExecutorMessage))
    return child
  }

  #receive(child: ChildProcess, message: ExecutorMessage): void {
    const pending = this.#pending.get(message.executionId)
    if (pending == null) return
    if (message.type == 'result') {
      if (message.retire && this.#child == child) {
        this.#child = undefined
      }
      this.#finish(message.executionId, () => {
        if (message.ok) pending.resolve(message.value)
        else pending.reject(new IsolatedVmError(message.code, message.message))
      })
      return
    }
    if (message.type == 'call.cancel') {
      const fiber = pending.activeCalls.get(message.id)
      if (fiber != null) Effect.runFork(Fiber.interrupt(fiber))
      return
    }
    if (message.type == 'event') {
      this.#call(child, message.executionId, message.id, pending, () => {
        if (pending.emit == null) throw new IsolatedVmError('executor-crashed', 'Runtime Executor emitted an event outside a Flow Run.')
        return pending.emit(message.event)
      })
      return
    }
    if (message.type == 'task') {
      this.#call(
        child,
        message.executionId,
        message.id,
        pending,
        (signal) => {
          if (pending.invokeTask == null) throw new IsolatedVmError('executor-crashed', 'Runtime Executor requested a Task outside a Flow Run.')
          return pending.invokeTask({ ...message.invocation, signal })
        },
        pending.limits.maxResultBytes,
      )
      return
    }
    const calls = (pending.capabilityCalls.get(message.invocationId) ?? 0) + 1
    pending.capabilityCalls.set(message.invocationId, calls)
    if (calls > pending.limits.maxCapabilityCalls) {
      this.#send(child, {
        code: 'node.failed',
        error: 'Capability call limit exceeded.',
        executionId: message.executionId,
        id: message.id,
        ok: false,
        type: 'capability.result',
      })
      return
    }
    this.#call(
      child,
      message.executionId,
      message.id,
      pending,
      (signal) =>
        pending.capability(message.capabilities ?? [], {
          invocationId: message.invocationId,
          kind: message.kind,
          payload: message.payload,
          signal,
        }),
      pending.limits.maxCapabilityResponseBytes,
    )
  }

  #call(
    child: ChildProcess,
    executionId: number,
    id: number,
    pending: PendingInvocation,
    operation: (signal: AbortSignal) => unknown | Promise<unknown>,
    byteLimit?: number,
  ): void {
    const fiber = Effect.runFork(
      Effect.tryPromise({
        try: (signal) => Promise.resolve(operation(signal)),
        catch: normalizedError,
      }).pipe(
        Effect.flatMap((value) =>
          Effect.try({
            try: () => {
              if (!this.#pending.has(executionId)) return
              if (byteLimit != null && serializedBytes(value) > byteLimit) {
                this.#send(child, {
                  code: 'node.failed',
                  error: 'Runtime response exceeds the configured byte limit.',
                  executionId,
                  id,
                  ok: false,
                  type: 'capability.result',
                })
              } else this.#send(child, { executionId, id, ok: true, type: 'capability.result', value: (value ?? null) as JsonValue })
            },
            catch: normalizedError,
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            if (!this.#pending.has(executionId)) return
            const failure = pending.projectFailure(error)
            this.#send(child, {
              code: failure.code,
              error: failure.message,
              executionId,
              id,
              ok: false,
              type: 'capability.result',
            })
          }),
        ),
      ),
    )
    pending.activeCalls.set(id, fiber)
    fiber.addObserver(() => pending.activeCalls.delete(id))
  }

  #send(child: ChildProcess, message: ParentMessage): void {
    if (this.#child != child || !child.connected) return
    child.send(message, (error) => {
      if (error != null) this.#fail(child, normalizedError(error))
    })
  }

  #finish(executionId: number, operation: () => void): void {
    const pending = this.#pending.get(executionId)
    if (pending == null) return
    this.#pending.delete(executionId)
    pending.signal?.removeEventListener('abort', pending.cancel)
    for (const fiber of pending.activeCalls.values()) Effect.runFork(Fiber.interrupt(fiber))
    pending.activeCalls.clear()
    operation()
  }

  #fail(child: ChildProcess, error: Error): void {
    if (this.#child != child) return
    this.#child = undefined
    for (const [executionId, pending] of this.#pending) this.#finish(executionId, () => pending.reject(error))
  }
}
