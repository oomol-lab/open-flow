import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { IsolatedVmHost } from '../runtime/isolated-vm.ts'

import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { IsolatedVmError, isolatedVmEngineDigest, isolatedVmLimits } from '../runtime/isolated-vm.ts'

const wrapper = `import compute from './code.mjs'
export default async function (inputs) {
  const value = await compute(inputs)
  const seen = new Set()
  function check(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return
    if (typeof item === 'number' && Number.isFinite(item)) return
    if (typeof item !== 'object') throw new Error('Code must return a JSON value.')
    if (seen.has(item)) throw new Error('Code returned a circular value.')
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
      throw new Error('Code must return plain JSON objects.')
    if (Object.getOwnPropertySymbols(item).length) throw new Error('Code returned symbol properties.')
    seen.add(item)
    for (const child of Array.isArray(item) ? item : Object.values(item)) check(child)
    seen.delete(item)
  }
  check(value)
  return value
}`

export async function executeCode(host: IsolatedVmHost, code: string, input: JsonValue, invocationId: string, signal: AbortSignal): Promise<JsonValue> {
  signal.throwIfAborted()
  if (Buffer.byteLength(code) > 64 * 1024) throw new IsolatedVmError('invalid-program', 'Code exceeds the 64 KiB source limit.')
  const value = await host
    .invoke(
      {
        input,
        invocationId,
        signal,
        capabilities: [],
        capability: async () => {
          throw new Error('Code computation cannot access host capabilities.')
        },
        program: {
          engineContract: currentEngineContract,
          engineDigest: isolatedVmEngineDigest,
          entryModuleId: 'main',
          modules: { main: { imports: ['code'], source: wrapper }, code: { imports: [], source: code } },
        },
      },
      {
        ...isolatedVmLimits,
        maxCapabilityCalls: 0,
        maxInputBytes: 32 * 1024 * 1024,
        maxResultBytes: 32 * 1024 * 1024,
        memoryMb: 256,
        wallMs: 5000,
      },
    )
    .catch((error: unknown) => {
      // V8 reports denied ArrayBuffer allocations as ordinary task errors.
      if (error instanceof IsolatedVmError && /^Array buffer allocation failed\.?$/i.test(error.message))
        throw new IsolatedVmError('limit-exceeded', error.message)
      throw error
    })
  signal.throwIfAborted()
  if (value === undefined) throw new IsolatedVmError('task-failed', 'Code must return a JSON value.')
  return value
}
