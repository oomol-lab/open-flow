import { z } from 'zod'
import { authoringDefinitionSchemas as definitions } from '../../flow/common/changeSchema.ts'
import { authoringLlmConfiguration } from './authoringLlm.ts'
import { authoringOpenApiSchema } from './authoringOpenApi.ts'

const id = z.string().min(1)
const json = z.json()
const patch = z.record(id, json)
export const authoringTypes = [
  'manual',
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
const variable = z.strictObject({ kind: z.literal('variable'), name: id })
export const authoringSourceSchema = z.union([
  output,
  variable,
  z.strictObject({ kind: z.literal('value'), value: json }),
  z.strictObject({ kind: z.literal('unset') }),
  z.strictObject({ kind: z.literal('default') }),
  z.strictObject({ kind: z.literal('sources'), sources: z.array(z.union([output, variable])).min(1) }),
])
const operand = z.union([z.strictObject({ kind: z.literal('value'), value: json.optional(), schema: json.optional() }), output, variable])
const agentTool = definitions.agent.shape.tools.element
  .omit({ id: true, inputs: true })
  .extend({
    inputs: z
      .record(id, definitions.agent.shape.tools.element.shape.inputs.element.shape.source)
      .optional()
      .describe(
        'Action input sources by name. The tool resolves types from the Action. New inputs default to model-provided; existing sources are preserved when omitted.',
      ),
  })
  .strict()
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
const outputFields = z.record(id, field).describe('Code return fields by name. Omitted schema accepts any JSON; omitted nullable is true.')
const expression = z.strictObject({
  left: operand,
  operator: definitions.condition.shape.cases.element.shape.groups.element.shape.expressions.element.shape.operator,
  right: operand.optional(),
})
const all = z.strictObject({ all: z.array(expression) })
const when = z.union([expression, all, z.strictObject({ any: z.array(z.union([expression, all])) })])
export const authoringConfigurations = {
  manual: z.strictObject({}),
  error: z.strictObject({ sourceFlowIds: z.array(id).optional() }),
  webhook: definitions.webhook.omit({ bodyFields: true }).extend({ body: inputFields }).strict(),
  cron: z.strictObject({ schedule: definitions.schedule }),
  poll: z.strictObject({ key: id, connectionId: id.optional(), schedule: definitions.schedule }),
  integration: z.strictObject({ key: id, connectionId: id.optional() }),
  code: z.strictObject({ inputs: inputFields, outputs: outputFields, capabilities: definitions.capabilities.optional() }),
  connector: definitions.connector.strict(),
  openapi: authoringOpenApiSchema,
  agent: definitions.agent
    .omit({ prompt: true, tools: true })
    .extend({
      inputs: inputFields,
      resultSchema: json.describe('JSON schema of the final result. Defaults to text. The tool manages the output definition; references can omit port.'),
      tools: z.array(agentTool),
      notification: notification.optional(),
    })
    .strict(),
  llm: authoringLlmConfiguration.extend({ inputs: inputFields }),
  decision: definitions.decision,
  condition: z.strictObject({ match: z.enum(['first', 'all']), branches: z.array(z.strictObject({ name: id, description: z.string().optional(), when })) }),
  value: z.strictObject({ values: patch, outputs: outputFields }),
  wait: z.strictObject({ inputs: inputFields }),
  approval: z.strictObject({ inputs: inputFields }),
}
const metadata = {
  name: id.optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  maxExecutions: z.int().positive().optional(),
  timeoutMs: z.number().nonnegative().optional(),
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
    config: patch.optional(),
    inputs: z
      .record(id, authoringSourceSchema)
      .optional()
      .describe('Input data sources, applied after creation, as input.set operations. Execution edges are separate.'),
    code: z.string().optional(),
    prompt: z.string().optional(),
  }),
  z.strictObject({ op: z.literal('node.update'), node: referenceSchema, set: updates.optional(), clear: z.array(z.array(id).min(1)).optional() }),
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
      'Choose one mode: outline (omit nodes and text), node details (nodes), or text excerpt (text). nodes and text are mutually exclusive. Text defaults to 80 lines, at most 200 lines and 24000 characters. For the complete text, repeat at nextStart with the same revision until truncated is false.',
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
      'Use the observed revision as baseRevision and a stable requestId. Edits are ordered and atomic. node.add.as declares a batch-local alias without $. Every later reference to that new node must use $alias, including node, edge source/target and output source node fields; a bare alias is not the node ID. Use returned node references in later batches. Updates recursively merge objects (including schemas); {} preserves existing fields. Arrays replace as a whole. Remove fields with clear paths. Text replacement requires exactly one match. Read the target text first. A saved draft can have validation diagnostics.',
    examples: [
      {
        baseRevision: 'REVISION',
        requestId: 'CREATE_REQUEST',
        edits: [
          { op: 'node.add', as: 'start', type: 'manual', name: 'Start' },
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
        inputSources: ['poll', 'integration'].includes(kind)
          ? ['value', 'unset', 'default']
          : ['manual', 'error', 'cron', 'webhook', 'value', 'condition'].includes(kind)
            ? []
            : ['value', 'unset', 'default', 'output', 'variable', 'sources'],
        extensibleInputs: ['code', 'agent', 'llm', 'wait', 'approval'].includes(kind),
        guidance:
          kind == 'condition'
            ? 'Edit branch operands through config.branches. A branch can test one expression, all expressions, or any alternatives. Unmatched execution uses branch otherwise.'
            : ['poll', 'integration'].includes(kind)
              ? 'Configure static parameters with node.add.inputs or input.set. Definitions come from the selected Trigger key; execution output and variable sources are unavailable.'
              : kind == 'llm'
                ? 'Configure model settings, message templates and history as defaults. Input bindings with the same names override these defaults; named business inputs can be bound directly. Template strings interpolate {{name}}.'
                : kind == 'openapi'
                  ? 'Select an operation; the tool resolves its ports and authentication. Read authenticationChoices from node details. authentication is replaced as a complete choice. Bind advertised credentials through inputs.'
                  : 'Supply business configuration and input data. Fixed definitions are assembled by the tool. Existing constraints and defaults are preserved on partial updates.',
        example: {
          op: 'node.add',
          as: 'step',
          type: kind,
          name: 'Step',
          ...((
            {
              connector: { config: { action: '<Action ID>', connectionId: '<Connection ID>' } },
              poll: { config: { key: '<Trigger key>', schedule: [{ type: 'every', unit: 'minute', value: 5 }] } },
              integration: { config: { key: '<Trigger key>' } },
              openapi: { config: { sourceUrl: 'https://example.com/openapi.json', path: '/items', method: 'get' } },
              code: { code: 'export default ({value}) => ({result:value})', inputs: { value: { kind: 'value', value: 'Hello' } } },
              condition: {
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
              value: { config: { values: { threshold: 100, region: 'EU' } } },
              webhook: { config: { method: 'POST', body: { orderId: { schema: { type: 'string' }, nullable: false } } } },
              wait: { prompt: 'Continue processing this order?', inputs: { order: { kind: 'value', value: { orderId: 'A-1' } } } },
              approval: { prompt: 'Approve this order?', inputs: { order: { kind: 'value', value: { orderId: 'A-1' } } } },
              llm: {
                config: { model: { model: 'deepseek-v4-flash' }, template: [{ role: 'user', content: 'Summarize {{order}}.' }] },
                inputs: { order: { kind: 'value', value: { orderId: 'A-1', total: 42 } } },
              },
              agent: {
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
  data: z.object({ nodes: z.array(z.record(z.string(), json)).optional(), edges: z.array(json).optional(), text: z.record(z.string(), json).optional() }),
  version: z.literal(1),
})
export const authoringSearchResponse = z.object({
  flowId: id,
  revision: id,
  data: z.object({
    matches: z.array(z.object({ node: id, field: id, line: z.int().optional(), excerpt: z.string() })),
    total: z.int(),
    nextOffset: z.int().optional(),
  }),
  version: z.literal(1),
})
