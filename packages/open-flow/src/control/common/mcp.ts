import type { JsonValue } from '../../flow/common/change.ts'

import { z } from 'zod'
import { canvasCommandSchema } from '../../canvas/common/commands.ts'
import { runStatuses } from '../../execution/common/runLifecycle.ts'
import { waitCommentSchema } from '../../execution/common/wait.ts'
import { resourceNameIssue } from '../../flow/common/change.ts'
import { stateClearSchema, stateReadSchema, dedupeClearSchema } from '../../state/common/state.ts'
import { authoringReadSchema, authoringSearchSchema, authoringRequestSchema, authoringSchemaQuery } from './authoringSchema.ts'

export const mcpProtocolVersion = '2026-07-28'
export const mcpToolsets = ['core', 'authoring', 'publish', 'state', 'runs', 'connections', 'catalog', 'canvas'] as const
export type McpToolset = (typeof mcpToolsets)[number]
export const mcpDefaultToolsets = ['core', 'authoring', 'publish', 'runs', 'catalog'] as const

const json: z.ZodType<JsonValue> = z.json()
const id = z.string().min(1)
const mutationKey = id.max(256).describe('Stable identity for this mutation. Retry with the same key and identical arguments, even after a lost response.')
const pageLimit = z.int().min(1).max(100).default(50)
const flow = id.describe('Exact Flow ID returned by flow_list or flow_create.')
const run = id.describe('Exact Run ID returned by run_start or run_list.')
const waitSeconds = z.int().min(0).max(25).optional().describe('Optional seconds (0–25) to wait for a state transition before returning.')

export const mcpInstructions =
  'Keep Flow and node names short (2–4 English words or 4–8 Chinese chars, matching the user or existing workflow language); put details in descriptions. Preserve user-supplied names. ' +
  'Use flow_read to inspect, search, or export workflows (omit nodes/text/query/export for an outline, or pass one mode) and flow_schema to read node/action schemas. ' +
  'Edit drafts atomically with flow_edit using the observed baseRevision and a stable requestId; use $alias for preceding node.add items (never bare alias). ' +
  'New Flows have no Trigger until you add one (check catalog_get resource="event_sources" before adding shared-source Triggers). ' +
  'Always run flow_check before run_start. Use waitSeconds (up to 25s) on flow_publish, flow_live_get, run_start, and run_get to avoid tight polling loops. ' +
  'Retry mutations with identical arguments and the same idempotencyKey/requestId. Never auto-retry flow_canvas_control (pan is relative) or auto-approve run_resolve_wait. ' +
  'Use prompts (author_flow, publish_and_run_flow, debug_run) for full step-by-step playbooks.'

function isJsonValueSchemaNode(node: unknown, defName: string): boolean {
  if (node == null || typeof node != 'object' || Array.isArray(node)) return false
  const anyOf = (node as { anyOf?: unknown }).anyOf
  if (!Array.isArray(anyOf) || anyOf.length != 6) return false
  return anyOf.some(
    (branch) =>
      branch != null &&
      typeof branch == 'object' &&
      (branch as { type?: unknown }).type == 'array' &&
      (branch as { items?: { $ref?: unknown } }).items?.$ref == `#/$defs/${defName}`,
  )
}

const longReferenceDescription =
  'An existing node reference returned by read/search, or $alias for a preceding node.add in this edit batch. For node.add.as "step", reference "$step", never bare "step". Aliases are local to one batch.'

function replaceJsonRefs(node: unknown, jsonDefRefs: ReadonlySet<string>): unknown {
  if (Array.isArray(node)) return node.map((item) => replaceJsonRefs(item, jsonDefRefs))
  if (node == null || typeof node != 'object') return node
  const record = node as Record<string, unknown>
  if (typeof record.$ref == 'string' && jsonDefRefs.has(record.$ref)) {
    const rest = Object.fromEntries(Object.entries(record).filter(([key]) => key != '$ref'))
    return rest
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key == 'description' && value == longReferenceDescription) out[key] = 'Existing node ID or $alias.'
    else out[key] = replaceJsonRefs(value, jsonDefRefs)
  }
  return out
}

