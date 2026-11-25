import type { CallToolResult, ServerContext, StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import type { McpToolset } from '@oomol-lab/open-flow/mcp'
import type { Logger } from 'pino'
import type { ServerService } from '../application/service.ts'

import { createMcpHandler, McpServer, SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/server'
import { controlErrorCode, actionSummary, searchTriggerKeys } from '@oomol-lab/open-flow/control-api'
import { authoringSchema } from '@oomol-lab/open-flow/control-requests'
import { serializeWorkflowBundle, serializeWorkflowFile, workflowBundleFromPreview } from '@oomol-lab/open-flow/flow-encoding'
import { importedWorkflowName, resolveMetadataLanguage } from '@oomol-lab/open-flow/localization'
import { mcpTools, mcpPrompts, mcpToolsets, mcpDefaultToolsets, mcpProtocolVersion, mcpInstructions } from '@oomol-lab/open-flow/mcp'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import manifest from '../../package.json' with { type: 'json' }
import { ControlError } from '../error.ts'
import { decodeFlowCursor, decodeRunCursor, encodeFlowCursor, encodeRunCursor } from './control-cursor.ts'

const validToolsets = new Set<string>(mcpToolsets)

function parseToolsets(raw: string | undefined): { readonly toolsets?: ReadonlySet<McpToolset>; readonly errorMessage?: string } {
  if (raw == null) return {}
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  if (parts.length == 0) {
    return { errorMessage: `Invalid toolsets parameter. Valid values: default, all, ${mcpToolsets.join(', ')}.` }
  }
  const expanded = new Set<McpToolset>()
  for (const part of parts) {
    if (part == 'default') {
      for (const toolset of mcpDefaultToolsets) expanded.add(toolset)
    } else if (part == 'all') {
      for (const toolset of mcpToolsets) expanded.add(toolset)
    } else if (validToolsets.has(part)) {
      expanded.add(part as McpToolset)
    } else {
      return { errorMessage: `Invalid toolsets parameter. Valid values: default, all, ${mcpToolsets.join(', ')}.` }
    }
  }
  return { toolsets: expanded }
}

function controlErrorHint(code: string): string | undefined {
  switch (code) {
    case controlErrorCode.flowRevisionConflict:
      return 'Call flow_read to inspect the latest revision before retrying flow_edit.'
    case controlErrorCode.liveConflict:
      return 'Call flow_live_get to inspect the current live publicationId before retrying.'
    case controlErrorCode.runNotTerminal:
      return 'Call run_get with view="status" and waitSeconds (up to 25) until the Run reaches a terminal state.'
    case controlErrorCode.pageInvalidCursor:
      return 'Restart pagination without cursor or use the cursor returned within the same Flow scope.'
    case controlErrorCode.connectorUnconfigured:
      return 'Configure OOMOL Connector in Settings/Workbench before calling Connector tools.'
    case controlErrorCode.flowNotFound:
      return 'Call flow_list to verify available Flow IDs for the current account.'
    case controlErrorCode.runNotFound:
      return 'Call run_list with flowId to verify available Run IDs.'
    default:
      return undefined
  }
}

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
    let actorId: string
    try {
      actorId = await authenticate(context.req.raw)
    } catch (error) {
      if (error instanceof ControlError && error.code == controlErrorCode.authenticationRequired) {
        return context.json({ error: { code: error.code, message: error.message } }, 401, {
          'WWW-Authenticate': 'Bearer realm="open-flow"',
          'Cache-Control': 'no-store',
        })
      }
      throw error
    }
    if (shutdownSignal?.aborted) return context.json({ error: { code: 'mcp.unavailable', message: 'Server is shutting down.' } }, 503)
    const parsedToolsets = parseToolsets(context.req.query('toolsets'))
    if (parsedToolsets.errorMessage != null) {
      return context.json({ error: { code: 'mcp.toolset-invalid', message: parsedToolsets.errorMessage } }, 400)
    }
    const allowedToolsets = parsedToolsets.toolsets
    const handler = createMcpHandler(
      () =>
        createServer(
          service,
          actorId,
          logger,
          new URL(context.req.url).origin,
          importedWorkflowName(resolveMetadataLanguage(undefined, context.req.header('accept-language'))),
          allowedToolsets,
        ),
      { legacy: 'stateless', responseMode: 'auto' },
    )
    try {
      return await handler.fetch(context.req.raw)
    } finally {
      await handler.close()
    }
  })
  return app
}

