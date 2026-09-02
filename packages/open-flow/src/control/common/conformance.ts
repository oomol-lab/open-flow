import { dequal } from 'dequal/lite'

export interface ControlApiConformanceHarness {
  readonly origin: string
  dispose(): Promise<void>
  request(request: Request): Promise<Response>
}

export interface ControlApiConformanceCase {
  readonly name: string
  verify(harness: ControlApiConformanceHarness): Promise<void>
}

type RecordValue = Readonly<Record<string, unknown>>

const engineContract = 'open-flow-engine/v1'

function fail(message: string): never {
  throw new Error(message)
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (!dequal(actual, expected)) fail(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`)
}

function record(value: unknown, message: string): RecordValue {
  if (value == null || typeof value != 'object' || Array.isArray(value)) fail(`${message}: expected an object.`)
  return value as RecordValue
}

function list(value: unknown, message: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${message}: expected an array.`)
  return value
}

function requiredString(value: unknown, message: string): string {
  if (typeof value != 'string' || value.length == 0) fail(`${message}: expected a non-empty string.`)
  return value
}

async function json(response: Response, status: number, message: string): Promise<RecordValue> {
  equal(response.status, status, `${message} status`)
  return record(await response.json().catch(() => fail(`${message} body: expected JSON.`)), `${message} body`)
}

async function error(response: Response, status: number, code: string, message: string): Promise<void> {
  const body = await json(response, status, message)
  equal(record(body.error, `${message} error`).code, code, `${message} error code`)
  equal(body.version, 1, `${message} version`)
}

function request(harness: ControlApiConformanceHarness, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.body != null && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return harness.request(new Request(new URL(path, harness.origin), { ...init, headers }))
}

function createFlowRequest(harness: ControlApiConformanceHarness, name: string, key: string): Promise<Response> {
  return request(harness, '/v1/flows', {
    body: JSON.stringify({ name, version: 1 }),
    headers: { 'idempotency-key': key },
    method: 'POST',
  })
}

async function createFlow(harness: ControlApiConformanceHarness, name: string, key: string): Promise<RecordValue> {
  return json(await createFlowRequest(harness, name, key), 201, 'Create Flow')
}

function changeRequest(
  harness: ControlApiConformanceHarness,
  flowId: string,
  revisionId: string,
  operations: readonly unknown[],
  changeId = `change-${crypto.randomUUID()}`,
): Promise<Response> {
  return request(harness, `/v1/flows/${encodeURIComponent(flowId)}/draft/changes`, {
    body: JSON.stringify({ expectedRevisionId: revisionId, operations, version: 1 }),
    headers: { 'idempotency-key': changeId },
    method: 'POST',
  })
}

function addValueNode(harness: ControlApiConformanceHarness, flowId: string, revisionId: string, nodeId = 'marker', changeId?: string): Promise<Response> {
  return changeRequest(
    harness,
    flowId,
    revisionId,
    [
      {
        kind: 'graph.node.create',
        node: {
          concurrency: 1,
          inputs: {},
          kind: 'value',
          values: [{ handle: 'ready', jsonSchema: { type: 'boolean' }, nullable: false, value: true }],
        },
        nodeId,
        target: { kind: 'flow' },
      },
    ],
    changeId,
  )
}

function changedRevisionId(change: RecordValue, message: string): string {
  return requiredString(record(change.revision, `${message} revision`).revisionId, `${message} revisionId`)
}

function publishRequest(
  harness: ControlApiConformanceHarness,
  flowId: string,
  revisionId: string,
  expectedLivePublicationId: string | null,
  key: string,
): Promise<Response> {
  return request(harness, `/v1/flows/${encodeURIComponent(flowId)}/revisions/${encodeURIComponent(revisionId)}/publications`, {
    body: JSON.stringify({ engineContract, expectedLivePublicationId, version: 1 }),
    headers: { 'idempotency-key': key },
    method: 'POST',
  })
}

