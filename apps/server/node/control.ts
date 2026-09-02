import type { ChangeOperation, JsonValue, WaitAction } from '@oomol-lab/open-flow/flow-change'
import type { RunStatus } from '@oomol-lab/open-flow/run-lifecycle'
import type { FlowRunOptions } from '@oomol-lab/open-flow/scheduler'
import type { Context, Next } from 'hono'
import type { ControlService, FlowPosition, PublicationPosition, RunPosition, TriggerActivityPosition } from './control-service.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { resourceNameIssue, validVariableName } from '@oomol-lab/open-flow/flow-change'
import { runStatuses } from '@oomol-lab/open-flow/run-lifecycle'
import { Hono } from 'hono'
import { ControlError } from './error.ts'

export type ResolveControlActor = (request: Request) => Promise<string | undefined> | string | undefined

type Environment = { Variables: { actorId: string } }
type InvalidCode =
  | typeof controlErrorCode.flowInvalid
  | typeof controlErrorCode.pageInvalidCursor
  | typeof controlErrorCode.runInvalid
  | typeof controlErrorCode.variableInvalid
type RunInputs = NonNullable<FlowRunOptions['inputs']>

const maxRequestBytes = 5 * 1024 * 1024
const maxIdempotencyKeyLength = 256
const maxPageSize = 100
const defaultPageSize = 50
const runStatusSet: ReadonlySet<string> = new Set(runStatuses)
const encoder = new TextEncoder()