function normalizeMcpJsonSchema(raw: Record<string, unknown>, options?: { stripTopLevelNot?: boolean }): Record<string, unknown> {
  const defs = raw.$defs as Record<string, unknown> | undefined
  const jsonDefNames = new Set<string>()
  if (defs != null && typeof defs == 'object') {
    for (const [name, def] of Object.entries(defs)) {
      if (isJsonValueSchemaNode(def, name)) jsonDefNames.add(name)
    }
  }
  const jsonDefRefs = new Set([...jsonDefNames].map((name) => `#/$defs/${name}`))
  const normalized = replaceJsonRefs(raw, jsonDefRefs) as Record<string, unknown>
  if (normalized.$defs != null && typeof normalized.$defs == 'object') {
    const nextDefs = { ...(normalized.$defs as Record<string, unknown>) }
    for (const name of jsonDefNames) delete nextDefs[name]
    if (Object.keys(nextDefs).length == 0) delete normalized.$defs
    else normalized.$defs = nextDefs
  }
  if (options?.stripTopLevelNot) delete normalized.not
  return normalized
}

function wrapSchema<Args>(schema: z.ZodType<Args>, options?: { stripTopLevelNot?: boolean; dedupeRefs?: boolean }) {
  let cachedInput: Record<string, unknown> | undefined
  let cachedOutput: Record<string, unknown> | undefined
  const reused = options?.dedupeRefs ? ('ref' as const) : undefined
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'open-flow',
      jsonSchema: {
        input: (): Record<string, unknown> => (cachedInput ??= normalizeMcpJsonSchema(z.toJSONSchema(schema, { io: 'input', reused }), options)),
        output: (): Record<string, unknown> => (cachedOutput ??= normalizeMcpJsonSchema(z.toJSONSchema(schema, { reused }), options)),
      },
      validate(value: unknown): { value: Args } | { issues: { message: string; path: string[] }[] } {
        const result = schema.safeParse(value)
        return result.success
          ? { value: result.data }
          : { issues: result.error.issues.map((issue) => ({ message: issue.message, path: issue.path.map(String) })) }
      },
    },
  }
}

interface McpToolConfig<Args, Out = unknown> {
  readonly title: string
  readonly description: string
  readonly inputSchema: z.ZodType<Args>
  readonly outputSchema?: z.ZodType<Out>
  readonly readOnly: boolean
  readonly destructive?: boolean
  readonly idempotent?: boolean
  readonly openWorld?: boolean
  readonly toolset: McpToolset
  readonly stripTopLevelNot?: boolean
  readonly dedupeRefs?: boolean
}

function tool<Args, Out = unknown>(config: McpToolConfig<Args, Out>) {
  return {
    title: config.title,
    description: config.description,
    toolset: config.toolset,
    annotations: {
      readOnlyHint: config.readOnly,
      destructiveHint: config.destructive ?? false,
      idempotentHint: config.idempotent ?? true,
      openWorldHint: config.openWorld ?? false,
    },
    inputSchema: wrapSchema(config.inputSchema, { stripTopLevelNot: config.stripTopLevelNot, dedupeRefs: config.dedupeRefs }),
    ...(config.outputSchema == null ? {} : { outputSchema: wrapSchema(config.outputSchema) }),
  }
}

const flowCreateInputSchema = z
  .strictObject({
    name: id
      .refine((name) => name == name.trim() && resourceNameIssue(name) == null, 'Flow name is invalid.')
      .optional()
      .describe('Flow name (required when creating an empty Flow; optional override when importing file).'),
    file: json.optional().describe('Omit to create an empty Flow; provide workflow JSON or bundle to import as unpublished draft(s).'),
    teamId: id.optional(),
    tagIds: z.array(id).optional().describe('Optional tags applied to every imported workflow (valid only with file).'),
    idempotencyKey: mutationKey,
  })
  .superRefine((value, ctx) => {
    if (value.file == null) {
      if (value.name == null) ctx.addIssue({ code: 'custom', path: ['name'], message: 'name is required when file is omitted.' })
      if (value.tagIds != null) ctx.addIssue({ code: 'custom', path: ['tagIds'], message: 'tagIds is only valid when importing file.' })
    }
  })

