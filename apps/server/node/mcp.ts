import type { CallToolResult, ServerContext, StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import type { Logger } from 'pino'
import type { ServerService } from './service.ts'

import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { changeOperationsSchema, decodeChangeOperations, resourceNameIssue } from '@oomol-lab/open-flow/flow-change'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import * as z from 'zod'
import manifest from '../package.json' with { type: 'json' }
import { decodeFlowCursor, encodeFlowCursor } from './control-cursor.ts'
import { ControlError } from './error.ts'

const protocolVersion = '2026-07-28'
const id = z.string().min(1)
const mutationKey = id.max(256).describe('Stable identity for this mutation. Retry with the same key and identical arguments, even after a lost response.')
const pageLimit = z.int().min(1).max(100).default(50)
const flow = id.describe('Exact Flow ID returned by flow_list or flow_create.')
const run = id.describe('Exact Run ID returned by flow_run.')
const instructions =
  'Use flow_list and flow_get to inspect a Flow. Use flow_schema to learn atomic edit operations, then flow_apply with the observed expectedRevisionId and a stable idempotencyKey. ' +
  'Use flow_check before flow_run. Select an explicit Trigger node ID and fixed revision or publication. A new Flow has no Trigger until you add one. ' +
  'flow_run returns an accepted Run, not its final result. Poll run_get and use run_result after terminal. A waiting Run requires an explicit action outside these tools. ' +
  'Retry mutations only with identical arguments and the same idempotencyKey; a new key can execute the Flow again. Cancel a Run explicitly with run_cancel. ' +
  'Use nextCursor and nextAfter to read subsequent pages. Connector-backed deployments may require a Team; inspect connector_teams before creating a Flow.'

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
    { instructions, supportedProtocolVersions: [protocolVersion], capabilities: { tools: { listChanged: false } } },
  )
  function register<Args>(
    name: string,
    description: string,
    inputSchema: StandardSchemaWithJSON<unknown, Args>,
    readOnly: boolean,
    execute: (args: Args, context: ServerContext) => unknown | Promise<unknown>,
  ) {
    server.registerTool(
      name,
      {
        description,
        inputSchema,
        annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: true, openWorldHint: true },
      },
      async (args, context) => {
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
      },
    )
  }

  register(
    'flow_list',
    'List Flows in this deployment. Continue with nextCursor; cursors are compatible with the Control API.',
    z.strictObject({ cursor: id.optional(), limit: pageLimit }),
    true,
    ({ cursor, limit }) => {
      const { next, page } = control.listFlows(limit, cursor == null ? undefined : decodeFlowCursor(cursor))
      return { ...page, ...(next == null ? {} : { nextCursor: encodeFlowCursor(next) }) }
    },
  )
  register(
    'flow_get',
    'Read Flow metadata, the full Draft and current Live publication. Use draft.revisionId as the base of an edit.',
    z.strictObject({ flowId: flow }),
    true,
    async ({ flowId }) => {
      const metadata = control.getFlow(flowId)
      const draft = control.getDraft(flowId)
      return { flow: metadata, draft, live: await control.getLive(flowId), version: 1 }
    },
  )
  register(
    'flow_schema',
    'Get the JSON Schema for atomic change operations, optionally one operation kind. Node titles must be non-empty and unique within a graph.',
    z.strictObject({ kind: id.optional() }),
    true,
    ({ kind }) => {
      try {
        return {
          operations: changeOperationsSchema(kind),
          example: [{ kind: 'graph.node.create', nodeId: 'start', target: { kind: 'flow' }, node: { kind: 'manual', name: 'Start' } }],
        }
      } catch {
        throw new ControlError(controlErrorCode.flowInvalid, 'Unknown change operation kind.')
      }
    },
  )
  register(
    'flow_create',
    'Create an empty Flow. If this deployment uses OOMOL Connector, choose a teamId from connector_teams. Keep the key and arguments stable when retrying.',
    z.strictObject({
      name: id.refine((name) => name == name.trim() && resourceNameIssue(name) == null, 'Flow name is invalid.'),
      idempotencyKey: mutationKey,
      teamId: id.optional(),
    }),
    false,
    async ({ name, idempotencyKey, teamId }) => (await control.createFlow(actorId, name, idempotencyKey, teamId)).flow,
  )
  register(
    'flow_apply',
    'Apply ordered atomic changes. Read flow_schema first. A stale expectedRevisionId is a conflict; reread the Draft before deciding on a new edit.',
    z.strictObject({
      flowId: flow,
      expectedRevisionId: id,
      idempotencyKey: mutationKey,
      operations: z.array(z.json()).min(1).describe('Change operations defined by flow_schema. Explicit IDs and before values refer to the base Revision.'),
    }),
    false,
    async ({ flowId, expectedRevisionId, operations, idempotencyKey }) => {
      let changes
      try {
        changes = decodeChangeOperations(operations)
      } catch (error) {
        throw new ControlError(controlErrorCode.flowInvalid, error instanceof Error ? error.message : 'Invalid change operations.')
      }
      return await control.changeDraft(actorId, flowId, expectedRevisionId, changes, idempotencyKey)
    },
  )
  register(
    'flow_check',
    'Validate a fixed Revision and return diagnostics. Get its revisionId from flow_get or flow_apply.',
    z.strictObject({ flowId: flow, revisionId: id }),
    true,
    ({ flowId, revisionId }) => control.checkFlow(flowId, revisionId, currentEngineContract),
  )
  register(
    'flow_run',
    'Start a Run and return its runId. For draft supply flowId and revisionId; for live supply publicationId. Always fix the source, Trigger and idempotencyKey. Poll run_get for completion.',
    z.strictObject({
      source: z.enum(['draft', 'live']),
      flowId: flow.optional(),
      revisionId: id.optional(),
      publicationId: id.optional(),
      trigger: z.strictObject({ nodeId: id, payload: z.json() }),
      inputs: z.record(z.string(), z.record(z.string(), z.json())).default({}),
      idempotencyKey: mutationKey,
    }),
    false,
    async ({ source, flowId, revisionId, publicationId, trigger, inputs, idempotencyKey }) => {
      if (source == 'draft') {
        if (flowId == null || revisionId == null || publicationId != null)
          throw new ControlError(controlErrorCode.runInvalid, 'Draft requires flowId and revisionId, without publicationId.')
        return (await control.createDraftRun(flowId, revisionId, currentEngineContract, inputs, idempotencyKey, trigger)).run
      }
      if (publicationId == null || flowId != null || revisionId != null)
        throw new ControlError(controlErrorCode.runInvalid, 'Live requires publicationId, without flowId or revisionId.')
      return (await control.createLiveRun(publicationId, inputs, idempotencyKey, trigger)).run
    },
  )
  register(
    'run_get',
    'Read Run status, including waiting details and allowed actions. Completed, failed, canceled and indeterminate are terminal.',
    z.strictObject({ runId: run }),
    true,
    ({ runId }) => control.getRun(runId),
  )
  register(
    'run_events',
    'Read one page of Run events. Continue with nextAfter. Events can expire independently of the terminal result.',
    z.strictObject({ runId: run, after: z.int().min(0).default(0), limit: pageLimit }),
    true,
    ({ runId, after, limit }) => control.getRunEvents(runId, after, limit),
  )
  register(
    'run_result',
    'Read the terminal result. A queued, running or waiting Run returns run.not-terminal; inspect run_get first.',
    z.strictObject({ runId: run }),
    true,
    ({ runId }) => control.getRunResult(runId),
  )
  register(
    'run_cancel',
    'Explicitly cancel a Run. Inspect cancelAccepted and the authoritative status; completion can win the race.',
    z.strictObject({ runId: run }),
    false,
    ({ runId }) => control.cancelRun(runId),
  )
  register(
    'connector_teams',
    'List OOMOL Teams available for Flow creation. An unconfigured or custom Connector may not provide Teams.',
    z.strictObject({}),
    true,
    (_, context) => service.connectorTeams(context.mcpReq.signal),
  )
  register(
    'connector_list',
    'List Connector providers available in the Flow scope.',
    z.strictObject({ flowId: flow.optional() }),
    true,
    async ({ flowId }, context) => ({ providers: await control.listConnectorProviders(flowId, context.mcpReq.signal) }),
  )
  register(
    'connector_search',
    'Search Connector actions in the Flow scope.',
    z.strictObject({ query: id, flowId: flow.optional() }),
    true,
    async ({ query, flowId }, context) => ({ actions: await control.searchConnectorActions(query, flowId, context.mcpReq.signal) }),
  )
  register(
    'connector_get',
    'Read a Connector action, input/output definitions and connection requirements before authoring a node.',
    z.strictObject({ actionId: id, flowId: flow.optional() }),
    true,
    ({ actionId, flowId }, context) => control.getConnectorAction(actionId, flowId, context.mcpReq.signal),
  )
  register(
    'connector_connections',
    'List Connector connections in the Flow scope. Use active connection IDs in bindings.',
    z.strictObject({ serviceId: id.max(256), flowId: flow.optional() }),
    true,
    async ({ serviceId, flowId }, context) => ({ connections: await control.listConnectorConnections(serviceId, flowId, context.mcpReq.signal) }),
  )
  register(
    'trigger_list',
    'List provider Trigger definitions. Manual, Webhook and Cron are built-in node kinds described by flow_schema.',
    z.strictObject({}),
    true,
    () => ({ keys: control.listTriggerKeys() }),
  )
  register('trigger_get', 'Read a provider Trigger definition before creating its node.', z.strictObject({ key: id }), true, ({ key }) => ({
    definition: control.getTriggerKey(key),
  }))
  return server
}

function result(value: unknown, isError = false): CallToolResult {
  const text = JSON.stringify(value)
  return { content: [{ type: 'text', text }], structuredContent: value as CallToolResult['structuredContent'], ...(isError ? { isError: true } : {}) }
}
