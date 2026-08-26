import type { ConnectorCapability, JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { PreparedFlow } from '@oomol-lab/open-flow/flow-semantics'
import type { RuntimeCapabilityResponse, RuntimeInvocation, RuntimeProgram } from '@oomol-lab/open-flow/runtime-contract'
import type { FlowRunOptions, FlowRunResult, SchedulerEvent, SchedulerFailure, TaskInvocation, TriggerSeed } from '@oomol-lab/open-flow/scheduler'
import type IsolatedVM from 'isolated-vm'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Interface } from 'node:readline'

import { createRuntimeProgram } from '@oomol-lab/open-flow/flow-semantics'
import { findEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { runFlow } from '@oomol-lab/open-flow/scheduler'
import * as Effect from 'effect/Effect'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
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

export const isolatedVmEngineDigest = `sha256:${createHash('sha256').update('open-flow-isolated-vm/2 isolated-vm/7.0.1 node/26 web-globals/1').digest('hex')}`

export class IsolatedVmError extends Error {
  readonly code: 'canceled' | 'executor-crashed' | 'invalid-program' | 'limit-exceeded' | 'task-failed'

  constructor(code: IsolatedVmError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'IsolatedVmError'
  }
}

type InvokeRequest =
  | {
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
        readonly flowId: string
        readonly inputs?: FlowRunOptions['inputs']
        readonly prepared: PreparedFlow
        readonly runId: string
        readonly trigger?: TriggerSeed
      }
      readonly limits: IsolatedVmLimits
      readonly type: 'invoke'
    }

type ParentMessage = InvokeRequest | { readonly executionId: number; readonly type: 'cancel' } | CapabilityResult

interface CapabilityResult {
  readonly code?: string
  readonly error?: string
  readonly executionId: number
  readonly id: number
  readonly ok: boolean
  readonly type: 'capability.result'
  readonly value?: unknown
}

type CapabilityOutcome = Omit<CapabilityResult, 'executionId'>

type ExecutorMessage =
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
  | { readonly executionId: number; readonly id: number; readonly invocation: Omit<TaskInvocation, 'signal'>; readonly type: 'task' }
  | { readonly executionId: number; readonly id: number; readonly type: 'call.cancel' }
  | { readonly code: IsolatedVmError['code']; readonly executionId: number; readonly message: string; readonly ok: false; readonly type: 'result' }
  | { readonly executionId: number; readonly ok: true; readonly type: 'result'; readonly value: FlowRunResult | JsonValue }

interface PendingCapability {
  readonly cancel: () => void
  readonly reject: (error: Error) => void
  readonly resolve: (result: CapabilityResult) => void
}

interface PendingInvocation {
  readonly capability: (
    capabilities: readonly ConnectorCapability[],
    call: Parameters<RuntimeInvocation['capability']>[0],
  ) => Promise<RuntimeCapabilityResponse>
  readonly capabilityCalls: Map<string, number>
  readonly activeCalls: Map<number, AbortController>
  readonly cancel: () => void
  readonly emit?: (event: SchedulerEvent) => void | Promise<void>
  readonly invokeTask?: (invocation: TaskInvocation) => Promise<unknown>
  readonly limits: IsolatedVmLimits
  readonly projectFailure: (error: unknown) => SchedulerFailure
  readonly reject: (error: unknown) => void
  readonly resolve: (value: FlowRunResult | JsonValue) => void
  readonly signal?: AbortSignal
  readonly wallTimer?: ReturnType<typeof setTimeout>
}

const encoder = new TextEncoder()

function serializedBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength
}