const flowReadInputSchema = z
  .strictObject({
    flowId: flow,
    revision: authoringReadSchema.shape.revision,
    nodes: authoringReadSchema.shape.nodes,
    text: authoringReadSchema.shape.text,
    query: authoringSearchSchema.shape.query.optional().describe('Search nodes, configuration or source text at the pinned revision.'),
    type: authoringSearchSchema.shape.type,
    offset: z.int().nonnegative().optional().describe('Search pagination offset (use only with query).'),
    limit: z.int().min(1).max(100).optional().describe('Search page size 1–100 (use only with query).'),
    export: z.enum(['workflow', 'bundle']).optional().describe('Export the current draft as shareable workflow JSON or a dependency bundle.'),
  })
  .superRefine((value, ctx) => {
    const modes = [value.nodes != null, value.text != null, value.query != null, value.export != null].filter(Boolean).length
    if (modes > 1) {
      ctx.addIssue({ code: 'custom', message: 'Provide at most one of nodes, text, query, or export.' })
    }
    if (value.query == null && (value.type != null || value.offset != null || value.limit != null)) {
      ctx.addIssue({ code: 'custom', message: 'type, offset, and limit require query.' })
    }
    if (value.export != null && value.revision != null) {
      ctx.addIssue({ code: 'custom', path: ['revision'], message: 'revision is not valid when exporting.' })
    }
  })

const flowLiveGetSchema = z
  .strictObject({
    flowId: flow,
    operationId: id.optional().describe('Omit to read current live details; provide to check a publish operation.'),
    waitSeconds,
  })
  .superRefine((value, ctx) => {
    if (value.waitSeconds != null && value.operationId == null) {
      ctx.addIssue({ code: 'custom', message: 'waitSeconds requires operationId.' })
    }
  })

const flowStateGetSchema = z.strictObject({
  flowId: flow,
  scope: z.enum(['draft', 'live']),
  keys: stateReadSchema.shape.keys.optional().describe('Omit to inspect state metadata and dedupe spaces; pass 1–16 distinct keys to read their values.'),
})

const flowStateClearSchema = z
  .strictObject({
    flowId: flow,
    scope: z.enum(['draft', 'live']),
    target: z.enum(['state', 'dedupe']).default('state').describe('Clear business state keys or a deduplication space.'),
    key: stateClearSchema.shape.key.describe('Optional business key when target is state; omit to clear all business keys.'),
    space: dedupeClearSchema.shape.space.optional().describe('Required when target is dedupe (flow or node:<id>).'),
  })
  .superRefine((value, ctx) => {
    if (value.target == 'state' && value.space != null) {
      ctx.addIssue({ code: 'custom', path: ['space'], message: 'space is only valid when target is dedupe.' })
    }
    if (value.target == 'dedupe') {
      if (value.space == null) ctx.addIssue({ code: 'custom', path: ['space'], message: 'space is required when target is dedupe.' })
      if (value.key != null) ctx.addIssue({ code: 'custom', path: ['key'], message: 'key is not valid when target is dedupe.' })
    }
  })

const runStartSchema = z
  .strictObject({
    source: z.enum(['draft', 'live']),
    flowId: flow.optional().describe('Required when source is draft; forbidden for live.'),
    revisionId: id.optional().describe('Required when source is draft; forbidden for live.'),
    publicationId: id.optional().describe('Required when source is live; forbidden for draft.'),
    trigger: z.strictObject({ nodeId: id, outputs: z.record(z.string(), json) }),
    inputs: z.record(z.string(), z.record(z.string(), json)).default({}),
    idempotencyKey: mutationKey,
    waitSeconds,
  })
  .superRefine((value, ctx) => {
    if (value.source == 'draft') {
      if (value.flowId == null) ctx.addIssue({ code: 'custom', path: ['flowId'], message: 'flowId is required when source is draft.' })
      if (value.revisionId == null) ctx.addIssue({ code: 'custom', path: ['revisionId'], message: 'revisionId is required when source is draft.' })
      if (value.publicationId != null) ctx.addIssue({ code: 'custom', path: ['publicationId'], message: 'publicationId is forbidden when source is draft.' })
    } else {
      if (value.publicationId == null) ctx.addIssue({ code: 'custom', path: ['publicationId'], message: 'publicationId is required when source is live.' })
      if (value.flowId != null) ctx.addIssue({ code: 'custom', path: ['flowId'], message: 'flowId is forbidden when source is live.' })
      if (value.revisionId != null) ctx.addIssue({ code: 'custom', path: ['revisionId'], message: 'revisionId is forbidden when source is live.' })
    }
  })

