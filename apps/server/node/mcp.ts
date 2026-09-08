import type { CallToolResult, ServerContext, StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import type { Logger } from 'pino'
import type { ServerService } from './service.ts'

import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { changeOperationsSchema, decodeChangeOperations } from '@oomol-lab/open-flow/flow-change'
import { mcpTools, mcpProtocolVersion, mcpInstructions } from '@oomol-lab/open-flow/mcp'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import manifest from '../package.json' with { type: 'json' }
import { decodeFlowCursor, encodeFlowCursor } from './control-cursor.ts'
import { ControlError } from './error.ts'

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
  register('flow_get', mcpTools.flow_get, async ({ flowId }) => {
    const metadata = control.getFlow(flowId)
    const draft = control.getDraft(flowId)
    return { flow: metadata, draft, live: await control.getLive(flowId), version: 1 }
  })
  register('flow_schema', mcpTools.flow_schema, ({ kind }) => {
    try {
      return {
        operations: changeOperationsSchema(kind),
        example: [{ kind: 'graph.node.create', nodeId: 'start', target: { kind: 'flow' }, node: { kind: 'manual', name: 'Start' } }],
      }
    } catch {
      throw new ControlError(controlErrorCode.flowInvalid, 'Unknown change operation kind.')
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
      changes = decodeChangeOperations(operations)
    } catch (error) {
      throw new ControlError(controlErrorCode.flowInvalid, error instanceof Error ? error.message : 'Invalid change operations.')
    }
    return await control.changeDraft(actorId, flowId, expectedRevisionId, changes, idempotencyKey)
  })
  register('flow_check', mcpTools.flow_check, ({ flowId, revisionId }) => control.checkFlow(flowId, revisionId, currentEngineContract))
  register('flow_run', mcpTools.flow_run, async ({ source, flowId, revisionId, publicationId, trigger, inputs, idempotencyKey }) => {
    if (source == 'draft') {
      if (flowId == null || revisionId == null || publicationId != null)
        throw new ControlError(controlErrorCode.runInvalid, 'Draft requires flowId and revisionId, without publicationId.')
      return (await control.createDraftRun(flowId, revisionId, currentEngineContract, inputs, idempotencyKey, trigger)).run
    }
    if (publicationId == null || flowId != null || revisionId != null)
      throw new ControlError(controlErrorCode.runInvalid, 'Live requires publicationId, without flowId or revisionId.')
    return (await control.createLiveRun(publicationId, inputs, idempotencyKey, trigger)).run
  })
  register('run_get', mcpTools.run_get, ({ runId }) => control.getRun(runId))
  register('run_events', mcpTools.run_events, ({ runId, after, limit }) => control.getRunEvents(runId, after, limit))
  register('run_result', mcpTools.run_result, ({ runId }) => control.getRunResult(runId))
  register('run_cancel', mcpTools.run_cancel, ({ runId }) => control.cancelRun(runId))
  register('connector_teams', mcpTools.connector_teams, (_, context) => service.connectorTeams(context.mcpReq.signal))
  register('connector_list', mcpTools.connector_list, async ({ flowId }, context) => ({
    providers: await control.listConnectorProviders(flowId, context.mcpReq.signal),
  }))
  register('connector_search', mcpTools.connector_search, async ({ query, flowId }, context) => ({
    actions: await control.searchConnectorActions(query, flowId, context.mcpReq.signal),
  }))
  register('connector_get', mcpTools.connector_get, ({ actionId, flowId }, context) => control.getConnectorAction(actionId, flowId, context.mcpReq.signal))
  register('connector_connections', mcpTools.connector_connections, async ({ serviceId, flowId }, context) => ({
    connections: await control.listConnectorConnections(serviceId, flowId, context.mcpReq.signal),
  }))
  register('trigger_list', mcpTools.trigger_list, () => ({ keys: control.listTriggerKeys() }))
  register('trigger_get', mcpTools.trigger_get, ({ key }) => ({
    definition: control.getTriggerKey(key),
  }))
  return server
}

function result(value: unknown, isError = false): CallToolResult {
  const text = JSON.stringify(value)
  return { content: [{ type: 'text', text }], structuredContent: value as CallToolResult['structuredContent'], ...(isError ? { isError: true } : {}) }
}