async function completePublish(
  harness: ControlApiConformanceHarness,
  response: Response,
  status: 202,
  message: string,
): Promise<{ readonly operation: RecordValue; readonly publication: RecordValue }> {
  let operation = await json(response, status, message)
  const operationId = requiredString(operation.operationId, `${message} operationId`)
  for (let attempt = 0; operation.status == 'pending' && attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    operation = await json(
      await request(harness, `/v1/flows/${requiredString(operation.flowId, `${message} flowId`)}/publish-operations/${operationId}`),
      200,
      `${message} operation`,
    )
  }
  equal(operation.status, 'succeeded', `${message} terminal status`)
  const publicationId = requiredString(operation.publicationId, `${message} publicationId`)
  const live = await json(await request(harness, `/v1/flows/${requiredString(operation.flowId, `${message} flowId`)}/live`), 200, `${message} Live`)
  const publication = record(live.publication, `${message} Publication`)
  equal(publication.publicationId, publicationId, `${message} Live Publication`)
  return { operation, publication }
}

function rollbackRequest(harness: ControlApiConformanceHarness, flowId: string, source: string, expected: string, key: string): Promise<Response> {
  return request(harness, `/v1/flows/${encodeURIComponent(flowId)}/publications/${encodeURIComponent(source)}/rollback`, {
    body: JSON.stringify({ expectedLivePublicationId: expected, version: 1 }),
    headers: { 'idempotency-key': key },
    method: 'POST',
  })
}

function liveRunRequest(harness: ControlApiConformanceHarness, publicationId: string, key: string): Promise<Response> {
  return request(harness, '/v1/runs', {
    body: JSON.stringify({ inputs: {}, publicationId, version: 1 }),
    headers: { 'idempotency-key': key },
    method: 'POST',
  })
}