const runGetSchema = z
  .strictObject({
    runId: run,
    view: z.enum(['status', 'result', 'events', 'tool_results']).default('status'),
    waitSeconds,
    after: z
      .union([z.int().min(0), id])
      .optional()
      .describe('Pagination cursor: integer >= 0 for events, or nextAfter string for listing tool_results.'),
    limit: z.int().min(1).max(100).optional().describe('Page size 1–100 (for events or reading a tool_results item).'),
    resultId: id.optional().describe('Omit in tool_results view to list metadata; provide to read a stored tool result page.'),
    pointer: z.string().max(4096).optional().describe('JSON Pointer within a stored tool result (requires resultId).'),
    offset: z.number().int().nonnegative().optional().describe('Page offset within a stored tool result (requires resultId).'),
    maxBytes: z.number().int().min(1).max(1048576).optional().describe('Byte cap 1–1048576 for reading a stored tool result (requires resultId).'),
  })
  .superRefine((value, ctx) => {
    if (value.waitSeconds != null && value.view != 'status') {
      ctx.addIssue({ code: 'custom', path: ['waitSeconds'], message: 'waitSeconds is only valid when view is status.' })
    }
    if (value.view != 'tool_results' && (value.resultId != null || value.pointer != null || value.offset != null || value.maxBytes != null)) {
      ctx.addIssue({ code: 'custom', message: 'resultId, pointer, offset, and maxBytes are only valid when view is tool_results.' })
    }
    if (
      value.view == 'tool_results' &&
      value.resultId == null &&
      (value.pointer != null || value.offset != null || value.maxBytes != null || value.limit != null)
    ) {
      ctx.addIssue({ code: 'custom', message: 'pointer, offset, maxBytes, and limit require resultId in tool_results view.' })
    }
    if (value.view == 'tool_results' && value.resultId != null && value.after != null) {
      ctx.addIssue({ code: 'custom', path: ['after'], message: 'after is only valid when listing tool_results without resultId.' })
    }
    if (value.view == 'events' && value.after != null && typeof value.after != 'number') {
      ctx.addIssue({ code: 'custom', path: ['after'], message: 'events view requires a non-negative integer after.' })
    }
    if (value.view == 'tool_results' && value.after != null && typeof value.after != 'string') {
      ctx.addIssue({ code: 'custom', path: ['after'], message: 'tool_results view requires a string after cursor.' })
    }
    if ((value.view == 'status' || value.view == 'result') && (value.after != null || value.limit != null)) {
      ctx.addIssue({ code: 'custom', message: 'after and limit are not valid for status or result views.' })
    }
  })

const flowConnectionsGetSchema = z
  .strictObject({
    flowId: flow,
    publicationId: id.optional().describe('Read a fixed published snapshot of shared Code connections.'),
    providerIds: z.array(id).min(1).optional().describe('Provide to list available connection candidates for these providers.'),
  })
  .superRefine((value, ctx) => {
    if (value.publicationId != null && value.providerIds != null) {
      ctx.addIssue({ code: 'custom', message: 'publicationId and providerIds are mutually exclusive.' })
    }
  })

