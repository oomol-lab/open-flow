import type { JsonValue } from '@oomol-lab/open-flow/project-change'
import type { RuntimeCapabilityResponse, RuntimeInvocation, RuntimeProgram } from '@oomol-lab/open-flow/runtime-contract'
import type IsolatedVM from 'isolated-vm'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Interface } from 'node:readline'

import { findEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
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

export const isolatedVmEngineDigest = `sha256:${createHash('sha256').update('open-flow-isolated-vm/1 isolated-vm/7.0.1 node/26').digest('hex')}`

export class IsolatedVmError extends Error {
  readonly code: 'canceled' | 'executor-crashed' | 'invalid-program' | 'limit-exceeded' | 'task-failed'

  constructor(code: IsolatedVmError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'IsolatedVmError'
  }
}

interface InvokeRequest {
  readonly executionId: number
  readonly input: JsonValue
  readonly invocationId: string
  readonly limits: IsolatedVmLimits
  readonly program: RuntimeProgram
  readonly type: 'invoke'
}

type ParentMessage = InvokeRequest | { readonly executionId: number; readonly type: 'cancel' } | CapabilityResult

interface CapabilityResult {
  readonly error?: string
  readonly executionId: number
  readonly id: number
  readonly ok: boolean
  readonly type: 'capability.result'
  readonly value?: RuntimeCapabilityResponse
}

type CapabilityOutcome = Omit<CapabilityResult, 'executionId'>

type ExecutorMessage =
  | { readonly executionId: number; readonly id: number; readonly kind: string; readonly payload: JsonValue; readonly type: 'capability' }
  | { readonly code: IsolatedVmError['code']; readonly executionId: number; readonly message: string; readonly ok: false; readonly type: 'result' }
  | { readonly executionId: number; readonly ok: true; readonly type: 'result'; readonly value: JsonValue }

interface PendingCapability {
  readonly reject: (error: Error) => void
  readonly resolve: (result: CapabilityResult) => void
}

interface PendingInvocation {
  capabilityCalls: number
  readonly capabilitySignals: Set<AbortController>
  readonly cancel: () => void
  readonly invocation: RuntimeInvocation
  readonly limits: IsolatedVmLimits
  readonly reject: (error: unknown) => void
  readonly resolve: (value: JsonValue) => void
  readonly wallTimer: ReturnType<typeof setTimeout>
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
        capabilityCalls: 0,
        capabilitySignals: new Set(),
        cancel,
        invocation,
        limits,
        reject,
        resolve,
        wallTimer,
      })
      invocation.signal?.addEventListener('abort', cancel, { once: true })
      this.#send(child, { executionId, input: invocation.input, invocationId: invocation.invocationId, limits, program: invocation.program, type: 'invoke' })
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
    pending.capabilityCalls += 1
    if (pending.capabilityCalls > pending.limits.maxCapabilityCalls) {
      this.#send(child, {
        error: 'Capability call limit exceeded.',
        executionId: message.executionId,
        id: message.id,
        ok: false,
        type: 'capability.result',
      })
      return
    }
    const controller = new AbortController()
    pending.capabilitySignals.add(controller)
    void pending.invocation
      .capability({
        invocationId: pending.invocation.invocationId,
        kind: message.kind,
        payload: message.payload,
        signal: controller.signal,
      })
      .then((value) => {
        if (!this.#pending.has(message.executionId)) return
        if (serializedBytes(value) > pending.limits.maxCapabilityResponseBytes) {
          this.#send(child, {
            error: 'Capability response exceeds the configured byte limit.',
            executionId: message.executionId,
            id: message.id,
            ok: false,
            type: 'capability.result',
          })
        } else this.#send(child, { executionId: message.executionId, id: message.id, ok: true, type: 'capability.result', value })
      })
      .catch((error) => {
        if (this.#pending.has(message.executionId)) {
          this.#send(child, {
            error: normalizedError(error).message,
            executionId: message.executionId,
            id: message.id,
            ok: false,
            type: 'capability.result',
          })
        }
      })
      .finally(() => pending.capabilitySignals.delete(controller))
  }

  #send(child: ChildProcessWithoutNullStreams, message: ParentMessage): void {
    if (this.#child == child && !child.stdin.destroyed) child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  #finish(executionId: number, operation: () => void): void {
    const pending = this.#pending.get(executionId)
    if (pending == null) return
    this.#pending.delete(executionId)
    clearTimeout(pending.wallTimer)
    pending.invocation.signal?.removeEventListener('abort', pending.cancel)
    const reason = new IsolatedVmError('canceled', 'Runtime invocation is no longer active.')
    for (const controller of pending.capabilitySignals) controller.abort(reason)
    pending.capabilitySignals.clear()
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

async function execute(request: InvokeRequest, canceled: AbortSignal, pending: Map<number, PendingCapability>): Promise<JsonValue> {
  const invalid = programError(request.program)
  if (invalid != null) throw invalid
  if (serializedBytes(request.program) > request.limits.maxProgramBytes) {
    throw new IsolatedVmError('limit-exceeded', 'Runtime program exceeds the configured byte limit.')
  }
  const ivm = (await import('isolated-vm')).default
  let isolate: IsolatedVM.Isolate | undefined
  try {
    isolate = new ivm.Isolate({
      memoryLimit: request.limits.memoryMb,
      onCatastrophicError() {
        process.abort()
      },
    })
    const context = await isolate.createContext()
    let capabilityId = 0
    let active = true
    const abort = (): void => {
      if (!active) return
      active = false
      const error = new IsolatedVmError('canceled', 'Runtime invocation was canceled.')
      for (const pendingCapability of pending.values()) pendingCapability.reject(error)
      pending.clear()
      if (isolate != null && !isolate.isDisposed) isolate.dispose()
    }
    canceled.addEventListener('abort', abort, { once: true })
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
          let call: { readonly kind: string; readonly payload: JsonValue }
          try {
            const parsed = JSON.parse(source) as { readonly kind?: unknown; readonly payload?: unknown }
            if (typeof parsed.kind != 'string' || !Object.hasOwn(parsed, 'payload')) throw new TypeError()
            call = parsed as { readonly kind: string; readonly payload: JsonValue }
          } catch {
            settleResult({ error: 'Capability request is invalid.', id: 0, ok: false, type: 'capability.result' })
            return
          }
          const id = ++capabilityId
          pending.set(id, {
            reject: (error) => settleResult({ error: error.message, id, ok: false, type: 'capability.result' }),
            resolve: settleResult,
          })
          writeMessage({ executionId: request.executionId, id, kind: call.kind, payload: call.payload, type: 'capability' })
        })
        .catch((error) => settleResult({ error: normalizedError(error).message, id: 0, ok: false, type: 'capability.result' }))
        .finally(() => sourceReference.release())
    })
    context.global.setSync('__openFlowCapability', capability)

    const contract = findEngineContract(request.program.engineContract)!
    const capabilityModule = await isolate.compileModule(
      `const call = globalThis.__openFlowCapability
delete globalThis.__openFlowCapability
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
    for (const [moduleId, module] of Object.entries(request.program.modules)) {
      const modulePath = `user/${moduleId}.mjs`
      const compiled = await isolate.compileModule(module.source, { filename: `open-flow:${modulePath}` })
      modules.set(modulePath, compiled)
      paths.set(compiled, modulePath)
    }
    const mainModule = await isolate.compileModule(
      `import task from '../user/${request.program.entryModuleId}.mjs'
import { capability } from './capability.mjs'
export async function invoke(source) {
  try {
    const value = await task(JSON.parse(source), capability)
    return JSON.stringify({ engineDigest: ${JSON.stringify(request.program.engineDigest)}, ok: true, value })
  } catch {
    return JSON.stringify({ error: 'User Task failed.', ok: false })
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
      if (referrerPath == 'engine/main.mjs' && specifier == `../user/${request.program.entryModuleId}.mjs`) {
        return modules.get(`user/${request.program.entryModuleId}.mjs`)!
      }
      const imported = /^\.\/([^/]+)\.mjs$/.exec(specifier)?.[1]
      const referrerId = /^user\/(.+)\.mjs$/.exec(referrerPath)?.[1]
      if (imported != null && referrerId != null && request.program.modules[referrerId]?.imports.includes(imported)) {
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
    if (!result.ok || result.engineDigest != request.program.engineDigest || !Object.hasOwn(result, 'value')) {
      throw new IsolatedVmError('task-failed', result.error ?? 'User Task failed.')
    }
    active = false
    for (const pendingCapability of pending.values()) pendingCapability.reject(new IsolatedVmError('canceled', 'Capability is no longer active.'))
    pending.clear()
    return result.value!
  } catch (error) {
    if (error instanceof IsolatedVmError) throw error
    const message = normalizedError(error).message
    const code = /memory|heap|timed out|timeout/i.test(message) ? 'limit-exceeded' : 'invalid-program'
    throw new IsolatedVmError(code, message)
  } finally {
    if (isolate != null && !isolate.isDisposed) isolate.dispose()
  }
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
  try {
    const value = await execute(request, signal, pending)
    writeMessage({ executionId: request.executionId, ok: true, type: 'result', value })
  } catch (error) {
    const failure = error instanceof IsolatedVmError ? error : new IsolatedVmError('executor-crashed', normalizedError(error).message)
    writeMessage({ code: failure.code, executionId: request.executionId, message: failure.message, ok: false, type: 'result' })
  }
}

if (process.argv[1] != null && fileURLToPath(import.meta.url) == process.argv[1] && process.argv[2] == '--executor') {
  void runExecutor()
}
