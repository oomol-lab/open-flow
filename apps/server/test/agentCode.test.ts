import { afterAll, describe, expect, it } from 'vitest'
import { executeCode } from '../node/deployment/agent-code.ts'
import { IsolatedVmHost } from '../node/runtime/isolated-vm.ts'

const host = new IsolatedVmHost()
afterAll(() => host.close())
const run = (code: string, signal = new AbortController().signal) => executeCode(host, code, { count: 3 }, 'code-test', signal)

describe('Agent code isolation', () => {
  it('computes JSON and creates a fresh realm for every call', async () => {
    await expect(run('export default inputs => { globalThis.saved = 1; return { count: inputs.count * 2 } }')).resolves.toEqual({ count: 6 })
    await expect(run('export default () => ({ saved: typeof saved, process: typeof process, require: typeof require })')).resolves.toEqual({
      saved: 'undefined',
      process: 'undefined',
      require: 'undefined',
    })
  })

  it.each([
    'export default () => ({ value: NaN })',
    'export default () => ({ value: undefined })',
    'export default () => 1n',
    'export default () => { const x = {}; x.x = x; return x }',
    'export default () => new Date()',
  ])('rejects non-JSON output: %s', async (code) => {
    await expect(run(code)).rejects.toMatchObject({ code: 'task-failed' })
  })

  it('rejects imports outside the declared closure', async () => {
    await expect(run("import fs from 'node:fs'; export default () => fs.readFileSync('/etc/passwd', 'utf8')")).rejects.toMatchObject({
      code: 'invalid-program',
    })
    await expect(run("export default async () => await import('node:fs')")).rejects.toBeDefined()
  })

  it('does not expose network or a Task context to generated code', async () => {
    await expect(run('export default function () { return { fetch: typeof fetch, context: typeof arguments[1] } }')).resolves.toEqual({
      fetch: 'undefined',
      context: 'undefined',
    })
    await expect(run("export default async () => await fetch('https://example.com')")).rejects.toMatchObject({ code: 'task-failed' })
  })

  it('terminates synchronous and asynchronous CPU loops', async () => {
    await expect(run('export default () => { while (true) {} }')).rejects.toMatchObject({ code: 'limit-exceeded' })
    await expect(run('export default async () => { await Promise.resolve(); while (true) {} }')).rejects.toMatchObject({ code: 'limit-exceeded' })
  })

  it('terminates a never-ending asynchronous call', async () => {
    await expect(run('export default () => new Promise(() => {})')).rejects.toMatchObject({ code: 'limit-exceeded' })
  }, 10000)

  it('propagates cancellation and keeps the executor usable', async () => {
    const controller = new AbortController()
    const promise = run('export default () => new Promise(() => {})', controller.signal)
    setTimeout(() => controller.abort(new Error('Canceled computation')), 50)
    await expect(promise).rejects.toThrow('Canceled computation')
    await expect(run('export default () => 42')).resolves.toBe(42)
  })

  it('bounds aggregate input and code size before execution', async () => {
    await expect(
      executeCode(
        host,
        'export default () => 1',
        { first: 'x'.repeat(17 * 1024 * 1024), second: 'y'.repeat(17 * 1024 * 1024) },
        'large',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'limit-exceeded' })
    await expect(run(' '.repeat(65537))).rejects.toMatchObject({ code: 'invalid-program' })
  })
})

it('enforces memory and output limits without breaking later computations', async () => {
  await expect(run('export default () => new Uint8Array(300 * 1024 * 1024)')).rejects.toMatchObject({ code: 'limit-exceeded' })
  await expect(run("export default () => 'x'.repeat(33 * 1024 * 1024)")).rejects.toMatchObject({ code: 'limit-exceeded' })
  await expect(run('export default () => 7')).resolves.toBe(7)
})