export function createControlApp(service: ControlService, resolveActor?: ResolveControlActor): Hono<Environment> {
  const app = new Hono<Environment>()
  const authenticate = async (context: Context<Environment>, next: Next): Promise<void> => {
    const actorId = await resolveActor?.(context.req.raw)
    if (actorId == null || actorId.length == 0) throw new ControlError(controlErrorCode.authenticationRequired, 'Authentication is required.')
    context.set('actorId', actorId)
    await next()
  }
  for (const route of ['/connector/*', '/flows', '/flows/*', '/runs', '/runs/*', '/trigger-keys', '/trigger-keys/*', '/variables', '/variables/*']) {
    app.use(route, authenticate)
  }

  app.get('/variables', (context) => {
    query(context.req.raw, [], controlErrorCode.variableInvalid)
    return response(200, service.listVariables())
  })
  app.get('/variables/:name', (context) => {
    query(context.req.raw, [], controlErrorCode.variableInvalid)
    return response(200, service.getVariable(variableName(context.req.param('name'))))
  })
  app.put('/variables/:name', async (context) => {
    query(context.req.raw, [], controlErrorCode.variableInvalid)
    const body = await requestObject(context.req.raw, controlErrorCode.variableInvalid)
    exact(body, ['value'], controlErrorCode.variableInvalid)
    return response(200, service.putVariable(variableName(context.req.param('name')), variableValue(body.value)))
  })
  app.delete('/variables/:name', (context) => {
    query(context.req.raw, [], controlErrorCode.variableInvalid)
    service.deleteVariable(variableName(context.req.param('name')))
    return response(200, { version: 1 })
  })

  app.get('/trigger-keys', (context) => {
    query(context.req.raw, [], controlErrorCode.flowInvalid)
    return response(200, { keys: service.listTriggerKeys(), version: 1 })
  })
  app.get('/trigger-keys/catalog', (context) => {
    query(context.req.raw, [], controlErrorCode.flowInvalid)
    return response(200, { definitions: service.listTriggerDefinitions(), version: 1 })
  })
  app.get('/trigger-keys/:key', (context) => {
    query(context.req.raw, [], controlErrorCode.flowInvalid)
    return response(200, { definition: service.getTriggerKey(context.req.param('key')), version: 1 })
  })

  app.get('/flows', (context) => {
    const parameters = query(context.req.raw, ['cursor', 'includeTotal', 'limit'], controlErrorCode.flowInvalid)
    const limit = pageSize(parameters)
    const cursor = parameters.get('cursor')
    const after = cursor == null ? undefined : decodeFlowCursor(cursor)
    const { next, page } = service.listFlows(limit, after, optionalBoolean(parameters.get('includeTotal'), controlErrorCode.flowInvalid))
    return response(200, { ...page, ...(next == null ? {} : { nextCursor: encodeCursor('flows', next) }) })
  })
  app.post('/flows', async (context) => {
    query(context.req.raw, [], controlErrorCode.flowInvalid)
    const body = await requestObject(context.req.raw, controlErrorCode.flowInvalid)
    exact(body, ['name', 'version'], controlErrorCode.flowInvalid)
    version(body.version, controlErrorCode.flowInvalid)
    const name = resourceName(body.name)
    const created = await service.createFlow(context.get('actorId'), name, idempotencyKey(context.req.raw, controlErrorCode.flowInvalid))
    return response(created.created ? 201 : 200, created.flow)
  })
  app.get('/flows/:flowId', (context) => {
    query(context.req.raw, [], controlErrorCode.flowInvalid)
    return response(200, service.getFlow(context.req.param('flowId')))
  })
  app.patch('/flows/:flowId', async (context) => {
    query(context.req.raw, [], controlErrorCode.flowInvalid)
    const body = await requestObject(context.req.raw, controlErrorCode.flowInvalid)
    exact(body, ['name', 'version'], controlErrorCode.flowInvalid)
    version(body.version, controlErrorCode.flowInvalid)
    return response(200, service.renameFlow(context.req.param('flowId'), resourceName(body.name)))
  })
  app.delete('/flows/:flowId', (context) => {
    query(context.req.raw, [], controlErrorCode.flowInvalid)
    return response(202, service.retireFlow(context.req.param('flowId')))
  })

  app.get('/flows/:flowId/draft', (context) => response(200, service.getDraft(context.req.param('flowId'))))
  app.get('/flows/:flowId/draft/sync', (context) => {
    query(context.req.raw, [], controlErrorCode.flowInvalid)
    return response(200, service.syncDraft(context.req.param('flowId')))
  })
  app.post('/flows/:flowId/draft/changes', async (context) => {
    query(context.req.raw, [], controlErrorCode.flowInvalid)
    const body = await requestObject(context.req.raw, controlErrorCode.flowInvalid)
    exact(body, ['expectedRevisionId', 'operations', 'version'], controlErrorCode.flowInvalid)
    version(body.version, controlErrorCode.flowInvalid)
    if (!Array.isArray(body.operations) || body.operations.length == 0) invalid(controlErrorCode.flowInvalid, 'Draft operations must be a non-empty array.')
    for (const operation of body.operations) {
      if (typeof record(operation, controlErrorCode.flowInvalid).kind != 'string') invalid(controlErrorCode.flowInvalid, 'Draft operation kind is invalid.')
    }
    return response(
      200,
      await service.changeDraft(
        context.get('actorId'),
        context.req.param('flowId'),
        text(body.expectedRevisionId, controlErrorCode.flowInvalid),
        body.operations as readonly ChangeOperation[],
        idempotencyKey(context.req.raw, controlErrorCode.flowInvalid),
      ),
    )
  })
  app.get('/flows/:flowId/revisions/:revisionId', (context) => response(200, service.getRevision(context.req.param('flowId'), context.req.param('revisionId'))))

  app.get('/connector/providers', async (context) => {
    const flowId = query(context.req.raw, ['flowId'], controlErrorCode.flowInvalid).get('flowId')
    return response(200, {
      providers: await service.listConnectorProviders(flowId == null ? undefined : text(flowId, controlErrorCode.flowInvalid)),
      version: 1,
    })
  })
  app.get('/connector/actions', async (context) => {
    const parameters = query(context.req.raw, ['flowId', 'q', 'service'], controlErrorCode.flowInvalid)
    const flowId = parameters.get('flowId')
    const queryValue = parameters.get('q')?.trim()
    const serviceId = parameters.get('service')?.trim()
    if (queryValue != null && serviceId != null) invalid(controlErrorCode.flowInvalid, 'Connector Action query is invalid.')
    if (queryValue != null && (queryValue.length == 0 || queryValue.length > 256)) invalid(controlErrorCode.flowInvalid, 'Connector Action query is invalid.')
    if (serviceId != null && (serviceId.length == 0 || serviceId.length > 256)) invalid(controlErrorCode.flowInvalid, 'Connector service is invalid.')
    const scope = flowId == null ? undefined : text(flowId, controlErrorCode.flowInvalid)
    const actions = queryValue == null ? await service.listConnectorActions(serviceId, scope) : await service.searchConnectorActions(queryValue, scope)
    return response(200, { actions, version: 1 })
  })
  app.get('/connector/actions/:actionId', async (context) => {
    const flowId = query(context.req.raw, ['flowId'], controlErrorCode.flowInvalid).get('flowId')
    return response(200, {
      action: await service.getConnectorAction(
        text(context.req.param('actionId'), controlErrorCode.flowInvalid),
        flowId == null ? undefined : text(flowId, controlErrorCode.flowInvalid),
      ),
      version: 1,
    })
  })
  app.get('/connector/connections/:serviceId', async (context) => {
    const flowId = query(context.req.raw, ['flowId'], controlErrorCode.flowInvalid).get('flowId')
    const serviceId = connectorService(context.req.param('serviceId'))
    return response(200, {
      connections: await service.listConnectorConnections(serviceId, flowId == null ? undefined : text(flowId, controlErrorCode.flowInvalid)),
      serviceId,
      version: 1,
    })
  })
  app.post('/connector/connections/:serviceId/page', async (context) => {
    const flowId = query(context.req.raw, ['flowId'], controlErrorCode.flowInvalid).get('flowId')
    const body = await requestObject(context.req.raw, controlErrorCode.flowInvalid)
    exact(body, ['version'], controlErrorCode.flowInvalid)
    version(body.version, controlErrorCode.flowInvalid)
    return response(200, {
      url: service.connectorConnectionPage(
        connectorService(context.req.param('serviceId')),
        flowId == null ? undefined : text(flowId, controlErrorCode.flowInvalid),
      ),
      version: 1,
    })
  })

  app.get('/flows/:flowId/live', async (context) => response(200, await service.getLive(context.req.param('flowId'))))
  app.get('/flows/:flowId/triggers', (context) => {
    const flowId = context.req.param('flowId')
    return response(200, { bindings: service.listFlowTriggerBindings(flowId), flowId, version: 1 })
  })
  app.get('/flows/:flowId/triggers/:triggerNodeId', (context) =>
    response(200, {
      binding: service.getFlowTriggerBinding(context.req.param('flowId'), context.req.param('triggerNodeId'), new URL(context.req.url).origin),
      version: 1,
    }),
  )
  app.get('/flows/:flowId/triggers/:triggerNodeId/activities', (context) => {
    const parameters = query(context.req.raw, ['cursor', 'limit'], controlErrorCode.flowInvalid)
    const flowId = context.req.param('flowId')
    const triggerNodeId = context.req.param('triggerNodeId')
    const cursor = parameters.get('cursor')
    const after = cursor == null ? undefined : decodeTriggerActivityCursor(cursor, flowId, triggerNodeId)
    const { next, page } = service.listFlowTriggerActivities(flowId, triggerNodeId, pageSize(parameters), after)
    return response(200, { ...page, ...(next == null ? {} : { nextCursor: encodeTriggerActivityCursor(flowId, triggerNodeId, next) }) })
  })
  app.post('/flows/:flowId/triggers/:triggerNodeId/pause', async (context) => {
    await versionOnly(context.req.raw, controlErrorCode.flowInvalid)
    return response(200, service.changeFlowTriggerState(context.req.param('flowId'), context.req.param('triggerNodeId'), 'paused'))
  })
  app.post('/flows/:flowId/triggers/:triggerNodeId/resume', async (context) => {
    await versionOnly(context.req.raw, controlErrorCode.flowInvalid)
    return response(200, service.changeFlowTriggerState(context.req.param('flowId'), context.req.param('triggerNodeId'), 'active'))
  })
  app.post('/flows/:flowId/triggers/:triggerNodeId/test', async (context) => {
    await versionOnly(context.req.raw, controlErrorCode.flowInvalid)
    return response(200, await service.testFlowPollTrigger(context.req.param('flowId'), context.req.param('triggerNodeId')))
  })

  app.get('/flows/:flowId/publications', (context) => {
    const parameters = query(context.req.raw, ['cursor', 'includeTotal', 'limit'], controlErrorCode.flowInvalid)
    const flowId = context.req.param('flowId')
    const cursor = parameters.get('cursor')
    const after = cursor == null ? undefined : decodePublicationCursor(cursor, flowId)
    const { next, page } = service.listPublications(
      flowId,
      pageSize(parameters),
      after,
      optionalBoolean(parameters.get('includeTotal'), controlErrorCode.flowInvalid),
    )
    return response(200, { ...page, ...(next == null ? {} : { nextCursor: encodePublicationCursor(flowId, next) }) })
  })
  app.get('/flows/:flowId/publish-operations/:operationId', (context) =>
    response(200, service.getPublishOperation(context.req.param('flowId'), context.req.param('operationId'))),
  )
  app.get('/flows/:flowId/presentation', (context) => response(200, service.getPresentation(context.req.param('flowId'))))
  app.put('/flows/:flowId/presentation', async (context) => {
    const body = await requestObject(context.req.raw, controlErrorCode.flowInvalid)
    exact(body, ['expectedRevision', 'value', 'version'], controlErrorCode.flowInvalid)
    version(body.version, controlErrorCode.flowInvalid)
    return response(
      200,
      service.updatePresentation(
        context.req.param('flowId'),
        positiveInteger(body.expectedRevision, controlErrorCode.flowInvalid),
        record(body.value, controlErrorCode.flowInvalid) as Readonly<Record<string, JsonValue>>,
      ),
    )
  })
  app.post('/flows/:flowId/revisions/:revisionId/check', async (context) => {
    const body = await requestObject(context.req.raw, controlErrorCode.flowInvalid)
    exact(body, ['engineContract', 'version'], controlErrorCode.flowInvalid)
    version(body.version, controlErrorCode.flowInvalid)
    return response(
      200,
      await service.checkFlow(context.req.param('flowId'), context.req.param('revisionId'), text(body.engineContract, controlErrorCode.flowInvalid)),
    )
  })
  app.post('/flows/:flowId/revisions/:revisionId/publications', async (context) => {
    const body = await requestObject(context.req.raw, controlErrorCode.flowInvalid)
    exact(body, ['engineContract', 'expectedLivePublicationId', 'version'], controlErrorCode.flowInvalid)
    version(body.version, controlErrorCode.flowInvalid)
    if (body.expectedLivePublicationId !== null && (typeof body.expectedLivePublicationId != 'string' || body.expectedLivePublicationId.length == 0)) {
      invalid(controlErrorCode.flowInvalid, 'Expected Live Publication is invalid.')
    }
    const operation = await service.publishFlow(
      context.get('actorId'),
      context.req.param('flowId'),
      context.req.param('revisionId'),
      text(body.engineContract, controlErrorCode.flowInvalid),
      body.expectedLivePublicationId as string | null,
      idempotencyKey(context.req.raw, controlErrorCode.flowInvalid),
    )
    return response(202, operation)
  })
  app.post('/flows/:flowId/publications/:publicationId/rollback', async (context) => {
    const body = await requestObject(context.req.raw, controlErrorCode.flowInvalid)
    exact(body, ['expectedLivePublicationId', 'version'], controlErrorCode.flowInvalid)
    version(body.version, controlErrorCode.flowInvalid)
    const committed = await service.rollbackFlow(
      context.get('actorId'),
      context.req.param('flowId'),
      context.req.param('publicationId'),
      text(body.expectedLivePublicationId, controlErrorCode.flowInvalid),
      idempotencyKey(context.req.raw, controlErrorCode.flowInvalid),
    )
    return response(committed.created ? 201 : 200, committed.publication)
  })
  app.post('/flows/:flowId/revisions/:revisionId/runs', async (context) => {
    const body = await requestObject(context.req.raw, controlErrorCode.runInvalid)
    exact(body, ['engineContract', 'inputs', 'version'], controlErrorCode.runInvalid)
    version(body.version, controlErrorCode.runInvalid)
    const accepted = await service.createDraftRun(
      context.req.param('flowId'),
      context.req.param('revisionId'),
      text(body.engineContract, controlErrorCode.runInvalid),
      record(body.inputs, controlErrorCode.runInvalid) as RunInputs,
      idempotencyKey(context.req.raw, controlErrorCode.runInvalid),
    )
    return response(accepted.created ? 202 : 200, accepted.run)
  })

  app.post('/runs', async (context) => {
    const body = await requestObject(context.req.raw, controlErrorCode.runInvalid)
    exact(body, ['inputs', 'publicationId', 'version'], controlErrorCode.runInvalid)
    version(body.version, controlErrorCode.runInvalid)
    const accepted = await service.createLiveRun(
      text(body.publicationId, controlErrorCode.runInvalid),
      record(body.inputs, controlErrorCode.runInvalid) as RunInputs,
      idempotencyKey(context.req.raw, controlErrorCode.runInvalid),
    )
    return response(accepted.created ? 202 : 200, accepted.run)
  })
  app.get('/flows/:flowId/runs', (context) => {
    const parameters = query(context.req.raw, ['cursor', 'limit', 'status'], controlErrorCode.runInvalid)
    const cursor = parameters.get('cursor')
    const after = cursor == null ? undefined : decodeRunCursor(cursor)
    const status = parameters.get('status')
    if (status != null && !runStatusSet.has(status)) invalid(controlErrorCode.runInvalid, 'Run status is invalid.')
    const { next, page } = service.listRuns(context.req.param('flowId'), pageSize(parameters, controlErrorCode.runInvalid), {
      ...(after == null ? {} : { after }),
      ...(status == null ? {} : { status: status as RunStatus }),
    })
    return response(200, { ...page, ...(next == null ? {} : { nextCursor: encodeCursor('runs', next) }) })
  })
  app.get('/runs/:runId', (context) => response(200, service.getRun(context.req.param('runId'))))
  app.get('/runs/:runId/events', (context) => {
    const parameters = query(context.req.raw, ['after', 'limit'], controlErrorCode.runInvalid)
    return response(
      200,
      service.getRunEvents(
        context.req.param('runId'),
        nonnegativeInteger(parameters.get('after'), 0, controlErrorCode.runInvalid),
        pageSize(parameters, controlErrorCode.runInvalid),
      ),
    )
  })
  app.get('/runs/:runId/result', (context) => response(200, service.getRunResult(context.req.param('runId'))))
  app.post('/runs/:runId/cancel', async (context) => {
    await versionOnly(context.req.raw, controlErrorCode.runInvalid)
    return response(200, service.cancelRun(context.req.param('runId')))
  })
  app.post('/runs/:runId/waits/:waitId/resolve', async (context) => {
    const body = await requestObject(context.req.raw, controlErrorCode.runInvalid)
    exact(body, ['action', 'version'], controlErrorCode.runInvalid)
    version(body.version, controlErrorCode.runInvalid)
    const action = body.action
    if (action != 'approve' && action != 'continue' && action != 'reject') invalid(controlErrorCode.runInvalid, 'Wait action is invalid.')
    return response(200, service.resolveRunWait(context.req.param('runId'), context.req.param('waitId'), action as WaitAction))
  })
  return app
}

