import type { JsonValue } from '../../flow/common/change.ts'

import { z } from 'zod'
import { runStatuses } from '../../execution/common/runLifecycle.ts'
import { resourceNameIssue } from '../../flow/common/change.ts'
import { resultQuerySchema } from './results.ts'

export const mcpProtocolVersion = '2026-07-28'
const json: z.ZodType<JsonValue> = z.json()
const id = z.string().min(1)
const mutationKey = id.max(256).describe('Stable identity for this mutation. Retry with the same key and identical arguments, even after a lost response.')
const pageLimit = z.int().min(1).max(100).default(50)
const flow = id.describe('Exact Flow ID returned by flow_list or flow_create.')
const run = id.describe('Exact Run ID returned by flow_run or run_list.')
export const mcpInstructions =
  'Use flow_list and flow_get to inspect a Flow. Use flow_schema to learn atomic edit operations, then flow_apply with the observed expectedRevisionId and a stable idempotencyKey. ' +
  'Use flow_check before flow_run. Select an explicit Trigger node ID and fixed revision or publication. A new Flow has no Trigger until you add one. ' +
  'Use flow_publish to publish a fixed Revision, then poll flow_publish_status until succeeded or failed. Use flow_set_enabled to enable or disable the observed Live publication. ' +
  'flow_run returns an accepted Run, not its final result. Find Runs with run_list, poll run_get and use run_result after terminal. Resolve a waiting Run only with an explicit run_resolve_wait action allowed by run_get. ' +
  'Use run_results and run_result_read to inspect stored Agent tool results; these are separate from the terminal Run result. ' +
  'Retry flow_create, flow_apply, flow_publish and flow_run only with identical arguments and the same idempotencyKey; a new key can execute the Flow again. Other mutations use the same resource identity and arguments when retrying. Cancel a Run explicitly with run_cancel. ' +
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
  flow_get: tool(
    'Read Flow metadata, the full Draft and current Live publication. Use draft.revisionId as the base of an edit.',
    z.strictObject({ flowId: flow }),
    true,
  ),
  flow_schema: tool(
    'Get the JSON Schema for atomic change operations, optionally one operation kind. Node titles must be non-empty and unique within a graph.',
    z.strictObject({ kind: id.optional() }),
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
  flow_apply: tool(
    'Apply ordered atomic changes. Read flow_schema first. A stale expectedRevisionId is a conflict; reread the Draft before deciding on a new edit.',
    z.strictObject({
      flowId: flow,
      expectedRevisionId: id,
      idempotencyKey: mutationKey,
      operations: z.array(json).min(1).describe('Change operations defined by flow_schema. Explicit IDs and before values refer to the base Revision.'),
    }),
    false,
  ),
  flow_check: tool(
    'Validate a fixed Revision and return diagnostics. Get its revisionId from flow_get or flow_apply.',
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
    'Enable or disable a published Flow. Supply expectedPublicationId from flow_get; a changed Live publication is a conflict. This does not cancel accepted Runs; use run_cancel for those.',
    z.strictObject({ flowId: flow, expectedPublicationId: id, enabled: z.boolean() }),
    false,
  ),
  flow_run: tool(
    'Start a Run and return its runId. For draft supply flowId and revisionId; for live supply publicationId. Always fix the source, Trigger and idempotencyKey. Poll run_get for completion.',
    z.strictObject({
      source: z.enum(['draft', 'live']),
      flowId: flow.optional(),
      revisionId: id.optional(),
      publicationId: id.optional(),
      trigger: z.strictObject({ nodeId: id, payload: json }),
      inputs: z.record(z.string(), z.record(z.string(), json)).default({}),
      idempotencyKey: mutationKey,
    }),
    false,
  ),
  run_list: tool(
    'List Runs for a Flow, optionally filtered by status. Continue with nextCursor; cursors are compatible with the Control API.',
    z.strictObject({ flowId: flow, status: z.enum(runStatuses).optional(), cursor: id.optional(), limit: pageLimit }),
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
    'Explicitly resolve the waitId observed in run_get with one of its allowed actions. The first decision wins; inspect resolutionAccepted and action. Resume the same Run and poll run_get; do not create a replacement Run.',
    z.strictObject({ runId: run, waitId: id, action: z.enum(['approve', 'continue', 'reject']) }),
    false,
  ),
  run_cancel: tool(
    'Explicitly cancel a Run. Inspect cancelAccepted and the authoritative status; completion can win the race.',
    z.strictObject({ runId: run }),
    false,
  ),
  connector_teams: tool('List OOMOL Teams available for Flow creation. An unconfigured or custom Connector may not provide Teams.', z.strictObject({}), true),
  connector_list: tool('List Connector providers available in the Flow scope.', z.strictObject({ flowId: flow.optional() }), true),
  connector_search: tool('Search Connector actions in the Flow scope.', z.strictObject({ query: id, flowId: flow.optional() }), true),
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
  trigger_list: tool('List provider Trigger definitions. Manual, Webhook and Cron are built-in node kinds described by flow_schema.', z.strictObject({}), true),
  trigger_get: tool('Read a provider Trigger definition before creating its node.', z.strictObject({ key: id }), true),
}

export { mcpConformanceCases } from './mcpConformance.ts'
