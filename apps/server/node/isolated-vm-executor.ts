import type { ConnectorCapability, JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { RuntimeCapabilityResponse, RuntimeProgram } from '@oomol-lab/open-flow/runtime-contract'
import type { FlowRunOutcome, SchedulerEvent, TaskInvocation } from '@oomol-lab/open-flow/scheduler'
import type * as Scope from 'effect/Scope'
import type IsolatedVM from 'isolated-vm'
import type { CapabilityResult, ExecutorMessage, InvokeContext, InvokeRequest, IsolatedVmLimits, ParentMessage } from './isolated-vm.ts'

import { createRuntimeProgram } from '@oomol-lab/open-flow/flow-semantics'
import { findEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { runFlow } from '@oomol-lab/open-flow/scheduler'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FiberSet from 'effect/FiberSet'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { IsolatedVmError, isolatedVmEngineDigest, normalizedError, programError, serializedBytes } from './isolated-vm.ts'

type CapabilityOutcome = Omit<CapabilityResult, 'executionId'>

interface PendingCapability {
  readonly deferred: Deferred.Deferred<CapabilityResult, Error>
}

const encoder = new TextEncoder()
const executorIsolateBudget = 1_000
let completedIsolates = 0

function writeMessage(message: ExecutorMessage, sent: () => void = () => {}): void {
  if (process.send == null) return sent()
  process.send(message, sent)
}

function remote(result: Effect.Effect<CapabilityResult, Error>): Effect.Effect<unknown, Error> {
  return Effect.flatMap(result, (response) => {
    if (response.ok) return Effect.succeed(response.value ?? null)
    return Effect.fail(Object.assign(new Error(response.error ?? 'Runtime Host call failed.'), { schedulerCode: response.code ?? 'node.failed' }))
  })
}

// Executor code runs in a child process outside Vitest coverage collection.
/* v8 ignore start */
const capabilitySource = `const call = globalThis.__openFlowCapability
const cancelTimer = globalThis.__openFlowClearTimeout
const cloneValue = globalThis.__openFlowClone
const decodeBase64 = globalThis.__openFlowDecodeBase64
const decodeText = globalThis.__openFlowDecodeText
const encodeBase64 = globalThis.__openFlowEncodeBase64
const encodeText = globalThis.__openFlowEncodeText
const writeLog = globalThis.__openFlowLog
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
delete globalThis.__openFlowLog
delete globalThis.__openFlowNow
delete globalThis.__openFlowSetTimeout
delete globalThis.__openFlowTimeOrigin
const abortSignals = new WeakMap()
globalThis.AbortSignal = class AbortSignal {
  #aborted = false
  #listeners = new Set()
  #reason
  onabort = null
  constructor() {
    abortSignals.set(this, (reason) => {
      if (this.#aborted) return
      this.#aborted = true
      this.#reason = reason
      const event = Object.freeze({ currentTarget: this, target: this, type: 'abort' })
      if (typeof this.onabort == 'function') this.onabort.call(this, event)
      for (const listener of this.#listeners) {
        if (typeof listener == 'function') listener.call(this, event)
        else listener.handleEvent(event)
      }
      this.#listeners.clear()
    })
  }
  get aborted() {
    return this.#aborted
  }
  get reason() {
    return this.#reason
  }
  addEventListener(type, listener) {
    if (type == 'abort') this.#listeners.add(listener)
  }
  removeEventListener(type, listener) {
    if (type == 'abort') this.#listeners.delete(listener)
  }
  throwIfAborted() {
    if (this.#aborted) throw this.#reason
  }
}
globalThis.AbortController = class AbortController {
  #signal = new AbortSignal()
  get signal() {
    return this.#signal
  }
  abort(reason = new Error('This operation was aborted.')) {
    abortSignals.get(this.#signal)(reason)
  }
}
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
const formatLogValue = (value) => {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? value.message
  try {
    const source = JSON.stringify(value)
    return source === undefined ? String(value) : source
  } catch {
    return String(value)
  }
}
const emitLog = (level, values) => {
  const message = values.map(formatLogValue).join(' ')
  if (message.length > 0) writeLog.applySync(undefined, [level, message], { arguments: { copy: true } })
}
globalThis.console = Object.freeze({
  debug: (...values) => emitLog('debug', values),
  error: (...values) => emitLog('error', values),
  info: (...values) => emitLog('info', values),
  log: (...values) => emitLog('info', values),
  warn: (...values) => emitLog('warn', values),
})
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
  outputs: (value) => invoke('outputs', value),
})`

function installGlobals(
  ivm: typeof IsolatedVM,
  context: IsolatedVM.Context,
  request: { readonly invocationId: string; readonly limits: IsolatedVmLimits },
  call: (invocationId: string, capabilities: readonly ConnectorCapability[], kind: string, payload: JsonValue) => Promise<RuntimeCapabilityResponse>,
  capabilities: readonly ConnectorCapability[],
  log?: (level: 'debug' | 'error' | 'info' | 'warn', message: string) => Promise<void>,
): { readonly close: () => boolean; readonly failure: () => unknown; readonly flush: () => Promise<void> } {
  const timers = new Map<number, { readonly fire: IsolatedVM.Reference<() => void>; readonly timer: ReturnType<typeof setTimeout> }>()
  const canceledTimers = new Set<number>()
  let active = true
  let capabilityFailure: unknown
  let logQueue = Promise.resolve()

  const close = (): boolean => {
    const wasActive = active
    active = false
    for (const { fire, timer } of timers.values()) {
      clearTimeout(timer)
      fire.release()
    }
    timers.clear()
    canceledTimers.clear()
    return wasActive
  }
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
  const writeLog = new ivm.Reference((level: 'debug' | 'error' | 'info' | 'warn', message: string): void => {
    if (!active || log == null) return
    logQueue = logQueue.then(() => log(level, message)).catch(() => {})
  })
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
        void call(request.invocationId, capabilities, capabilityCall.kind, capabilityCall.payload).then(
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
  context.global.setSync('__openFlowLog', writeLog)
  context.global.setSync('__openFlowNow', now)
  context.global.setSync('__openFlowSetTimeout', scheduleTimer)
  context.global.setSync('__openFlowTimeOrigin', performance.timeOrigin)
  return { close, failure: () => capabilityFailure, flush: () => logQueue }
}

async function compileProgram(
  isolate: IsolatedVM.Isolate,
  context: IsolatedVM.Context,
  program: RuntimeProgram,
  contract: NonNullable<ReturnType<typeof findEngineContract>>,
  cpuMs: number,
  taskContext: InvokeContext | undefined,
): Promise<IsolatedVM.Module> {
  const capabilityModule = await isolate.compileModule(capabilitySource, { filename: 'open-flow:engine/capability.mjs' })
  await capabilityModule.instantiate(context, () => {
    throw new IsolatedVmError('invalid-program', 'Engine Capability module cannot import dependencies.')
  })
  await capabilityModule.evaluate({ timeout: cpuMs })

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
const cancellation = new AbortController()
export function cancelTask() {
  cancellation.abort(new Error('Task invocation was canceled.'))
}
export async function invoke(source) {
  try {
    const inputs = JSON.parse(source)
    const context = Object.freeze(Object.assign({}, capability, {
      blockId: ${JSON.stringify(taskContext?.blockId)},
      flowId: ${JSON.stringify(taskContext?.flowId)},
      runId: ${JSON.stringify(taskContext?.runId)},
      inputs,
      signal: cancellation.signal,
    }))
    const result = await task(inputs, context)
    return result === undefined
      ? JSON.stringify({ engineDigest: ${JSON.stringify(program.engineDigest)}, ok: true, void: true })
      : JSON.stringify({ engineDigest: ${JSON.stringify(program.engineDigest)}, ok: true, value: result })
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
  await mainModule.evaluate({ timeout: cpuMs })
  return mainModule
}

async function invokeProgram(mainModule: IsolatedVM.Module, input: JsonValue, cpuMs: number): Promise<unknown> {
  const invoke = await mainModule.namespace.get('invoke', { reference: true })
  return await (invoke as IsolatedVM.Reference<(source: string) => Promise<string>>).apply(undefined, [JSON.stringify(input)], {
    arguments: { copy: true },
    result: { copy: true, promise: true },
    timeout: cpuMs,
  })
}

function readResult(
  source: unknown,
  program: RuntimeProgram,
  maxBytes: number,
  preserveCapabilityFailure: boolean,
  capabilityFailure: unknown,
): JsonValue | undefined {
  if (typeof source != 'string' || encoder.encode(source).byteLength > maxBytes) {
    throw new IsolatedVmError('limit-exceeded', 'Runtime result exceeds the configured byte limit.')
  }
  const result = JSON.parse(source) as {
    readonly engineDigest?: string
    readonly error?: string
    readonly ok?: boolean
    readonly value?: JsonValue
    readonly void?: boolean
  }
  const returnedValue = Object.hasOwn(result, 'value') && result.void === undefined
  const returnedVoid = !Object.hasOwn(result, 'value') && result.void === true
  if (!result.ok || result.engineDigest != program.engineDigest || (!returnedValue && !returnedVoid)) {
    if (preserveCapabilityFailure && capabilityFailure != null) throw capabilityFailure
    throw new IsolatedVmError('task-failed', result.error ?? 'User Task failed.')
  }
  return returnedVoid ? undefined : (result.value as JsonValue)
}

async function execute(
  request: InvokeRequest,
  canceled: AbortSignal,
  call: (invocationId: string, capabilities: readonly ConnectorCapability[], kind: string, payload: JsonValue) => Promise<RuntimeCapabilityResponse>,
  capabilities: readonly ConnectorCapability[] = [],
  preserveCapabilityFailure = false,
  log?: (level: 'debug' | 'error' | 'info' | 'warn', message: string) => Promise<void>,
): Promise<JsonValue | undefined> {
  if (!('program' in request)) throw new IsolatedVmError('invalid-program', 'Runtime module invocation is incomplete.')
  const { program } = request
  const invalid = programError(program)
  if (invalid != null) throw invalid
  if (serializedBytes(program) > request.limits.maxProgramBytes) {
    throw new IsolatedVmError('limit-exceeded', 'Runtime program exceeds the configured byte limit.')
  }
  const contract = findEngineContract(program.engineContract)
  if (contract == null) throw new IsolatedVmError('invalid-program', `Unsupported Engine Contract "${program.engineContract}".`)
  const ivm = (await import('isolated-vm')).default
  let isolate: IsolatedVM.Isolate | undefined
  let globals: ReturnType<typeof installGlobals> | undefined
  let abort: (() => void) | undefined
  try {
    isolate = new ivm.Isolate({
      memoryLimit: request.limits.memoryMb,
      onCatastrophicError() {
        process.abort()
      },
    })
    const context = await isolate.createContext()
    globals = installGlobals(ivm, context, request, call, capabilities, log)
    abort = (): void => {
      if (!globals?.close()) return
      if (isolate != null && !isolate.isDisposed) isolate.dispose()
    }
    canceled.addEventListener('abort', abort, { once: true })
    const mainModule = await compileProgram(isolate, context, program, contract, request.limits.cpuMs, request.context)
    const cancelTask = (await mainModule.namespace.get('cancelTask', { reference: true })) as IsolatedVM.Reference<() => void>
    canceled.removeEventListener('abort', abort)
    abort = (): void => {
      if (!globals?.close()) return
      try {
        cancelTask.applySync(undefined, [], { arguments: { copy: true } })
      } finally {
        cancelTask.release()
        if (isolate != null && !isolate.isDisposed) isolate.dispose()
      }
    }
    canceled.addEventListener('abort', abort, { once: true })
    if (canceled.aborted) abort()
    const source = await invokeProgram(mainModule, request.input, request.limits.cpuMs)
    await globals.flush()
    const result = readResult(source, program, request.limits.maxResultBytes, preserveCapabilityFailure, globals.failure())
    globals.close()
    return result
  } catch (error) {
    if (error instanceof IsolatedVmError) throw error
    if (preserveCapabilityFailure && error === globals?.failure()) throw error
    const message = normalizedError(error).message
    const code = /memory|heap|timed out|timeout/i.test(message) ? 'limit-exceeded' : 'invalid-program'
    throw new IsolatedVmError(code, message)
  } finally {
    if (abort != null) canceled.removeEventListener('abort', abort)
    globals?.close()
    if (isolate != null) {
      if (!isolate.isDisposed) isolate.dispose()
      completedIsolates += 1
    }
  }
}

function executeEffect(
  request: InvokeRequest,
  call: (
    invocationId: string,
    capabilities: readonly ConnectorCapability[],
    kind: string,
    payload: JsonValue,
  ) => Effect.Effect<RuntimeCapabilityResponse, Error>,
  capabilities: readonly ConnectorCapability[] = [],
  preserveCapabilityFailure = false,
  log?: (level: 'debug' | 'error' | 'info' | 'warn', message: string) => Effect.Effect<void, Error>,
): Effect.Effect<JsonValue | undefined, Error, Scope.Scope> {
  return Effect.gen(function* () {
    const run = yield* FiberSet.makeRuntimePromise<never, RuntimeCapabilityResponse, Error>()
    const emit = yield* FiberSet.makeRuntimePromise<never, void, Error>()
    return yield* Effect.tryPromise({
      try: (signal) =>
        execute(
          request,
          signal,
          (invocationId, allowed, kind, payload) => run(call(invocationId, allowed, kind, payload)),
          capabilities,
          preserveCapabilityFailure,
          log == null ? undefined : (level, message) => emit(log(level, message)),
        ),
      catch: normalizedError,
    })
  })
}

function executeFlow(
  request: InvokeRequest,
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
      | { readonly invocation: TaskInvocation; readonly type: 'task' },
  ) => Effect.Effect<CapabilityResult, Error>,
): Effect.Effect<FlowRunOutcome, Error> {
  if (!('flow' in request)) return Effect.fail(new IsolatedVmError('invalid-program', 'Flow Runtime invocation is incomplete.'))
  const { flow } = request
  return runFlow(flow.prepared, {
    ...(flow.bindingValues == null ? {} : { bindingValues: flow.bindingValues }),
    createId: randomUUID,
    emit: (event) => remote(call({ event, type: 'event' })).pipe(Effect.asVoid),
    flowId: flow.flowId,
    ...(flow.inputs == null ? {} : { inputs: flow.inputs }),
    invokeTask: (invocation, outputs) =>
      Effect.gen(function* () {
        if ('moduleId' in invocation) {
          const program = createRuntimeProgram(flow.prepared, invocation.moduleId, isolatedVmEngineDigest)
          if (program == null) return yield* Effect.fail(new IsolatedVmError('invalid-program', 'Task Module is not part of the fixed Flow closure.'))
          const input = Object.assign({}, invocation.additionalInputs, invocation.input)
          return yield* Effect.scoped(
            executeEffect(
              {
                context: { blockId: invocation.blockId, flowId: invocation.flowId, runId: invocation.runId },
                executionId: request.executionId,
                input,
                invocationId: invocation.invocationId,
                limits: request.limits,
                program,
                type: 'invoke',
              },
              (invocationId, capabilities, kind, payload) => {
                if (kind == 'outputs') {
                  if (serializedBytes(payload) > request.limits.maxResultBytes) {
                    return Effect.fail(new IsolatedVmError('limit-exceeded', 'Runtime result exceeds the configured byte limit.'))
                  }
                  return outputs(payload).pipe(Effect.as({ body: null, status: 200 }))
                }
                return remote(call({ capabilities, invocationId, kind, payload, type: 'capability' })).pipe(
                  Effect.map((response) => response as RuntimeCapabilityResponse),
                )
              },
              invocation.capabilities,
              true,
              (level, message) =>
                remote(
                  call({
                    event: {
                      jobId: invocation.jobId,
                      level,
                      message,
                      nodeId: invocation.nodeId,
                      runId: invocation.runId,
                      type: 'node.log',
                    },
                    type: 'event',
                  }),
                ).pipe(Effect.asVoid),
            ).pipe(
              Effect.timeoutOrElse({
                duration: request.limits.wallMs,
                orElse: () => Effect.fail(new IsolatedVmError('limit-exceeded', 'Runtime invocation exceeded its wall-clock limit.')),
              }),
            ),
          )
        }
        return yield* remote(call({ invocation, type: 'task' }))
      }),
    projectFailure: (error) => ({
      code: typeof Reflect.get(Object(error), 'schedulerCode') == 'string' ? (Reflect.get(Object(error), 'schedulerCode') as string) : 'node.failed',
      message: normalizedError(error).message,
    }),
    ...(flow.resume == null ? {} : { resume: flow.resume }),
    runId: flow.runId,
    ...(flow.trigger == null ? {} : { trigger: flow.trigger }),
  })
}

function executeWithCapabilities(request: InvokeRequest, pending: Map<number, PendingCapability>, retire: () => boolean): Effect.Effect<void> {
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
      | { readonly invocation: TaskInvocation; readonly type: 'task' },
  ): Effect.Effect<CapabilityResult, Error> =>
    Effect.gen(function* () {
      const id = ++nextId
      const deferred = yield* Deferred.make<CapabilityResult, Error>()
      yield* Effect.sync(() => {
        pending.set(id, { deferred })
        writeMessage({ executionId: request.executionId, id, ...message } as ExecutorMessage)
      })
      return yield* Deferred.await(deferred).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            if (pending.delete(id)) writeMessage({ executionId: request.executionId, id, type: 'call.cancel' })
          }),
        ),
        Effect.ensuring(Effect.sync(() => pending.delete(id))),
      )
    })

  return Effect.scoped(
    Effect.gen(function* () {
      let value: FlowRunOutcome | JsonValue | undefined
      if ('flow' in request) value = yield* executeFlow(request, call)
      else {
        value = yield* executeEffect(request, (invocationId, capabilities, kind, payload) =>
          Effect.gen(function* () {
            const response = yield* call({ capabilities, invocationId, kind, payload, type: 'capability' })
            if (!response.ok) return yield* Effect.fail(new Error(response.error ?? 'Capability call failed.'))
            return response.value as RuntimeCapabilityResponse
          }),
        )
      }
      yield* Effect.sync(() => {
        const retiring = retire()
        writeMessage(
          { executionId: request.executionId, ok: true, ...(retiring ? { retire: true } : {}), type: 'result', value },
          retiring ? () => process.disconnect?.() : undefined,
        )
      })
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const failure =
            error instanceof IsolatedVmError
              ? error
              : new IsolatedVmError('flow' in request ? 'task-failed' : 'executor-crashed', normalizedError(error).message)
          const retiring = retire()
          writeMessage(
            {
              code: failure.code,
              executionId: request.executionId,
              message: failure.message,
              ok: false,
              ...(retiring ? { retire: true } : {}),
              type: 'result',
            },
            retiring ? () => process.disconnect?.() : undefined,
          )
        }),
      ),
      Effect.ensuring(Effect.sync(() => pending.clear())),
    ),
  )
}

