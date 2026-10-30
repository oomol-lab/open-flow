import type { JsonValue } from '../../types/index.ts'

import { z } from 'zod'
import {
  agentToolFields,
  connectorAgentToolSchema,
  workflowAgentToolSchema,
  connectorCapabilitySchema,
  httpCapabilitySchema,
  authoringDefinitionSchemas as definitions,
} from '../../flow/common/changeSchema.ts'
import { retryConfigurationSchema, retryNodeTypes } from '../../flow/common/retry.ts'
import { httpRequestConfigSchema } from '../../http/common/httpRequest.ts'
import { currentEngineContract, findEngineContract } from '../../runtime/common/engineContract.ts'
import { dedupeConfigSchema } from '../../state/common/state.ts'
import { authoringLlmConfiguration } from './authoringLlm.ts'
import { authoringOpenApiSchema } from './authoringOpenApi.ts'

const id = z.string().min(1)
const json = z.json()
const patch = z.record(id, json)
export const authoringTypes = [
  'start',
  'outputs',
  'webhook-response',
  'workflow',
  'webhook',
  'cron',
  'error',
  'poll',
  'integration',
  'code',
  'connector',
  'agent',
  'llm',
  'decision',
  'openapi',
  'http-request',
  'dedupe',
  'condition',
  'value',
  'wait',
  'approval',
] as const
const type = z.enum(authoringTypes)
export type AuthoringType = z.infer<typeof type>
const referenceSchema = id.describe(
  'An existing node reference returned by read/search, or $alias for a preceding node.add in this edit batch. For node.add.as "step", reference "$step", never bare "step". Aliases are local to one batch.',
)
const output = z.strictObject({
  kind: z.literal('output'),
  node: referenceSchema,
  port: id.optional().describe('Omit for a node with one output. For multiple outputs, choose a name from node details.'),
  field: z.string().optional(),
})
const system = z.strictObject({ kind: z.literal('system'), node: referenceSchema, port: z.literal('error'), field: z.string().optional() })
const variable = z.strictObject({ kind: z.literal('variable'), name: id })
export const authoringSourceSchema = z.union([
  output,
  system,
  variable,
  z.strictObject({ kind: z.literal('value'), value: json }),
  z.strictObject({ kind: z.literal('unset') }),
  z.strictObject({ kind: z.literal('default') }),
  z.strictObject({ kind: z.literal('sources'), sources: z.array(z.union([output, system, variable])).min(1) }),
])
const operand = z.union([z.strictObject({ kind: z.literal('value'), value: json.optional(), schema: json.optional() }), output, system, variable])
const toolSources = z
  .record(id, agentToolFields.inputs.element.shape.source)
  .optional()
  .describe(
    'Tool input sources by name. The platform resolves types from the selected Action or workflow. New inputs default to model-provided; omitted existing sources are preserved.',
  )
const agentTool = z.union([
  workflowAgentToolSchema.omit({ id: true, inputs: true, outputs: true, revisionId: true }).extend({ inputs: toolSources }).strict(),
  connectorAgentToolSchema.omit({ id: true, inputs: true }).extend({ inputs: toolSources }).strict(),
])
const authoringCapabilities = z.array(
  z.union([connectorCapabilitySchema, z.strictObject({ kind: z.literal('workflow'), name: id, flowId: id }), httpCapabilitySchema]),
)
const notification = z.strictObject({
  ...definitions.connector.shape,
  messageHandle: id,
  inputs: z.record(id, z.union([z.strictObject({ kind: z.literal('value'), value: json }), z.strictObject({ kind: z.literal('input'), input: id })])),
})
const field = z.strictObject({ schema: json.optional(), nullable: z.boolean().optional(), description: z.string().optional() })
const inputFields = z
  .record(id, field.extend({ default: json.optional() }))
  .describe(
    'Optional business input constraints by name. A binding to a new Code, Agent, LLM, Wait or Approval input automatically declares an input accepting any JSON. Existing constraints are preserved. Omitted schema accepts any JSON; omitted nullable is true. Use default for inherited values; input.set supplies data.',
  )
export const flowInputFields = z
  .record(id, field)
  .describe(
    'Workflow input definitions by name. Omitted schema accepts any JSON; omitted nullable is true. No defaults. Supply call values as trigger.outputs.',
  )