function writeMessage(message: ExecutorMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function normalizedError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

async function remote(result: Promise<CapabilityResult>): Promise<unknown> {
  const response = await result
  if (response.ok) return response.value ?? null
  throw Object.assign(new Error(response.error ?? 'Runtime Host call failed.'), { schedulerCode: response.code ?? 'node.failed' })
}

function programError(program: RuntimeProgram): IsolatedVmError | undefined {
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
  #child?: ChildProcessWithoutNullStreams
  #closed = false
  #executionId = 0
  #output?: Interface
  readonly #pending = new Map<number, PendingInvocation>()
  #stderr = ''

  async invoke(invocation: RuntimeInvocation, limits: IsolatedVmLimits = isolatedVmLimits): Promise<JsonValue> {
    if (this.#closed) throw new IsolatedVmError('executor-crashed', 'Runtime Host is closed.')
    const invalid = programError(invocation.program)
    if (invalid != null) throw invalid
    if (serializedBytes(invocation.input) > limits.maxInputBytes) {
      throw new IsolatedVmError('limit-exceeded', 'Runtime input exceeds the configured byte limit.')
    }
    if (serializedBytes(invocation.program) > limits.maxProgramBytes) {
      throw new IsolatedVmError('limit-exceeded', 'Runtime program exceeds the configured byte limit.')
    }
    if (invocation.signal?.aborted) throw invocation.signal.reason

    const child = this.#child ?? this.#start()
    const executionId = ++this.#executionId
    return await new Promise<JsonValue>((resolve, reject) => {
      const cancel = (): void => {
        this.#send(child, { executionId, type: 'cancel' })
        this.#finish(executionId, () => reject(invocation.signal?.reason ?? new IsolatedVmError('canceled', 'Runtime invocation was canceled.')))
      }
      const wallTimer = setTimeout(() => {
        this.#send(child, { executionId, type: 'cancel' })
        this.#finish(executionId, () => reject(new IsolatedVmError('limit-exceeded', 'Runtime invocation exceeded its wall-clock limit.')))
      }, limits.wallMs)
      this.#pending.set(executionId, {
        capability: (_capabilities, call) => invocation.capability(call),
        capabilityCalls: new Map(),
        activeCalls: new Map(),
        cancel,
        limits,
        projectFailure: (error) => ({ code: 'node.failed', message: normalizedError(error).message }),
        reject,
        resolve: (value) => resolve(value as JsonValue),
        signal: invocation.signal,
        wallTimer,
      })
      invocation.signal?.addEventListener('abort', cancel, { once: true })
      this.#send(child, { executionId, input: invocation.input, invocationId: invocation.invocationId, limits, program: invocation.program, type: 'invoke' })
    })
  }

  async run(
    prepared: PreparedFlow,
    options: {
      readonly capability: (
        capabilities: readonly ConnectorCapability[],
        call: Parameters<RuntimeInvocation['capability']>[0],
      ) => Promise<RuntimeCapabilityResponse>
      readonly emit?: (event: SchedulerEvent) => void | Promise<void>
      readonly flowId: string
      readonly inputs?: FlowRunOptions['inputs']
      readonly invokeTask: (invocation: TaskInvocation) => Promise<unknown>
      readonly projectFailure: (error: unknown) => SchedulerFailure
      readonly runId: string
      readonly signal?: AbortSignal
      readonly trigger?: TriggerSeed
    },
    limits: IsolatedVmLimits = isolatedVmLimits,
  ): Promise<FlowRunResult> {
    if (this.#closed) throw new IsolatedVmError('executor-crashed', 'Runtime Host is closed.')
    if (serializedBytes(prepared) > limits.maxProgramBytes) {
      throw new IsolatedVmError('limit-exceeded', 'Fixed Flow exceeds the configured byte limit.')
    }
    if (options.signal?.aborted) throw options.signal.reason

    const child = this.#child ?? this.#start()
    const executionId = ++this.#executionId
    return await new Promise<FlowRunResult>((resolve, reject) => {
      const cancel = (): void => {
        this.#send(child, { executionId, type: 'cancel' })
        this.#finish(executionId, () => reject(options.signal?.reason ?? new IsolatedVmError('canceled', 'Flow Run was canceled.')))
      }
      this.#pending.set(executionId, {
        capability: options.capability,
        capabilityCalls: new Map(),
        activeCalls: new Map(),
        cancel,
        emit: options.emit,
        invokeTask: options.invokeTask,
        limits,
        projectFailure: options.projectFailure,
        reject,
        resolve: (value) => resolve(value as FlowRunResult),
        signal: options.signal,
      })
      options.signal?.addEventListener('abort', cancel, { once: true })
      this.#send(child, {
        executionId,
        flow: {
          flowId: options.flowId,
          ...(options.inputs == null ? {} : { inputs: options.inputs }),
          prepared,
          runId: options.runId,
          ...(options.trigger == null ? {} : { trigger: options.trigger }),
        },
        limits,
        type: 'invoke',
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
    this.#output?.close()
    this.#output = undefined
    if (child.exitCode != null || child.signalCode != null) return
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
    child.kill()
    await closed
  }

  #start(): ChildProcessWithoutNullStreams {
    const modulePath = fileURLToPath(import.meta.url)
    const executorPath = modulePath.endsWith('.ts') ? modulePath : fileURLToPath(new URL('./isolated-vm.js', import.meta.url))
    const child = spawn(process.execPath, ['--no-node-snapshot', executorPath, '--executor'], {
      env: { NODE_ENV: 'production' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const output = createInterface({ input: child.stdout })
    this.#child = child
    this.#output = output
    this.#stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (this.#child == child && this.#stderr.length < 4_096) this.#stderr += chunk
    })
    child.once('error', (error) => this.#fail(child, normalizedError(error)))
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
    output.on('line', (line) => this.#receive(child, line))
    return child
  }

  #receive(child: ChildProcessWithoutNullStreams, line: string): void {
    let message: ExecutorMessage
    try {
      message = JSON.parse(line) as ExecutorMessage
    } catch {
      this.#fail(child, new IsolatedVmError('executor-crashed', 'Runtime Executor returned an invalid protocol message.'))
      child.kill()
      return
    }
    const pending = this.#pending.get(message.executionId)
    if (pending == null) return
    if (message.type == 'result') {
      this.#finish(message.executionId, () => {
        if (message.ok) pending.resolve(message.value)
        else pending.reject(new IsolatedVmError(message.code, message.message))
      })
      return
    }
    if (message.type == 'call.cancel') {
      pending.activeCalls.get(message.id)?.abort(new IsolatedVmError('canceled', 'Runtime call was canceled.'))
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
          return pending.invokeTask({ ...message.invocation, signal } as TaskInvocation)
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
    child: ChildProcessWithoutNullStreams,
    executionId: number,
    id: number,
    pending: PendingInvocation,
    operation: (signal: AbortSignal) => unknown | Promise<unknown>,
    byteLimit?: number,
  ): void {
    const controller = new AbortController()
    pending.activeCalls.set(id, controller)
    void Promise.resolve()
      .then(() => operation(controller.signal))
      .then((value) => {
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
      })
      .catch((error) => {
        if (this.#pending.has(executionId)) {
          const failure = pending.projectFailure(error)
          this.#send(child, {
            code: failure.code,
            error: failure.message,
            executionId,
            id,
            ok: false,
            type: 'capability.result',
          })
        }
      })
      .finally(() => pending.activeCalls.delete(id))
  }

  #send(child: ChildProcessWithoutNullStreams, message: ParentMessage): void {
    if (this.#child == child && !child.stdin.destroyed) child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  #finish(executionId: number, operation: () => void): void {
    const pending = this.#pending.get(executionId)
    if (pending == null) return
    this.#pending.delete(executionId)
    if (pending.wallTimer != null) clearTimeout(pending.wallTimer)
    pending.signal?.removeEventListener('abort', pending.cancel)
    const reason = new IsolatedVmError('canceled', 'Runtime invocation is no longer active.')
    for (const controller of pending.activeCalls.values()) controller.abort(reason)
    pending.activeCalls.clear()
    operation()
  }

  #fail(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.#child != child) return
    this.#child = undefined
    this.#output?.close()
    this.#output = undefined
    for (const [executionId, pending] of this.#pending) this.#finish(executionId, () => pending.reject(error))
  }
}