const flowConnectionsEditSchema = z
  .strictObject({
    flowId: flow,
    action: z.enum(['set_code_binding', 'remove_usage']),
    expectedAccessRevision: z.int().nonnegative(),
    providerId: id.optional().describe('Required for set_code_binding.'),
    accessBindingId: id.optional().describe('Required for set_code_binding.'),
    selected: z.boolean().optional().describe('Required for set_code_binding.'),
    connectionId: id.optional().describe('Required for remove_usage.'),
    expectedRevisionId: id.optional().describe('Required for remove_usage.'),
    idempotencyKey: mutationKey.optional().describe('Required for remove_usage.'),
  })
  .superRefine((value, ctx) => {
    if (value.action == 'set_code_binding') {
      if (value.providerId == null) ctx.addIssue({ code: 'custom', path: ['providerId'], message: 'providerId is required for set_code_binding.' })
      if (value.accessBindingId == null)
        ctx.addIssue({ code: 'custom', path: ['accessBindingId'], message: 'accessBindingId is required for set_code_binding.' })
      if (value.selected == null) ctx.addIssue({ code: 'custom', path: ['selected'], message: 'selected is required for set_code_binding.' })
      if (value.connectionId != null || value.expectedRevisionId != null || value.idempotencyKey != null) {
        ctx.addIssue({ code: 'custom', message: 'connectionId, expectedRevisionId, and idempotencyKey are forbidden for set_code_binding.' })
      }
    } else {
      if (value.connectionId == null) ctx.addIssue({ code: 'custom', path: ['connectionId'], message: 'connectionId is required for remove_usage.' })
      if (value.expectedRevisionId == null)
        ctx.addIssue({ code: 'custom', path: ['expectedRevisionId'], message: 'expectedRevisionId is required for remove_usage.' })
      if (value.idempotencyKey == null) ctx.addIssue({ code: 'custom', path: ['idempotencyKey'], message: 'idempotencyKey is required for remove_usage.' })
      if (value.providerId != null || value.accessBindingId != null || value.selected != null) {
        ctx.addIssue({ code: 'custom', message: 'providerId, accessBindingId, and selected are forbidden for remove_usage.' })
      }
    }
  })

const catalogGetSchema = z
  .strictObject({
    resource: z.enum(['teams', 'providers', 'actions', 'action', 'connections', 'event_sources', 'triggers', 'trigger']),
    flowId: flow.optional().describe('Optional Flow scope for providers, actions, action, and connections.'),
    query: z.string().trim().min(1).max(256).optional().describe('Search query (required for actions, optional for triggers).'),
    actionId: id.optional().describe('Required when resource is action.'),
    serviceId: id.max(256).optional().describe('Required when resource is connections.'),
    key: id.optional().describe('Required when resource is trigger.'),
  })
  .superRefine((value, ctx) => {
    const flowScoped = value.resource == 'providers' || value.resource == 'actions' || value.resource == 'action' || value.resource == 'connections'
    if (!flowScoped && value.flowId != null) {
      ctx.addIssue({ code: 'custom', path: ['flowId'], message: `flowId is not valid for resource ${value.resource}.` })
    }
    if (value.resource == 'actions') {
      if (value.query == null) ctx.addIssue({ code: 'custom', path: ['query'], message: 'query is required when resource is actions.' })
    } else if (value.resource != 'triggers' && value.query != null) {
      ctx.addIssue({ code: 'custom', path: ['query'], message: 'query is only valid for actions or triggers.' })
    }
    if (value.resource == 'action') {
      if (value.actionId == null) ctx.addIssue({ code: 'custom', path: ['actionId'], message: 'actionId is required when resource is action.' })
    } else if (value.actionId != null) {
      ctx.addIssue({ code: 'custom', path: ['actionId'], message: 'actionId is only valid when resource is action.' })
    }
    if (value.resource == 'connections') {
      if (value.serviceId == null) ctx.addIssue({ code: 'custom', path: ['serviceId'], message: 'serviceId is required when resource is connections.' })
    } else if (value.serviceId != null) {
      ctx.addIssue({ code: 'custom', path: ['serviceId'], message: 'serviceId is only valid when resource is connections.' })
    }
    if (value.resource == 'trigger') {
      if (value.key == null) ctx.addIssue({ code: 'custom', path: ['key'], message: 'key is required when resource is trigger.' })
    } else if (value.key != null) {
      ctx.addIssue({ code: 'custom', path: ['key'], message: 'key is only valid when resource is trigger.' })
    }
  })