export const flowOutputFields = flowInputFields.describe(
  'Workflow output definitions by name. Omitted schema accepts any JSON; omitted nullable is true. No defaults. Set values on the Outputs node with input.set or node.add.inputs.',
)
export const flowInputFieldsView = z.record(id, field.extend({ schema: json as z.ZodType<JsonValue>, nullable: z.boolean() }))
const outputFields = z.record(id, field).describe('Code return fields by name. Omitted schema accepts any JSON; omitted nullable is true.')
const expression = z.strictObject({
  left: operand,
  operator: definitions.condition.shape.cases.element.shape.groups.element.shape.expressions.element.shape.operator,
  right: operand.optional(),
})
const all = z.strictObject({ all: z.array(expression) })
const when = z.union([expression, all, z.strictObject({ any: z.array(z.union([expression, all])) })])
export const authoringConfigurations = {
  'webhook-response': z.strictObject({}),
  'workflow': z.strictObject({ flowId: id }),
  'start': z.strictObject({ inputDefs: flowInputFields.default({}) }),
  'outputs': z.strictObject({ outputDefs: flowOutputFields.default({}) }),
  'error': z.strictObject({ sourceFlowIds: z.array(id).optional() }),
  'webhook': definitions.webhook.omit({ bodyFields: true }).extend({ body: inputFields }).strict(),
  'cron': z.strictObject({ schedule: definitions.schedule }),
  'poll': z.strictObject({ key: id, connectionId: id.optional(), schedule: definitions.schedule }),
  'integration': z.strictObject({ key: id, connectionId: id.optional() }),
  'code': z.strictObject({ inputs: inputFields, outputs: outputFields, capabilities: authoringCapabilities.optional() }),
  'connector': definitions.connector.omit({ outputMode: true }).strict(),
  'openapi': authoringOpenApiSchema,
  'http-request': httpRequestConfigSchema,
  'dedupe': dedupeConfigSchema,
  'agent': definitions.agent
    .omit({ prompt: true, tools: true })
    .extend({
      inputs: inputFields,
      resultSchema: json.describe('JSON schema of the final result. Defaults to text. The tool manages the output definition; references can omit port.'),
      tools: z.array(agentTool),
      notification: notification.optional(),
    })
    .strict(),
  'llm': authoringLlmConfiguration.extend({ inputs: inputFields }),
  'decision': definitions.decision,
  'condition': z.strictObject({ match: z.enum(['first', 'all']), branches: z.array(z.strictObject({ name: id, description: z.string().optional(), when })) }),
  'value': z.strictObject({ values: patch, outputs: outputFields }),
  'wait': z.strictObject({
    inputs: inputFields,
    autoContinue: definitions.waitAutoContinue
      .optional()
      .describe(
        'Wait only. Omit to disable; clear config.autoContinue to remove. after counts from each wait registration; at requires an explicit offset and continues immediately if already past. Optional timezone preserves the editor zone; at remains the absolute instant. Server requires the deadline to precede the 7-day expiry.',
      ),
  }),
  'approval': z.strictObject({ inputs: inputFields }),
}
const metadata = {
  onError: z.enum(['stop', 'error']).optional(),
  name: id.optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  maxExecutions: z.int().positive().optional(),
  timeoutMs: z.number().nonnegative().optional(),
  retry: retryConfigurationSchema
    .partial()
    .optional()
    .describe(
      'Node retry policy for Code, Connector, OpenAPI, LLM and AI Decision. Omitted update fields preserve the policy; use clear: [["retry"]] to disable it. maxRetries counts additional attempts; intervalMs is 1000–60000 in whole seconds.',
    ),
}
const updates = z.strictObject({
  ...metadata,
  config: patch
    .optional()
    .describe(
      'Recursively merge configuration; omitted fields remain unchanged and arrays replace as a whole. This includes schema objects: {} does not clear an existing schema. Use clear paths to remove fields, e.g. ["config","inputs","amount","schema","type"].',
    ),
})
export const authoringEditSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('node.add'),
    as: id
      .regex(/^[A-Za-z][\w-]*$/)
      .describe('Unique batch-local alias without the $ prefix. Later edits must reference this new node as $alias; the bare alias is not its node ID.'),
    type,
    name: id,
    onError: z.enum(['stop', 'error']).optional(),
    retry: retryConfigurationSchema.optional(),
    config: patch.optional(),
    inputs: z
      .record(id, authoringSourceSchema)
      .optional()
      .describe('Input data sources, applied after creation, as input.set operations. Execution edges are separate.'),
    code: z.string().optional(),
    prompt: z.string().optional(),
  }),
  z.strictObject({ op: z.literal('node.update'), node: referenceSchema, set: updates.optional(), clear: z.array(z.array(id).min(1)).optional() }),
  z.strictObject({
    op: z.literal('node.refresh'),
    node: referenceSchema,
    tool: id.optional().describe('Name of a workflow tool on an Agent or Code node. Omit for a Call Workflow node.'),
  }),
  z.strictObject({ op: z.literal('node.remove'), node: referenceSchema }),
  z.strictObject({ op: z.literal('input.set'), node: referenceSchema, input: id, source: authoringSourceSchema }),
  z.strictObject({ op: z.enum(['edge.connect', 'edge.disconnect']), source: referenceSchema, target: referenceSchema, branch: id.optional() }),
  z.strictObject({ op: z.literal('text.edit'), node: referenceSchema, field: z.enum(['code', 'prompt']), oldText: id, newText: z.string() }),
  z.strictObject({ op: z.literal('text.set'), node: referenceSchema, field: z.enum(['code', 'prompt']), text: z.string() }),
])
export const authoringRequestSchema = z.strictObject({ baseRevision: id, requestId: id.max(256), edits: z.array(authoringEditSchema).min(1).max(1000) })
export const authoringReadSchema = z
  .strictObject({
    revision: id.optional().describe('Fixed revision from a previous read; omit to read the current draft.'),
    nodes: z.array(id).min(1).max(100).optional().describe('Node references to read in one batch. Mutually exclusive with text. Long texts return metadata.'),
    text: z
      .strictObject({ node: id, field: z.enum(['code', 'prompt']), start: z.int().positive().default(1), lines: z.int().min(1).max(200).default(80) })
      .optional()
      .describe('Read code or prompt by line (1-based). Mutually exclusive with nodes. Follow nextStart at the same revision until truncated is false.'),
  })
  .refine((v) => v.nodes == null || v.text == null, 'Choose nodes or text.')
  .meta({ not: { required: ['nodes', 'text'] }, description: 'Omit nodes and text for an outline; provide nodes for details, or text for an excerpt.' })