function response(status: number, body: unknown): Response {
  const source = JSON.stringify(body)
  return new Response(source, {
    headers: { 'content-length': String(encoder.encode(source).byteLength), 'content-type': 'application/json; charset=utf-8' },
    status,
  })
}

async function versionOnly(request: Request, code: InvalidCode): Promise<void> {
  query(request, [], code)
  const body = await requestObject(request, code)
  exact(body, ['version'], code)
  version(body.version, code)
}

async function requestObject(request: Request, code: InvalidCode): Promise<Record<string, unknown>> {
  if (request.body == null) return invalid(code, 'Request body must be valid JSON.')
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request.body) {
    size += chunk.byteLength
    if (size > maxRequestBytes) invalid(code, 'Request body is too large.')
    chunks.push(chunk)
  }
  try {
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return record(JSON.parse(new TextDecoder().decode(bytes)) as unknown, code)
  } catch {
    return invalid(code, 'Request body must be valid JSON.')
  }
}

function query(request: Request, allowed: readonly string[], code: InvalidCode): URLSearchParams {
  const parameters = new URL(request.url).searchParams
  for (const key of new Set(parameters.keys())) {
    if (!allowed.includes(key) || parameters.getAll(key).length != 1) invalid(code, 'Query parameters are invalid.')
  }
  return parameters
}

