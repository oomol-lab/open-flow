import type { JsonValue } from '../../flow/common/change.ts'

import { z } from 'zod'
import { runStatuses } from '../../execution/common/runLifecycle.ts'
import { waitCommentSchema } from '../../execution/common/wait.ts'
import { resourceNameIssue } from '../../flow/common/change.ts'
import { authoringReadSchema, authoringSearchSchema, authoringRequestSchema, authoringSchemaQuery } from './authoringSchema.ts'
import { resultQuerySchema } from './resultQuery.ts'

export const mcpProtocolVersion = '2026-07-28'
const json: z.ZodType<JsonValue> = z.json()
const id = z.string().min(1)
const mutationKey = id.max(256).describe('Stable identity for this mutation. Retry with the same key and identical arguments, even after a lost response.')
const pageLimit = z.int().min(1).max(100).default(50)
const flow = id.describe('Exact Flow ID returned by flow_list or flow_create.')
const run = id.describe('Exact Run ID returned by flow_run or run_list.')
export const mcpInstructions =
  'Use flow_list, flow_read and flow_search to inspect root workflows. Read node type schemas with flow_schema. Use flow_edit with the observed baseRevision and a stable requestId. Node edits affect only the selected node. Text edits require exactly one match. Execution edges and input sources are independent. Legacy Subflow content is unsupported. Edits can save incomplete drafts; inspect returned diagnostics and use flow_check before running. ' +
  'Use flow_check before flow_run. Select an explicit Trigger node ID and fixed revision or publication. A new Flow has no Trigger until you add one. ' +
  'Before adding a Feishu Trigger, use event_source_list and compare its Connection IDs with connector_connections in the Flow scope. If no source is available, create and verify one in Workbench. ' +
  'Use flow_publish to publish a fixed Revision, then poll flow_publish_status until succeeded or failed. Use flow_set_enabled to enable or disable the observed Live publication. ' +
  'flow_run returns an accepted Run, not its final result. Find Runs with run_list, poll run_get and use run_result after terminal. Resolve a waiting Run only with an explicit run_resolve_wait action allowed by run_get. ' +
  'Use run_results and run_result_read to inspect stored Agent tool results; these are separate from the terminal Run result. ' +
  'Retry flow_edit with identical arguments and the same requestId. Retry flow_create, flow_publish and flow_run only with identical arguments and the same idempotencyKey; a new key can execute the Flow again. Other mutations use the same resource identity and arguments when retrying. Cancel a Run explicitly with run_cancel. ' +
  'Use nextCursor and nextAfter to read subsequent pages. Connector-backed deployments may require a Team; inspect connector_teams before creating a Flow.'

function tool<Args>(description: string, schema: z.ZodType<Args>, readOnly: boolean) {
  return {
    description,
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      '~standard': {
        version: 1 as const,
        vendor: 'open-flow',
        jsonSchema: {
          input: (): Record<string, unknown> => z.toJSONSchema(schema, { io: 'input' }),
          output: (): Record<string, unknown> => z.toJSONSchema(schema),
        },
        validate(value: unknown): { value: Args } | { issues: { message: string; path: string[] }[] } {
          const result = schema.safeParse(value)
          return result.success
            ? { value: result.data }
            : { issues: result.error.issues.map((issue) => ({ message: issue.message, path: issue.path.map(String) })) }
        },
      },
    },
  }
}