export const authoringCheckSchema = z.strictObject({ revisionId: id })
export const authoringSearchSchema = z.strictObject({
  revision: id.optional(),
  query: id.max(1000),
  type: type.optional(),
  offset: z.int().nonnegative().default(0),
  limit: z.int().min(1).max(100).default(20),
})
export type AuthoringRequest = z.infer<typeof authoringRequestSchema>
export type AuthoringEdit = z.infer<typeof authoringEditSchema>
export type AuthoringRead = z.input<typeof authoringReadSchema>
export type AuthoringSearch = z.input<typeof authoringSearchSchema>
export type AuthoringSource = z.infer<typeof authoringSourceSchema>
export const authoringSchemaQuery = z
  .strictObject({ type: type.optional(), action: id.optional() })
  .refine((v) => v.type == null || v.action == null, 'Choose type or action.')

const requestContracts = {
  read: {
    schema: authoringReadSchema,
    guidance:
      'Read Start and Outputs node details for their interface definitions and data sources. Choose one mode: outline (omit nodes and text), node details (nodes), or text excerpt (text). nodes and text are mutually exclusive. Text defaults to 80 lines, at most 200 lines and 24000 characters. For the complete text, repeat at nextStart with the same revision until truncated is false.',
    examples: [{}, { revision: 'REVISION', nodes: ['NODE'] }, { revision: 'REVISION', text: { node: 'NODE', field: 'prompt', start: 1, lines: 80 } }],
  },
  search: {
    schema: authoringSearchSchema,
    guidance: 'Search names, configurations and text. Keep the returned revision when following nextOffset or reading a match.',
    examples: [{ query: 'Customer summary', type: 'agent' }],
  },
  edit: {
    schema: authoringRequestSchema,
    guidance:
      'Edit Start config.inputDefs and Outputs config.outputDefs through node.add or node.update; clear paths are relative to the node, e.g. ["config","inputDefs","amount"]. Set Outputs values with input.set. Use the observed revision as baseRevision and a stable requestId. Edits are ordered and atomic. node.add.as declares a batch-local alias without $. Every later reference to that new node must use $alias, including node, edge source/target and output source node fields; a bare alias is not the node ID. Use returned node references in later batches. Updates recursively merge objects (including schemas); {} preserves existing fields. Arrays replace as a whole. Remove fields with clear paths. Text replacement requires exactly one match. Read the target text first. A saved draft can have validation diagnostics.',
    examples: [
      {
        baseRevision: 'REVISION',
        requestId: 'CREATE_REQUEST',
        edits: [
          { op: 'node.add', as: 'start', type: 'start', name: 'Start' },
          { op: 'node.add', as: 'step', type: 'code', name: 'Process', code: 'export default ({value}) => ({result:value})' },
          { op: 'edge.connect', source: '$start', target: '$step' },
          { op: 'node.update', node: '$step', set: { description: 'Created and connected in one atomic edit.' } },
        ],
      },
      {
        baseRevision: 'REVISION',
        requestId: 'REQUEST',
        edits: [{ op: 'text.edit', node: 'NODE', field: 'prompt', oldText: 'Original rule.', newText: 'Updated rule.' }],
      },
    ],
  },
  check: {
    schema: authoringCheckSchema,
    guidance: 'Check a fixed revision. In the CLI, pass this identity with --revision REVISION.',
    examples: [{ revisionId: 'REVISION' }],
  },
}