export const controlApiConformanceCases: readonly ControlApiConformanceCase[] = [
  {
    name: 'manages deployment Variables with stable limits and exact-case identity',
    async verify(harness) {
      equal(await json(await request(harness, '/v1/variables'), 200, 'List empty Variables'), { variables: [], version: 1 }, 'Empty Variables')
      const put = (name: string, value: string, body: Readonly<Record<string, unknown>> = { value }) =>
        request(harness, `/v1/variables/${encodeURIComponent(name)}`, { body: JSON.stringify(body), method: 'PUT' })
      const created = await json(await put('Token', ''), 200, 'Create Variable')
      equal(Object.keys(created).toSorted(), ['name', 'updatedAt', 'value', 'version'], 'Variable fields')
      equal(created.name, 'Token', 'Variable name')
      equal(created.value, '', 'Empty Variable value')
      equal(created.version, 1, 'Variable version')
      requiredString(created.updatedAt, 'Variable updatedAt')
      equal(await json(await request(harness, '/v1/variables/Token'), 200, 'Read Variable'), created, 'Read Variable')
      equal(await json(await put('Token', ''), 200, 'Put same Variable'), created, 'Same Variable update')

      for (const name of ['A', 'Z', 'a', 'token']) await json(await put(name, name), 200, `Create ${name} Variable`)
      const listed = await json(await request(harness, '/v1/variables'), 200, 'List Variables')
      equal(
        list(listed.variables, 'Variables').map((value) => record(value, 'Variable').name),
        ['A', 'Token', 'Z', 'a', 'token'],
        'Variable binary order',
      )

      const large = `${'值'.repeat(21_845)}x`
      equal(new TextEncoder().encode(large).byteLength, 65_536, 'Variable UTF-8 boundary fixture')
      await json(await put('BIG', large), 200, 'Create maximum Variable value')
      await error(await put('BIG', `${large}x`), 400, 'variable.invalid', 'Reject oversized Variable value')
      await error(await put('OO_TOKEN', 'value'), 400, 'variable.invalid', 'Reject reserved Variable name')
      await error(await put('bad-name', 'value'), 400, 'variable.invalid', 'Reject invalid Variable name')
      await error(await put('EXTRA', 'value', { extra: true, value: 'value' }), 400, 'variable.invalid', 'Reject extra Variable field')
      await error(await request(harness, '/v1/variables/MISSING'), 404, 'variable.not-found', 'Read missing Variable')
      await error(await request(harness, '/v1/variables/MISSING', { method: 'DELETE' }), 404, 'variable.not-found', 'Delete missing Variable')
      equal(await json(await request(harness, '/v1/variables/Token', { method: 'DELETE' }), 200, 'Delete Variable'), { version: 1 }, 'Delete response')

      for (let index = 0; index < 195; index += 1) {
        await json(await put(`V${String(index).padStart(3, '0')}`, 'value'), 200, `Fill Variable ${index}`)
      }
      await error(await put('V195', 'value'), 409, 'variable.limit-reached', 'Reject Variable over limit')
      equal((await json(await put('A', 'updated'), 200, 'Update full Variable catalog')).value, 'updated', 'Full catalog update')
    },
  },
  {
    name: 'creates, replays, lists, reads, renames, and retires a Flow',
    async verify(harness) {
      const created = await createFlow(harness, 'Control flow', 'flow-lifecycle')
      const flowId = requiredString(created.flowId, 'Created Flow flowId')
      const draftRevisionId = requiredString(created.draftRevisionId, 'Created Flow draftRevisionId')
      equal(created.name, 'Control flow', 'Created Flow name')
      equal(created.status, 'active', 'Created Flow status')
      equal(await json(await createFlowRequest(harness, 'Control flow', 'flow-lifecycle'), 200, 'Replay Flow'), created, 'Replayed Flow')
      await error(await createFlowRequest(harness, 'Different flow', 'flow-lifecycle'), 409, 'flow.conflict', 'Conflicting Flow')
      equal(await json(await request(harness, `/v1/flows/${flowId}`), 200, 'Read Flow'), created, 'Read Flow')
      const page = await json(await request(harness, '/v1/flows?includeTotal=true'), 200, 'List Flows')
      equal(page.flows, [created], 'Listed Flows')
      equal(page.total, 1, 'Flow total')
      const second = await createFlow(harness, 'Second control flow', 'flow-lifecycle-second')
      const firstPage = await json(await request(harness, '/v1/flows?limit=1'), 200, 'List first Flow page')
      equal(firstPage.flows, [created], 'First Flow page')
      const cursor = requiredString(firstPage.nextCursor, 'Flow cursor')
      equal(
        (await json(await request(harness, `/v1/flows?limit=1&cursor=${encodeURIComponent(cursor)}`), 200, 'List second Flow page')).flows,
        [second],
        'Second Flow page',
      )
      const renamed = await json(
        await request(harness, `/v1/flows/${flowId}`, { body: JSON.stringify({ name: 'Renamed flow', version: 1 }), method: 'PATCH' }),
        200,
        'Rename Flow',
      )
      equal(renamed.name, 'Renamed flow', 'Renamed Flow name')
      const retired = await json(await request(harness, `/v1/flows/${flowId}`, { method: 'DELETE' }), 202, 'Retire Flow')
      equal(retired.status, 'retiring', 'Retired Flow status')
      await error(await addValueNode(harness, flowId, draftRevisionId), 409, 'flow.busy', 'Mutation after retirement')
    },
  },
  {
    name: 'commits immutable Draft Revisions for one Flow',
    async verify(harness) {
      const flow = await createFlow(harness, 'Draft flow', 'draft-flow')
      const flowId = requiredString(flow.flowId, 'Draft Flow flowId')
      const initialRevisionId = requiredString(flow.draftRevisionId, 'Draft Flow revisionId')
      const changed = await json(await addValueNode(harness, flowId, initialRevisionId, 'marker', 'draft-change'), 200, 'Change Draft')
      const currentRevisionId = changedRevisionId(changed, 'Changed Draft')
      equal(record(changed.revision, 'Changed Draft revision').parentRevisionId, initialRevisionId, 'Changed Draft parent')
      equal(
        await json(await addValueNode(harness, flowId, initialRevisionId, 'marker', 'draft-change'), 200, 'Replay Draft change'),
        changed,
        'Replayed Draft change',
      )
      await error(
        await addValueNode(harness, flowId, initialRevisionId, 'another-marker', 'draft-change'),
        409,
        'flow.conflict',
        'Conflicting Draft change replay',
      )
      await error(
        await changeRequest(harness, flowId, currentRevisionId, [
          {
            before: [{ handle: 'ready', jsonSchema: { type: 'boolean' }, nullable: false, value: true }],
            kind: 'graph.node.values.set',
            nodeId: 'marker',
            target: { kind: 'flow' },
            value: [{ handle: 'ready', jsonSchema: { type: 'boolean' }, nullable: false, value: true }],
          },
        ]),
        400,
        'flow.invalid',
        'No-op Draft change',
      )
      await error(await addValueNode(harness, flowId, initialRevisionId, 'stale'), 412, 'flow.revision-conflict', 'Stale Draft change')
      const old = await json(await request(harness, `/v1/flows/${flowId}/revisions/${initialRevisionId}`), 200, 'Read old Revision')
      const oldNodes = record(record(record(record(old.content, 'Old content').document, 'Old document').graph, 'Old graph').nodes, 'Old nodes')
      equal(oldNodes, {}, 'Old Revision nodes')
      const draft = await json(await request(harness, `/v1/flows/${flowId}/draft`), 200, 'Read Draft')
      equal(draft.revisionId, currentRevisionId, 'Draft revisionId')
      const sync = await json(await request(harness, `/v1/flows/${flowId}/draft/sync`), 200, 'Sync Draft')
      equal(sync.kind, 'snapshot', 'Draft sync kind')
      equal(record(sync.draft, 'Draft snapshot').revisionId, currentRevisionId, 'Draft snapshot revisionId')
    },
  },
  {
    name: 'keeps Presentation CAS independent from the Draft head',
    async verify(harness) {
      const flow = await createFlow(harness, 'Presentation flow', 'presentation-flow')
      const flowId = requiredString(flow.flowId, 'Presentation Flow flowId')
      const draftRevisionId = requiredString(flow.draftRevisionId, 'Presentation Flow revisionId')
      const path = `/v1/flows/${flowId}/presentation`
      const value = { nodes: { task: { x: 120, y: 80 } } }
      const updated = await json(
        await request(harness, path, { body: JSON.stringify({ expectedRevision: 1, value, version: 1 }), method: 'PUT' }),
        200,
        'Update Presentation',
      )
      equal(updated.revision, 2, 'Presentation revision')
      equal(updated.value, value, 'Presentation value')
      await error(
        await request(harness, path, { body: JSON.stringify({ expectedRevision: 1, value: {}, version: 1 }), method: 'PUT' }),
        412,
        'flow.presentation-conflict',
        'Stale Presentation update',
      )
      equal((await json(await request(harness, path), 200, 'Read Presentation')).value, value, 'Presentation value after conflict')
      await json(await request(harness, `/v1/flows/${flowId}`, { method: 'DELETE' }), 202, 'Retire Presentation Flow')
      await error(
        await request(harness, path, { body: JSON.stringify({ expectedRevision: 2, value: {}, version: 1 }), method: 'PUT' }),
        409,
        'flow.busy',
        'Update retired Presentation',
      )
      equal((await json(await request(harness, `/v1/flows/${flowId}`), 200, 'Read Flow')).draftRevisionId, draftRevisionId, 'Draft head')
    },
  },
  {
    name: 'validates, admits, lists, and cancels one Draft Run',
    async verify(harness) {
      const flow = await createFlow(harness, 'Run flow', 'run-flow')
      const flowId = requiredString(flow.flowId, 'Run Flow flowId')
      const draftRevisionId = requiredString(flow.draftRevisionId, 'Run Flow revisionId')
      const checked = await json(
        await request(harness, `/v1/flows/${flowId}/revisions/${draftRevisionId}/check`, {
          body: JSON.stringify({ engineContract, version: 1 }),
          method: 'POST',
        }),
        200,
        'Check Flow',
      )
      equal(checked.valid, true, 'Flow validity')
      const runPath = `/v1/flows/${flowId}/revisions/${draftRevisionId}/runs`
      const create = () =>
        request(harness, runPath, {
          body: JSON.stringify({ engineContract, inputs: {}, version: 1 }),
          headers: { 'idempotency-key': 'draft-run' },
          method: 'POST',
        })
      const run = await json(await create(), 202, 'Create Draft Run')
      const runId = requiredString(run.runId, 'Draft Run runId')
      equal(await json(await create(), 200, 'Replay Draft Run'), run, 'Replayed Draft Run')
      await error(await request(harness, `/v1/runs/${runId}/result`), 409, 'run.not-terminal', 'Read queued Run result')
      const secondRun = await json(
        await request(harness, runPath, {
          body: JSON.stringify({ engineContract, inputs: {}, version: 1 }),
          headers: { 'idempotency-key': 'draft-run-second' },
          method: 'POST',
        }),
        202,
        'Create second Draft Run',
      )
      const secondRunId = requiredString(secondRun.runId, 'Second Draft Run')
      const page = await json(await request(harness, `/v1/flows/${flowId}/runs?limit=1`), 200, 'List Runs')
      equal(
        list(page.runs, 'Runs').map((value) => record(value, 'Run').runId),
        [secondRunId],
        'Listed Runs',
      )
      const cursor = requiredString(page.nextCursor, 'Run cursor')
      const nextPage = await json(await request(harness, `/v1/flows/${flowId}/runs?limit=1&cursor=${encodeURIComponent(cursor)}`), 200, 'List next Runs')
      equal(
        list(nextPage.runs, 'Next Runs').map((value) => record(value, 'Run').runId),
        [runId],
        'Listed next Runs',
      )
      const canceled = await json(
        await request(harness, `/v1/runs/${runId}/cancel`, { body: JSON.stringify({ version: 1 }), method: 'POST' }),
        200,
        'Cancel Run',
      )
      equal(canceled.status, 'canceled', 'Canceled Run status')
      equal((await json(await request(harness, `/v1/runs/${runId}/result`), 200, 'Read canceled Run result')).status, 'canceled', 'Canceled Run result')
      equal((await json(await request(harness, `/v1/runs/${runId}/events`), 200, 'Read canceled Run events')).done, true, 'Canceled Run events')
      equal(
        (
          await json(
            await request(harness, `/v1/runs/${secondRunId}/cancel`, {
              body: JSON.stringify({ version: 1 }),
              method: 'POST',
            }),
            200,
            'Cancel second Draft Run',
          )
        ).status,
        'canceled',
        'Second canceled Run status',
      )
    },
  },
  {
    name: 'rejects invalid and missing Flow control targets',
    async verify(harness) {
      const missingFlow = '00000000-0000-7000-8000-000000000001'
      const missingRevision = '00000000-0000-7000-8000-000000000002'
      const missingRun = '00000000-0000-7000-8000-000000000003'
      await error(await request(harness, `/v1/flows/${missingFlow}`), 404, 'flow.not-found', 'Read missing Flow')
      await error(
        await request(harness, `/v1/flows/${missingFlow}`, { body: JSON.stringify({ name: 'Missing', version: 1 }), method: 'PATCH' }),
        404,
        'flow.not-found',
        'Rename missing Flow',
      )
      await error(await request(harness, `/v1/flows/${missingFlow}`, { method: 'DELETE' }), 404, 'flow.not-found', 'Retire missing Flow')
      await error(await request(harness, `/v1/flows/${missingFlow}/draft`), 404, 'flow.not-found', 'Read missing Draft')
      await error(await request(harness, `/v1/flows/${missingFlow}/revisions/${missingRevision}`), 404, 'flow.not-found', 'Read missing Revision')
      await error(await request(harness, `/v1/flows/${missingFlow}/presentation`), 404, 'flow.not-found', 'Read missing Presentation')
      await error(
        await request(harness, `/v1/flows/${missingFlow}/presentation`, {
          body: JSON.stringify({ expectedRevision: 1, value: {}, version: 1 }),
          method: 'PUT',
        }),
        404,
        'flow.not-found',
        'Update missing Presentation',
      )
      await error(await request(harness, `/v1/flows/${missingFlow}/runs`), 404, 'flow.not-found', 'List missing Flow Runs')
      await error(await request(harness, `/v1/runs/${missingRun}`), 404, 'run.not-found', 'Read missing Run')
      await error(await request(harness, `/v1/runs/${missingRun}/events`), 404, 'run.not-found', 'Read missing Run events')
      await error(await request(harness, `/v1/runs/${missingRun}/result`), 404, 'run.not-found', 'Read missing Run result')
      await error(
        await request(harness, `/v1/runs/${missingRun}/cancel`, { body: JSON.stringify({ version: 1 }), method: 'POST' }),
        404,
        'run.not-found',
        'Cancel missing Run',
      )

      const flow = await createFlow(harness, 'Invalid targets', 'invalid-targets')
      const flowId = requiredString(flow.flowId, 'Invalid targets Flow')
      const revisionId = requiredString(flow.draftRevisionId, 'Invalid targets Revision')
      const check = (targetRevision: string, contract: string) =>
        request(harness, `/v1/flows/${flowId}/revisions/${targetRevision}/check`, {
          body: JSON.stringify({ engineContract: contract, version: 1 }),
          method: 'POST',
        })
      await error(await check(revisionId, 'unsupported-engine/v1'), 409, 'engine.unsupported', 'Check unsupported Engine')
      await error(await check(missingRevision, engineContract), 404, 'flow.not-found', 'Check missing Revision')
      const run = (targetRevision: string, contract: string, key: string) =>
        request(harness, `/v1/flows/${flowId}/revisions/${targetRevision}/runs`, {
          body: JSON.stringify({ engineContract: contract, inputs: {}, version: 1 }),
          headers: { 'idempotency-key': key },
          method: 'POST',
        })
      await error(await run(revisionId, 'unsupported-engine/v1', 'unsupported-run'), 409, 'engine.unsupported', 'Run unsupported Engine')
      await error(await run(missingRevision, engineContract, 'missing-revision-run'), 404, 'flow.not-found', 'Run missing Revision')
    },
  },
]

