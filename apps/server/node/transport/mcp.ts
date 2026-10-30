import type { CallToolResult, ServerContext, StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import type { Logger } from 'pino'
import type { ServerService } from '../application/service.ts'

import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { controlErrorCode, actionSummary, searchTriggerKeys } from '@oomol-lab/open-flow/control-api'
import { authoringSchema } from '@oomol-lab/open-flow/control-requests'
import { importedWorkflowName, resolveMetadataLanguage } from '@oomol-lab/open-flow/localization'
import { mcpTools, mcpProtocolVersion, mcpInstructions } from '@oomol-lab/open-flow/mcp'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import manifest from '../../package.json' with { type: 'json' }
import { ControlError } from '../error.ts'
import { decodeFlowCursor, decodeRunCursor, encodeFlowCursor, encodeRunCursor } from './control-cursor.ts'

export function createMcpApp(service: ServerService, authenticate: (request: Request) => Promise<string>, logger: Logger, shutdownSignal?: AbortSignal) {
  const app = new Hono()
  app.use('*', async (context, next) => {
    context.header('cache-control', 'no-store')
    const origin = context.req.header('origin')
    if (origin != null && origin != new URL(context.req.url).origin) {
      return context.json({ error: { code: 'mcp.origin-invalid', message: 'Origin is not allowed.' } }, 403)
    }
    if (context.req.method != 'POST') return context.json({ error: { code: 'mcp.method-not-allowed', message: 'Use POST.' } }, 405, { Allow: 'POST' })
    const init = {
      method: context.req.method,
      headers: context.req.raw.headers,
      body: context.req.raw.body,
      duplex: 'half',
      signal: shutdownSignal == null ? context.req.raw.signal : AbortSignal.any([context.req.raw.signal, shutdownSignal]),
    }
    context.req.raw = new Request(context.req.url, init)
    await next()
    context.header('cache-control', 'no-store')
  })
  app.use(
    '*',
    bodyLimit({
      maxSize: 5 * 1024 * 1024,
      onError: (context) => context.json({ error: { code: 'mcp.request-too-large', message: 'Request body is too large.' } }, 413),
    }),
  )
  app.all('/', async (context) => {
    const actorId = await authenticate(context.req.raw)
    if (shutdownSignal?.aborted) return context.json({ error: { code: 'mcp.unavailable', message: 'Server is shutting down.' } }, 503)
    const handler = createMcpHandler(
      () =>
        createServer(
          service,
          actorId,
          logger,
          new URL(context.req.url).origin,
          importedWorkflowName(resolveMetadataLanguage(undefined, context.req.header('accept-language'))),
        ),
      { legacy: 'reject', responseMode: 'auto' },
    )
    try {
      return await handler.fetch(context.req.raw)
    } finally {
      await handler.close()
    }
  })
  return app
}

function createServer(service: ServerService, actorId: string, logger: Logger, endpointOrigin: string, defaultImportName: string) {
  const control = service.control
  const server = new McpServer(
    { name: 'open-flow', version: manifest.version },
    { instructions: mcpInstructions, supportedProtocolVersions: [mcpProtocolVersion], capabilities: { tools: { listChanged: false } } },
  )
  function register<Args>(
    name: string,
    definition: {
      description: string
      inputSchema: StandardSchemaWithJSON<unknown, Args>
      annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }
    },
    execute: (args: Args, context: ServerContext) => unknown | Promise<unknown>,
  ) {
    server.registerTool(name, definition, async (args, context) => {
      try {
        context.mcpReq.signal.throwIfAborted()
        return result(await execute(args, context))
      } catch (error) {
        if (context.mcpReq.signal.aborted) throw error
        if (error instanceof ControlError)
          return result(
            { error: { code: error.code, message: error.message, status: error.status, ...(error.details == null ? {} : { details: error.details }) } },
            true,
          )
        logger.error({ err: error, tool: name }, 'MCP tool failed.')
        const input = args as Record<string, unknown>
        return result(
          {
            error: {
              code: (input.idempotencyKey ?? input.requestId) == null ? 'internal' : 'flow.mutation-outcome-unknown',
              message:
                (input.idempotencyKey ?? input.requestId) == null
                  ? 'The request could not be completed.'
                  : 'The mutation outcome is unknown. Retry the same tool with identical arguments and the same request identity.',
              ...((input.idempotencyKey ?? input.requestId) == null
                ? {}
                : input.requestId == null
                  ? { idempotencyKey: input.idempotencyKey }
                  : { requestId: input.requestId }),
            },
          },
          true,
        )
      }
    })
  }

  register('flow_live', mcpTools.flow_live, ({ flowId }) => control.publications.getLiveDetails(actorId, flowId, endpointOrigin))
  register('flow_list', mcpTools.flow_list, ({ cursor, limit }) => {
    const { next, page } = control.flows.listFlows(actorId, limit, cursor == null ? undefined : decodeFlowCursor(cursor), false)
    return { ...page, ...(next == null ? {} : { nextCursor: encodeFlowCursor(next) }) }
  })
  register('flow_canvas', mcpTools.flow_canvas, ({ flowId, command }) => control.flows.broadcastCanvas(actorId, flowId, command))
  register('flow_read', mcpTools.flow_read, ({ flowId, ...query }) => control.drafts.readAuthoring(actorId, flowId, query))
  register('flow_search', mcpTools.flow_search, ({ flowId, ...query }) => control.drafts.searchAuthoring(actorId, flowId, query))
  register('flow_schema', mcpTools.flow_schema, ({ flowId, ...query }) => {
    if (flowId != null) return control.drafts.authoringSchema(actorId, flowId, query)
    if (query.action != null) throw new ControlError(controlErrorCode.flowInvalid, 'Action lookup requires flowId.')
    return authoringSchema(query.type)
  })
  register(
    'flow_create',
    mcpTools.flow_create,
    async ({ name, idempotencyKey, teamId }) => (await control.flows.createFlow(actorId, name, idempotencyKey, teamId)).flow,
  )
  register('flow_export', mcpTools.flow_export, ({ flowId }) => control.flows.exportFlow(actorId, flowId))
  register(
    'flow_import',
    mcpTools.flow_import,
    async ({ file, name, teamId, idempotencyKey }) => (await control.flows.importFlow(actorId, file, idempotencyKey, name, teamId, defaultImportName)).flow,
  )
  register('flow_edit', mcpTools.flow_edit, ({ flowId, ...request }) => control.drafts.editAuthoring(actorId, flowId, request))
  register('flow_check', mcpTools.flow_check, ({ flowId, revisionId }) => control.drafts.checkAuthoring(actorId, flowId, revisionId))
  register('flow_publish', mcpTools.flow_publish, ({ flowId, revisionId, expectedLivePublicationId, idempotencyKey }) =>
    control.publications.publishFlow(actorId, flowId, revisionId, currentEngineContract, expectedLivePublicationId, idempotencyKey),
  )
  register('flow_publish_status', mcpTools.flow_publish_status, ({ flowId, operationId }) =>
    control.publications.getPublishOperation(actorId, flowId, operationId),
  )
  register('flow_set_enabled', mcpTools.flow_set_enabled, ({ flowId, expectedPublicationId, enabled }) =>
    control.publications.setFlowEnabled(actorId, flowId, expectedPublicationId, enabled),
  )
  register('flow_run', mcpTools.flow_run, async (args) => {
    return (
      args.source == 'draft'
        ? await control.runs.createDraftRun(actorId, args.flowId, args.revisionId, currentEngineContract, args.inputs, args.idempotencyKey, args.trigger, 'mcp')
        : await control.runs.createLiveRun(actorId, args.publicationId, args.inputs, args.idempotencyKey, args.trigger, 'mcp')
    ).run
  })
  register('run_list', mcpTools.run_list, ({ flowId, status, cursor, limit, pendingWait }) => {
    const { next, page } = control.runs.listRuns(actorId, flowId, limit, {
      ...(status == null ? {} : { status }),
      ...(pendingWait == null ? {} : { pendingWait }),
      ...(cursor == null ? {} : { after: decodeRunCursor(cursor, flowId) }),
    })
    return { ...page, ...(next == null ? {} : { nextCursor: encodeRunCursor(flowId, next) }) }
  })
  register('run_get', mcpTools.run_get, ({ runId }) => control.runs.getRun(actorId, runId))
  register('run_events', mcpTools.run_events, ({ runId, after, limit }) => control.runs.getRunEvents(actorId, runId, after, limit))
  register('run_result', mcpTools.run_result, ({ runId }) => control.runs.getRunResult(actorId, runId))
  register('run_results', mcpTools.run_results, ({ runId, after }) => control.runs.listRunResults(actorId, runId, after))
  register('run_result_read', mcpTools.run_result_read, ({ runId, resultId, ...query }) => control.runs.readRunResult(actorId, runId, resultId, query))
  register('run_resolve_wait', mcpTools.run_resolve_wait, ({ runId, waitId, action, comment }) =>
    control.runs.resolveRunWait(actorId, runId, waitId, action, comment),
  )
  register('run_cancel', mcpTools.run_cancel, ({ runId }) => control.runs.cancelRun(actorId, runId))
  register('flow_code_connections', mcpTools.flow_code_connections, ({ flowId, publicationId }) =>
    control.connectors.getConnectorAccess(actorId, flowId, publicationId),
  )
  register('flow_connection_candidates', mcpTools.flow_connection_candidates, ({ flowId, providerIds }, context) =>
    control.connectors.getProviderAccessBindingCandidates(actorId, flowId, providerIds, context.mcpReq.signal),
  )
  register('flow_code_connection_set', mcpTools.flow_code_connection_set, ({ flowId, providerId, accessBindingId, selected, expectedAccessRevision }) =>
    selected
      ? control.connectors.addProviderAccessBinding(actorId, flowId, providerId, accessBindingId, expectedAccessRevision)
      : control.connectors.removeProviderAccessBinding(actorId, flowId, providerId, accessBindingId, expectedAccessRevision),
  )
  register(
    'flow_connection_usage_remove',
    mcpTools.flow_connection_usage_remove,
    ({ flowId, connectionId, expectedRevisionId, expectedAccessRevision, idempotencyKey }) =>
      control.drafts.removeConnectionUsage(actorId, flowId, connectionId, expectedRevisionId, expectedAccessRevision, idempotencyKey),
  )
  register('connector_teams', mcpTools.connector_teams, async (_, context) => {
    const { enabled, teams, version } = await service.connectorTeams(context.mcpReq.signal)
    return { enabled, teams, version }
  })
  register('connector_providers', mcpTools.connector_providers, async ({ flowId }, context) => ({
    providers: await control.connectors.listConnectorProviders(actorId, flowId, context.mcpReq.signal),
  }))
  register('connector_search', mcpTools.connector_search, async ({ query, flowId }, context) => ({
    actions: (await control.connectors.searchConnectorActions(actorId, query, flowId, context.mcpReq.signal)).map(actionSummary),
  }))
  register('connector_get', mcpTools.connector_get, ({ actionId, flowId }, context) =>
    control.connectors.getConnectorAction(actorId, actionId, flowId, context.mcpReq.signal),
  )
  register('connector_connections', mcpTools.connector_connections, async ({ serviceId, flowId }, context) => ({
    connections: await control.connectors.listConnectorConnections(actorId, serviceId, flowId, context.mcpReq.signal),
  }))
  register('event_source_list', mcpTools.event_source_list, async (_, context) => {
    const sources = await control.eventSources.listEventSources(actorId, undefined, context.mcpReq.signal)
    return {
      ...sources,
      ...(sources.sources.length == 0
        ? {
            guidance:
              'No event sources are visible to this identity. Open Workbench to create and verify an event source for the required provider, then list again.',
          }
        : {}),
    }
  })
  register('trigger_search', mcpTools.trigger_search, ({ query }) => ({ keys: searchTriggerKeys(control.drafts.listTriggerKeys(), query) }))
  register('trigger_get', mcpTools.trigger_get, ({ key }) => ({
    definition: control.drafts.getTriggerKey(key),
  }))
  return server
}

function result(value: unknown, isError = false): CallToolResult {
  const text = JSON.stringify(value)
  return { content: [{ type: 'text', text }], structuredContent: value as CallToolResult['structuredContent'], ...(isError ? { isError: true } : {}) }
}