async function execute(
  request: InvokeRequest,
  canceled: AbortSignal,
  call: (invocationId: string, capabilities: readonly ConnectorCapability[], kind: string, payload: JsonValue) => Promise<RuntimeCapabilityResponse>,
  capabilities: readonly ConnectorCapability[] = [],
  preserveCapabilityFailure = false,
): Promise<JsonValue> {
  if (!('program' in request)) throw new IsolatedVmError('invalid-program', 'Runtime module invocation is incomplete.')
  const { invocationId, program } = request
  const invalid = programError(program)
  if (invalid != null) throw invalid
  if (serializedBytes(program) > request.limits.maxProgramBytes) {
    throw new IsolatedVmError('limit-exceeded', 'Runtime program exceeds the configured byte limit.')
  }
  const ivm = (await import('isolated-vm')).default
  let isolate: IsolatedVM.Isolate | undefined
  const timers = new Map<number, { readonly fire: IsolatedVM.Reference<() => void>; readonly timer: ReturnType<typeof setTimeout> }>()
  const canceledTimers = new Set<number>()
  let abort: (() => void) | undefined
  let clearTimers: (() => void) | undefined
  let capabilityFailure: unknown
  try {
    isolate = new ivm.Isolate({
      memoryLimit: request.limits.memoryMb,
      onCatastrophicError() {
        process.abort()
      },
    })
    const context = await isolate.createContext()
    let active = true
    clearTimers = (): void => {
      for (const { fire, timer } of timers.values()) {
        clearTimeout(timer)
        fire.release()
      }
      timers.clear()
      canceledTimers.clear()
    }
    abort = (): void => {
      if (!active) return
      active = false
      clearTimers?.()
      if (isolate != null && !isolate.isDisposed) isolate.dispose()
    }
    canceled.addEventListener('abort', abort, { once: true })
    const scheduleTimer = new ivm.Reference(
      (idReference: IsolatedVM.Reference<number>, delayReference: IsolatedVM.Reference<number>, fire: IsolatedVM.Reference<() => void>): void => {
        const id = idReference.copySync()
        const delay = delayReference.copySync()
        idReference.release()
        delayReference.release()
        if (!active || canceledTimers.delete(id)) {
          fire.release()
          return
        }
        const timer = setTimeout(
          () => {
            timers.delete(id)
            if (active) fire.applyIgnored(undefined, [], { arguments: { copy: true } })
            fire.release()
          },
          Math.min(Math.max(Number.isFinite(delay) ? delay : 0, 0), request.limits.wallMs),
        )
        timers.set(id, { fire, timer })
      },
    )
    const cancelTimer = new ivm.Reference((id: number): void => {
      const timer = timers.get(id)
      if (timer == null) {
        canceledTimers.add(id)
        return
      }
      timers.delete(id)
      clearTimeout(timer.timer)
      timer.fire.release()
    })
    const cloneValue = new ivm.Reference((value: unknown): unknown => value)
    const decodeBase64 = new ivm.Reference((value: string): string => atob(value))
    const decodeText = new ivm.Reference((input: Uint8Array, label: string, options: { readonly fatal?: boolean; readonly ignoreBOM?: boolean }): string =>
      new TextDecoder(label, options).decode(input),
    )
    const encodeBase64 = new ivm.Reference((value: string): string => btoa(value))
    const encodeText = new ivm.Reference((value: string): Uint8Array => new TextEncoder().encode(value))
    const now = new ivm.Reference((): number => performance.now())
    const capability = new ivm.Reference((sourceReference: IsolatedVM.Reference<string>, settle: IsolatedVM.Reference<(source: string) => void>): void => {
      const settleResult = (result: CapabilityOutcome): void => {
        if (!active) return
        const source = result.ok ? JSON.stringify({ ok: true, value: result.value }) : JSON.stringify({ error: result.error, ok: false })
        settle.applyIgnored(undefined, [source], { arguments: { copy: true } })
        settle.release()
      }
      void sourceReference
        .copy()
        .then((source) => {
          if (!active) {
            settleResult({ error: 'Capability is no longer active.', id: 0, ok: false, type: 'capability.result' })
            return
          }
          let capabilityCall: { readonly kind: string; readonly payload: JsonValue }
          try {
            const parsed = JSON.parse(source) as { readonly kind?: unknown; readonly payload?: unknown }
            if (typeof parsed.kind != 'string' || !Object.hasOwn(parsed, 'payload')) throw new TypeError()
            capabilityCall = parsed as { readonly kind: string; readonly payload: JsonValue }
          } catch {
            settleResult({ error: 'Capability request is invalid.', id: 0, ok: false, type: 'capability.result' })
            return
          }
          void call(invocationId, capabilities, capabilityCall.kind, capabilityCall.payload).then(
            (result) => settleResult({ id: 0, ok: true, type: 'capability.result', value: result }),
            (error) => {
              capabilityFailure = error
              settleResult({ error: normalizedError(error).message, id: 0, ok: false, type: 'capability.result' })
            },
          )
        })
        .catch((error) => settleResult({ error: normalizedError(error).message, id: 0, ok: false, type: 'capability.result' }))
        .finally(() => sourceReference.release())
    })
    context.global.setSync('__openFlowCapability', capability)
    context.global.setSync('__openFlowClearTimeout', cancelTimer)
    context.global.setSync('__openFlowClone', cloneValue)
    context.global.setSync('__openFlowDecodeBase64', decodeBase64)
    context.global.setSync('__openFlowDecodeText', decodeText)
    context.global.setSync('__openFlowEncodeBase64', encodeBase64)
    context.global.setSync('__openFlowEncodeText', encodeText)
    context.global.setSync('__openFlowNow', now)
    context.global.setSync('__openFlowSetTimeout', scheduleTimer)
    context.global.setSync('__openFlowTimeOrigin', performance.timeOrigin)

    const contract = findEngineContract(program.engineContract)!
    const capabilityModule = await isolate.compileModule(
      `const call = globalThis.__openFlowCapability
const cancelTimer = globalThis.__openFlowClearTimeout
const cloneValue = globalThis.__openFlowClone
const decodeBase64 = globalThis.__openFlowDecodeBase64
const decodeText = globalThis.__openFlowDecodeText
const encodeBase64 = globalThis.__openFlowEncodeBase64
const encodeText = globalThis.__openFlowEncodeText
const now = globalThis.__openFlowNow
const scheduleTimer = globalThis.__openFlowSetTimeout
const timeOrigin = globalThis.__openFlowTimeOrigin
delete globalThis.__openFlowCapability
delete globalThis.__openFlowClearTimeout
delete globalThis.__openFlowClone
delete globalThis.__openFlowDecodeBase64
delete globalThis.__openFlowDecodeText
delete globalThis.__openFlowEncodeBase64
delete globalThis.__openFlowEncodeText
delete globalThis.__openFlowNow
delete globalThis.__openFlowSetTimeout
delete globalThis.__openFlowTimeOrigin
let nextTimerId = 0
const activeTimers = new Set()
const schedule = (callback, delay, args, repeat) => {
  const id = ++nextTimerId
  const fire = () => {
    if (!activeTimers.has(id)) return
    if (repeat) {
      scheduleTimer.applyIgnored(undefined, [id, Number(delay), fire], { arguments: { reference: true } })
    } else activeTimers.delete(id)
    callback(...args)
  }
  activeTimers.add(id)
  scheduleTimer.applyIgnored(undefined, [id, Number(delay), fire], { arguments: { reference: true } })
  return id
}
globalThis.clearTimeout = (id) => {
  const timerId = Number(id)
  if (!activeTimers.delete(timerId)) return
  cancelTimer.applyIgnored(undefined, [timerId], { arguments: { copy: true } })
}
globalThis.clearInterval = globalThis.clearTimeout
globalThis.setTimeout = (callback, delay = 0, ...args) => {
  if (typeof callback !== 'function') throw new TypeError('setTimeout callback must be a function.')
  return schedule(callback, delay, args, false)
}
globalThis.setInterval = (callback, delay = 0, ...args) => {
  if (typeof callback !== 'function') throw new TypeError('setInterval callback must be a function.')
  return schedule(callback, delay, args, true)
}
globalThis.queueMicrotask = (callback) => {
  if (typeof callback !== 'function') throw new TypeError('queueMicrotask callback must be a function.')
  void Promise.resolve().then(callback)
}
globalThis.performance = Object.freeze({
  now: () => now.applySync(undefined, [], { arguments: { copy: true }, result: { copy: true } }),
  timeOrigin,
})
globalThis.atob = (value) => decodeBase64.applySync(undefined, [String(value)], { arguments: { copy: true }, result: { copy: true } })
globalThis.btoa = (value) => encodeBase64.applySync(undefined, [String(value)], { arguments: { copy: true }, result: { copy: true } })
globalThis.structuredClone = (value) => cloneValue.applySync(undefined, [value], { arguments: { copy: true }, result: { copy: true } })
globalThis.TextDecoder = class TextDecoder {
  constructor(label = 'utf-8', options = {}) {
    this.encoding = String(label).toLowerCase()
    this.fatal = Boolean(options.fatal)
    this.ignoreBOM = Boolean(options.ignoreBOM)
  }
  decode(input = new Uint8Array()) {
    return decodeText.applySync(undefined, [input, this.encoding, { fatal: this.fatal, ignoreBOM: this.ignoreBOM }], {
      arguments: { copy: true },
      result: { copy: true },
    })
  }
}
globalThis.TextEncoder = class TextEncoder {
  encoding = 'utf-8'
  encode(input = '') {
    return encodeText.applySync(undefined, [String(input)], { arguments: { copy: true }, result: { copy: true } })
  }
}
async function invoke(kind, payload) {
  const source = await new Promise((resolve) => {
    call.applyIgnored(undefined, [JSON.stringify({ kind, payload }), resolve], { arguments: { reference: true } })
  })
  const result = JSON.parse(source)
  if (!result.ok) throw new Error(result.error)
  return result.value
}
export const capability = Object.freeze({
  artifact: Object.freeze({
    open: (reference) => invoke('artifact.open', reference),
    put: (input) => invoke('artifact.put', input),
  }),
  connector: (input) => invoke('connector', input),
  egress: (url) => invoke('egress', { url }),
  secret: (reference) => invoke('secret', reference),
})`,
      { filename: 'open-flow:engine/capability.mjs' },
    )
    await capabilityModule.instantiate(context, () => {
      throw new IsolatedVmError('invalid-program', 'Engine Capability module cannot import dependencies.')
    })
    await capabilityModule.evaluate({ timeout: request.limits.cpuMs })

    const platformModule = await isolate.compileModule(contract.platformSource, { filename: contract.platformModule })
    const modules = new Map<string, IsolatedVM.Module>([
      ['engine/capability.mjs', capabilityModule],
      [contract.platformModule, platformModule],
    ])
    const paths = new Map<IsolatedVM.Module, string>([
      [capabilityModule, 'engine/capability.mjs'],
      [platformModule, contract.platformModule],
    ])
    for (const [moduleId, module] of Object.entries(program.modules)) {
      const modulePath = `user/${moduleId}.mjs`
      const compiled = await isolate.compileModule(module.source, { filename: `open-flow:${modulePath}` })
      modules.set(modulePath, compiled)
      paths.set(compiled, modulePath)
    }
    const mainModule = await isolate.compileModule(
      `import task from '../user/${program.entryModuleId}.mjs'
import { capability } from './capability.mjs'
export async function invoke(source) {
  try {
    const value = await task(JSON.parse(source), capability)
    return JSON.stringify({ engineDigest: ${JSON.stringify(program.engineDigest)}, ok: true, value })
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error), ok: false })
  }
}`,
      { filename: 'open-flow:engine/main.mjs' },
    )
    modules.set('engine/main.mjs', mainModule)
    paths.set(mainModule, 'engine/main.mjs')

    const resolve = (specifier: string, referrer: IsolatedVM.Module): IsolatedVM.Module => {
      const referrerPath = paths.get(referrer)
      if (referrerPath == null) throw new IsolatedVmError('invalid-program', 'Runtime module referrer is unknown.')
      if (specifier == contract.platformModule && referrerPath.startsWith('user/')) return platformModule
      if (referrerPath == 'engine/main.mjs' && specifier == './capability.mjs') return capabilityModule
      if (referrerPath == 'engine/main.mjs' && specifier == `../user/${program.entryModuleId}.mjs`) {
        return modules.get(`user/${program.entryModuleId}.mjs`)!
      }
      const imported = /^\.\/([^/]+)\.mjs$/.exec(specifier)?.[1]
      const referrerId = /^user\/(.+)\.mjs$/.exec(referrerPath)?.[1]
      if (imported != null && referrerId != null && program.modules[referrerId]?.imports.includes(imported)) {
        const target = modules.get(`user/${imported}.mjs`)
        if (target != null) return target
      }
      throw new IsolatedVmError('invalid-program', `Module "${specifier}" is not part of the fixed runtime closure.`)
    }
    await mainModule.instantiate(context, resolve)
    await mainModule.evaluate({ timeout: request.limits.cpuMs })
    const invoke = await mainModule.namespace.get('invoke', { reference: true })
    const source = await (invoke as IsolatedVM.Reference<(source: string) => Promise<string>>).apply(undefined, [JSON.stringify(request.input)], {
      arguments: { copy: true },
      result: { copy: true, promise: true },
      timeout: request.limits.cpuMs,
    })
    if (typeof source != 'string' || encoder.encode(source).byteLength > request.limits.maxResultBytes) {
      throw new IsolatedVmError('limit-exceeded', 'Runtime result exceeds the configured byte limit.')
    }
    const result = JSON.parse(source) as { readonly engineDigest?: string; readonly error?: string; readonly ok?: boolean; readonly value?: JsonValue }
    if (!result.ok || result.engineDigest != program.engineDigest || !Object.hasOwn(result, 'value')) {
      if (preserveCapabilityFailure && capabilityFailure != null) throw capabilityFailure
      throw new IsolatedVmError('task-failed', result.error ?? 'User Task failed.')
    }
    active = false
    clearTimers()
    return result.value!
  } catch (error) {
    if (error instanceof IsolatedVmError) throw error
    if (preserveCapabilityFailure && error === capabilityFailure) throw error
    const message = normalizedError(error).message
    const code = /memory|heap|timed out|timeout/i.test(message) ? 'limit-exceeded' : 'invalid-program'
    throw new IsolatedVmError(code, message)
  } finally {
    if (abort != null) canceled.removeEventListener('abort', abort)
    clearTimers?.()
    if (isolate != null && !isolate.isDisposed) isolate.dispose()
  }
}

