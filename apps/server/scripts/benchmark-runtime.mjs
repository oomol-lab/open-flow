import * as Effect from 'effect/Effect'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const target = process.argv[2] == null ? new URL('../dist/server/isolated-vm.js', import.meta.url) : pathToFileURL(path.resolve(process.argv[2]))
const soakBatches = Number(process.argv[3] ?? 5)
if (!Number.isSafeInteger(soakBatches) || soakBatches <= 0) throw new TypeError('Soak batch count must be a positive safe integer.')
const runtime = await import(target.href)
const { IsolatedVmHost, isolatedVmEngineDigest } = runtime
let invocationId = 0

function program(source) {
  return {
    engineContract: 'open-flow-engine/v1',
    engineDigest: isolatedVmEngineDigest,
    entryModuleId: 'main',
    modules: { main: { imports: [], source } },
  }
}

function invoke(host, source = 'export default (input) => input') {
  return host.invoke({
    capability: async () => ({ body: null, status: 200 }),
    input: { value: 1 },
    invocationId: `benchmark-${++invocationId}`,
    program: program(source),
  })
}

async function measure(operation) {
  const startedAt = performance.now()
  await operation()
  return Number((performance.now() - startedAt).toFixed(3))
}

async function executorPid() {
  const { stdout } = await execFileAsync('ps', ['-A', '-o', 'pid=,ppid=,command='])
  const processLine = stdout
    .split('\n')
    .map((line) => /^(\s*\d+)\s+(\d+)\s+(.+)$/.exec(line))
    .find((match) => match?.[2] == String(process.pid) && match[3].includes('--executor'))
  if (processLine == null) throw new Error('Runtime Executor process was not found.')
  return Number(processLine[1])
}

async function rssMb(pid) {
  globalThis.gc?.()
  await new Promise((resolve) => setTimeout(resolve, 50))
  const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)])
  return Number((Number(stdout.trim()) / 1024).toFixed(2))
}

async function sequence(count, operation) {
  for (let index = 0; index < count; index += 1) await operation()
}

async function soak(operation) {
  const parentRssBeforeMb = Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2))
  const pidByBatch = [await executorPid()]
  const rssMbByBatch = [await rssMb(pidByBatch[0])]
  const parentHeapMbByBatch = [Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2))]
  const batch1000Ms = []
  for (let batch = 0; batch < soakBatches; batch += 1) {
    batch1000Ms.push(await measure(() => sequence(1_000, operation)))
    pidByBatch.push(await executorPid())
    rssMbByBatch.push(await rssMb(pidByBatch[pidByBatch.length - 1]))
    parentHeapMbByBatch.push(Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)))
  }
  const parentRssAfterMb = Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2))
  return {
    batch1000Ms,
    executorRetirements: new Set(pidByBatch).size - 1,
    parentHeapMbByBatch,
    parentRssAfterMb,
    parentRssBeforeMb,
    pidByBatch,
    rssMbByBatch,
  }
}

const host = new IsolatedVmHost()
const coldMs = await measure(() => invoke(host))
const warm100Ms = await measure(() => sequence(100, () => invoke(host)))
const concurrent4Ms = await measure(() => Promise.all(Array.from({ length: 4 }, () => invoke(host))))
const concurrent50Ms = await measure(() => Promise.all(Array.from({ length: 50 }, () => invoke(host))))
const invokeSoak = await soak(() => invoke(host))
const cancellation = new AbortController()
const pending = host.invoke({
  capability: async () => ({ body: null, status: 200 }),
  input: null,
  invocationId: `benchmark-${++invocationId}`,
  program: program('export default async () => await new Promise(() => {})'),
  signal: cancellation.signal,
})
await new Promise((resolve) => setTimeout(resolve, 25))
const cancelMs = await measure(async () => {
  cancellation.abort(new Error('Benchmark cancellation.'))
  try {
    await pending
    throw new Error('Canceled invocation completed unexpectedly.')
  } catch (error) {
    if (!(error instanceof Error) || error.message != 'Benchmark cancellation.') throw error
  }
})
await host.close()

const result = {
  invoke: {
    cancelMs,
    coldMs,
    concurrent4Ms,
    concurrent50Ms,
    soak: invokeSoak,
    warm100AverageMs: Number((warm100Ms / 100).toFixed(3)),
    warm100Ms,
  },
  target: target.pathname,
}

if (typeof IsolatedVmHost.prototype.run == 'function') {
  const flowHost = new IsolatedVmHost()
  const output = { handle: 'value', jsonSchema: {}, nullable: false }
  const prepared = {
    closureDigest: 'runtime-benchmark',
    engineContract: 'open-flow-engine/v1',
    graph: {
      nodes: {
        task: {
          concurrency: 1,
          inputs: {},
          kind: 'task',
          task: { inputs: [], moduleId: 'main', name: 'Main', outputs: [output] },
        },
      },
    },
    modules: { main: { imports: [], name: 'Main', source: 'export default () => ({ value: 1 })' } },
    subflows: {},
    tasks: {},
  }
  let runId = 0
  const run = () =>
    Effect.runPromise(
      flowHost.run(prepared, {
        capability: async () => ({ body: null, status: 200 }),
        emit: async () => undefined,
        flowId: 'main',
        invokeTask: async () => {
          throw new Error('Unexpected external Task invocation.')
        },
        projectFailure: (error) => ({ code: 'node.failed', message: error instanceof Error ? error.message : String(error) }),
        runId: `benchmark-run-${++runId}`,
      }),
    )
  const flowColdMs = await measure(run)
  const flowWarm100Ms = await measure(() => sequence(100, run))
  const flowConcurrent25Ms = await measure(() => Promise.all(Array.from({ length: 25 }, run)))
  const flowSoak = await soak(run)
  result.flow = {
    coldMs: flowColdMs,
    concurrent25Ms: flowConcurrent25Ms,
    soak: flowSoak,
    warm100AverageMs: Number((flowWarm100Ms / 100).toFixed(3)),
    warm100Ms: flowWarm100Ms,
  }
  await flowHost.close()
}

process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