const codeBuiltins = [...findEngineContract(currentEngineContract)!.builtinModules!].filter((name) => !name.startsWith('node:'))
const codeGuidance = `Code is an ES module whose default export receives (inputs, context) and returns the business outputs. It may import the Node builtins ${codeBuiltins.join(', ')}, with or without the node: prefix; fs is a fresh in-memory filesystem containing /tmp per execution. require, dynamic import, packages and the http/net builtins are unavailable. To call HTTP APIs, declare their hosts in config.capabilities as {kind: "http", hosts: ["api.example.com", "*.example.org"]} and use context.fetch(url, {method, headers, body}); it returns status, ok, headers.get(), text(), json() and bytes(), does not follow redirects, adds no credentials, and limits bodies to 1 MiB. Prefer an HTTP Request node for a single call without transformation and Connector Actions for services with accounts. context provides inputs, signal, getPrevious(), fetch, actions, workflows, artifact, flowId, runId and blockId. Select workflows through config.capabilities: [{kind: "workflow", flowId, name}]. Call context.workflows.call(name, input) and await its business output. The platform derives input/output types. Refresh a selected workflow tool with node.refresh and tool: its name. Calls obey node and Run time limits.`

/** Transport-independent discovery of the same requests the service validates. */
export function authoringRequestContract(name: string) {
  if (!Object.hasOwn(requestContracts, name)) return undefined
  const contract = requestContracts[name as keyof typeof requestContracts]
  return { request: z.toJSONSchema(contract.schema, { io: 'input' }), guidance: contract.guidance, examples: contract.examples }
}