export const mcpTools = {
  flow_list: tool(
    'List Flows in this deployment. Continue with nextCursor; cursors are compatible with the Control API.',
    z.strictObject({ cursor: id.optional(), limit: pageLimit }),
    true,
  ),
  flow_read: tool(
    'Read an outline, selected node details, or a bounded code/prompt excerpt. Carry the returned revision into subsequent reads and edits.',
    authoringReadSchema.safeExtend({ flowId: flow }).meta({ ...authoringReadSchema.meta() }),
    true,
  ),
  flow_search: tool(
    'Find nodes by name, configuration or source text in a fixed Revision. Follow nextOffset for more matches.',
    authoringSearchSchema.extend({ flowId: flow }),
    true,
  ),
  flow_schema: tool(
    'Read node configuration schemas and the edit grammar, or an Action contract. Action lookup requires a flowId.',
    authoringSchemaQuery.safeExtend({ flowId: flow.optional() }),
    true,
  ),
  flow_create: tool(
    'Create an empty Flow. If this deployment uses OOMOL Connector, choose a teamId from connector_teams. Keep the key and arguments stable when retrying.',
    z.strictObject({
      name: id.refine((name) => name == name.trim() && resourceNameIssue(name) == null, 'Flow name is invalid.'),
      idempotencyKey: mutationKey,
      teamId: id.optional(),
    }),
    false,
  ),
  flow_edit: tool(
    'Atomically edit root nodes, input sources, execution edges and text. Use $alias for preceding creations. Preserve baseRevision and requestId when retrying. A saved draft may have validation diagnostics.',
    authoringRequestSchema.extend({ flowId: flow }),
    false,
  ),
  flow_check: tool(
    'Validate a fixed Revision and return diagnostics. Use the revision returned by flow_read or flow_edit as revisionId.',
    z.strictObject({ flowId: flow, revisionId: id }),
    true,
  ),
  flow_publish: tool(
    'Publish a fixed Revision. Supply the observed Live publication ID, or null for the first publication, and a stable idempotencyKey. Returns an operation; poll flow_publish_status for success or failure.',
    z.strictObject({ flowId: flow, revisionId: id, expectedLivePublicationId: id.nullable(), idempotencyKey: mutationKey }),
    false,
  ),
  flow_publish_status: tool(
    'Read a publish operation. Only succeeded confirms publication; failed includes the failure details. Keep polling while pending.',
    z.strictObject({ flowId: flow, operationId: id }),
    true,
  ),
  flow_set_enabled: tool(
    'Enable or disable a published Flow. Supply expectedPublicationId from flow_list; a changed Live publication is a conflict. This does not cancel accepted Runs; use run_cancel for those.',
    z.strictObject({ flowId: flow, expectedPublicationId: id, enabled: z.boolean() }),
    false,
  ),
  flow_run: tool(
    'Start a Run and return its runId. For draft supply flowId and revisionId; for live supply publicationId. Always fix the source, Trigger and idempotencyKey. Poll run_get for completion.',
    z
      .discriminatedUnion('source', [
        z.strictObject({
          source: z.literal('draft'),
          flowId: flow,
          revisionId: id,
          trigger: z.strictObject({ nodeId: id, outputs: z.record(z.string(), json) }),
          inputs: z.record(z.string(), z.record(z.string(), json)).default({}),
          idempotencyKey: mutationKey,
        }),
        z.strictObject({
          source: z.literal('live'),
          publicationId: id,
          trigger: z.strictObject({ nodeId: id, outputs: z.record(z.string(), json) }),
          inputs: z.record(z.string(), z.record(z.string(), json)).default({}),
          idempotencyKey: mutationKey,
        }),
      ])
      .meta({ type: 'object' }),
    false,
  ),
  run_list: tool(
    'List Runs for a Flow, optionally filtered by status. Continue with nextCursor; cursors are compatible with the Control API.',
    z.strictObject({ flowId: flow, pendingWait: z.boolean().optional(), status: z.enum(runStatuses).optional(), cursor: id.optional(), limit: pageLimit }),
    true,
  ),
  run_get: tool(
    'Read Run status, including waiting details and allowed actions. Completed, failed, canceled and indeterminate are terminal.',
    z.strictObject({ runId: run }),
    true,
  ),
  run_events: tool(
    'Read one page of Run events. Continue with nextAfter. Events can expire independently of the terminal result.',
    z.strictObject({ runId: run, after: z.int().min(0).default(0), limit: pageLimit }),
    true,
  ),
  run_result: tool(
    'Read the terminal result. A queued, running or waiting Run returns run.not-terminal; inspect run_get first.',
    z.strictObject({ runId: run }),
    true,
  ),
  run_results: tool(
    'List stored Agent tool result metadata for a Run, including Connector and code results. Continue with nextAfter as after. Use run_result_read to inspect content.',
    z.strictObject({ runId: run, after: id.optional() }),
    true,
  ),
  run_result_read: tool(
    'Read a bounded page of a stored Agent tool result. Select a JSON Pointer with pointer and continue with nextOffset as offset at the same pointer. A complete value contains all data at that pointer.',
    resultQuerySchema.extend({ runId: run, resultId: id }),
    true,
  ),
  run_resolve_wait: tool(
    'Explicitly resolve the waitId observed in run_get with one of its allowed actions. Optional comment records the reason (up to 2,000 Unicode code points). The first decision and comment win; inspect resolutionAccepted and action. Resume the same Run and poll run_get; do not create a replacement Run.',
    z.strictObject({ runId: run, waitId: id, action: z.enum(['approve', 'continue', 'reject']), comment: waitCommentSchema }),
    false,
  ),
  run_cancel: tool(
    'Explicitly cancel a Run. Inspect cancelAccepted and the authoritative status; completion can win the race.',
    z.strictObject({ runId: run }),
    false,
  ),
  flow_code_connections: tool(
    'Read the connections shared by all Code nodes in this Flow. With publicationId, read the fixed published snapshot; it cannot be edited.',
    z.strictObject({ flowId: flow, publicationId: id.optional() }),
    true,
  ),
  flow_connection_candidates: tool(
    'List connections and permissions available to select. Node selections do not add shared Code usage.',
    z.strictObject({ flowId: flow, providerIds: z.array(id).min(1) }),
    true,
  ),
  flow_code_connection_set: tool(
    'Add or remove shared Code usage in the Draft only. Does not change node selections or published versions. Use the observed accessRevision.',
    z.strictObject({ flowId: flow, providerId: id, accessBindingId: id, selected: z.boolean(), expectedAccessRevision: z.int().nonnegative() }),
    false,
  ),
  flow_connection_usage_remove: tool(
    'Remove a connection from all node selections and shared Code usage in this Draft atomically. Keeps the account, published versions and accepted Runs. Use the observed revisionId and accessRevision.',
    z.strictObject({ flowId: flow, connectionId: id, expectedRevisionId: id, expectedAccessRevision: z.int().nonnegative(), idempotencyKey: mutationKey }),
    false,
  ),
  connector_teams: tool('List OOMOL Teams available for Flow creation. An unconfigured or custom Connector may not provide Teams.', z.strictObject({}), true),
  connector_providers: tool('List Connector providers available in the Flow scope.', z.strictObject({ flowId: flow.optional() }), true),
  connector_search: tool(
    'Search Connector action summaries in the Flow scope. Read complete schemas with connector_get after selecting an action.',
    z.strictObject({ query: z.string().trim().min(1).max(256), flowId: flow.optional() }),
    true,
  ),
  connector_get: tool(
    'Read a Connector action, input/output definitions and connection requirements before authoring a node.',
    z.strictObject({ actionId: id, flowId: flow.optional() }),
    true,
  ),
  connector_connections: tool(
    'List Connector connections in the Flow scope. Use active connection IDs in bindings.',
    z.strictObject({ serviceId: id.max(256), flowId: flow.optional() }),
    true,
  ),
  event_source_list: tool(
    'List independent Feishu event sources, including Team, Connection, event types, enabled and verification status. Inspect consumers for Flows actually using each source.',
    z.strictObject({}),
    true,
  ),
  trigger_search: tool(
    'Search provider Trigger summaries; omit query to list all. Flow trigger instances are in flow_read. Manual, Webhook and Cron are built-in node kinds described by flow_schema.',
    z.strictObject({ query: z.string().trim().min(1).max(256).optional() }),
    true,
  ),
  trigger_get: tool('Read a provider Trigger definition before creating its node.', z.strictObject({ key: id }), true),
}

export { mcpConformanceCases } from './mcpConformance.ts'