export const mcpTools = {
  server_whoami: tool({
    title: 'Check Server Identity',
    description: 'Check MCP connectivity and return the authenticated account identity and Server information.',
    inputSchema: z.strictObject({}),
    outputSchema: z.looseObject({
      user: z.looseObject({
        userId: z.string(),
        kind: z.enum(['operator', 'user']),
        email: z.string().nullable(),
        role: z.string(),
      }),
      server: z.looseObject({
        name: z.string(),
        version: z.string(),
        origin: z.string(),
      }),
    }),
    readOnly: true,
    toolset: 'core',
  }),
  flow_list: tool({
    title: 'List Flows',
    description: 'List Flows in this deployment. Continue with nextCursor; cursors are compatible with the Control API.',
    inputSchema: z.strictObject({ cursor: id.optional(), limit: pageLimit }),
    outputSchema: z.looseObject({
      flows: z.array(z.looseObject({ flowId: z.string() })),
      nextCursor: z.string().optional(),
    }),
    readOnly: true,
    toolset: 'core',
  }),
  flow_create: tool({
    title: 'Create or Import Flow',
    description:
      'Create an empty Flow (omit file) or import workflow JSON / bundle as unpublished draft(s) (pass file). If this deployment uses OOMOL Connector, choose teamId from catalog_get (resource="teams"). Keep key and arguments stable on retry.',
    inputSchema: flowCreateInputSchema,
    readOnly: false,
    toolset: 'authoring',
  }),
  flow_read: tool({
    title: 'Read, Search, or Export Flow',
    description:
      'Inspect or export a Flow. Omit nodes, text, query, and export for an outline; pass nodes for details, text for a line excerpt, query to search, or export ("workflow" | "bundle") for shareable JSON.',
    inputSchema: flowReadInputSchema,
    readOnly: true,
    toolset: 'authoring',
    stripTopLevelNot: true,
  }),
  flow_schema: tool({
    title: 'Read Node or Action Schema',
    description: 'Read node configuration schemas and edit grammar by type, or read an Action contract by action (requires flowId).',
    inputSchema: authoringSchemaQuery.safeExtend({ flowId: flow.optional() }),
    readOnly: true,
    toolset: 'authoring',
  }),
  flow_edit: tool({
    title: 'Edit Flow Draft',
    description:
      'Atomically edit root nodes, input sources, execution edges and text. Use $alias (e.g. "$step" for node.add.as="step", never bare "step") for preceding creations in the same batch. Preserve baseRevision and requestId when retrying.',
    inputSchema: authoringRequestSchema.extend({ flowId: flow }),
    readOnly: false,
    toolset: 'authoring',
    dedupeRefs: true,
  }),
  flow_check: tool({
    title: 'Check Flow Revision',
    description: 'Validate a fixed Revision and return diagnostics. Use the revision returned by flow_read or flow_edit as revisionId.',
    inputSchema: z.strictObject({ flowId: flow, revisionId: id }),
    outputSchema: z.looseObject({
      valid: z.boolean(),
      diagnostics: z.array(z.unknown()),
    }),
    readOnly: true,
    toolset: 'authoring',
  }),
  flow_canvas_control: tool({
    title: 'Control Workbench Canvas',
    description: 'Broadcast a transient viewport command (focus, zoom, pan, fit) to connected Workbenches. Pan is relative; never automatically retry.',
    inputSchema: z.strictObject({ flowId: flow, command: canvasCommandSchema }),
    readOnly: false,
    idempotent: false,
    toolset: 'canvas',
  }),
  flow_live_get: tool({
    title: 'Get Live Flow or Publish Status',
    description:
      'Omit operationId to read current live publication, enablement, and online entries; pass operationId (with optional waitSeconds) to poll a publish operation.',
    inputSchema: flowLiveGetSchema,
    readOnly: true,
    toolset: 'publish',
  }),
  flow_publish: tool({
    title: 'Publish Flow Revision',
    description:
      'Publish a fixed Revision. Supply observed expectedLivePublicationId (or null for first publish) and a stable idempotencyKey. Optionally waitSeconds up to 25s for completion.',
    inputSchema: z.strictObject({ flowId: flow, revisionId: id, expectedLivePublicationId: id.nullable(), idempotencyKey: mutationKey, waitSeconds }),
    outputSchema: z.looseObject({
      operationId: z.string(),
      status: z.string(),
    }),
    readOnly: false,
    openWorld: true,
    toolset: 'publish',
  }),
  flow_live_set: tool({
    title: 'Enable or Disable Live Flow',
    description: 'Enable or disable the observed Live publication (supply expectedPublicationId from flow_list or flow_live_get). Does not cancel active Runs.',
    inputSchema: z.strictObject({ flowId: flow, expectedPublicationId: id, enabled: z.boolean() }),
    readOnly: false,
    toolset: 'publish',
  }),
  flow_state_get: tool({
    title: 'Read Flow State',
    description: 'Inspect Flow state metadata and deduplication spaces (omit keys), or read values for 1–16 distinct named State keys (1 MiB combined limit).',
    inputSchema: flowStateGetSchema,
    readOnly: true,
    toolset: 'state',
  }),
  flow_state_clear: tool({
    title: 'Clear Flow State or Dedupe',
    description:
      'Delete one or all business state keys (target="state"), or clear a deduplication space (target="dedupe", space="flow" or "node:<id>"). Live changes production state immediately.',
    inputSchema: flowStateClearSchema,
    readOnly: false,
    destructive: true,
    toolset: 'state',
  }),
  run_start: tool({
    title: 'Start Flow Run',
    description:
      'Start a Run and return its runId. For source="draft" supply flowId and revisionId; for source="live" supply publicationId. Supply Start/Trigger parameters in trigger.outputs. Optionally waitSeconds up to 25s.',
    inputSchema: runStartSchema,
    outputSchema: z.looseObject({
      runId: z.string(),
      status: z.string(),
    }),
    readOnly: false,
    openWorld: true,
    toolset: 'runs',
  }),
  run_list: tool({
    title: 'List Flow Runs',
    description: 'List Runs for a Flow, optionally filtered by status or pendingWait. Continue with nextCursor.',
    inputSchema: z.strictObject({
      flowId: flow,
      pendingWait: z.boolean().optional(),
      status: z.enum(runStatuses).optional(),
      cursor: id.optional(),
      limit: pageLimit,
    }),
    readOnly: true,
    toolset: 'runs',
  }),
  run_get: tool({
    title: 'Inspect Run',
    description:
      'Inspect a Run by view: "status" (default, supports waitSeconds), "result" (terminal result), "events" (paginated with after/limit), or "tool_results" (omit resultId to list, pass resultId/pointer/offset/limit/maxBytes to read).',
    inputSchema: runGetSchema,
    readOnly: true,
    toolset: 'runs',
  }),
  run_resolve_wait: tool({
    title: 'Resolve Waiting Run',
    description: 'Explicitly resolve a waitId observed in run_get with one of its allowed actions (approve, continue, reject). First decision wins.',
    inputSchema: z.strictObject({ runId: run, waitId: id, action: z.enum(['approve', 'continue', 'reject']), comment: waitCommentSchema }),
    outputSchema: z.looseObject({
      resolutionAccepted: z.boolean(),
      action: z.string(),
    }),
    readOnly: false,
    toolset: 'runs',
  }),
  run_cancel: tool({
    title: 'Cancel Run',
    description: 'Explicitly cancel a Run. Inspect cancelAccepted and the authoritative status; completion can win the race.',
    inputSchema: z.strictObject({ runId: run }),
    outputSchema: z.looseObject({
      cancelAccepted: z.boolean(),
      status: z.string(),
    }),
    readOnly: false,
    destructive: true,
    toolset: 'runs',
  }),
  flow_connections_get: tool({
    title: 'Get Flow Connections',
    description:
      'Omit providerIds to read shared Code node connections (optionally at publicationId); pass providerIds to list available connection candidates.',
    inputSchema: flowConnectionsGetSchema,
    readOnly: true,
    openWorld: true,
    toolset: 'connections',
  }),
  flow_connections_edit: tool({
    title: 'Edit Flow Connections',
    description:
      'Edit Draft connection bindings: "set_code_binding" adds/removes shared Code usage; "remove_usage" atomically removes a connection from all nodes and shared Code.',
    inputSchema: flowConnectionsEditSchema,
    readOnly: false,
    destructive: true,
    toolset: 'connections',
  }),
  catalog_get: tool({
    title: 'Browse Connector & Trigger Catalog',
    description:
      'Discover Connector and Trigger resources: "teams", "providers", "actions" (requires query), "action" (requires actionId), "connections" (requires serviceId), "event_sources", "triggers" (optional query), or "trigger" (requires key).',
    inputSchema: catalogGetSchema,
    readOnly: true,
    openWorld: true,
    toolset: 'catalog',
  }),
} as const

