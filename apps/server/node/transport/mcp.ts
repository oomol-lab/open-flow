import type { CallToolResult, ServerContext, StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import type { Logger } from 'pino'
import type { ServerService } from '../application/service.ts'

import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { controlErrorCode, inspectFlowDraft, flowInspection, actionSummary, nodeDetails, searchTriggerKeys } from '@oomol-lab/open-flow/control-api'
import { authoringExample, authoringExamples, draftOperationsSchema, decodeDraftOperations } from '@oomol-lab/open-flow/control-requests'
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
    const handler = createMcpHandler(() => createServer(service, actorId, logger), { legacy: 'reject', responseMode: 'auto' })
    try {
      return await handler.fetch(context.req.raw)
    } finally {
      await handler.close()
    }
  })
  return app
}

function createServer(service: ServerService, actorId: string, logger: Logger) {
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
        if (error instanceof ControlError) return result({ error: { code: error.code, message: error.message, status: error.status } }, true)
        logger.error({ err: error, tool: name }, 'MCP tool failed.')
        const input = args as Record<string, unknown>
        return result(
          {
            error: {
              code: input.idempotencyKey == null ? 'internal' : 'flow.mutation-outcome-unknown',
              message:
                input.idempotencyKey == null
                  ? 'The request could not be completed.'
                  : 'The mutation outcome is unknown. Retry the same tool with identical arguments and the same idempotencyKey.',
              ...(input.idempotencyKey == null ? {} : { idempotencyKey: input.idempotencyKey }),
            },
          },
          true,
        )
      }
    })
  }

  register('flow_list', mcpTools.flow_list, ({ cursor, limit }) => {
    const { next, page } = control.listFlows(limit, cursor == null ? undefined : decodeFlowCursor(cursor))
    return { ...page, ...(next == null ? {} : { nextCursor: encodeFlowCursor(next) }) }
  })
  register('flow_get', mcpTools.flow_get, async ({ flowId, full }) => {
    const metadata = control.getFlow(flowId)
    const inspected = await inspectFlowDraft(metadata, () => control.getRevision(flowId, metadata.draftRevisionId))
    return flowInspection(inspected, inspected.draft == null ? undefined : await control.getLive(flowId), full)
  })
  register('flow_node_get', mcpTools.flow_node_get, ({ flowId, revisionId, nodeId, subflowId }) => {
    const draft = control.getRevision(flowId, revisionId)
    const graph = subflowId == null ? draft.content.document.graph : draft.content.document.subflows[subflowId]?.graph
    const node = graph?.nodes[nodeId]
    if (node == null) throw new ControlError(controlErrorCode.flowInvalid, 'Node was not found in the selected Revision and graph.')
    return { flowId, revisionId, ...(subflowId == null ? {} : { subflowId }), ...nodeDetails(draft.content, nodeId, node), version: 1 }
  })
  register('flow_schema', mcpTools.flow_schema, ({ kind, example }) => {
    try {
      if (example != null) return example == 'index' ? { examples: authoringExamples } : authoringExample(example)
      return { operations: draftOperationsSchema(kind), examples: authoringExamples }
    } catch {
      throw new ControlError(controlErrorCode.flowInvalid, 'Unknown change operation kind or example.')
    }
  })
  register(
    'flow_create',
    mcpTools.flow_create,
    async ({ name, idempotencyKey, teamId }) => (await control.createFlow(actorId, name, idempotencyKey, teamId)).flow,
  )
  register('flow_apply', mcpTools.flow_apply, async ({ flowId, expectedRevisionId, operations, idempotencyKey }) => {
    let changes
    try {
      changes = decodeDraftOperations(operations)
    } catch (error) {
      throw new ControlError(controlErrorCode.flowInvalid, error instanceof Error ? error.message : 'Invalid change operations.')
    }
    return await control.changeDraft(actorId, flowId, expectedRevisionId, changes, idempotencyKey)
  })
  register('flow_check', mcpTools.flow_check, ({ flowId, revisionId }) => control.checkFlow(flowId, revisionId, currentEngineContract))
  register('flow_publish', mcpTools.flow_publish, ({ flowId, revisionId, expectedLivePublicationId, idempotencyKey }) =>
    control.publishFlow(actorId, flowId, revisionId, currentEngineContract, expectedLivePublicationId, idempotencyKey),
  )
  register('flow_publish_status', mcpTools.flow_publish_status, ({ flowId, operationId }) => control.getPublishOperation(flowId, operationId))
  register('flow_set_enabled', mcpTools.flow_set_enabled, ({ flowId, expectedPublicationId, enabled }) =>
    control.setFlowEnabled(flowId, expectedPublicationId, enabled),
  )
  register('flow_run', mcpTools.flow_run, async (args) => {
    return (
      args.source == 'draft'
        ? await control.runs.createDraftRun(args.flowId, args.revisionId, currentEngineContract, args.inputs, args.idempotencyKey, args.trigger)
        : await control.runs.createLiveRun(args.publicationId, args.inputs, args.idempotencyKey, args.trigger)
    ).run
  })
  register('run_list', mcpTools.run_list, ({ flowId, status, cursor, limit, pendingWait }) => {
    const { next, page } = control.runs.listRuns(flowId, limit, {
      ...(status == null ? {} : { status }),
      ...(pendingWait == null ? {} : { pendingWait }),
      ...(cursor == null ? {} : { after: decodeRunCursor(cursor, flowId) }),
    })
    return { ...page, ...(next == null ? {} : { nextCursor: encodeRunCursor(flowId, next) }) }
  })
  register('run_get', mcpTools.run_get, ({ runId }) => control.runs.getRun(runId))
  register('run_events', mcpTools.run_events, ({ runId, after, limit }) => control.runs.getRunEvents(runId, after, limit))
  register('run_result', mcpTools.run_result, ({ runId }) => control.runs.getRunResult(runId))
  register('run_results', mcpTools.run_results, ({ runId, after }) => control.runs.listRunResults(runId, after))
  register('run_result_read', mcpTools.run_result_read, ({ runId, resultId, ...query }) => control.runs.readRunResult(runId, resultId, query))
  register('run_resolve_wait', mcpTools.run_resolve_wait, ({ runId, waitId, action, comment }) => control.runs.resolveRunWait(runId, waitId, action, comment))
  register('run_cancel', mcpTools.run_cancel, ({ runId }) => control.runs.cancelRun(runId))
  register('flow_code_connections', mcpTools.flow_code_connections, ({ flowId, publicationId }) => control.getConnectorAccess(actorId, flowId, publicationId))
  register('flow_connection_candidates', mcpTools.flow_connection_candidates, ({ flowId, providerIds }, context) =>
    control.getProviderAccessBindingCandidates(actorId, flowId, providerIds, context.mcpReq.signal),
  )
  register('flow_code_connection_set', mcpTools.flow_code_connection_set, ({ flowId, providerId, accessBindingId, selected, expectedAccessRevision }) =>
    selected
      ? control.addProviderAccessBinding(actorId, flowId, providerId, accessBindingId, expectedAccessRevision)
      : control.removeProviderAccessBinding(actorId, flowId, providerId, accessBindingId, expectedAccessRevision),
  )
  register(
    'flow_connection_usage_remove',
    mcpTools.flow_connection_usage_remove,
    ({ flowId, connectionId, expectedRevisionId, expectedAccessRevision, idempotencyKey }) =>
      control.removeConnectionUsage(actorId, flowId, connectionId, expectedRevisionId, expectedAccessRevision, idempotencyKey),
  )
  register('connector_teams', mcpTools.connector_teams, async (_, context) => {
    const { enabled, teams, version } = await service.connectorTeams(context.mcpReq.signal)
    return { enabled, teams, version }
  })
  register('connector_providers', mcpTools.connector_providers, async ({ flowId }, context) => ({
    providers: await control.listConnectorProviders(flowId, context.mcpReq.signal),
  }))
  register('connector_search', mcpTools.connector_search, async ({ query, flowId }, context) => ({
    actions: (await control.searchConnectorActions(query, flowId, context.mcpReq.signal)).map(actionSummary),
  }))
  register('connector_get', mcpTools.connector_get, ({ actionId, flowId }, context) => control.getConnectorAction(actionId, flowId, context.mcpReq.signal))
  register('connector_connections', mcpTools.connector_connections, async ({ serviceId, flowId }, context) => ({
    connections: await control.listConnectorConnections(serviceId, flowId, context.mcpReq.signal),
  }))
  register('event_source_list', mcpTools.event_source_list, async () => {
    const sources = await control.listEventSources()
    return {
      ...sources,
      ...(sources.sources.length == 0
        ? { guidance: 'No event sources are visible to this identity. Open Workbench to create and verify a Feishu event source, then list again.' }
        : {}),
    }
  })
  register('trigger_search', mcpTools.trigger_search, ({ query }) => ({ keys: searchTriggerKeys(control.listTriggerKeys(), query) }))
  register('trigger_get', mcpTools.trigger_get, ({ key }) => ({
    definition: control.getTriggerKey(key),
  }))
  return server
}

function result(value: unknown, isError = false): CallToolResult {
  const text = JSON.stringify(value)
  return { content: [{ type: 'text', text }], structuredContent: value as CallToolResult['structuredContent'], ...(isError ? { isError: true } : {}) }
}
