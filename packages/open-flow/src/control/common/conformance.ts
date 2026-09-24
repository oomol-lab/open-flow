import type { JsonValue, RevisionContent, TriggerKeySnapshot } from '../../flow/common/change.ts'
import type { TriggerConfigOption } from '../../trigger/common/configOptions.ts'
import type { ConnectorConnection, CreateEventSource, ResultInfo, PollTriggerTestResult } from './api.ts'
import type { ProviderAccessIdentity } from './providerAccess.ts'

import { dequal } from 'dequal/lite'
import { ControlClient, decodeRunEvent } from './api.ts'
import { allConnectorConnectionsQuery } from './connectorQueries.ts'

export interface ControlApiConformanceHarness {
  readonly origin: string
  dispose(): Promise<void>
  request(request: Request): Promise<Response>
}

export interface ControlApiConformanceCase {
  readonly name: string
  readonly runtime?: true
  verify(harness: ControlApiConformanceHarness): Promise<void>
}

type RecordValue = Readonly<Record<string, unknown>>

const engineContract = 'open-flow-engine/v5'

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

async function error(response: Response, status: number, code: string, message: string, detail?: string): Promise<void> {
  const body = await json(response, status, message)
  const bodyError = record(body.error, `${message} error`)
  equal(bodyError.code, code, `${message} error code`)
  const errorMessage = requiredString(bodyError.message, `${message} error message`)
  if (detail != null && !errorMessage.includes(detail)) fail(`${message} error message: expected ${JSON.stringify(detail)} in ${JSON.stringify(errorMessage)}.`)
  equal(body.version, 1, `${message} version`)
}

function request(harness: ControlApiConformanceHarness, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.body != null && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return harness.request(new Request(new URL(path, harness.origin), { ...init, headers }))
}

function client(harness: ControlApiConformanceHarness): ControlClient {
  return new ControlClient((path, init) => request(harness, path, init))
}

async function revalidate(harness: ControlApiConformanceHarness, path: string, locale?: string): Promise<void> {
  const response = await request(harness, path)
  await json(response, 200, `Read ${path}`)
  const etag = requiredString(response.headers.get('etag'), `${path} ETag`)
  equal(response.headers.get('cache-control'), 'private, no-cache', `${path} cache policy`)
  const cached = await request(harness, path, { headers: { 'if-none-match': etag } })
  equal(cached.status, 304, `${path} conditional status`)
  equal(await cached.text(), '', `${path} conditional body`)
  equal(cached.headers.get('etag'), etag, `${path} conditional ETag`)
  equal(cached.headers.get('cache-control'), 'private, no-cache', `${path} conditional cache policy`)
  if (locale != null) {
    for (const result of [response, cached]) {
      equal(result.headers.get('content-language'), locale, `${path} language`)
      if (!result.headers.get('vary')?.toLowerCase().split(/,\s*/).includes('accept-language')) fail(`${path} must vary by Accept-Language.`)
    }
  }
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
          inputs: {},
          kind: 'value',
          name: nodeId,
          values: [{ handle: 'ready', jsonSchema: { type: 'boolean' }, nullable: false, value: true }],
        },
        nodeId,
        target: { kind: 'flow' },
      },
    ],
    changeId,
  )
}

async function addManualTrigger(harness: ControlApiConformanceHarness, flowId: string, revisionId: string): Promise<string> {
  return changedRevisionId(
    await json(
      await changeRequest(harness, flowId, revisionId, [
        { kind: 'graph.node.create', node: { kind: 'manual', name: 'Start' }, nodeId: 'start', target: { kind: 'flow' } },
      ]),
      200,
      'Add manual trigger',
    ),
    'Manual trigger Revision',
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
    body: JSON.stringify({ inputs: {}, trigger: { nodeId: 'start', outputs: {} }, publicationId, version: 2 }),
    headers: { 'idempotency-key': key },
    method: 'POST',
  })
}