export function authoringSchema(kind?: AuthoringType) {
  return kind == null
    ? {
        types: authoringTypes,
        request: z.toJSONSchema(authoringRequestSchema),
        guidance:
          'Read a node type schema before creating or configuring it. Use $alias to reference a preceding node.add in the same batch. Read returns stable node references. Long code and prompt fields use text reads and edits. Changes use the observed baseRevision and a stable requestId.',
      }
    : {
        type: kind,
        onError: retryNodeTypes.some((nodeType) => nodeType == kind) ? { enum: ['stop', 'error'] } : false,
        retry: retryNodeTypes.some((nodeType) => nodeType == kind) ? z.toJSONSchema(retryConfigurationSchema) : false,
        inputSources: ['poll', 'integration'].includes(kind)
          ? ['value', 'unset', 'default']
          : ['start', 'outputs', 'error', 'cron', 'webhook', 'value', 'condition'].includes(kind)
            ? []
            : ['value', 'unset', 'default', 'output', 'system', 'variable', 'sources'],
        extensibleInputs: ['code', 'agent', 'llm', 'wait', 'approval'].includes(kind),
        guidance:
          kind == 'webhook-response'
            ? 'Prepare an HTTP response using fixed inputs body (any JSON, default empty text), statusCode (number, default 200) and headers (scalar-valued object, default {}). Select this node in Webhook options.responseBody as {kind: "webhook-response", nodeId: "node reference", timeoutMs: 30000}. Its first completion responds immediately while the Run continues. It has no business outputs. Multiple response nodes are allowed; each Webhook selects one reachable node.'
            : kind == 'outputs'
              ? 'Declare output fields through config.outputDefs. Set their values through node.add.inputs or input.set. Outputs is a singleton execution sink; it waits for its predecessors and produces workflow business outputs independently of node logs. No downstream edges or data references to Outputs are allowed.'
              : kind == 'webhook'
                ? 'Use options.responseBody: {kind: "webhook-response", nodeId: "node ID or $alias", timeoutMs: 30000} to respond on the selected node’s first completion while the Run continues. Body, statusCode and headers come exclusively from that node; clear workflow-output-only status/header references when switching. Alternatively configure options.responseBody as {kind: "workflow-outputs", output?: "top-level output name", timeoutMs?: 30000} to respond after the Run succeeds. Omit output for the complete object. Connect Webhook to Outputs. Timeout is 1000–60000 ms; HTTP timeout does not cancel the Run. Strings return text; other values return JSON. Only in this mode, options.responseStatusCodeOutput can select a numeric top-level workflow output as the HTTP status, overriding the preserved fixed responseStatusCode (default 200). Its runtime value must be an integer from 200 to 599, excluding 204, 205, 304; missing or invalid values return 500. Use responseHeaders for fixed text headers. In workflow-output mode, responseHeaderOutputs maps header names to top-level output names; values can be string, number or boolean and are converted to text. Alternatively responseHeadersSource: {kind: "workflow-outputs", output?: "object field"} replaces the entire header object (omit output for all outputs), preserving but ignoring per-header settings. Missing, null, complex or invalid header values return 500 without fallback. Header restrictions and Content-Type policy still apply. Omit responseBody for immediate responseData. Clear options.responseBody, options.responseStatusCodeOutput, options.responseHeadersSource and options.responseHeaderOutputs explicitly to switch back.'
                : kind == 'start'
                  ? 'Declare workflow inputs through config.inputDefs; read them in Start node details. REST calls and manual runs supply them as trigger.outputs. Downstream nodes bind these parameters as Start outputs. Start has no input sources or defaults; non-nullable parameters are required, and omitted nullable parameters become null.'
                  : kind == 'condition'
                    ? 'Edit branch operands through config.branches. A branch can test one expression, all expressions, or any alternatives. Unmatched execution uses branch otherwise.'
                    : ['poll', 'integration'].includes(kind)
                      ? 'Configure static parameters with node.add.inputs or input.set. Definitions come from the selected Trigger key; execution output and variable sources are unavailable.'
                      : kind == 'llm'
                        ? 'Configure model settings, message templates and history as defaults. Input bindings with the same names override these defaults; named business inputs can be bound directly. Template strings interpolate {{name}}.'
                        : kind == 'dedupe'
                          ? 'Bind an items array. Configure field (dot-separated identity path, empty for scalar items), mode (new or increasing), and space (node or flow). Outputs are items and duplicates. History persists immediately; downstream failures do not roll it back. Increasing mode accepts finite numbers or RFC 3339 timestamps, never mixed types.'
                          : kind == 'http-request'
                            ? 'Configure method, query/headers modes and names, bodyFormat, authentication, responseFormat and statusPolicy. Bind url, query.<name>/header.<name> or whole query/headers objects, body and auth.token (Basic: auth.username/auth.password). Credentials accept variables or upstream outputs only. Outputs: body, statusCode, headers. Authentication is replaced as a complete choice.'
                            : kind == 'openapi'
                              ? 'Select an operation; the tool resolves its ports and authentication. Read authenticationChoices from node details. authentication is replaced as a complete choice. Bind advertised credentials through inputs.'
                              : kind == 'workflow'
                                ? 'Select another workflow with config.flowId. A workflow cannot call itself, including in a disconnected node. Owned unpublished or unavailable targets may be saved as incomplete drafts. Use node.refresh to load the current published interface.'
                                : kind == 'agent'
                                  ? 'Tools accept Connector Actions or {kind: "workflow", flowId, name, description, approval, inputs}. Workflow parameter sources use model, input or value. The platform derives the interface. Refresh a workflow tool with node.refresh and tool: its name.'
                                  : kind == 'code'
                                    ? codeGuidance
                                    : 'Supply business configuration and input data. Fixed definitions are assembled by the tool. Existing constraints and defaults are preserved on partial updates.',
        example: {
          op: 'node.add',
          as: 'step',
          type: kind,
          name: 'Step',
          ...((
            {
              'start': { config: { inputDefs: {} } },
              'outputs': { config: { outputDefs: {} } },
              'workflow': { config: { flowId: '<Flow ID>' } },
              'connector': { config: { action: '<Action ID>', connectionId: '<Connection ID>' } },
              'poll': { config: { key: '<Trigger key>', schedule: [{ type: 'every', unit: 'minute', value: 5 }] } },
              'integration': { config: { key: '<Trigger key>' } },
              'dedupe': { config: { field: 'id', mode: 'new', space: 'node' }, inputs: { items: { kind: 'value', value: [{ id: 'a' }, { id: 'b' }] } } },
              'http-request': { config: {}, inputs: { url: { kind: 'value', value: 'https://example.com' } } },
              'openapi': { config: { sourceUrl: 'https://example.com/openapi.json', path: '/items', method: 'get' } },
              'code': { code: 'export default ({value}) => ({result:value})', inputs: { value: { kind: 'value', value: 'Hello' } } },
              'condition': {
                config: {
                  match: 'first',
                  branches: [
                    {
                      name: 'yes',
                      when: {
                        left: { kind: 'value', value: 120 },
                        operator: '>',
                        right: { kind: 'value', value: 100 },
                      },
                    },
                  ],
                },
              },
              'value': { config: { values: { threshold: 100, region: 'EU' } } },
              'webhook': { config: { method: 'POST', body: { orderId: { schema: { type: 'string' }, nullable: false } } } },
              'wait': { prompt: 'Continue processing this order?', inputs: { order: { kind: 'value', value: { orderId: 'A-1' } } } },
              'approval': { prompt: 'Approve this order?', inputs: { order: { kind: 'value', value: { orderId: 'A-1' } } } },
              'llm': {
                config: { model: { model: 'deepseek-v4-flash' }, template: [{ role: 'user', content: 'Summarize {{order}}.' }] },
                inputs: { order: { kind: 'value', value: { orderId: 'A-1', total: 42 } } },
              },
              'agent': {
                config: {
                  model: 'deepseek-v4-flash',
                },
                inputs: { orders: { kind: 'value', value: [{ orderId: 'A-1', total: 42 }] } },
                prompt: 'Summarize {{orders}}.',
              },
            } as Partial<Record<AuthoringType, unknown>>
          )[kind] as object),
        },
        configuration: z.toJSONSchema(authoringConfigurations[kind].partial()),
        texts: kind == 'code' ? ['code'] : ['agent', 'wait', 'approval'].includes(kind) ? ['prompt'] : [],
      }
}