function exact(value: Record<string, unknown>, keys: readonly string[], code: InvalidCode): void {
  const actual = Object.keys(value)
  if (actual.length != keys.length || actual.some((key) => !keys.includes(key))) invalid(code, 'Request fields are invalid.')
}

function version(value: unknown, code: InvalidCode): void {
  if (value !== 1) invalid(code, 'Request version is invalid.')
}

function record(value: unknown, code: InvalidCode): Record<string, unknown> {
  if (value == null || typeof value != 'object' || Array.isArray(value)) invalid(code, 'Request value must be an object.')
  return value as Record<string, unknown>
}

function text(value: unknown, code: InvalidCode): string {
  if (typeof value != 'string' || value.length == 0) invalid(code, 'Request value must be a non-empty string.')
  return value
}

function resourceName(value: unknown): string {
  const name = text(value, controlErrorCode.flowInvalid)
  if (name != name.trim() || resourceNameIssue(name) != null) invalid(controlErrorCode.flowInvalid, 'Flow name is invalid.')
  return name
}

function variableName(value: unknown): string {
  const name = text(value, controlErrorCode.variableInvalid)
  if (!validVariableName(name)) invalid(controlErrorCode.variableInvalid, 'Variable name is invalid.')
  return name
}

function variableValue(value: unknown): string {
  if (typeof value != 'string' || encoder.encode(value).byteLength > 64 * 1024) {
    invalid(controlErrorCode.variableInvalid, 'Variable value is invalid.')
  }
  return value
}