async function executeFlow(
  request: InvokeRequest,
  signal: AbortSignal,
  call: (
    message:
      | {
          readonly capabilities?: readonly ConnectorCapability[]
          readonly invocationId: string
          readonly kind: string
          readonly payload: JsonValue
          readonly type: 'capability'
        }
      | { readonly event: SchedulerEvent; readonly type: 'event' }
      | { readonly invocation: Omit<TaskInvocation, 'signal'>; readonly type: 'task' },
    signal: AbortSignal,
  ) => Promise<CapabilityResult>,
): Promise<FlowRunResult> {
  if (!('flow' in request)) throw new IsolatedVmError('invalid-program', 'Flow Runtime invocation is incomplete.')
  const { flow } = request
  return await Effect.runPromise(
    runFlow(flow.prepared, {
      createId: randomUUID,
      emit: async (event) => {
        await remote(call({ event, type: 'event' }, signal))
      },
      flowId: flow.flowId,
      ...(flow.inputs == null ? {} : { inputs: flow.inputs }),
      invokeTask: async (invocation) => {
        if ('moduleId' in invocation) {
          const program = createRuntimeProgram(flow.prepared, invocation.moduleId, isolatedVmEngineDigest)
          if (program == null) throw new IsolatedVmError('invalid-program', 'Task Module is not part of the fixed Flow closure.')
          return await Effect.runPromise(
            Effect.tryPromise({
              try: (timeoutSignal) =>
                execute(
                  {
                    executionId: request.executionId,
                    input: invocation.input,
                    invocationId: invocation.invocationId,
                    limits: request.limits,
                    program,
                    type: 'invoke',
                  },
                  AbortSignal.any([invocation.signal, timeoutSignal]),
                  async (invocationId, capabilities, kind, payload) =>
                    (await remote(call({ capabilities, invocationId, kind, payload, type: 'capability' }, invocation.signal))) as RuntimeCapabilityResponse,
                  invocation.capabilities,
                  true,
                ),
              catch: (error) => error,
            }).pipe(
              Effect.timeoutOrElse({
                duration: request.limits.wallMs,
                orElse: () => Effect.fail(new IsolatedVmError('limit-exceeded', 'Runtime invocation exceeded its wall-clock limit.')),
              }),
            ),
          )
        }
        const { signal: _signal, ...input } = invocation
        return await remote(call({ invocation: input, type: 'task' }, invocation.signal))
      },
      projectFailure: (error) => ({
        code: typeof Reflect.get(Object(error), 'schedulerCode') == 'string' ? (Reflect.get(Object(error), 'schedulerCode') as string) : 'node.failed',
        message: normalizedError(error).message,
      }),
      runId: flow.runId,
      signal,
      ...(flow.trigger == null ? {} : { trigger: flow.trigger }),
    }),
  )
}