export interface McpPromptDefinition<Args> {
  readonly title: string
  readonly description: string
  readonly argsSchema: ReturnType<typeof wrapSchema<Args>>
  render(args: Args): { messages: { role: 'user'; content: { type: 'text'; text: string } }[] }
}

const authorFlowArgs = z.strictObject({
  flowId: z.string().optional().describe('Existing Flow ID to edit, or omit to create a new Flow.'),
  goal: z.string().optional().describe('Desired workflow behavior or edit goal.'),
})

const publishAndRunArgs = z.strictObject({
  flowId: z.string().describe('Flow ID to validate, publish, and run.'),
  revisionId: z.string().optional().describe('Draft revision ID if already known.'),
})

const debugRunArgs = z.strictObject({
  runId: z.string().describe('Run ID to inspect and troubleshoot.'),
})

export const mcpPrompts = {
  author_flow: {
    title: 'Author or Edit Flow',
    description: 'Step-by-step workflow for inspecting, authoring, and validating an Open Flow draft.',
    argsSchema: wrapSchema(authorFlowArgs),
    render: ({ flowId, goal }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              flowId == null
                ? '1. Call catalog_get(resource="teams") if Connector teams are enabled, then flow_create(name, idempotencyKey).'
                : `1. Call flow_read(flowId="${flowId}") to inspect the current outline and revision.`,
              '2. Use flow_schema(type) for node configuration rules and catalog_get for Connector actions/connections/event_sources or provider triggers.',
              '3. Apply atomic edits with flow_edit(flowId, baseRevision, requestId, edits). Use $alias for newly added nodes in the same batch.',
              '4. Ensure the Flow has a Trigger (Start, Webhook, Cron, or provider trigger), then validate with flow_check(flowId, revisionId).',
              ...(goal == null ? [] : [`Goal: ${goal}`]),
            ].join('\n'),
          },
        },
      ],
    }),
  } satisfies McpPromptDefinition<z.infer<typeof authorFlowArgs>>,
  publish_and_run_flow: {
    title: 'Publish and Run Flow',
    description: 'Validate a draft revision, publish it safely, and start a Run with waitSeconds.',
    argsSchema: wrapSchema(publishAndRunArgs),
    render: ({ flowId, revisionId }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              revisionId == null
                ? `1. Read the Flow with flow_read(flowId="${flowId}") to get revisionId and Start/Trigger nodeId + inputDefs.`
                : `1. Validate the revision with flow_check(flowId="${flowId}", revisionId="${revisionId}").`,
              `2. Call flow_live_get(flowId="${flowId}") to obtain the current expectedLivePublicationId (or null if unpublished).`,
              `3. Call flow_publish(flowId="${flowId}", revisionId, expectedLivePublicationId, idempotencyKey, waitSeconds=20). If still pending, poll flow_live_get(flowId="${flowId}", operationId, waitSeconds=20).`,
              '4. Call run_start(source="live", publicationId, trigger={nodeId, outputs}, idempotencyKey, waitSeconds=20).',
              '5. If not terminal, poll run_get(runId, view="status", waitSeconds=20), then fetch run_get(runId, view="result").',
            ].join('\n'),
          },
        },
      ],
    }),
  } satisfies McpPromptDefinition<z.infer<typeof publishAndRunArgs>>,
  debug_run: {
    title: 'Debug Failed or Waiting Run',
    description: 'Inspect Run status, events, stored Agent tool results, and terminal errors.',
    argsSchema: wrapSchema(debugRunArgs),
    render: ({ runId }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `1. Call run_get(runId="${runId}", view="status") to check status, waiting details, or terminal state.`,
              `2. If waiting, inspect allowed actions and ask the user before calling run_resolve_wait(runId="${runId}", waitId, action).`,
              `3. If terminal, call run_get(runId="${runId}", view="result") and run_get(runId="${runId}", view="events") to trace node execution.`,
              `4. To inspect large Connector/Agent tool payloads, call run_get(runId="${runId}", view="tool_results") and pass resultId + pointer to drill down.`,
            ].join('\n'),
          },
        },
      ],
    }),
  } satisfies McpPromptDefinition<z.infer<typeof debugRunArgs>>,
} as const

export { mcpConformanceCases } from './mcpConformance.ts'