function connectorService(value: unknown): string {
  const service = text(value, controlErrorCode.flowInvalid)
  if (service.length > 256) invalid(controlErrorCode.flowInvalid, 'Connector service is invalid.')
  return service
}

function positiveInteger(value: unknown, code: InvalidCode): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) invalid(code, 'Request value must be a positive integer.')
  return value as number
}

function nonnegativeInteger(value: string | null, fallback: number, code: InvalidCode): number {
  if (value == null) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) invalid(code, 'Query value must be a nonnegative integer.')
  return parsed
}

function pageSize(parameters: URLSearchParams, code: InvalidCode = controlErrorCode.flowInvalid): number {
  const value = parameters.get('limit')
  if (value == null) return defaultPageSize
  const parsed = positiveInteger(Number(value), code)
  if (parsed > maxPageSize) invalid(code, `Page size cannot exceed ${maxPageSize}.`)
  return parsed
}

function optionalBoolean(value: string | null, code: InvalidCode): boolean {
  if (value == null || value == 'false') return false
  if (value == 'true') return true
  return invalid(code, 'Query value must be true or false.')
}

function idempotencyKey(request: Request, code: InvalidCode): string {
  const value = request.headers.get('idempotency-key')
  if (value == null || value.length == 0 || value.length > maxIdempotencyKeyLength) invalid(code, 'Idempotency-Key is invalid.')
  return value
}