async function runExecutor(): Promise<void> {
  const input = createInterface({ input: process.stdin })
  const executions = new Map<number, { readonly cancellation: AbortController; readonly pending: Map<number, PendingCapability> }>()
  input.once('close', () => {
    const error = new IsolatedVmError('canceled', 'Runtime host disconnected.')
    for (const execution of executions.values()) execution.cancellation.abort(error)
  })
  input.on('line', (line) => {
    let message: ParentMessage
    try {
      message = JSON.parse(line) as ParentMessage
    } catch {
      process.stderr.write('Executor received an invalid protocol message.\n')
      process.exitCode = 1
      input.close()
      return
    }
    if (message.type == 'cancel') {
      executions.get(message.executionId)?.cancellation.abort(new IsolatedVmError('canceled', 'Runtime invocation was canceled.'))
      return
    }
    if (message.type == 'capability.result') {
      const pending = executions.get(message.executionId)?.pending
      const capability = pending?.get(message.id)
      pending?.delete(message.id)
      capability?.resolve(message)
      return
    }
    if (executions.has(message.executionId)) {
      writeMessage({
        code: 'executor-crashed',
        executionId: message.executionId,
        message: 'Executor received a duplicate execution ID.',
        ok: false,
        type: 'result',
      })
      return
    }
    const execution = { cancellation: new AbortController(), pending: new Map<number, PendingCapability>() }
    executions.set(message.executionId, execution)
    void executeWithCapabilities(message, execution.cancellation.signal, execution.pending).finally(() => executions.delete(message.executionId))
  })
}