function createServer(
  service: ServerService,
  actorId: string,
  logger: Logger,
  endpointOrigin: string,
  defaultImportName: string,
  allowedToolsets?: ReadonlySet<McpToolset>,
) {
  const control = service.control
  const server = new McpServer(
    { name: 'open-flow', version: manifest.version },
    {
      instructions: mcpInstructions,
      supportedProtocolVersions: [mcpProtocolVersion, ...SUPPORTED_PROTOCOL_VERSIONS],
      capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
    },
  )

  function register<Args>(
    name: string,
    definition: {
      title: string
      description: string
      toolset: McpToolset
      inputSchema: StandardSchemaWithJSON<unknown, Args>
      outputSchema?: StandardSchemaWithJSON<unknown, unknown>
      annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }
    },
    execute: (args: Args, context: ServerContext) => unknown | Promise<unknown>,
  ) {
    if (allowedToolsets != null && !allowedToolsets.has(definition.toolset)) return
    server.registerTool(
      name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        ...(definition.outputSchema == null ? {} : { outputSchema: definition.outputSchema }),
        annotations: definition.annotations,
      },
      async (args, context) => {
        try {
          context.mcpReq.signal.throwIfAborted()
          return result(await execute(args, context))
        } catch (error) {
          if (context.mcpReq.signal.aborted) throw error
          if (error instanceof ControlError) {
            const hint = controlErrorHint(error.code)
            return result(
              {
                error: {
                  code: error.code,
                  message: error.message,
                  status: error.status,
                  ...(error.details == null ? {} : { details: error.details }),
                  ...(hint == null ? {} : { hint }),
                },
              },
              true,
            )
          }
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
      },
    )
  }

  for (const [name, prompt] of Object.entries(mcpPrompts)) {
    if (allowedToolsets != null && !prompt.requiredToolsets.every((toolset) => allowedToolsets.has(toolset))) continue
    server.registerPrompt(
      name,
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema: prompt.argsSchema as StandardSchemaWithJSON<unknown, Record<string, unknown>>,
      },
      (args) => prompt.render(args as never),
    )
  }

  register('server_whoami', mcpTools.server_whoami, () => {
    const user = actorId == 'operator' ? undefined : control.users.get(actorId)
    return {
      user:
        actorId == 'operator'
          ? { userId: 'operator', kind: 'operator', email: null, role: 'admin' }
          : { userId: user?.userId ?? actorId, kind: 'user', email: user?.email ?? null, role: user?.role ?? 'user' },
      server: { name: 'open-flow', version: manifest.version, origin: endpointOrigin },
    }
  })

  register('flow_list', mcpTools.flow_list, ({ cursor, limit }) => {
    const { next, page } = control.flows.listFlows(actorId, limit, cursor == null ? undefined : decodeFlowCursor(cursor), false)
    return { ...page, ...(next == null ? {} : { nextCursor: encodeFlowCursor(next) }) }
  })

  register('flow_create', mcpTools.flow_create, async ({ file, name, teamId, tagIds, idempotencyKey }) => {
    if (file == null) return (await control.flows.createFlow(actorId, name!, idempotencyKey, teamId)).flow
    if (typeof file == 'object' && 'kind' in file && file.kind == 'open-flow-workflow-bundle') {
      const { created: _created, ...imported } = await control.flows.importBundle(actorId, file, idempotencyKey, name, teamId, defaultImportName, tagIds)
      const validations = Object.fromEntries(
        await Promise.all(
          imported.flows.map(async (item) => [item.flowId, await control.drafts.staticImportValidation(actorId, item.flowId, item.draftRevisionId)] as const),
        ),
      )
      return { ...imported, validations }
    }
    const imported = (await control.flows.importFlow(actorId, file, idempotencyKey, name, teamId, defaultImportName, tagIds)).flow
    return { ...imported, validation: await control.drafts.staticImportValidation(actorId, imported.flowId, imported.draftRevisionId) }
  })

  register('flow_read', mcpTools.flow_read, ({ flowId, query, type, offset, limit, revision, nodes, text, export: exportMode }) => {
    if (exportMode != null) {
      if (exportMode == 'workflow') return serializeWorkflowFile(control.flows.exportFlow(actorId, flowId))
      const preview = control.flows.getExportPreview(actorId, flowId)
      if (preview.unavailableFlowIds.length) throw new ControlError(controlErrorCode.flowInvalid, 'Some referenced workflows are unavailable.')
      return serializeWorkflowBundle(workflowBundleFromPreview(preview))
    }
    if (query != null) {
      return control.drafts.searchAuthoring(actorId, flowId, {
        query,
        ...(revision == null ? {} : { revision }),
        ...(type == null ? {} : { type }),
        offset: offset ?? 0,
        limit: limit ?? 20,
      })
    }
    return control.drafts.readAuthoring(actorId, flowId, {
      ...(revision == null ? {} : { revision }),
      ...(nodes == null ? {} : { nodes }),
      ...(text == null ? {} : { text }),
    })
  })

  register('flow_schema', mcpTools.flow_schema, ({ flowId, ...query }) => {
    if (flowId != null) return control.drafts.authoringSchema(actorId, flowId, query)
    if (query.action != null) throw new ControlError(controlErrorCode.flowInvalid, 'Action lookup requires flowId.')
    return authoringSchema(query.type)
  })

  register('flow_edit', mcpTools.flow_edit, ({ flowId, ...request }) => control.drafts.editAuthoring(actorId, flowId, request))

  register('flow_check', mcpTools.flow_check, ({ flowId, revisionId }) => control.drafts.checkAuthoring(actorId, flowId, revisionId))

  register('flow_canvas_control', mcpTools.flow_canvas_control, ({ flowId, command }) => control.flows.broadcastCanvas(actorId, flowId, command))

  register('flow_live_get', mcpTools.flow_live_get, async ({ flowId, operationId, waitSeconds }, context) => {
    if (operationId == null) return control.publications.getLiveDetails(actorId, flowId, endpointOrigin)
    if (waitSeconds != null && waitSeconds > 0) {
      await service.waitForPublishOperation(actorId, flowId, operationId, waitSeconds * 1000, context.mcpReq.signal)
      context.mcpReq.signal.throwIfAborted()
    }
    return control.publications.getPublishOperation(actorId, flowId, operationId)
  })

  register('flow_publish', mcpTools.flow_publish, async ({ flowId, revisionId, expectedLivePublicationId, idempotencyKey, waitSeconds }, context) => {
    const operation = await control.publications.publishFlow(actorId, flowId, revisionId, currentEngineContract, expectedLivePublicationId, idempotencyKey)
    if (waitSeconds != null && waitSeconds > 0 && operation.status == 'pending') {
      await service.waitForPublishOperation(actorId, flowId, operation.operationId, waitSeconds * 1000, context.mcpReq.signal)
      context.mcpReq.signal.throwIfAborted()
      return control.publications.getPublishOperation(actorId, flowId, operation.operationId)
    }
    return operation
  })

  register('flow_live_set', mcpTools.flow_live_set, ({ flowId, expectedPublicationId, enabled }) =>
    control.publications.setFlowEnabled(actorId, flowId, expectedPublicationId, enabled),
  )

  register('flow_state_get', mcpTools.flow_state_get, ({ flowId, scope, keys }) =>
    keys == null ? control.state.read(actorId, flowId, { scope }) : control.state.readValues(actorId, flowId, { scope, keys }),
  )

  register('flow_state_clear', mcpTools.flow_state_clear, ({ flowId, scope, target, key, space }) =>
    target == 'dedupe'
      ? control.state.clearDedupe(actorId, flowId, { scope, space: space! })
      : control.state.clear(actorId, flowId, { scope, ...(key == null ? {} : { key }) }),
  )

  register('run_start', mcpTools.run_start, async (args, context) => {
    const started = (
      args.source == 'draft'
        ? await control.runs.createDraftRun(
            actorId,
            args.flowId!,
            args.revisionId!,
            currentEngineContract,
            args.inputs,
            args.idempotencyKey,
            args.trigger,
            'mcp',
          )
        : await control.runs.createLiveRun(actorId, args.publicationId!, args.inputs, args.idempotencyKey, args.trigger, 'mcp')
    ).run
    if (args.waitSeconds != null && args.waitSeconds > 0) {
      await service.waitForRunTransition(actorId, started.runId, args.waitSeconds * 1000, context.mcpReq.signal)
      context.mcpReq.signal.throwIfAborted()
      return control.runs.getRun(actorId, started.runId)
    }
    return started
  })

  register('run_list', mcpTools.run_list, ({ flowId, status, cursor, limit, pendingWait }) => {
    const { next, page } = control.runs.listRuns(actorId, flowId, limit, {
      ...(status == null ? {} : { status }),
      ...(pendingWait == null ? {} : { pendingWait }),
      ...(cursor == null ? {} : { after: decodeRunCursor(cursor, flowId) }),
    })
    return { ...page, ...(next == null ? {} : { nextCursor: encodeRunCursor(flowId, next) }) }
  })

  register('run_get', mcpTools.run_get, async ({ runId, view, waitSeconds, after, limit, resultId, pointer, offset, maxBytes }, context) => {
    switch (view) {
      case 'status': {
        if (waitSeconds != null && waitSeconds > 0) {
          await service.waitForRunTransition(actorId, runId, waitSeconds * 1000, context.mcpReq.signal)
          context.mcpReq.signal.throwIfAborted()
        }
        return control.runs.getRun(actorId, runId)
      }
      case 'result':
        return control.runs.getRunResult(actorId, runId)
      case 'events':
        return control.runs.getRunEvents(actorId, runId, (after as number | undefined) ?? 0, limit ?? 50)
      case 'tool_results':
        if (resultId == null) return control.runs.listRunResults(actorId, runId, after as string | undefined)
        return control.runs.readRunResult(actorId, runId, resultId, {
          pointer: pointer ?? '',
          offset: offset ?? 0,
          limit: limit ?? 20,
          maxBytes: maxBytes ?? 15000,
        })
    }
  })

  register('run_resolve_wait', mcpTools.run_resolve_wait, ({ runId, waitId, action, comment }) =>
    control.runs.resolveRunWait(actorId, runId, waitId, action, comment),
  )

  register('run_cancel', mcpTools.run_cancel, ({ runId }) => control.runs.cancelRun(actorId, runId))

  register('flow_connections_get', mcpTools.flow_connections_get, ({ flowId, publicationId, providerIds }, context) =>
    providerIds != null
      ? control.connectors.getProviderAccessBindingCandidates(actorId, flowId, providerIds, context.mcpReq.signal)
      : control.connectors.getConnectorAccess(actorId, flowId, publicationId),
  )

  register('flow_connections_edit', mcpTools.flow_connections_edit, (args) =>
    args.action == 'set_code_binding'
      ? args.selected
        ? control.connectors.addProviderAccessBinding(actorId, args.flowId, args.providerId!, args.accessBindingId!, args.expectedAccessRevision)
        : control.connectors.removeProviderAccessBinding(actorId, args.flowId, args.providerId!, args.accessBindingId!, args.expectedAccessRevision)
      : control.drafts.removeConnectionUsage(
          actorId,
          args.flowId,
          args.connectionId!,
          args.expectedRevisionId!,
          args.expectedAccessRevision,
          args.idempotencyKey!,
        ),
  )

  register('catalog_get', mcpTools.catalog_get, async ({ resource, flowId, query, actionId, serviceId, key }, context) => {
    switch (resource) {
      case 'teams': {
        const { enabled, teams, version } = await service.connectorTeams(context.mcpReq.signal)
        return { enabled, teams, version }
      }
      case 'providers':
        return { providers: await control.connectors.listConnectorProviders(actorId, flowId, context.mcpReq.signal) }
      case 'actions':
        return { actions: (await control.connectors.searchConnectorActions(actorId, query!, flowId, context.mcpReq.signal)).map(actionSummary) }
      case 'action':
        return control.connectors.getConnectorAction(actorId, actionId!, flowId, context.mcpReq.signal)
      case 'connections':
        return { connections: await control.connectors.listConnectorConnections(actorId, serviceId!, flowId, context.mcpReq.signal) }
      case 'event_sources': {
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
      }
      case 'triggers':
        return { keys: searchTriggerKeys(control.drafts.listTriggerKeys(), query) }
      case 'trigger':
        return { definition: control.drafts.getTriggerKey(key!) }
    }
  })

  return server
}

function result(value: unknown, isError = false): CallToolResult {
  const text = JSON.stringify(value)
  if (isError) return { content: [{ type: 'text', text }], isError: true }
  return { content: [{ type: 'text', text }], structuredContent: value as CallToolResult['structuredContent'] }
}