function encodeCursor(kind: 'flows' | 'runs', position: FlowPosition | RunPosition): string {
  return Buffer.from(JSON.stringify({ kind, ...position })).toString('base64url')
}

function encodePublicationCursor(flowId: string, position: PublicationPosition): string {
  return Buffer.from(JSON.stringify({ flowId, kind: 'publications', ...position })).toString('base64url')
}

function encodeTriggerActivityCursor(flowId: string, triggerNodeId: string, position: TriggerActivityPosition): string {
  return Buffer.from(JSON.stringify({ flowId, kind: 'trigger-activities', triggerNodeId, ...position })).toString('base64url')
}

function decodeFlowCursor(value: string): FlowPosition {
  const decoded = decodeCursor(value, 'flows', ['createdAt', 'flowId', 'kind'])
  return { createdAt: decoded.createdAt as number, flowId: text(decoded.flowId, controlErrorCode.pageInvalidCursor) }
}

function decodeRunCursor(value: string): RunPosition {
  const decoded = decodeCursor(value, 'runs', ['createdAt', 'kind', 'runId'])
  return { createdAt: decoded.createdAt as number, runId: text(decoded.runId, controlErrorCode.pageInvalidCursor) }
}

function decodePublicationCursor(value: string, flowId: string): PublicationPosition {
  const decoded = decodeCursor(value, 'publications', ['createdAt', 'flowId', 'kind', 'publicationId'])
  if (decoded.flowId != flowId) invalid(controlErrorCode.pageInvalidCursor, 'Cursor is invalid.')
  return { createdAt: decoded.createdAt as number, publicationId: text(decoded.publicationId, controlErrorCode.pageInvalidCursor) }
}

function decodeTriggerActivityCursor(value: string, flowId: string, triggerNodeId: string): TriggerActivityPosition {
  const decoded = decodeCursor(value, 'trigger-activities', ['activityId', 'createdAt', 'flowId', 'kind', 'triggerNodeId'])
  if (decoded.flowId != flowId || decoded.triggerNodeId != triggerNodeId) invalid(controlErrorCode.pageInvalidCursor, 'Cursor is invalid.')
  return { activityId: text(decoded.activityId, controlErrorCode.pageInvalidCursor), createdAt: decoded.createdAt as number }
}

function decodeCursor(value: string, kind: string, keys: readonly string[]): Record<string, unknown> {
  try {
    const decoded = record(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown, controlErrorCode.pageInvalidCursor)
    exact(decoded, keys, controlErrorCode.pageInvalidCursor)
    if (decoded.kind != kind || !Number.isSafeInteger(decoded.createdAt) || (decoded.createdAt as number) < 0) throw new Error()
    return decoded
  } catch (error) {
    if (error instanceof ControlError) throw error
    return invalid(controlErrorCode.pageInvalidCursor, 'Cursor is invalid.')
  }
}

function invalid(code: InvalidCode, message: string): never {
  throw new ControlError(code, message)
}
