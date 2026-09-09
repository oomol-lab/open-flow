import type { RunStatus } from '@oomol-lab/open-flow/run-lifecycle'
import type { Context, Next } from 'hono'
import type { ControlService } from '../application/control-service.ts'

import { parseResultQuery } from '@oomol-lab/open-flow/control-api'
import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { controlRequests } from '@oomol-lab/open-flow/control-requests'
import { validVariableName } from '@oomol-lab/open-flow/flow-change'
import { runStatuses } from '@oomol-lab/open-flow/run-lifecycle'
import { Hono } from 'hono'
import { ControlError } from '../error.ts'
import {
  decodeFlowCursor,
  decodeRunCursor,
  decodePublicationCursor,
  decodeTriggerActivityCursor,
  encodeFlowCursor,
  encodeRunCursor,
  encodePublicationCursor,
  encodeTriggerActivityCursor,
} from './control-cursor.ts'

export type ResolveControlActor = (request: Request) => Promise<string | undefined> | string | undefined

type Environment = { Variables: { actorId: string } }
type InvalidCode =
  | typeof controlErrorCode.flowInvalid
  | typeof controlErrorCode.pageInvalidCursor
  | typeof controlErrorCode.runInvalid
  | typeof controlErrorCode.variableInvalid

const maxRequestBytes = 5 * 1024 * 1024
const maxIdempotencyKeyLength = 256
const maxPageSize = 100
const defaultPageSize = 50
const runStatusSet: ReadonlySet<string> = new Set(runStatuses)
const encoder = new TextEncoder()
const controlDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })

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
    const body = await decodeRequest(context.req.raw, controlErrorCode.variableInvalid, controlRequests.putVariable)
    return response(200, service.putVariable(variableName(context.req.param('name')), body.value))
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
    return response(200, { ...page, ...(next == null ? {} : { nextCursor: encodeFlowCursor(next) }) })
  })
  app.post('/flows', async (context) => {
    query(context.req.raw, [], controlErrorCode.flowInvalid)
    const body = await decodeRequest(context.req.raw, controlErrorCode.flowInvalid, controlRequests.createFlow)
    const name = body.name
    const created = await service.createFlow(context.get('actorId'), name, idempotencyKey(context.req.raw, controlErrorCode.flowInvalid))
    return response(created.created ? 201 : 200, created.flow)
  })
  app.get('/flows/:flowId', (context) => {
    query(context.req.raw, [], controlErrorCode.flowInvalid)
    return response(200, service.getFlow(context.req.param('flowId')))
  })
  app.put('/flows/:flowId/enabled', async (context) => {
    query(context.req.raw, [], controlErrorCode.flowInvalid)
    const body = await decodeRequest(context.req.raw, controlErrorCode.flowInvalid, controlRequests.setEnabled)
    return response(200, service.setFlowEnabled(context.req.param('flowId'), body.expectedPublicationId, body.enabled))
  })
  app.patch('/flows/:flowId', async (context) => {
    query(context.req.raw, [], controlErrorCode.flowInvalid)
    const body = await decodeRequest(context.req.raw, controlErrorCode.flowInvalid, controlRequests.renameFlow)
    return response(200, service.renameFlow(context.req.param('flowId'), body.name))
  })
  app.delete('/flows/:flowId', (context) => {
    query(context.req.raw, [], controlErrorCode.flowInvalid)
    return response(202, service.retireFlow(context.req.param('flowId')))
  })

  app.get('/flows/:flowId/editor', async (context) => response(200, await service.getEditor(context.req.param('flowId'))))
  app.get('/flows/:flowId/draft', (context) => response(200, service.getDraft(context.req.param('flowId'))))
  app.get('/flows/:flowId/draft/sync', (context) => {
    query(context.req.raw, [], controlErrorCode.flowInvalid)
    return response(200, service.syncDraft(context.req.param('flowId')))
  })
  app.post('/flows/:flowId/draft/changes', async (context) => {
    query(context.req.raw, [], controlErrorCode.flowInvalid)
    const body = await decodeRequest(context.req.raw, controlErrorCode.flowInvalid, controlRequests.changeDraft)
    return response(
      200,
      await service.changeDraft(
        context.get('actorId'),
        context.req.param('flowId'),
        text(body.expectedRevisionId, controlErrorCode.flowInvalid),
        body.operations,
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
    await decodeRequest(context.req.raw, controlErrorCode.flowInvalid, controlRequests.versionOnly)
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
    const body = await decodeRequest(context.req.raw, controlErrorCode.flowInvalid, controlRequests.updatePresentation)
    return response(200, service.updatePresentation(context.req.param('flowId'), body.expectedRevision, body.value))
  })
  app.post('/flows/:flowId/revisions/:revisionId/check', async (context) => {
    const body = await decodeRequest(context.req.raw, controlErrorCode.flowInvalid, controlRequests.checkFlow)
    return response(
      200,
      await service.checkFlow(context.req.param('flowId'), context.req.param('revisionId'), text(body.engineContract, controlErrorCode.flowInvalid)),
    )
  })
  app.post('/flows/:flowId/revisions/:revisionId/publications', async (context) => {
    const body = await decodeRequest(context.req.raw, controlErrorCode.flowInvalid, controlRequests.publishFlow)
    const operation = await service.publishFlow(
      context.get('actorId'),
      context.req.param('flowId'),
      context.req.param('revisionId'),
      text(body.engineContract, controlErrorCode.flowInvalid),
      body.expectedLivePublicationId,
      idempotencyKey(context.req.raw, controlErrorCode.flowInvalid),
    )
    return response(202, operation)
  })
  app.post('/flows/:flowId/publications/:publicationId/rollback', async (context) => {
    const body = await decodeRequest(context.req.raw, controlErrorCode.flowInvalid, controlRequests.rollbackFlow)
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
    const body = await decodeRequest(context.req.raw, controlErrorCode.runInvalid, controlRequests.createDraftRun)
    const accepted = await service.createDraftRun(
      context.req.param('flowId'),
      context.req.param('revisionId'),
      text(body.engineContract, controlErrorCode.runInvalid),
      body.inputs,
      idempotencyKey(context.req.raw, controlErrorCode.runInvalid),
      body.trigger,
    )
    return response(accepted.created ? 202 : 200, accepted.run)
  })

  app.post('/runs', async (context) => {
    const body = await decodeRequest(context.req.raw, controlErrorCode.runInvalid, controlRequests.createLiveRun)
    const accepted = await service.createLiveRun(
      text(body.publicationId, controlErrorCode.runInvalid),
      body.inputs,
      idempotencyKey(context.req.raw, controlErrorCode.runInvalid),
      body.trigger,
    )
    return response(accepted.created ? 202 : 200, accepted.run)
  })
  app.get('/flows/:flowId/runs', (context) => {
    const parameters = query(context.req.raw, ['cursor', 'limit', 'status'], controlErrorCode.runInvalid)
    const flowId = context.req.param('flowId')
    const cursor = parameters.get('cursor')
    const after = cursor == null ? undefined : decodeRunCursor(cursor, flowId)
    const status = parameters.get('status')
    if (status != null && !runStatusSet.has(status)) invalid(controlErrorCode.runInvalid, 'Run status is invalid.')
    const { next, page } = service.listRuns(flowId, pageSize(parameters, controlErrorCode.runInvalid), {
      ...(after == null ? {} : { after }),
      ...(status == null ? {} : { status: status as RunStatus }),
    })
    return response(200, { ...page, ...(next == null ? {} : { nextCursor: encodeRunCursor(flowId, next) }) })
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
  app.get('/runs/:runId/results', (context) => {
    const parameters = query(context.req.raw, ['after'], controlErrorCode.runInvalid)
    return response(200, service.listRunResults(context.req.param('runId'), parameters.get('after') ?? undefined))
  })
  app.get('/runs/:runId/results/:resultId/content', (context) => {
    const stored = service.runResultContent(context.req.param('runId'), context.req.param('resultId'))
    return new Response(stored.content, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${stored.result.resultId}.json"`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
      },
    })
  })
  app.get('/runs/:runId/results/:resultId', (context) => {
    const parameters = query(context.req.raw, ['pointer', 'offset', 'limit'], controlErrorCode.runInvalid)
    let parsed
    try {
      parsed = parseResultQuery({
        ...(parameters.has('pointer') ? { pointer: parameters.get('pointer') } : {}),
        ...(parameters.has('offset') ? { offset: Number(parameters.get('offset')) } : {}),
        ...(parameters.has('limit') ? { limit: Number(parameters.get('limit')) } : {}),
      })
    } catch {
      invalid(controlErrorCode.runInvalid, 'Invalid result page query.')
    }
    return response(200, service.readRunResult(context.req.param('runId'), context.req.param('resultId'), parsed))
  })
  app.get('/runs/:runId/result', (context) => response(200, service.getRunResult(context.req.param('runId'))))
  app.post('/runs/:runId/cancel', async (context) => {
    await versionOnly(context.req.raw, controlErrorCode.runInvalid)
    return response(200, service.cancelRun(context.req.param('runId')))
  })
  app.post('/runs/:runId/waits/:waitId/resolve', async (context) => {
    const body = await decodeRequest(context.req.raw, controlErrorCode.runInvalid, controlRequests.resolveWait)
    const action = body.action
    return response(200, service.resolveRunWait(context.req.param('runId'), context.req.param('waitId'), action))
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
  await decodeRequest(request, code, controlRequests.versionOnly)
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
    return record(JSON.parse(controlDecoder.decode(bytes)) as unknown, code)
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

function record(value: unknown, code: InvalidCode): Record<string, unknown> {
  if (value == null || typeof value != 'object' || Array.isArray(value)) invalid(code, 'Request value must be an object.')
  return value as Record<string, unknown>
}

function text(value: unknown, code: InvalidCode): string {
  if (typeof value != 'string' || value.length == 0) invalid(code, 'Request value must be a non-empty string.')
  return value
}

function variableName(value: unknown): string {
  const name = text(value, controlErrorCode.variableInvalid)
  if (!validVariableName(name)) invalid(controlErrorCode.variableInvalid, 'Variable name is invalid.')
  return name
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

function invalid(code: InvalidCode, message: string): never {
  throw new ControlError(code, message)
}

async function decodeRequest<Value>(request: Request, code: InvalidCode, decode: (value: unknown) => Value): Promise<Value> {
  const body = await requestObject(request, code)
  try {
    return decode(body)
  } catch (error) {
    throw new ControlError(code, decode == controlRequests.changeDraft ? 'The Draft operation has an invalid structure.' : 'Request fields are invalid.', {
      cause: error,
    })
  }
}