export const publicationControlApiConformanceCases: readonly ControlApiConformanceCase[] = [
  {
    name: 'publishes one immutable Flow with idempotent Live CAS',
    async verify(harness) {
      const flow = await createFlow(harness, 'Publication flow', 'publication-flow')
      const flowId = requiredString(flow.flowId, 'Publication Flow flowId')
      const draftRevisionId = requiredString(flow.draftRevisionId, 'Publication Flow revisionId')
      equal((await json(await request(harness, `/v1/flows/${flowId}/live`), 200, 'Read Live')).status, 'not-published', 'Initial Live status')
      const publish = () => publishRequest(harness, flowId, draftRevisionId, null, 'publication-first')
      const completed = await completePublish(harness, await publish(), 202, 'Publish Flow')
      const publication = completed.publication
      const publicationId = requiredString(publication.publicationId, 'Publication id')
      equal(await json(await publish(), 202, 'Replay Publish'), completed.operation, 'Replayed Publish operation')
      await error(await publishRequest(harness, flowId, draftRevisionId, publicationId, 'publication-first'), 409, 'publication.conflict', 'Conflicting replay')
      const live = await json(await request(harness, `/v1/flows/${flowId}/live`), 200, 'Read published Live')
      equal(live.publication, publication, 'Live Publication')
      const history = await json(await request(harness, `/v1/flows/${flowId}/publications?includeTotal=true`), 200, 'List Publications')
      equal(history.publications, [publication], 'Publication history')
      equal(history.total, 1, 'Publication total')
      await error(
        await request(harness, `/v1/flows/${flowId}/revisions/${draftRevisionId}/publications`, {
          body: JSON.stringify({ engineContract: 'unsupported-engine/v1', expectedLivePublicationId: publicationId, version: 1 }),
          headers: { 'idempotency-key': 'unsupported-publication' },
          method: 'POST',
        }),
        409,
        'engine.unsupported',
        'Publish unsupported Engine',
      )
      await error(
        await publishRequest(harness, flowId, '00000000-0000-7000-8000-000000000002', publicationId, 'missing-revision-publication'),
        404,
        'flow.not-found',
        'Publish missing Revision',
      )
      await error(
        await rollbackRequest(harness, flowId, '00000000-0000-7000-8000-000000000004', publicationId, 'missing-rollback'),
        404,
        'publication.not-found',
        'Rollback missing Publication',
      )
      await error(
        await liveRunRequest(harness, '00000000-0000-7000-8000-000000000004', 'missing-publication-run'),
        404,
        'publication.not-found',
        'Run missing Publication',
      )
    },
  },
  {
    name: 'rolls back immutable history and fixes a Live Run target',
    async verify(harness) {
      const flow = await createFlow(harness, 'Rollback flow', 'rollback-flow')
      const flowId = requiredString(flow.flowId, 'Rollback Flow flowId')
      const firstRevisionId = requiredString(flow.draftRevisionId, 'Rollback Flow revisionId')
      const first = (
        await completePublish(harness, await publishRequest(harness, flowId, firstRevisionId, null, 'publish-first'), 202, 'Publish first Revision')
      ).publication
      const firstPublicationId = requiredString(first.publicationId, 'First Publication')
      const changed = await json(await addValueNode(harness, flowId, firstRevisionId), 200, 'Change Draft')
      const secondRevisionId = changedRevisionId(changed, 'Second Revision')
      const second = (
        await completePublish(
          harness,
          await publishRequest(harness, flowId, secondRevisionId, firstPublicationId, 'publish-second'),
          202,
          'Publish second Revision',
        )
      ).publication
      const secondPublicationId = requiredString(second.publicationId, 'Second Publication')
      await error(await liveRunRequest(harness, firstPublicationId, 'stale-live-run'), 412, 'live.conflict', 'Run stale Publication')
      const rollback = () => rollbackRequest(harness, flowId, firstPublicationId, secondPublicationId, 'rollback-first')
      const restored = await json(await rollback(), 201, 'Rollback Flow')
      const restoredPublicationId = requiredString(restored.publicationId, 'Rollback Publication')
      equal(restored.operation, 'rollback', 'Rollback operation')
      equal(restored.sourcePublicationId, firstPublicationId, 'Rollback source')
      equal(await json(await rollback(), 200, 'Replay Rollback'), restored, 'Replayed Rollback')
      const run = await json(await liveRunRequest(harness, restoredPublicationId, 'rollback-run'), 202, 'Create Live Run')
      equal(run.flowId, flowId, 'Live Run flowId')
      equal(run.revisionId, firstRevisionId, 'Live Run revisionId')
      await json(await request(harness, `/v1/flows/${flowId}`, { method: 'DELETE' }), 202, 'Retire Flow')
      await error(await liveRunRequest(harness, restoredPublicationId, 'retired-run'), 409, 'flow.busy', 'Run retired Flow')
    },
  },
]

