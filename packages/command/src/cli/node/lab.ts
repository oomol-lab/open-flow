/** Development host for the production CLI. No Lab business rules live here. */
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runCli } from './cli.ts'

export interface RequestCost {
  method: string
  path: string
  status?: number
  inputBytes: number
  outputBytes: number
  retryIdentity?: string
}
export interface CommandRecord {
  id: string
  args: string[]
  category: 'read' | 'edit' | 'execute' | 'check'
  startedAt: string
  durationMs: number
  exitCode: number
  argumentBytes: number
  inputs: { source: string; bytes: number }[]
  stdoutBytes: number
  stderrBytes: number
  requests: RequestCost[]
}
export interface LabCliOptions {
  id: string
  origin: string
  token: string
  stdin?: () => Promise<string>
  output: (stream: 'stdout' | 'stderr', chunk: string) => void
}
export async function runLabCli(args: string[], options: LabCliOptions): Promise<CommandRecord> {
  const record: CommandRecord = {
    id: options.id,
    args,
    category:
      args[0] == 'check'
        ? 'check'
        : args[0] == 'run' || (args[0] == 'runs' && ['cancel', 'resolve'].includes(args[1] ?? ''))
          ? 'execute'
          : ['list', 'show', 'inspect', 'schema', 'runs'].includes(args[0] ?? '') ||
              args.includes('--help') ||
              ['show', 'search', 'providers', 'connections', 'teams', 'list'].includes(args[1] ?? '')
            ? 'read'
            : 'edit',
    startedAt: new Date().toISOString(),
    durationMs: 0,
    exitCode: 1,
    argumentBytes: Buffer.byteLength(args.join(' ')),
    inputs: [],
    stdoutBytes: 0,
    stderrBytes: 0,
    requests: [],
  }
  const started = performance.now()
  const seen = new Set<string>()
  function input(source: string, value: string) {
    if (!seen.has(source)) record.inputs.push({ source, bytes: Buffer.byteLength(value) })
    seen.add(source)
    return value
  }
  function output(stream: 'stdout' | 'stderr', value: string) {
    record[stream == 'stdout' ? 'stdoutBytes' : 'stderrBytes'] += Buffer.byteLength(value)
    options.output(stream, value)
  }
  record.exitCode = await runCli(
    args,
    {
      request: async (path, init) => {
        const headers = new Headers(init?.headers)
        headers.set('authorization', `Bearer ${options.token}`)
        headers.set('x-lab-command', options.id)
        const body = typeof init?.body == 'string' ? init.body : ''
        const method = init?.method ?? 'GET'
        const key = headers.get('idempotency-key')
        const cost: RequestCost = {
          method,
          path,
          inputBytes: Buffer.byteLength(body),
          outputBytes: 0,
          ...(key == null
            ? {}
            : {
                retryIdentity: createHash('sha256')
                  .update(JSON.stringify([method, path, key, body]))
                  .digest('hex'),
              }),
        }
        record.requests.push(cost)
        const response = await fetch(new URL(path, options.origin), { ...init, headers })
        cost.status = response.status
        if (response.body == null) return response
        const bodyStream = response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              cost.outputBytes += chunk.byteLength
              controller.enqueue(chunk)
            },
          }),
        )
        return new Response(bodyStream, { status: response.status, statusText: response.statusText, headers: response.headers })
      },
    },
    {
      env: {},
      language: 'en',
      openUrl: async () => {
        throw new Error('Use lab open to open Workbench.')
      },
      readFile: async (path) => input(await realpath(resolve(path)), await readFile(path, 'utf8')),
      readStdin: async () => input('stdin', await (options.stdin?.() ?? readStdin())),
      stdout: { write: (value) => output('stdout', value) },
      stderr: { write: (value) => output('stderr', value) },
      wait: (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)),
    },
  )
  record.durationMs = performance.now() - started
  return record
}
async function readStdin() {
  let value = ''
  for await (const chunk of process.stdin) value += String(chunk)
  return value
}
