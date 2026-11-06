import type { ExecutorMessage } from '../node/runtime/isolated-vm.ts'

import * as Effect from 'effect/Effect'
import { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { Session } from 'node:inspector/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { mock } from 'node:test'
import { RunControl } from '../node/application/run-control.ts'
import { ServerService } from '../node/application/service.ts'
import { IsolatedVmHost } from '../node/runtime/isolated-vm.ts'
import { Database } from '../node/storage/database.ts'
import { FlowStore } from '../node/storage/flow-store.ts'
import { RunStore } from '../node/storage/run-store.ts'
import { RunViewStore } from '../node/storage/run-view-store.ts'

const samples = Number(process.argv[2] ?? 15)
if (!Number.isSafeInteger(samples) || samples < 1) throw new Error('Sample count must be a positive safe integer.')
const actor = 'operator'
const port = { schema: { type: 'number' }, nullable: false }

async function benchmark(service: ServerService, profiler: Session) {
  async function create(name: string, edits: Parameters<ServerService['control']['drafts']['editAuthoring']>[2]['edits'], output: string) {
    const { flow } = await service.control.flows.createFlow(actor, name, name)
    const edited = await service.control.drafts.editAuthoring(actor, flow.flowId, {
      baseRevision: flow.draftRevisionId,
      requestId: name,
      edits: [
        { op: 'node.add', as: 'start', type: 'start', name: 'Start' },
        ...edits,
        {
          op: 'node.add',
          as: 'outputs',
          type: 'outputs',
          name: 'Outputs',
          config: { outputDefs: { answer: port } },
          inputs: { answer: { kind: 'output', node: output, port: 'answer' } },
        },
        { op: 'edge.connect', source: output, target: '$outputs' },
      ],
    })
    const revision = service.control.drafts.getRevision(actor, flow.flowId, edited.revision)
    const published = await service.publisher.publish({
      control: { actorId: actor, operation: 'publish' },
      flowId: flow.flowId,
      revision: revision.content,
      revisionId: revision.revisionId,
      expectedLivePublicationId: null,
      idempotencyKey: name,
    })
    if (published.kind != 'published') throw new Error(`Could not publish ${name}`)
    const contract = service.control.flows.getWorkflowContract(actor, flow.flowId)
    return { name, flowId: flow.flowId, publicationId: contract.publicationId, start: edited.nodes.start! }
  }

  const leaf = await create(
    'direct',
    [
      { op: 'node.add', as: 'code', type: 'code', name: 'Value', code: 'export default () => ({answer: 42})', config: { outputs: { answer: port } } },
      { op: 'edge.connect', source: '$start', target: '$code' },
    ],
    '$code',
  )
  const noisy = await create(
    'logging-child',
    [
      {
        op: 'node.add',
        as: 'code',
        type: 'code',
        name: 'Logs',
        code: 'export default () => { for (let i = 0; i < 100; i++) console.log(i); return {answer: 42} }',
        config: { outputs: { answer: port } },
      },
      { op: 'edge.connect', source: '$start', target: '$code' },
    ],
    '$code',
  )
  const large = await create(
    'large-direct-64',
    Array.from({ length: 64 }, (_, index) => [
      {
        op: 'node.add' as const,
        as: `code${index}`,
        type: 'code' as const,
        name: `Code ${index}`,
        code: 'export default () => ({answer: 42})',
        config: { outputs: { answer: port } },
      },
      { op: 'edge.connect' as const, source: index == 0 ? '$start' : `$code${index - 1}`, target: `$code${index}` },
    ]).flat(),
    '$code63',
  )
  const scenarios = []
  for (const root of [leaf, large]) {
    scenarios.push(root)
    let nested = root
    for (let depth = 1; depth <= 8; depth++) {
      nested = await create(
        `${root == leaf ? 'nested' : 'large-nested'}-${depth}`,
        [
          { op: 'node.add', as: 'call', type: 'workflow', name: 'Call', config: { flowId: nested.flowId } },
          { op: 'edge.connect', source: '$start', target: '$call' },
        ],
        '$call',
      )
      if (depth == 8 || (root == leaf && [1, 4].includes(depth))) scenarios.push(nested)
    }
  }
  scenarios.push(
    await create(
      'parallel-nodes-8',
      Array.from({ length: 8 }, (_, index) => [
        { op: 'node.add' as const, as: `call${index}`, type: 'workflow' as const, name: `Call ${index}`, config: { flowId: leaf.flowId } },
        { op: 'edge.connect' as const, source: '$start', target: `$call${index}` },
      ]).flat(),
      '$call7',
    ),
  )
  for (const [name, target, code] of [
    ['tool-single', leaf, "export default async (_, ctx) => ctx.workflows.call('child', {})"],
    [
      'tool-serial-8',
      leaf,
      "export default async (_, ctx) => { let result; for (let i = 0; i < 8; i++) result = await ctx.workflows.call('child', {}); return result }",
    ],
    [
      'tool-parallel-8',
      leaf,
      "export default async (_, ctx) => { const results = await Promise.all(Array.from({length: 8}, () => ctx.workflows.call('child', {}))); return results[7] }",
    ],
    ['tool-logging-100', noisy, "export default async (_, ctx) => ctx.workflows.call('child', {})"],
  ] as const) {
    scenarios.push(
      await create(
        name,
        [
          {
            op: 'node.add',
            as: 'code',
            type: 'code',
            name: 'Tools',
            code,
            config: { outputs: { answer: port }, capabilities: [{ kind: 'workflow', name: 'child', flowId: target.flowId }] },
          },
          { op: 'edge.connect', source: '$start', target: '$code' },
        ],
        '$code',
      ),
    )
  }
  scenarios.push(noisy)
  for (const [name, count, size] of [
    ['logging-1000', 1000, 0],
    ['logging-long-16', 16, 16_384],
  ] as const) {
    scenarios.push(
      await create(
        name,
        [
          {
            op: 'node.add',
            as: 'code',
            type: 'code',
            name: 'Logs',
            code: `export default () => { const text = 'x'.repeat(${size}); for (let i = 0; i < ${count}; i++) console.log(i, text); return {answer: 42} }`,
            config: { outputs: { answer: port } },
          },
          { op: 'edge.connect', source: '$start', target: '$code' },
        ],
        '$code',
      ),
    )
  }
  await service.waitForIdle()
  const counters = {
    sqlPreparations: mock.method(DatabaseSync.prototype, 'prepare'),
    transactions: mock.method(Database.prototype, 'transaction'),
    eventAppends: mock.method(RunStore.prototype, 'append'),
    revisionReads: mock.method(FlowStore.prototype, 'revision'),
    workflowRequests: mock.method(RunControl.prototype, 'invokeWorkflowTarget'),
    resultReads: mock.method(RunViewStore.prototype, 'run'),
    detailReads: mock.method(RunViewStore.prototype, 'controlRun'),
    originReads: mock.method(RunStore.prototype, 'workflowOrigin'),
    readinessReads: mock.method(RunStore.prototype, 'readyWorkflowRuns'),
    executorLaunches: mock.method(IsolatedVmHost.prototype, 'run'),
  }
  const messages = mock.method(ChildProcess.prototype, 'emit')
  const rows = []
  await profiler.post('Profiler.enable')
  await profiler.post('Profiler.setSamplingInterval', { interval: 100 })
  for (const scenario of scenarios) {
    let notifications = 0
    const unsubscribe = service.subscribeFlow(actor, scenario.flowId, () => notifications++)
    const durations: { admissionMs: number; completionMs: number; totalMs: number }[] = []
    for (let sample = 0; sample <= samples; sample++) {
      if (sample == 1) {
        for (const counter of Object.values(counters)) counter.mock.resetCalls()
        messages.mock.resetCalls()
        notifications = 0
        await profiler.post('Profiler.start')
      }
      const start = performance.now()
      const accepted = await service.control.runs.createLiveRun(actor, scenario.publicationId, {}, `${scenario.name}-${sample}`, {
        nodeId: scenario.start,
        outputs: {},
      })
      const admitted = performance.now()
      await service.waitForIdle()
      const finished = performance.now()
      const outcome = service.run(accepted.run.runId)
      if (outcome?.status != 'completed' || (outcome.result as { outputs?: { answer?: number } }).outputs?.answer != 42) {
        throw new Error(`Unexpected result for ${scenario.name}: ${JSON.stringify(outcome)}`)
      }
      if (sample > 0) durations.push({ admissionMs: admitted - start, completionMs: finished - admitted, totalMs: finished - start })
    }
    unsubscribe()
    const { profile } = await profiler.post('Profiler.stop')
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
    const parents = new Map(profile.nodes.flatMap((node) => (node.children ?? []).map((id) => [id, node.id] as const)))
    const sampled = { revisionRead: 0, revisionDecode: 0, workflowDiagnostics: 0, flowPreparation: 0 }
    for (const [index, id] of (profile.samples ?? []).entries()) {
      const phases = new Set<keyof typeof sampled>()
      let node = nodes.get(id)
      while (node != null) {
        const { url, functionName } = node.callFrame
        if (url.endsWith('/storage/flow-store.ts') && functionName == 'revision') phases.add('revisionRead')
        if (url.endsWith('/flow/common/encoding.ts') && functionName == 'decodeRevision') phases.add('revisionDecode')
        if (url.endsWith('/application/workflow.ts') && functionName == 'workflowDiagnostics') phases.add('workflowDiagnostics')
        if (url.endsWith('/flow/common/semantics.ts') && ['prepareFlow', 'validateFlow', 'flowClosure'].includes(functionName)) phases.add('flowPreparation')
        const parent = parents.get(node.id)
        node = parent == null ? undefined : nodes.get(parent)
      }
      for (const phase of phases) sampled[phase] += (profile.timeDeltas?.[index] ?? 0) / 1000
    }
    rows.push({
      scenario: scenario.name,
      sampledMsPerRun: Object.fromEntries(Object.entries(sampled).map(([phase, milliseconds]) => [phase, milliseconds / samples])),
      timing: Object.fromEntries(
        (['admissionMs', 'completionMs', 'totalMs'] as const).map((key) => {
          const values = durations.map((sample) => sample[key]).toSorted((a, b) => a - b)
          return [
            key,
            {
              median: (values[Math.floor((values.length - 1) / 2)]! + values[Math.floor(values.length / 2)]!) / 2,
              p95: values[Math.ceil(values.length * 0.95) - 1],
            },
          ]
        }),
      ),
      perRun: {
        ...Object.fromEntries(Object.entries(counters).map(([key, counter]) => [key, counter.mock.callCount() / samples])),
        eventsSubmitted: counters.eventAppends.mock.calls.reduce((count, call) => count + call.arguments.length - 1, 0) / samples,
        logRequests:
          messages.mock.calls.filter(({ arguments: [event, value] }) => {
            if (event != 'message') return false
            const message = value as ExecutorMessage
            return message.type == 'logs'
          }).length / samples,
        rootNotifications: notifications / samples,
      },
    })
  }
  mock.restoreAll()
  process.stdout.write(
    `${JSON.stringify({ samples, maxConcurrentRuns: 1, node: process.version, platform: `${process.platform}/${process.arch}`, notes: 'Instrumented application-service calls on temporary SQLite; excludes HTTP, fixture setup and one warm-up per scenario. resultReads includes one verification read per root Run. sqlPreparations counts prepare calls, not statement executions; workflowRequests counts workflow host requests, not total IPC. sampledMsPerRun estimates inclusive main-process stack time at a requested 100 us sampling interval: phases overlap and exclude isolated-process work; flowPreparation covers prepareFlow, validateFlow and flowClosure stacks, not async wall time. Timings include observer and profiler overhead.', scenarios: rows }, null, 2)}\n`,
  )
}

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(path.join(tmpdir(), 'open-flow-benchmark-'))),
        (temporaryDirectory) => Effect.promise(() => rm(temporaryDirectory, { recursive: true, force: true })),
      )
      const database = yield* Effect.acquireRelease(
        Effect.sync(() => Database.open(path.join(directory, 'flow.sqlite'))),
        (connection) => Effect.sync(() => connection.close()),
      )
      const service = yield* ServerService.open(database, { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
      yield* service.start()
      const profiler = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const session = new Session()
          session.connect()
          return session
        }),
        (session) => Effect.sync(() => session.disconnect()),
      )
      yield* Effect.promise(() => benchmark(service, profiler))
    }),
  ),
)