export const triggerControlApiConformanceCases: readonly ControlApiConformanceCase[] = [
  {
    name: 'exposes one deployment-scoped Trigger Key catalog',
    async verify(harness) {
      const keys = await json(await request(harness, '/v1/trigger-keys'), 200, 'List Trigger Keys')
      const catalog = await json(await request(harness, '/v1/trigger-keys/catalog'), 200, 'List Trigger definitions')
      const summaries = list(keys.keys, 'Trigger Keys').map((value) => record(value, 'Trigger Key'))
      const definitions = list(catalog.definitions, 'Trigger definitions').map((value) => record(value, 'Trigger definition'))
      equal(
        summaries.map((value) => value.key),
        definitions.map((value) => value.key),
        'Trigger catalog identities',
      )
      for (const [index, summary] of summaries.entries()) {
        const key = requiredString(summary.key, 'Trigger Key')
        equal(
          (await json(await request(harness, `/v1/trigger-keys/${encodeURIComponent(key)}`), 200, 'Read Trigger Key')).definition,
          definitions[index],
          'Trigger detail',
        )
      }
      await error(await request(harness, '/v1/trigger-keys/conformance.missing'), 404, 'trigger-key.not-found', 'Missing Trigger Key')
    },
  },
  {
    name: 'operates and retires one Live Trigger binding',
    async verify(harness) {
      const flow = await createFlow(harness, 'Trigger flow', 'trigger-flow')
      const flowId = requiredString(flow.flowId, 'Trigger Flow flowId')
      const firstRevisionId = requiredString(flow.draftRevisionId, 'Trigger Flow revisionId')
      const changed = await json(
        await changeRequest(harness, flowId, firstRevisionId, [
          {
            kind: 'graph.node.create',
            node: { cronTimes: [{ type: 'every', unit: 'hour', value: 1 }], kind: 'cron', name: 'Scheduled' },
            nodeId: 'cron',
            target: { kind: 'flow' },
          },
          { kind: 'graph.node.create', node: { inputsDef: [], kind: 'webhook', name: 'Incoming' }, nodeId: 'webhook', target: { kind: 'flow' } },
        ]),
        200,
        'Create Trigger nodes',
      )
      const triggerRevisionId = changedRevisionId(changed, 'Trigger Revision')
      const publication = (
        await completePublish(harness, await publishRequest(harness, flowId, triggerRevisionId, null, 'trigger-publication'), 202, 'Publish Trigger Flow')
      ).publication
      const publicationId = requiredString(publication.publicationId, 'Trigger Publication')
      const base = `/v1/flows/${flowId}/triggers`
      const bindings = list((await json(await request(harness, base), 200, 'List Trigger bindings')).bindings, 'Trigger bindings').map((value) =>
        record(value, 'Trigger binding'),
      )
      equal(
        bindings.map((value) => value.triggerNodeId),
        ['cron', 'webhook'],
        'Trigger binding order',
      )
      for (const binding of bindings) equal(binding.currentPublicationId, publicationId, 'Trigger Publication')
      const webhookPath = `${base}/webhook`
      const endpointUrl = requiredString(
        record((await json(await request(harness, webhookPath), 200, 'Read Webhook')).binding, 'Webhook').endpointUrl,
        'Webhook endpoint',
      )
      const state = (action: 'pause' | 'resume') => request(harness, `${webhookPath}/${action}`, { body: JSON.stringify({ version: 1 }), method: 'POST' })
      equal((await json(await state('pause'), 200, 'Pause Webhook')).operatorState, 'paused', 'Paused state')
      equal((await harness.request(new Request(endpointUrl, { method: 'POST' }))).status, 404, 'Paused callback')
      equal((await json(await state('resume'), 200, 'Resume Webhook')).operatorState, 'active', 'Resumed state')
      equal((await harness.request(new Request(endpointUrl, { method: 'POST' }))).status, 200, 'Resumed callback')
      const removed = await json(
        await changeRequest(harness, flowId, triggerRevisionId, [{ kind: 'graph.node.delete', nodeId: 'webhook', target: { kind: 'flow' } }]),
        200,
        'Delete Webhook',
      )
      await completePublish(
        harness,
        await publishRequest(harness, flowId, changedRevisionId(removed, 'Retired Trigger Revision'), publicationId, 'retire-trigger'),
        202,
        'Publish retired Trigger',
      )
      equal(
        record((await json(await request(harness, webhookPath), 200, 'Read retired Webhook')).binding, 'Retired Webhook').currentPublicationId,
        undefined,
        'Retired Publication',
      )
    },
  },
]