export const authoringDiagnosticSchema = z.object({
  code: id,
  message: z.string(),
  nodes: z.array(id),
  field: z.string().optional(),
  line: z.number().optional(),
  column: z.number().optional(),
})
export const authoringCheckResponse = z.object({
  flowId: id,
  revisionId: id,
  valid: z.boolean(),
  diagnostics: z.array(authoringDiagnosticSchema),
  version: z.literal(1),
})
export const authoringEditResponse = z.object({
  flowId: id,
  saved: z.literal(true),
  revision: id,
  nodes: z.record(id, id),
  changes: z.array(z.object({ index: z.int(), op: id, node: id.optional() })),
  validation: z.object({ status: z.enum(['valid', 'invalid', 'unavailable']), diagnostics: z.array(authoringDiagnosticSchema).optional() }),
  version: z.literal(1),
})
export const authoringReadResponse = z.object({
  flowId: id,
  revision: id,
  data: z.object({
    nodes: z.array(z.record(z.string(), json)).optional(),
    edges: z.array(json).optional(),
    text: z.record(z.string(), json).optional(),
  }),
  version: z.literal(1),
})
export const authoringSearchResponse = z.object({
  flowId: id,
  revision: id,
  data: z.object({
    matches: z.array(z.object({ node: id.optional(), field: id, line: z.int().optional(), excerpt: z.string() })),
    total: z.int(),
    nextOffset: z.int().optional(),
  }),
  version: z.literal(1),
})