async function executeWithCapabilities(request: InvokeRequest, signal: AbortSignal, pending: Map<number, PendingCapability>): Promise<void> {
  let nextId = 0
  const call = (
    message:
      | {
          readonly capabilities?: readonly ConnectorCapability[]
          readonly invocationId: string
          readonly kind: string
          readonly payload: JsonValue
          readonly type: 'capability'
        }
      | { readonly event: SchedulerEvent; readonly type: 'event' }
      | { readonly invocation: Omit<TaskInvocation, 'signal'>; readonly type: 'task' },
    callSignal: AbortSignal,
  ): Promise<CapabilityResult> => {
    const id = ++nextId
    return new Promise((resolve, reject) => {
      const cancel = (): void => {
        pending.delete(id)
        writeMessage({ executionId: request.executionId, id, type: 'call.cancel' })
        reject(normalizedError(callSignal.reason))
      }
      pending.set(id, {
        cancel,
        reject: (error) => {
          callSignal.removeEventListener('abort', cancel)
          reject(error)
        },
        resolve: (result) => {
          callSignal.removeEventListener('abort', cancel)
          resolve(result)
        },
      })
      if (callSignal.aborted) cancel()
      else {
        callSignal.addEventListener('abort', cancel, { once: true })
        writeMessage({ executionId: request.executionId, id, ...message } as ExecutorMessage)
      }
    })
  }
  const abort = (): void => {
    const error = normalizedError(signal.reason)
    for (const capability of pending.values()) capability.reject(error)
    pending.clear()
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const value =
      'flow' in request
        ? await executeFlow(request, signal, call)
        : await execute(request, signal, async (invocationId, capabilities, kind, payload) => {
            const response = await call({ capabilities, invocationId, kind, payload, type: 'capability' }, signal)
            if (!response.ok) throw new Error(response.error ?? 'Capability call failed.')
            return response.value as RuntimeCapabilityResponse
          })
    writeMessage({ executionId: request.executionId, ok: true, type: 'result', value })
  } catch (error) {
    const failure =
      error instanceof IsolatedVmError
        ? error
        : new IsolatedVmError(signal.aborted ? 'canceled' : 'flow' in request ? 'task-failed' : 'executor-crashed', normalizedError(error).message)
    writeMessage({ code: failure.code, executionId: request.executionId, message: failure.message, ok: false, type: 'result' })
  } finally {
    signal.removeEventListener('abort', abort)
    const error = new IsolatedVmError('canceled', 'Runtime invocation is no longer active.')
    for (const capability of pending.values()) capability.reject(error)
    pending.clear()
  }
}

if (process.argv[1] != null && fileURLToPath(import.meta.url) == process.argv[1] && process.argv[2] == '--executor') {
  void runExecutor()
}