export const connectorControlApiConformanceCases: readonly ControlApiConformanceCase[] = [
  {
    name: 'projects the deployment Connector catalog and authorized Connections',
    async verify(harness) {
      const providers = list(
        (await json(await request(harness, '/v1/connector/providers'), 200, 'List Connector Providers')).providers,
        'Connector Providers',
      ).map((value) => record(value, 'Connector Provider'))
      const actions = list((await json(await request(harness, '/v1/connector/actions'), 200, 'List Connector Actions')).actions, 'Connector Actions').map(
        (value) => record(value, 'Connector Action'),
      )
      if (providers.length == 0 || actions.length == 0) fail('Connector conformance deployment must expose a Provider and Action.')
      const action = actions[0]!
      const actionId = requiredString(action.actionId, 'Connector Action id')
      const serviceId = requiredString(action.serviceId, 'Connector Action serviceId')
      if (!providers.some((provider) => provider.serviceId == serviceId)) fail('Connector Action must refer to a listed Provider.')
      equal(
        (await json(await request(harness, `/v1/connector/actions/${encodeURIComponent(actionId)}`), 200, 'Read Connector Action')).action,
        action,
        'Connector Action detail',
      )
      const connections = await json(await request(harness, `/v1/connector/connections/${encodeURIComponent(serviceId)}`), 200, 'List Connector Connections')
      if (!Array.isArray(connections.connections)) fail('Connector Connections must be an array.')
      const page = await json(
        await request(harness, `/v1/connector/connections/${encodeURIComponent(serviceId)}/page`, { body: JSON.stringify({ version: 1 }), method: 'POST' }),
        200,
        'Create Connector Connection page',
      )
      const url = new URL(requiredString(page.url, 'Connector Connection page URL'))
      if (url.protocol != 'http:' && url.protocol != 'https:') fail('Connector Connection page URL must use HTTP.')
    },
  },
  {
    name: 'rejects invalid Connector discovery requests',
    async verify(harness) {
      await error(await request(harness, '/v1/connector/actions?service=mail&q=send'), 400, 'flow.invalid', 'Conflicting Connector query')
      await error(await request(harness, '/v1/connector/actions?q=%20%20'), 400, 'flow.invalid', 'Empty Connector query')
      await error(await request(harness, `/v1/connector/connections/${'a'.repeat(257)}`), 400, 'flow.invalid', 'Oversized Connector service')
      await error(await request(harness, '/v1/connector/actions/conformance.missing'), 404, 'connector.action-not-found', 'Missing Connector Action')
    },
  },
]