function runExecutor(): Effect.Effect<void> {
  return Effect.scoped(
    Effect.gen(function* () {
      const fibers = yield* FiberSet.make<void, never>()
      const run = yield* FiberSet.runtime(fibers)()
      const executions = new Map<number, { readonly fiber: Fiber.Fiber<void, never>; readonly pending: Map<number, PendingCapability> }>()

      yield* Effect.callback<void>((resume) => {
        const close = (): void => resume(Effect.void)
        const receive = (source: unknown): void => {
          const message = source as ParentMessage
          const execution = executions.get(message.executionId)
          if (message.type == 'cancel') {
            if (execution != null) run(Fiber.interrupt(execution.fiber))
            return
          }
          if (message.type == 'capability.result') {
            const capability = execution?.pending.get(message.id)
            if (capability != null) run(Deferred.succeed(capability.deferred, message).pipe(Effect.asVoid))
            return
          }
          if (execution != null) {
            run(
              Effect.sync(() =>
                writeMessage({
                  code: 'executor-crashed',
                  executionId: message.executionId,
                  message: 'Executor received a duplicate execution ID.',
                  ok: false,
                  type: 'result',
                }),
              ),
            )
            return
          }
          const pending = new Map<number, PendingCapability>()
          const fiber = run(
            executeWithCapabilities(message, pending, () => {
              if (completedIsolates < executorIsolateBudget || executions.size != 1) return false
              return true
            }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  executions.delete(message.executionId)
                }),
              ),
            ),
          )
          executions.set(message.executionId, { fiber, pending })
        }
        process.once('disconnect', close)
        process.on('message', receive)
        return Effect.sync(() => {
          process.off('disconnect', close)
          process.off('message', receive)
        })
      })
    }),
  )
}

if (process.argv[1] != null && fileURLToPath(import.meta.url) == process.argv[1] && process.argv[2] == '--executor') {
  void Effect.runPromise(runExecutor())
}
/* v8 ignore stop */