export const controlApiConformanceCases: readonly ControlApiConformanceCase[] = [
  {
    name: 'admits simultaneous retries as one Run and preserves its Trigger identity',
    async verify(harness) {
      const flow = await createFlow(harness, 'Concurrent Run', 'concurrent-run-flow')
      const flowId = requiredString(flow.flowId, 'Flow ID')
      const revisionId = await addManualTrigger(harness, flowId, requiredString(flow.draftRevisionId, 'Revision ID'))
      const submit = (payload: unknown = {}) =>
        request(harness, `/v1/flows/${flowId}/revisions/${revisionId}/runs`, {
          method: 'POST',
          headers: { 'idempotency-key': 'concurrent-run' },
          body: JSON.stringify({ engineContract, inputs: {}, trigger: { nodeId: 'start', outputs: payload }, version: 2 }),
        })
      const responses = await Promise.all([submit(), submit(), submit(), submit()])
      equal(responses.map((response) => response.status).toSorted(), [200, 200, 200, 202], 'One Run is admitted')
      const bodies = await Promise.all(responses.map((response) => response.json()))
      const runId = requiredString(record(bodies[0], 'Run').runId, 'Run ID')
      for (const body of bodies) equal(record(body, 'Run').runId, runId, 'Concurrent Run identity')
      await error(await submit({ changed: true }), 409, 'run.conflict', 'Reject changed Trigger replay')
      const runs = await json(await request(harness, `/v1/flows/${flowId}/runs`), 200, 'List admitted Runs')
      equal(list(runs.runs, 'Runs').length, 1, 'No duplicate Run')
    },
  },
  {
    name: 'deduplicates simultaneous creation and lost-response retries',
    async verify(harness) {
      const responses = await Promise.all(Array.from({ length: 4 }, () => createFlowRequest(harness, 'Concurrent Flow', 'concurrent-create')))
      equal(responses.map((response) => response.status).toSorted(), [200, 200, 200, 201], 'One creation commits')
      const bodies = await Promise.all(responses.map((response) => response.json()))
      for (const body of bodies) equal(body, bodies[0], 'Concurrent replay identity')
      const retried = await json(await createFlowRequest(harness, 'Concurrent Flow', 'concurrent-create'), 200, 'Retry lost creation response')
      equal(retried, bodies[0], 'Lost-response replay')
      await error(await createFlowRequest(harness, 'Different Flow', 'concurrent-create'), 409, 'flow.conflict', 'Reject changed retry')
    },
  },
  {
    name: 'commits one concurrent Draft change and replays the winning key',
    async verify(harness) {
      const created = await createFlow(harness, 'Concurrent Draft', 'concurrent-draft')
      const flowId = requiredString(created.flowId, 'Flow ID')
      const revisionId = requiredString(created.draftRevisionId, 'Revision ID')
      const responses = await Promise.all([
        addValueNode(harness, flowId, revisionId, 'left', 'concurrent-left'),
        addValueNode(harness, flowId, revisionId, 'right', 'concurrent-right'),
      ])
      equal(responses.map((response) => response.status).toSorted(), [200, 412], 'One Draft CAS commits')
      const winner = responses.findIndex((response) => response.status == 200)
      const committed = await json(responses[winner] ?? fail('Missing winning response'), 200, 'Winning Draft change')
      await error(responses[1 - winner] ?? fail('Missing losing response'), 412, 'flow.revision-conflict', 'Losing Draft change')
      const nodeId = winner == 0 ? 'left' : 'right'
      equal(
        await json(await addValueNode(harness, flowId, revisionId, nodeId, `concurrent-${nodeId}`), 200, 'Replay winning change'),
        committed,
        'Replay precedes stale Revision check',
      )
      const draft = await json(await request(harness, `/v1/flows/${flowId}/draft`), 200, 'Read authoritative Draft')
      const nodes = record(record(record(draft.content, 'Content').document, 'Document').graph, 'Graph').nodes
      equal(Object.keys(record(nodes, 'Nodes')), [nodeId], 'No partial losing edit')
    },
  },
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
        await addValueNode(harness, flowId, currentRevisionId, 'marker'),
        400,
        'flow.invalid',
        'Duplicate Draft Node',
        'A Node with this ID already exists',
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
    name: 'repairs a Draft with immutable history, idempotency and Revision CAS',
    async verify(harness) {
      const api = client(harness)
      const flow = await api.createFlow('Repair', 'repair-flow')
      const before = await api.getDraft(flow.flowId)
      const presentation = await api.getPresentation(flow.flowId)
      const live = await api.getLive(flow.flowId)
      const repaired = await api.repairDraft(flow.flowId, before.revisionId, 'repair-once')
      equal(repaired.revision.parentRevisionId, before.revisionId, 'Repair parent')
      if (repaired.revision.revisionId == before.revisionId) fail('Repair must create a child Revision.')
      equal(await api.repairDraft(flow.flowId, before.revisionId, 'repair-once'), repaired, 'Repair replay')
      equal(await api.getRevision(flow.flowId, before.revisionId), before, 'Original Revision remains immutable')
      equal((await api.getEditor(flow.flowId)).draft.content, before.content, 'Repair preserves readable content')
      equal(await api.getPresentation(flow.flowId), presentation, 'Repair preserves Presentation')
      equal(await api.getLive(flow.flowId), live, 'Repair preserves Live')
      await error(
        await request(harness, `/v1/flows/${encodeURIComponent(flow.flowId)}/draft/repair`, {
          method: 'POST',
          headers: { 'idempotency-key': 'repair-stale' },
          body: JSON.stringify({ expectedRevisionId: before.revisionId, version: 1 }),
        }),
        412,
        'flow.revision-conflict',
        'Stale repair',
      )
    },
  },
  {
    name: 'loads the current editor without changing Draft or Presentation',
    async verify(harness) {
      const created = await createFlow(harness, 'Editor flow', 'editor-flow')
      const flowId = requiredString(created.flowId, 'Editor Flow identity')
      const initialRevisionId = requiredString(created.draftRevisionId, 'Editor Draft identity')
      const changed = await json(await addValueNode(harness, flowId, initialRevisionId, 'marker'), 200, 'Change editor Draft')
      const layout = await json(
        await request(harness, `/v1/flows/${flowId}/presentation`, {
          method: 'PUT',
          body: JSON.stringify({ expectedRevision: 1, value: { nodes: { marker: { x: 12, y: 24 } } }, version: 1 }),
        }),
        200,
        'Update editor Presentation',
      )
      const editor = await json(await request(harness, `/v1/flows/${flowId}/editor`), 200, 'Read editor')
      equal(editor.version, 1, 'Editor version')
      equal(record(editor.flow, 'Editor Flow').draftRevisionId, changedRevisionId(changed, 'Editor change'), 'Editor Draft head')
      for (const key of ['flow', 'draft', 'live', 'presentation']) {
        const path = key == 'flow' ? `/v1/flows/${flowId}` : `/v1/flows/${flowId}/${key}`
        equal(editor[key], await json(await request(harness, path), 200, `Read editor ${key}`), `Editor ${key}`)
      }
      equal(editor.presentation, layout, 'Reading editor preserves Presentation')
      await error(await request(harness, '/v1/flows/missing-editor/editor'), 404, 'flow.not-found', 'Read missing editor')
    },
  },
  {
    name: 'keeps Presentation CAS independent from the Draft head',
    async verify(harness) {
      const flow = await createFlow(harness, 'Presentation flow', 'presentation-flow')
      const flowId = requiredString(flow.flowId, 'Presentation Flow flowId')
      const draftRevisionId = requiredString(flow.draftRevisionId, 'Presentation Flow revisionId')
      const path = `/v1/flows/${flowId}/presentation`
      const value = { edges: [], nodes: { task: { x: 120, y: 80 } } }
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
    name: 'admits a Draft entry while unrelated branches remain invalid',
    async verify(harness) {
      const flow = await createFlow(harness, 'Partial Draft', 'partial-draft')
      const flowId = requiredString(flow.flowId, 'Partial Flow identity')
      const initial = await addManualTrigger(harness, flowId, requiredString(flow.draftRevisionId, 'Partial Draft identity'))
      const changed = await json(
        await changeRequest(harness, flowId, initial, [
          { kind: 'graph.node.create', nodeId: 'other', target: { kind: 'flow' }, node: { kind: 'webhook', method: 'POST', name: 'Other', bodyFields: [] } },
          {
            kind: 'graph.node.create',
            nodeId: 'broken',
            target: { kind: 'flow' },
            node: { kind: 'task', name: 'Broken', inputs: {}, task: { name: 'Broken', moduleId: 'missing', inputs: [], outputs: [] } },
          },
          { kind: 'graph.edge.connect', target: { kind: 'flow' }, edge: { source: 'other', target: 'broken' } },
        ]),
        200,
        'Add unfinished branch',
      )
      const revisionId = changedRevisionId(changed, 'Partial Draft')
      const path = `/v1/flows/${flowId}/revisions/${revisionId}`
      const checked = await json(
        await request(harness, `${path}/check`, {
          method: 'POST',
          body: JSON.stringify({ engineContract, version: 1 }),
        }),
        200,
        'Check entire Draft',
      )
      equal(checked.valid, false, 'Entire Draft remains invalid')
      const run = (nodeId: string) =>
        request(harness, `${path}/runs`, {
          method: 'POST',
          headers: { 'idempotency-key': `partial-${nodeId}` },
          body: JSON.stringify({
            engineContract,
            inputs: {},
            trigger: { nodeId, outputs: nodeId === 'start' ? {} : { headers: {}, query: {}, body: {}, webhookUrl: 'http://example.com/webhook' } },
            version: 2,
          }),
        })
      await json(await run('start'), 202, 'Run valid entry')
      await error(await run('other'), 400, 'flow.invalid', 'Reject invalid entry branch')
      await error(await publishRequest(harness, flowId, revisionId, null, 'partial-publish'), 400, 'flow.invalid', 'Reject incomplete publication')
    },
  },
  {
    name: 'validates, admits, lists, and cancels one Draft Run',
    async verify(harness) {
      const flow = await createFlow(harness, 'Run flow', 'run-flow')
      const flowId = requiredString(flow.flowId, 'Run Flow flowId')
      const draftRevisionId = await addManualTrigger(harness, flowId, requiredString(flow.draftRevisionId, 'Run Flow revisionId'))
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
      for (const trigger of [undefined, { nodeId: 'missing', outputs: {} }, { nodeId: 'start', outputs: { payload: { unexpected: true } } }]) {
        await error(
          await request(harness, runPath, {
            body: JSON.stringify({ engineContract, inputs: {}, trigger, version: 2 }),
            headers: { 'idempotency-key': `invalid-entry-${JSON.stringify(trigger)}` },
            method: 'POST',
          }),
          400,
          'run.invalid',
          'Reject invalid start node or payload',
        )
      }
      const create = () =>
        request(harness, runPath, {
          body: JSON.stringify({ engineContract, inputs: {}, trigger: { nodeId: 'start', outputs: {} }, version: 2 }),
          headers: { 'idempotency-key': 'draft-run' },
          method: 'POST',
        })
      const run = await json(await create(), 202, 'Create Draft Run')
      const runId = requiredString(run.runId, 'Draft Run runId')
      equal(await json(await create(), 200, 'Replay Draft Run'), run, 'Replayed Draft Run')
      await error(
        await request(harness, runPath, {
          body: JSON.stringify({ engineContract, inputs: {}, trigger: { nodeId: 'another', outputs: {} }, version: 2 }),
          headers: { 'idempotency-key': 'draft-run' },
          method: 'POST',
        }),
        409,
        'run.conflict',
        'Changing the entry conflicts with the original Run request',
      )

      await error(await request(harness, `/v1/runs/${runId}/result`), 409, 'run.not-terminal', 'Read queued Run result')
      const secondRun = await json(
        await request(harness, runPath, {
          body: JSON.stringify({ engineContract, inputs: {}, trigger: { nodeId: 'start', outputs: {} }, version: 2 }),
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
      const otherFlow = await createFlow(harness, 'Other Run flow', 'other-run-flow')
      const otherFlowId = requiredString(otherFlow.flowId, 'Other Run Flow flowId')
      await error(
        await request(harness, `/v1/flows/${otherFlowId}/runs?limit=1&cursor=${encodeURIComponent(cursor)}`),
        400,
        'page.invalid-cursor',
        'Reject Run cursor from another Flow',
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
      const createdAt = requiredString(run.createdAt, 'Run createdAt')
      const api = client(harness)
      const completeEvents = await api.getRunEvents(runId)
      if (completeEvents.events.length < 2) fail('Canceled Run must expose multiple events for pagination.')
      const firstEvent = await api.getRunEvents(runId, { limit: 1 })
      equal(firstEvent.events, completeEvents.events.slice(0, 1), 'First event page')
      const remainingEvents = await api.getRunEvents(runId, { after: firstEvent.nextAfter })
      equal(remainingEvents.events, completeEvents.events.slice(1), 'Event continuation excludes cursor')
      const exhausted = await api.getRunEvents(runId, { after: completeEvents.nextAfter, limit: 1 })
      equal(exhausted.events, [], 'Exhausted event page')
      equal(exhausted.nextAfter, completeEvents.nextAfter, 'Exhausted event cursor')
      equal(exhausted.done, true, 'Terminal event page')
      const createdBefore = new Date(Date.parse(createdAt) + 1).toISOString()
      const filteredPage = await json(await request(harness, `/v1/flows/${flowId}/runs?limit=1&status=canceled&source=draft`), 200, 'Filter paginated Runs')
      equal(
        list(filteredPage.runs, 'Filtered Run page').map((value) => record(value, 'Filtered Run').runId),
        [secondRunId],
        'Filtered first Run page',
      )
      const filteredCursor = requiredString(filteredPage.nextCursor, 'Filtered Run cursor')
      const filteredNextPage = await json(
        await request(harness, `/v1/flows/${flowId}/runs?limit=1&status=canceled&source=draft&cursor=${encodeURIComponent(filteredCursor)}`),
        200,
        'Continue filtered Runs',
      )
      equal(
        list(filteredNextPage.runs, 'Next filtered Run page').map((value) => record(value, 'Filtered Run').runId),
        [runId],
        'Filtered next Run page',
      )
      const filtered = await json(
        await request(
          harness,
          `/v1/flows/${flowId}/runs?status=canceled&source=draft&createdFrom=${encodeURIComponent(createdAt)}&createdBefore=${encodeURIComponent(createdBefore)}&runId=${encodeURIComponent(runId)}`,
        ),
        200,
        'Filter Runs',
      )
      equal(
        list(filtered.runs, 'Filtered Runs').map((value) => record(value, 'Filtered Run').runId),
        [runId],
        'Filtered Run list',
      )
      const excluded = await json(await request(harness, `/v1/flows/${flowId}/runs?createdBefore=${encodeURIComponent(createdAt)}`), 200, 'Filter Run boundary')
      equal(list(excluded.runs, 'Boundary Runs'), [], 'Exclusive Run upper boundary')
      for (const invalidQuery of [
        'source=manual',
        'createdFrom=invalid',
        'createdFrom=2026-02-30T00%3A00%3A00Z',
        `createdFrom=${encodeURIComponent(createdBefore)}&createdBefore=${encodeURIComponent(createdAt)}`,
        'runId=',
      ]) {
        await error(await request(harness, `/v1/flows/${flowId}/runs?${invalidQuery}`), 400, 'run.invalid', `Reject Run filter ${invalidQuery}`)
      }
    },
  },
  {
    name: 'pauses, resolves, resumes, and cancels waiting Draft Runs',
    runtime: true,
    async verify(harness) {
      const flow = await createFlow(harness, 'Wait flow', 'wait-flow')
      const flowId = requiredString(flow.flowId, 'Wait Flow flowId')
      const initialRevisionId = await addManualTrigger(harness, flowId, requiredString(flow.draftRevisionId, 'Wait Flow revisionId'))
      const changed = await json(
        await changeRequest(harness, flowId, initialRevisionId, [
          {
            kind: 'graph.node.create',
            node: {
              inputDefinitions: [{ handle: 'value', jsonSchema: {}, nullable: true, value: null }],
              inputs: { value: { kind: 'value', value: { request: 1 } } },
              kind: 'approval',
              name: 'Approval',
              prompt: 'Approve request 1?',
            },
            nodeId: 'approval',
            target: { kind: 'flow' },
          },
          { kind: 'graph.edge.connect', edge: { source: 'start', target: 'approval' }, target: { kind: 'flow' } },
        ]),
        200,
        'Create Wait',
      )
      const revisionId = changedRevisionId(changed, 'Wait Revision')
      const runPath = `/v1/flows/${flowId}/revisions/${revisionId}/runs`
      const create = async (key: string, message: string) =>
        json(
          await request(harness, runPath, {
            body: JSON.stringify({ engineContract, inputs: {}, trigger: { nodeId: 'start', outputs: {} }, version: 2 }),
            headers: { 'idempotency-key': key },
            method: 'POST',
          }),
          202,
          message,
        )
      const run = await create('wait-run', 'Create Wait Run')
      const runId = requiredString(run.runId, 'Wait Run runId')
      let detail = run
      for (let attempt = 0; list(detail.waits, 'Waits').length == 0 && attempt < 200; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        detail = await json(await request(harness, `/v1/runs/${runId}`), 200, 'Read Wait Run')
      }
      equal(detail.status, 'running', 'Wait Run status')
      const waiting = record(list(detail.waits, 'Waits')[0], 'Active Wait')
      equal(waiting.actions, ['approve', 'reject'], 'Wait actions')
      equal(waiting.nodeId, 'approval', 'Wait node')
      equal(waiting.prompt, 'Approve request 1?', 'Wait prompt')
      requiredString(waiting.expiresAt, 'Wait expiry')
      requiredString(waiting.waitingSince, 'Wait start')
      const waitId = requiredString(waiting.waitId, 'Wait id')

      const waitingPage = await json(await request(harness, `/v1/flows/${flowId}/runs?pendingWait=true`), 200, 'List waiting Runs')
      equal(
        list(waitingPage.runs, 'Waiting Runs').map((value) => record(value, 'Waiting Run').runId),
        [runId],
        'Waiting Run list',
      )
      const waitingEvents = await json(await request(harness, `/v1/runs/${runId}/events`), 200, 'Read waiting Run events')
      for (const event of list(waitingEvents.events, 'Run events')) decodeRunEvent(event)
      equal(waitingEvents.done, false, 'Waiting events done')
      if (!list(waitingEvents.events, 'Waiting events').some((value) => record(value, 'Waiting event').kind == 'wait.created')) {
        fail('Waiting Run must contain wait.created.')
      }
      await error(await request(harness, `/v1/runs/${runId}/result`), 409, 'run.not-terminal', 'Read waiting Run result')

      const resolvePath = `/v1/runs/${runId}/waits/${waitId}/resolve`
      const resolveWait = (action: 'approve' | 'continue' | 'reject') =>
        request(harness, resolvePath, { body: JSON.stringify({ action, version: 1 }), method: 'POST' })
      await error(await resolveWait('continue'), 400, 'run.invalid', 'Reject unsupported Wait action')
      const approved = await json(await resolveWait('approve'), 200, 'Approve Wait')
      equal(approved.action, 'approve', 'Approved action')
      equal(approved.resolutionAccepted, true, 'Approved resolution')
      equal(approved.status, 'running', 'Resolved Run status')
      requiredString(approved.resolvedAt, 'Wait resolution time')
      const rejected = await json(await resolveWait('reject'), 200, 'Reject resolved Wait')
      equal(rejected.action, 'approve', 'Winning action')
      equal(rejected.resolutionAccepted, false, 'Competing resolution')

      for (let attempt = 0; detail.status != 'completed' && attempt < 200; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        detail = await json(await request(harness, `/v1/runs/${runId}`), 200, 'Read resumed Run')
      }
      equal(detail.status, 'completed', 'Resumed Run status')
      equal(detail.waits, [], 'Completed Wait projection')
      const replay = await json(await resolveWait('approve'), 200, 'Replay approved Wait')
      equal(replay.resolutionAccepted, true, 'Replayed resolution')
      equal(replay.status, 'completed', 'Replayed terminal status')
      const completedEvents = await json(await request(harness, `/v1/runs/${runId}/events`), 200, 'Read resumed Run events')
      for (const event of list(completedEvents.events, 'Run events')) decodeRunEvent(event)
      equal(
        list(completedEvents.events, 'Completed events').filter((value) => record(value, 'Completed event').kind == 'run.resolved').length,
        1,
        'Resolved event count',
      )

      const canceled = await create('wait-run-cancel', 'Create cancelable Wait Run')
      const canceledRunId = requiredString(canceled.runId, 'Cancelable Wait Run id')
      let canceledDetail = canceled
      for (let attempt = 0; list(canceledDetail.waits, 'Waits').length == 0 && attempt < 200; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        canceledDetail = await json(await request(harness, `/v1/runs/${canceledRunId}`), 200, 'Read cancelable Wait Run')
      }
      equal(canceledDetail.status, 'running', 'Cancelable Wait status')
      equal(
        (
          await json(
            await request(harness, `/v1/runs/${canceledRunId}/cancel`, { body: JSON.stringify({ version: 1 }), method: 'POST' }),
            200,
            'Cancel waiting Run',
          )
        ).status,
        'canceled',
        'Canceled waiting Run status',
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
          body: JSON.stringify({ engineContract: contract, inputs: {}, trigger: { nodeId: 'start', outputs: {} }, version: 2 }),
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
    name: 'controls Live admission independently from publishing and Draft testing',
    async verify(harness) {
      const flow = await createFlow(harness, 'Enabled flow', 'enabled-flow')
      const flowId = requiredString(flow.flowId, 'Flow id')
      const revisionId = await addManualTrigger(harness, flowId, requiredString(flow.draftRevisionId, 'Draft id'))
      const change = (enabled: boolean, expectedPublicationId: string) =>
        request(harness, `/v1/flows/${flowId}/enabled`, {
          method: 'PUT',
          body: JSON.stringify({ enabled, expectedPublicationId, version: 1 }),
        })
      await error(await change(true, 'missing'), 409, 'flow.conflict', 'Cannot enable unpublished Flow')
      const first = await completePublish(harness, await publishRequest(harness, flowId, revisionId, null, 'enable-first'), 202, 'Publish')
      const publicationId = requiredString(first.publication.publicationId, 'Publication id')
      const disabled = await json(await change(false, publicationId), 200, 'Disable')
      equal(disabled.live, { enabled: false, publicationId, revisionId }, 'Disabled summary')
      const page = await json(await request(harness, '/v1/flows'), 200, 'List disabled Flow')
      equal(page.flows, [disabled], 'List includes Live state')
      equal((await json(await request(harness, `/v1/flows/${flowId}/live`), 200, 'Disabled Live')).status, 'suspended', 'Disabled Live status')
      await error(await liveRunRequest(harness, publicationId, 'disabled-run'), 412, 'live.conflict', 'Disabled Live rejects Run')
      await json(
        await request(harness, `/v1/flows/${flowId}/revisions/${revisionId}/runs`, {
          method: 'POST',
          headers: { 'idempotency-key': 'disabled-draft' },
          body: JSON.stringify({ engineContract, inputs: {}, trigger: { nodeId: 'start', outputs: {} }, version: 2 }),
        }),
        202,
        'Disabled Flow permits Draft test',
      )
      const next = await completePublish(harness, await publishRequest(harness, flowId, revisionId, publicationId, 'enable-next'), 202, 'Publish disabled Flow')
      const nextId = requiredString(next.publication.publicationId, 'Next Publication id')
      equal(
        record((await json(await request(harness, `/v1/flows/${flowId}`), 200, 'Read Flow')).live, 'Live').enabled,
        false,
        'Publish preserves disabled state',
      )
      await error(await change(true, publicationId), 409, 'flow.conflict', 'Stale switch rejects')
      await json(await change(true, nextId), 200, 'Enable')
      await json(await liveRunRequest(harness, nextId, 'enabled-run'), 202, 'Enabled Live accepts Run')
    },
  },

  {
    name: 'publishes one immutable Flow with idempotent Live CAS',
    async verify(harness) {
      const flow = await createFlow(harness, 'Publication flow', 'publication-flow')
      const flowId = requiredString(flow.flowId, 'Publication Flow flowId')
      const draftRevisionId = await addManualTrigger(harness, flowId, requiredString(flow.draftRevisionId, 'Publication Flow revisionId'))
      equal((await json(await request(harness, `/v1/flows/${flowId}/live`), 200, 'Read Live')).status, 'not-published', 'Initial Live status')
      const publish = () => publishRequest(harness, flowId, draftRevisionId, null, 'publication-first')
      const completed = await completePublish(harness, await publish(), 202, 'Publish Flow')
      const publication = completed.publication
      const publicationId = requiredString(publication.publicationId, 'Publication id')
      equal(await json(await publish(), 202, 'Replay Publish'), completed.operation, 'Replayed Publish operation')
      await error(await publishRequest(harness, flowId, draftRevisionId, publicationId, 'publication-first'), 409, 'publication.conflict', 'Conflicting replay')
      const live = await json(await request(harness, `/v1/flows/${flowId}/live`), 200, 'Read published Live')
      equal(live.publication, publication, 'Live Publication')
      const editor = await json(await request(harness, `/v1/flows/${flowId}/editor`), 200, 'Read published editor')
      equal(editor.live, live, 'Published editor Live projection')
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
      const firstRevisionId = await addManualTrigger(harness, flowId, requiredString(flow.draftRevisionId, 'Rollback Flow revisionId'))
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
      const api = client(harness)
      const history = await api.listPublications(flowId, { limit: 1, includeTotal: true })
      equal(history.total, 2, 'Publication total across pages')
      equal(
        history.publications.map((item) => item.publicationId),
        [secondPublicationId],
        'Newest Publication first',
      )
      const next = await api.listPublications(flowId, { limit: 1, cursor: requiredString(history.nextCursor, 'Publication cursor') })
      equal(
        next.publications.map((item) => item.publicationId),
        [firstPublicationId],
        'Publication continuation',
      )
      equal(next.nextCursor, undefined, 'End of Publication history')
      const other = await api.createFlow('Other history', 'other-history')
      await error(
        await request(harness, `/v1/flows/${encodeURIComponent(other.flowId)}/publications?cursor=${encodeURIComponent(history.nextCursor!)}`),
        400,
        'page.invalid-cursor',
        'Publication cursor belongs to one Flow',
      )
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
      const api = client(harness)
      await api.listTriggerKeys()
      const decoded = (await api.getTriggerCatalog('en')).data
      equal(decoded.definitions, catalog.definitions, 'Decoded Trigger definitions')
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
      for (const route of ['/v1/trigger-keys', '/v1/trigger-keys/catalog']) {
        for (const [locale, expected] of [
          ['en', 'en'],
          ['zh-Hant-HK', 'zh-TW'],
          ['de', 'en'],
        ]) {
          await revalidate(harness, `${route}?locale=${locale}`, expected)
          const response = await request(harness, `${route}?locale=${locale}`, { headers: { 'accept-language': 'ja' } })
          equal(response.headers.get('content-language'), expected, 'Explicit locale precedes language header')
        }
        const negotiated = await request(harness, route, { headers: { 'accept-language': 'ja' } })
        equal(negotiated.headers.get('content-language'), 'ja', 'Negotiated Trigger language')
        await error(await request(harness, `${route}?locale=bad_tag`), 400, 'flow.invalid', 'Invalid Trigger locale')
      }
      const english = await api.getTriggerCatalog('en')
      const translated = await api.getTriggerCatalog('zh-CN', english)
      equal(translated.data.locale, 'zh-CN', 'Localized catalog')
      equal(translated.data.definitions, english.data.definitions, 'Canonical definitions survive localization')
      if (translated.etag == english.etag) fail('Different catalog locales must not share an ETag.')
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
          {
            kind: 'graph.node.create',
            node: { bodyFields: [], kind: 'webhook', method: 'POST', name: 'Incoming' },
            nodeId: 'webhook',
            target: { kind: 'flow' },
          },
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
      const enable = (enabled: boolean) =>
        request(harness, `/v1/flows/${flowId}/enabled`, {
          method: 'PUT',
          body: JSON.stringify({ enabled, expectedPublicationId: publicationId, version: 1 }),
        })
      await json(await enable(false), 200, 'Disable Trigger Flow')
      equal((await harness.request(new Request(endpointUrl, { method: 'POST' }))).status, 404, 'Disabled Flow blocks callback')
      await json(await state('pause'), 200, 'Pause binding while Flow disabled')
      await json(await enable(true), 200, 'Enable Trigger Flow')
      equal((await harness.request(new Request(endpointUrl, { method: 'POST' }))).status, 404, 'Enabling preserves binding pause')
      await json(await state('resume'), 200, 'Resume binding after enabling Flow')
      equal((await harness.request(new Request(endpointUrl, { method: 'POST' }))).status, 200, 'Enabled Flow permits callback')

      const api = client(harness)
      const activities = await api.listFlowTriggerActivities(flowId, 'webhook')
      if (activities.activities.length < 2) fail('Webhook fixture must record callback activities.')
      const firstPage = await api.listFlowTriggerActivities(flowId, 'webhook', { limit: 1 })
      equal(firstPage.activities, activities.activities.slice(0, 1), 'First Trigger activity page')
      const cursor = requiredString(firstPage.nextCursor, 'Trigger activity cursor')
      const nextPage = await api.listFlowTriggerActivities(flowId, 'webhook', { cursor })
      equal(nextPage.activities, activities.activities.slice(1), 'Trigger activity continuation')
      await error(
        await request(harness, `${base}/cron/activities?cursor=${encodeURIComponent(cursor)}`),
        400,
        'page.invalid-cursor',
        'Activity cursor belongs to one Trigger',
      )

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
    name: 'projects implicit Connector access without writable binding state',
    async verify(harness) {
      const created = await createFlow(harness, 'Connector access', 'connector-access-create')
      const flowId = requiredString(created.flowId, 'Flow ID')
      const access = await json(await request(harness, `/v1/flows/${flowId}/connector-access`), 200, 'Read Connector access')
      equal(access.accessRevision, 0, 'Implicit Connector access revision')
      equal(access.bindings, [], 'Implicit Connector access bindings')
      equal(access.mode, 'implicit', 'Implicit Connector access mode')
      if (!requiredString(access.sharedAccessDigest, 'Implicit Connector access digest').startsWith('implicit')) {
        fail('Implicit Connector access digest must identify the implicit authority generation.')
      }
      equal(access.version, 1, 'Implicit Connector access version')
      equal(
        await json(
          await request(harness, `/v1/flows/${flowId}/connector-access/candidates/query`, {
            method: 'POST',
            body: JSON.stringify({ providerIds: ['mail', 'github'], version: 1 }),
          }),
          200,
          'Read Connector access candidates',
        ),
        { results: ['mail', 'github'].map((providerId) => ({ candidates: [], mode: 'implicit', providerId, version: 1 })), version: 1 },
        'Implicit Connector access candidates',
      )
      for (const providerIds of [[], ['mail', 'mail'], [''], ['x'.repeat(257)], [1]]) {
        await error(
          await request(harness, `/v1/flows/${flowId}/connector-access/candidates/query`, {
            method: 'POST',
            body: JSON.stringify({ providerIds, version: 1 }),
          }),
          409,
          'connector.access-invalid',
          'Invalid candidate provider query',
        )
      }
      for (const method of ['PUT', 'DELETE']) {
        await error(
          await request(harness, `/v1/flows/${flowId}/connector-access/mail/service`, {
            method,
            body: JSON.stringify({ expectedAccessRevision: 0, version: 1 }),
          }),
          409,
          'connector.access-unsupported',
          'Service selection requires selectable access',
        )
      }
      await error(
        await request(harness, `/v1/flows/${flowId}/connector-access/mail`, {
          body: JSON.stringify({ accessBindingId: 'editors', expectedAccessRevision: 0, version: 1 }),
          method: 'PUT',
        }),
        409,
        'connector.access-unsupported',
        'Set implicit Connector access',
      )
      await error(
        await request(harness, `/v1/flows/${flowId}/connector-access/mail`, {
          body: JSON.stringify({ accessBindingId: 'editors', expectedAccessRevision: 0, version: 1 }),
          method: 'DELETE',
        }),
        409,
        'connector.access-unsupported',
        'Clear implicit Connector access',
      )
    },
  },
  {
    name: 'projects the deployment Connector catalog and authorized Connections',
    async verify(harness) {
      const api = client(harness)
      const created = await api.createFlow('Connector discovery', 'connector-discovery')
      for (const flowId of [undefined, created.flowId]) {
        const providers = await api.listConnectorProviders(undefined, flowId)
        const actions = await api.listConnectorActions(undefined, undefined, flowId)
        if (providers.length == 0 || actions.length == 0) fail('Connector conformance deployment must expose a Provider and Action in both scopes.')
        const action = actions[0]!
        if (!providers.some((provider) => provider.serviceId == action.serviceId)) fail('Connector Action must refer to a listed Provider.')
        equal(await api.getConnectorAction(action.actionId, undefined, flowId), action, 'Connector Action detail')
        const filtered = await api.listConnectorActions(action.serviceId, undefined, flowId)
        equal(
          filtered,
          actions.filter((item) => item.serviceId == action.serviceId),
          'Connector service filter',
        )
        const searched = await api.searchConnectorActions(action.name, undefined, flowId)
        if (!searched.some((item) => item.actionId == action.actionId)) fail('Connector search must find the named Action.')
        const all = await api.listAllConnectorConnections(undefined, flowId)
        const connections = await api.listConnectorConnections(action.serviceId, undefined, flowId)
        equal(
          connections,
          all.filter((item) => item.serviceId == action.serviceId),
          'Scoped Connection views',
        )
        await api.createConnectorConnectionPage(action.serviceId, flowId)
        const scope = flowId == null ? '' : `flowId=${encodeURIComponent(flowId)}&`
        for (const path of [
          `providers?${scope}locale=en`,
          `actions?${scope}locale=en`,
          `actions?${scope}service=${encodeURIComponent(action.serviceId)}&locale=en`,
          `actions?${scope}q=${encodeURIComponent(action.name)}&locale=en`,
          `actions/${encodeURIComponent(action.actionId)}?${scope}locale=en`,
          `connections?${scope.slice(0, -1)}`,
          `connections/${encodeURIComponent(action.serviceId)}?${scope.slice(0, -1)}`,
        ])
          await revalidate(harness, `/v1/connector/${path}`, path.startsWith('providers') ? 'en' : undefined)
      }
      for (const path of ['providers', 'actions', 'actions/conformance.missing', 'connections', 'connections/mail']) {
        await error(await request(harness, `/v1/connector/${path}?flowId=conformance.missing`), 404, 'flow.not-found', 'Missing Connector scope')
      }
      await error(
        await request(harness, `/v1/connector/connections/mail/page?flowId=${encodeURIComponent(created.flowId)}&teamId=team`, {
          method: 'POST',
          body: JSON.stringify({ version: 1 }),
        }),
        400,
        'flow.invalid',
        'Conflicting Connection page scopes',
      )
    },
  },
  {
    name: 'lists all authorized Connector Connections with optional Flow scope',
    async verify(harness) {
      const flow = await createFlow(harness, 'Connector Connections', 'connector-connections-create')
      const flowId = requiredString(flow.flowId, 'Connector Connections Flow id')
      for (const scope of [undefined, flowId]) {
        const query = allConnectorConnectionsQuery(scope)
        query.decode(await json(await request(harness, query.path), 200, `List all Connector Connections (${scope ?? 'unscoped'})`))
      }
      await error(
        await request(harness, '/v1/connector/connections?flowId=conformance.missing'),
        404,
        'flow.not-found',
        'List all Connector Connections for missing Flow',
      )
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

export function selectableConnectorAccessControlApiConformanceCases(
  fixture: ProviderAccessIdentity & {
    readonly accessBindingId: string
    readonly connectionDisplayName: string
    readonly permissionGroupName: string | null
    readonly providerId: string
  },
): readonly ControlApiConformanceCase[] {
  return [
    {
      name: 'selects services independently and removes their access bindings atomically',
      async verify(harness) {
        const api = client(harness)
        const flow = await api.createFlow('Service selection', 'service-selection')
        const initial = await api.getConnectorAccess(flow.flowId)
        const added = await api.setConnectorService(flow.flowId, fixture.providerId, true, initial.accessRevision)
        equal(added.accessRevision, initial.accessRevision + 1, 'Service selection revision')
        equal(added.providerIds, [fixture.providerId], 'Selected services')
        equal(added.bindings, [], 'Adding a service grants no account access')
        equal(added.sharedAccessDigest, initial.sharedAccessDigest, 'Service-only edits preserve authority digest')
        equal(await api.getConnectorAccess(flow.flowId), added, 'Service selection is persisted')
        const selected = await api.addProviderAccessBinding(flow.flowId, fixture.providerId, fixture.accessBindingId, added.accessRevision)
        const path = `/v1/flows/${encodeURIComponent(flow.flowId)}/connector-access/${encodeURIComponent(fixture.providerId)}/service`
        for (const method of ['PUT', 'DELETE']) {
          await error(
            await request(harness, path, { method, body: JSON.stringify({ version: 1, expectedAccessRevision: initial.accessRevision }) }),
            412,
            'connector.access-conflict',
            'Stale service selection',
          )
        }
        equal(await api.getConnectorAccess(flow.flowId), selected, 'Stale edits preserve service access')
        const removed = await api.setConnectorService(flow.flowId, fixture.providerId, false, selected.accessRevision)
        equal(removed.accessRevision, selected.accessRevision + 1, 'Service removal revision')
        equal(removed.providerIds, [], 'Service removed')
        equal(removed.bindings, [], 'Removing service revokes all its bindings')
        if (removed.sharedAccessDigest == selected.sharedAccessDigest) fail('Removing bound access must change the authority digest.')
        equal(await api.getConnectorAccess(flow.flowId), removed, 'Removed service remains removed')
      },
    },
    {
      name: 'selects Provider access with optimistic concurrency',
      async verify(harness) {
        const created = await createFlow(harness, 'Selectable Connector access', 'selectable-connector-access-create')
        const flowId = requiredString(created.flowId, 'Flow ID')
        const path = `/v1/flows/${flowId}/connector-access/${encodeURIComponent(fixture.providerId)}`
        const initial = await json(await request(harness, `/v1/flows/${flowId}/connector-access`), 200, 'Read selectable Connector access')
        equal(initial.mode, 'selectable', 'Selectable Connector access mode')
        equal(initial.accessRevision, 0, 'Initial selectable Connector access revision')
        const batch = await json(
          await request(harness, `/v1/flows/${flowId}/connector-access/candidates/query`, {
            method: 'POST',
            body: JSON.stringify({ providerIds: [fixture.providerId], version: 1 }),
          }),
          200,
          'Read Provider access candidates',
        )
        const candidates = record(list(batch.results, 'Provider candidate results')[0], 'Provider candidates')
        equal(candidates.mode, 'selectable', 'Provider access candidate mode')
        equal(candidates.providerId, fixture.providerId, 'Provider access candidate Provider')
        const candidate = list(candidates.candidates, 'Provider access candidates').find(
          (value) => record(value, 'Provider access candidate').accessBindingId == fixture.accessBindingId,
        )
        if (candidate == null) fail('Expected selectable Provider access candidate was not returned.')
        equal(record(candidate, 'Provider access candidate').connectionId, fixture.connectionId, 'Provider access candidate Connection ID')
        equal(record(candidate, 'Provider access candidate').source, fixture.source, 'Provider access candidate source')
        equal(
          record(candidate, 'Provider access candidate').connectionDisplayName,
          fixture.connectionDisplayName,
          'Provider access candidate connection display name',
        )
        equal(
          record(candidate, 'Provider access candidate').permissionGroupName,
          fixture.permissionGroupName,
          'Provider access candidate permission group name',
        )

        const selected = await json(
          await request(harness, path, {
            body: JSON.stringify({ accessBindingId: fixture.accessBindingId, expectedAccessRevision: 0, version: 1 }),
            method: 'PUT',
          }),
          200,
          'Select Provider access',
        )
        equal(selected.accessRevision, 1, 'Selected Connector access revision')
        equal(selected.mode, 'selectable', 'Selected Connector access mode')
        const binding = list(selected.bindings, 'Selected Connector access bindings').find(
          (value) => record(value, 'Selected Connector access binding').providerId == fixture.providerId,
        )
        if (binding == null) fail('Selected Provider access binding was not projected.')
        equal(record(binding, 'Selected Connector access binding').connectionId, fixture.connectionId, 'Selected Connector access binding Connection ID')
        equal(record(binding, 'Selected Connector access binding').source, fixture.source, 'Selected Connector access binding source')
        equal(record(binding, 'Selected Connector access binding').accessBindingId, fixture.accessBindingId, 'Selected Provider access binding ID')
        equal(
          record(binding, 'Selected Connector access binding').connectionDisplayName,
          fixture.connectionDisplayName,
          'Selected Provider access binding connection display name',
        )
        equal(
          record(binding, 'Selected Connector access binding').permissionGroupName,
          fixture.permissionGroupName,
          'Selected Provider access binding permission group name',
        )
        const selectedDigest = requiredString(selected.sharedAccessDigest, 'Selected Connector access digest')

        const revisionId = await addManualTrigger(harness, flowId, requiredString(created.draftRevisionId, 'Draft Revision ID'))
        const draftRun = await json(
          await request(harness, `/v1/flows/${flowId}/revisions/${revisionId}/runs`, {
            body: JSON.stringify({ engineContract, inputs: {}, trigger: { nodeId: 'start', outputs: {} }, version: 2 }),
            headers: { 'idempotency-key': 'selectable-connector-access-draft-run' },
            method: 'POST',
          }),
          202,
          'Admit Draft Run with selected Provider access',
        )
        equal(draftRun.sharedAccessDigest, selectedDigest, 'Draft Run Provider access snapshot')

        const published = await completePublish(
          harness,
          await publishRequest(harness, flowId, revisionId, null, 'selectable-connector-access-publish'),
          202,
          'Publish selected Provider access',
        )
        equal(published.publication.sharedAccessDigest, selectedDigest, 'Publication Provider access snapshot')

        await error(
          await request(harness, path, {
            body: JSON.stringify({ accessBindingId: fixture.accessBindingId, expectedAccessRevision: 0, version: 1 }),
            method: 'PUT',
          }),
          412,
          'connector.access-conflict',
          'Overwrite Provider access with a stale revision',
        )

        const cleared = await json(
          await request(harness, path, {
            body: JSON.stringify({ accessBindingId: fixture.accessBindingId, expectedAccessRevision: 1, version: 1 }),
            method: 'DELETE',
          }),
          200,
          'Clear Provider access',
        )
        equal(cleared.accessRevision, 2, 'Cleared Connector access revision')
        equal(cleared.bindings, [], 'Cleared Connector access bindings')
        const live = await json(await request(harness, `/v1/flows/${flowId}/live`), 200, 'Read Live after clearing Provider access')
        equal(live.hasUnpublishedChanges, true, 'Cleared Draft access marks Live as unpublished')
        const publicationId = requiredString(published.publication.publicationId, 'Publication ID')
        const liveRun = await json(
          await liveRunRequest(harness, publicationId, 'selectable-connector-access-live-run'),
          202,
          'Admit Live Run after clearing Draft access',
        )
        equal(liveRun.sharedAccessDigest, selectedDigest, 'Live Run preserves Publication Provider access snapshot')
      },
    },
  ]
}

export const controlRecoveryConformanceCases: readonly {
  readonly name: string
  verify(harness: ControlApiConformanceHarness & { restart(): Promise<void> }): Promise<void>
}[] = [
  {
    name: 'preserves committed mutations and idempotency receipts after restart',
    async verify(harness) {
      const created = await createFlow(harness, 'Recovery', 'recovery-create')
      const flowId = requiredString(created.flowId, 'Flow ID')
      const revisionId = requiredString(created.draftRevisionId, 'Revision ID')
      const changed = await json(await addValueNode(harness, flowId, revisionId, 'marker', 'recovery-change'), 200, 'Commit change')
      await harness.restart()
      equal(
        (await json(await createFlowRequest(harness, 'Recovery', 'recovery-create'), 200, 'Replay creation after restart')).flowId,
        flowId,
        'Durable creation identity',
      )
      equal(
        await json(await addValueNode(harness, flowId, revisionId, 'marker', 'recovery-change'), 200, 'Replay change after restart'),
        changed,
        'Durable change receipt',
      )
      const draft = await json(await request(harness, `/v1/flows/${flowId}/draft`), 200, 'Recovered Draft')
      equal(draft.revisionId, record(changed.revision, 'Revision').revisionId, 'Recovered head')
    },
  },
]

export function eventSourceControlApiConformanceCases(fixture: {
  readonly connection: ConnectorConnection
  readonly teamId: string | null
  readonly connectionPageUrl: string
}): readonly ControlApiConformanceCase[] {
  return [
    {
      name: 'manages event sources with scoped Connections, redacted credentials and revision conflicts',
      async verify(harness) {
        const api = client(harness)
        const connections = await api.listEventSourceConnections(fixture.teamId)
        if (!connections.some((item) => item.connectionId == fixture.connection.connectionId)) fail('Event source fixture Connection is missing.')
        const input: CreateEventSource = {
          version: 1,
          name: 'Conformance event source',
          connectionId: fixture.connection.connectionId,
          teamId: fixture.teamId,
          verificationToken: 'conformance-verification-secret',
          encryptKey: 'conformance-encryption-secret',
          eventTypes: ['im.message.receive_v1'],
          manageSubscriptions: false,
        }
        const source = await api.createEventSource(input)
        equal(source.appId, fixture.connection.providerAccountId, 'Verified application identity')
        equal(source.teamId, fixture.teamId, 'Event source Team')
        equal(source.connectionId, input.connectionId, 'Event source Connection')
        equal(source.verificationTokenConfigured, true, 'Verification token configured')
        equal(source.encryptKeyConfigured, true, 'Encryption key configured')
        const listed = await api.listEventSources()
        equal(
          listed.sources.find((item) => item.sourceId == source.sourceId),
          source,
          'Created event source is listed',
        )
        if (JSON.stringify(listed).includes(input.verificationToken) || JSON.stringify(listed).includes(input.encryptKey))
          fail('Event source credentials leaked.')
        const flow = await api.createFlow('Event source scope', 'event-source-scope')
        const scoped = await api.listEventSources(flow.flowId)
        if (!Object.hasOwn(scoped, 'teamId')) fail('Flow-scoped event sources must return their Team identity.')
        if (scoped.sources.some((item) => item.teamId != scoped.teamId)) fail('Event sources crossed Flow Team scope.')
        equal(
          scoped.sources.some((item) => item.sourceId == source.sourceId),
          scoped.teamId == fixture.teamId,
          'Event source visibility follows Flow Team',
        )
        await error(await request(harness, '/v1/event-sources?flowId=conformance.missing'), 404, 'flow.not-found', 'Missing event source Flow')
        const path = `/v1/event-sources/${encodeURIComponent(source.sourceId)}`
        const update = { version: 1 as const, expectedRevision: source.revision, name: 'Renamed source', enabled: false, eventTypes: ['approval_instance'] }
        const updated = await api.updateEventSource(source.sourceId, update)
        equal(updated.revision, source.revision + 1, 'Event source revision advances')
        equal(updated.name, update.name, 'Event source rename')
        equal(updated.enabled, false, 'Event source disabled')
        equal(updated.eventTypes, update.eventTypes, 'Event source filters')
        for (const method of ['PUT', 'DELETE']) {
          await error(
            await request(harness, path, { method, body: JSON.stringify(method == 'PUT' ? update : { version: 1, expectedRevision: source.revision }) }),
            409,
            'event-source.conflict',
            'Stale event source revision',
          )
        }
        equal(
          (await api.listEventSources()).sources.find((item) => item.sourceId == source.sourceId),
          updated,
          'Conflicts preserve source',
        )
        await error(
          await request(harness, '/v1/event-sources', { method: 'POST', body: JSON.stringify({ ...input, appId: 'cli_forged' }) }),
          400,
          'event-source.invalid',
          'Reject client-supplied application identity',
        )
        await error(
          await request(harness, path, { method: 'PUT', body: JSON.stringify({ ...update, expectedRevision: updated.revision, eventTypes: [] }) }),
          400,
          'event-source.invalid',
          'Reject empty event filters',
        )
        await api.deleteEventSource(source.sourceId, updated.revision)
        if ((await api.listEventSources()).sources.some((item) => item.sourceId == source.sourceId)) fail('Deleted event source remains listed.')
        for (const method of ['PUT', 'DELETE']) {
          await error(
            await request(harness, path, { method, body: JSON.stringify(method == 'PUT' ? update : { version: 1, expectedRevision: updated.revision }) }),
            404,
            'event-source.not-found',
            'Missing event source',
          )
        }
        equal(
          await api.createConnectorConnectionPage(fixture.connection.serviceId, undefined, fixture.teamId ?? undefined),
          fixture.connectionPageUrl,
          'Connection page uses the selected Team',
        )
      },
    },
  ]
}

export function runResultControlApiConformanceCases(fixture: {
  readonly runId: string
  readonly otherRunId: string
  readonly results: readonly ResultInfo[]
  readonly resultId: string
  readonly value: { readonly rows: readonly number[] }
}): readonly ControlApiConformanceCase[] {
  return [
    {
      name: 'pages and downloads stored tool results within their owning Run',
      async verify(harness) {
        if (fixture.results.length != 51 || fixture.value.rows.length < 2) fail('Result fixture needs 51 results and at least two rows.')
        const api = client(harness)
        const expected = fixture.results.toSorted((a, b) => (a.resultId < b.resultId ? -1 : a.resultId > b.resultId ? 1 : 0))
        const first = await api.listRunResults(fixture.runId)
        equal(first.runId, fixture.runId, 'Result list Run')
        equal(first.results, expected.slice(0, 50), 'Result page order and size')
        const after = requiredString(first.nextAfter, 'Result continuation')
        equal(after, expected[49]!.resultId, 'Result cursor')
        const second = await api.listRunResults(fixture.runId, after)
        equal(second.results, expected.slice(50), 'Result continuation excludes cursor')
        equal(second.nextAfter, undefined, 'Result end of list')
        equal((await api.listRunResults(fixture.otherRunId)).results, [], 'Other Run has no results')
        const full = await api.readRunResult(fixture.runId, fixture.resultId)
        equal(full.runId, fixture.runId, 'Result read Run')
        equal(
          full.result,
          expected.find((item) => item.resultId == fixture.resultId),
          'Result metadata',
        )
        equal(full.page.value, fixture.value, 'Complete result')
        const page = await api.readRunResult(fixture.runId, fixture.resultId, { pointer: '/rows', limit: 1, maxBytes: 1000 })
        equal(
          page.page.entries?.map((entry) => entry.value),
          fixture.value.rows.slice(0, 1),
          'Result member page',
        )
        equal(page.page.nextOffset, 1, 'Result member continuation')
        const next = await api.readRunResult(fixture.runId, fixture.resultId, { pointer: '/rows', offset: 1, limit: 1, maxBytes: 1000 })
        equal(
          next.page.entries?.map((entry) => entry.value),
          fixture.value.rows.slice(1, 2),
          'Next result member',
        )
        if (new TextEncoder().encode(JSON.stringify(page.page)).byteLength > 1000) fail('Result page exceeds byte budget.')
        const path = `/v1/runs/${encodeURIComponent(fixture.runId)}/results/${encodeURIComponent(fixture.resultId)}`
        const content = await request(harness, `${path}/content`)
        equal(content.status, 200, 'Result download status')
        equal(content.headers.get('content-type')?.split(';')[0], 'application/json', 'Result download type')
        equal(content.headers.get('cache-control'), 'no-store', 'Result download cache policy')
        if (!content.headers.get('content-disposition')?.startsWith('attachment;')) fail('Result download must be an attachment.')
        const bytes = new Uint8Array(await content.arrayBuffer())
        equal(bytes.byteLength, full.result.bytes, 'Result download byte count')
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
        equal(digest, full.result.digest, 'Result download digest')
        equal(JSON.parse(new TextDecoder().decode(bytes)), fixture.value, 'Result download content')
        for (const query of ['pointer=invalid', 'offset=-1', 'limit=0', 'maxBytes=0', 'pointer=%2Frows&offset=999']) {
          await error(await request(harness, `${path}?${query}`), 400, 'run.invalid', 'Invalid result page')
        }
        for (const suffix of ['', '/content']) {
          await error(
            await request(harness, `/v1/runs/${encodeURIComponent(fixture.otherRunId)}/results/${encodeURIComponent(fixture.resultId)}${suffix}`),
            404,
            'flow.not-found',
            'Result cannot cross Run boundary',
          )
        }
      },
    },
  ]
}

export function pollControlApiConformanceCases(fixture: {
  readonly definition: TriggerKeySnapshot & { readonly type: 'poll' }
  readonly connectionId: string
  readonly config: Readonly<Record<string, JsonValue>>
  readonly field: string
  readonly options: readonly TriggerConfigOption[]
  readonly preview: PollTriggerTestResult
}): readonly ControlApiConformanceCase[] {
  return [
    {
      name: 'reads Trigger options and previews a Poll without creating Runs or changing Live state',
      async verify(harness) {
        const api = client(harness)
        const flow = await api.createFlow('Poll controls', 'poll-controls')
        const changed = await json(
          await changeRequest(harness, flow.flowId, flow.draftRevisionId, [
            {
              kind: 'graph.node.create',
              nodeId: 'poll',
              target: { kind: 'flow' },
              node: {
                kind: 'poll',
                name: 'Poll',
                connectionId: fixture.connectionId,
                definition: fixture.definition,
                config: Object.fromEntries(Object.entries(fixture.config).map(([key, value]) => [key, { kind: 'value', value }])),
                pollTimes: [{ type: 'every', unit: 'minute', value: 5 }],
              },
            },
          ]),
          200,
          'Create Poll',
        )
        const draft = await api.getDraft(flow.flowId)
        equal(await api.listTriggerConfigOptions(flow.flowId, 'poll', fixture.field), fixture.options, 'Dynamic Trigger options')
        equal(await api.getDraft(flow.flowId), draft, 'Reading options preserves Draft')
        equal((await api.listFlowTriggerBindings(flow.flowId)).length, 0, 'Reading options does not create Live binding')
        await completePublish(
          harness,
          await publishRequest(harness, flow.flowId, changedRevisionId(changed, 'Poll Revision'), null, 'poll-publish'),
          202,
          'Publish Poll',
        )
        const before = await api.getFlowTriggerBinding(flow.flowId, 'poll')
        equal(await api.testFlowPollTrigger(flow.flowId, 'poll'), fixture.preview, 'Poll preview response')
        equal(await api.testFlowPollTrigger(flow.flowId, 'poll'), fixture.preview, 'Preview does not consume events')
        equal(await api.getFlowTriggerBinding(flow.flowId, 'poll'), before, 'Preview preserves Live binding')
        equal((await api.listRuns(flow.flowId)).runs, [], 'Options and preview do not admit Runs')
        const base = `/v1/flows/${encodeURIComponent(flow.flowId)}/triggers`
        await error(await request(harness, `${base}/poll/options/conformance.missing`), 409, 'trigger-key.invalid', 'Unknown option field')
        await error(
          await request(harness, `${base}/missing/test`, { method: 'POST', body: JSON.stringify({ version: 1 }) }),
          404,
          'trigger.not-found',
          'Missing Poll binding',
        )
      },
    },
  ]
}

export function connectorScopeControlApiConformanceCases(fixture: {
  readonly scopes: readonly [
    { readonly flowId: string; readonly connections: readonly ConnectorConnection[] },
    { readonly flowId: string; readonly connections: readonly ConnectorConnection[] },
  ]
}): readonly ControlApiConformanceCase[] {
  return [
    {
      name: 'isolates Connector Connections and conditional responses between Flows',
      async verify(harness) {
        const [first, second] = fixture.scopes
        if (dequal(first.connections, second.connections)) fail('Scope fixture must expose distinct Connection lists.')
        const api = client(harness)
        const services = new Set(fixture.scopes.flatMap((scope) => scope.connections.map((connection) => connection.serviceId)))
        let previousETag: string | undefined
        for (const scope of fixture.scopes) {
          equal(await api.listAllConnectorConnections(undefined, scope.flowId), scope.connections, 'Flow Connection authority')
          for (const service of services) {
            equal(
              await api.listConnectorConnections(service, undefined, scope.flowId),
              scope.connections.filter((connection) => connection.serviceId == service),
              'Service Connection authority',
            )
          }
          const path = `/v1/connector/connections?flowId=${encodeURIComponent(scope.flowId)}`
          const response = await request(harness, path, { headers: previousETag == null ? {} : { 'if-none-match': previousETag } })
          equal(response.status, 200, 'Another Flow cannot reuse a different Connection representation')
          previousETag = requiredString(response.headers.get('etag'), 'Scoped Connection ETag')
          await revalidate(harness, path)
        }
      },
    },
  ]
}

export function draftRepairControlApiConformanceCases(fixture: {
  readonly flowId: string
  readonly revisionId: string
  readonly content: RevisionContent
}): readonly ControlApiConformanceCase[] {
  return [
    {
      name: 'repairs an unreadable Draft into the expected readable child Revision',
      async verify(harness) {
        const api = client(harness)
        const presentation = await api.getPresentation(fixture.flowId)
        const changed = await api.repairDraft(fixture.flowId, fixture.revisionId, 'repair-unreadable')
        equal(changed.revision.parentRevisionId, fixture.revisionId, 'Unreadable repair parent')
        const editor = await api.getEditor(fixture.flowId)
        equal(editor.draft.revisionId, changed.revision.revisionId, 'Repaired editor Revision')
        equal(editor.draft.content, fixture.content, 'Repaired content retains readable entries')
        equal(editor.presentation, presentation, 'Repair preserves layout')
        equal(await api.repairDraft(fixture.flowId, fixture.revisionId, 'repair-unreadable'), changed, 'Unreadable repair replay')
      },
    },
  ]
}
