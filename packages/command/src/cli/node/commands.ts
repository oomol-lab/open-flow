import { changeOperationsSchema } from '@oomol-lab/open-flow/flow-change'

const edit = ['expected-revision', 'idempotency-key']
const page = ['cursor', 'limit']
const commands = [
  ['list', '[--cursor <cursor>] [--limit <count>]', page],
  ['create', '<name>', ['idempotency-key']],
  ['show', '<flow>', []],
  ['inspect', '<flow> [--summary]', ['summary']],
  ['apply', '<flow> --file <path|->', [...edit, 'file']],
  ['rename', '<flow> <new-name>', []],
  ['delete', '<flow> --yes', ['yes']],
  ['check', '<flow>', []],
  ['node list', '<flow>', []],
  ['node show', '<flow> <node>', []],
  ['node add', '<flow> <code|condition|value|llm-chat|llm-json> <name>', [...edit, 'code']],
  ['node set', '<flow> <node>', [...edit, 'name', 'timeout']],
  ['node input', '<flow> <node> <input> <source> <output> [<source> <output> ...]', edit],
  ['node remove', '<flow> <node> --yes', [...edit, 'yes']],
  ['connect', '<flow> <source> <target-node> [branch]', edit],
  ['disconnect', '<flow> <source> <target-node> [branch]', edit],
  ['code list', '<flow>', []],
  ['code show', '<flow> <module>', []],
  ['code edit', '<flow> <module> --code <javascript|@file|->', [...edit, 'code']],
  ['code set', '<flow> <module> --name <name>', [...edit, 'name']],
  ['connector list', '[--flow <flow>]', ['flow']],
  ['connector search', '<query> [--flow <flow>]', ['flow']],
  ['connector show', '<action> [--flow <flow>]', ['flow']],
  ['connector connections', '<service> [--flow <flow>]', ['flow']],
  ['connector add', '<flow> <action>', [...edit, 'name', 'connection', 'set']],
  ['connector set', '<flow> <node>', [...edit, 'name', 'connection', 'set', 'unset']],
  ['trigger search', '[query]', []],
  ['trigger show', '<key>', []],
  ['trigger list', '<flow>', []],
  ['trigger add', '<flow> <manual|webhook|cron|provider-key>', [...edit, 'name', 'connection', 'cron', 'every', 'timezone', 'set']],
  ['trigger set', '<flow> <trigger>', [...edit, 'name', 'description', 'connection', 'cron', 'every', 'timezone', 'set', 'unset']],
  ['trigger remove', '<flow> <trigger> --yes', [...edit, 'yes']],
  ['run', '<flow>', [...edit, 'expected-publication', 'source', 'trigger', 'payload', 'input', 'wait', 'timeout']],
  ['runs list', '--flow <flow>', ['flow', 'status', ...page]],
  ['runs show', '<run>', []],
  ['runs wait', '<run>', ['timeout']],
  ['runs resolve', '<run> <wait> <continue|approve|reject>', []],
  ['runs events', '<run>', ['after', 'limit', 'follow', 'timeout']],
  ['runs result', '<run>', []],
  ['runs cancel', '<run>', []],
  ['publish', '<flow>', [...edit, 'expected-publication', 'timeout']],
  ['publications list', '<flow>', page],
  ['publications show', '<flow> <publication>', []],
  ['publications wait', '<flow> <operation>', ['timeout']],
  ['publications operation', '<flow> <operation>', []],
  ['rollback', '<flow> <publication>', ['expected-publication', 'idempotency-key']],
  ['open', '[flow]', []],
  ['workbench', '[flow]', []],
  ['schema', '[operations|apply|input|payload|operation-kind]', []],
] as const

const optionDetails: Record<
  string,
  { description: string; type?: string; enum?: readonly string[]; default?: string | number; minimum?: number; maximum?: number }
> = {
  'expected-revision': {
    description: 'Base Revision ID from inspect. Required with an explicit idempotency key for draft edits and draft runs.',
    type: 'string',
  },
  'expected-publication': { description: 'Fixed Publication ID. Use none when publishing without a Live Publication.', type: 'string' },
  'idempotency-key': { description: 'Stable identity of one mutation. Reuse only with the identical arguments and base identity.', type: 'string' },
  'source': { description: 'Execution source.', type: 'string', enum: ['draft', 'live'], default: 'draft' },
  'trigger': { description: 'Exact Trigger ID or unambiguous name. A sole Manual Trigger is selected automatically.', type: 'string' },
  'timeout': {
    description: 'Wait budget in milliseconds; expiration does not cancel the operation. For node set, the node execution timeout.',
    type: 'integer',
    minimum: 1,
    default: 60000,
  },
  'limit': { description: 'Maximum items in one page.', type: 'integer', minimum: 1, maximum: 100, default: 100 },
  'after': { description: 'Resume events after this sequence number; use nextAfter from the preceding response.', type: 'integer', minimum: 0, default: 0 },
  'cursor': { description: 'Opaque nextCursor from the preceding page; keep the same filters.', type: 'string' },
  'status': {
    description: 'Filter runs by status.',
    type: 'string',
    enum: ['queued', 'running', 'waiting', 'completed', 'failed', 'canceled', 'indeterminate'],
  },
  'file': { description: 'Apply JSON file path, @path, or - for stdin. See schema apply for complete atomic edits.', type: 'string' },
  'code': { description: 'JavaScript source, @file, or - for stdin.', type: 'string' },
  'input': { description: 'JSON object keyed by node ID then input handle; literal JSON, @file, or -.', type: 'string' },
  'payload': { description: 'Trigger payload: literal JSON, @file, or -. Defaults to {}.', type: 'string' },
  'set': { description: 'handle=value; repeat for multiple fields. Values use port schemas, JSON, @file, or -.', type: 'string' },
  'unset': { description: 'Input/config handle to remove; repeat for multiple fields.', type: 'string' },
  'connection': { description: 'Exact active Connection ID, unambiguous display name, or default.', type: 'string' },
  'flow': { description: 'Exact Flow ID or unambiguous name; fixes Connector Team scope.', type: 'string' },
  'name': { description: 'Display name.', type: 'string' },
  'description': { description: 'Trigger description.', type: 'string' },
  'cron': { description: 'Cron expression; combine with --timezone. Mutually exclusive with --every.', type: 'string' },
  'timezone': { description: 'IANA time zone for --cron.', type: 'string' },
  'every': { description: 'Interval such as 5m, 1h, or 1d. Mutually exclusive with --cron.', type: 'string' },
  'wait': { description: 'Wait until terminal, waiting for an action, or the wait budget expires.' },
  'follow': { description: 'Stream event pages as NDJSON with --json; stop on terminal, Wait, or timeout.' },
  'summary': { description: 'Compact node, trigger and execution-edge list; omit full Revision content.' },
  'yes': { description: 'Confirm the requested deletion.' },
  'json': { description: 'Machine-readable JSON results and errors; NDJSON for followed events.' },
  'help': { description: 'Show this command contract without contacting the host.' },
}

export function commandHelp(path: readonly string[]) {
  const name = path.join(' ')
  return commands
    .filter(([key]) => name == '' || key == name || key.startsWith(`${name} `))
    .map(([key, operands, flags]) => ({
      command: key,
      usage: `oo flow ${key} ${operands} [--json]`,
      options: [...flags, 'json', 'help'].map((flag) =>
        Object.assign(
          {
            name: `--${flag}`,
            value: !['json', 'help', 'wait', 'follow', 'summary', 'yes'].includes(flag),
            repeatable: flag == 'set' || flag == 'unset',
          },
          optionDetails[flag],
          key == 'node set' && flag == 'timeout' ? { default: undefined } : {},
        ),
      ),
    }))
}

export function commandOptions(positionals: readonly string[]): readonly string[] | undefined {
  return commands.find(([key]) => key == positionals.slice(0, key.split(' ').length).join(' '))?.[2]
}

export function commandSchema(name = 'apply') {
  if (name == 'operations') return changeOperationsSchema()
  if (name == 'payload')
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      description: 'Any JSON trigger payload. The selected trigger defines its payload contract.',
    }
  if (name == 'input')
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      additionalProperties: { type: 'object', additionalProperties: true },
      description: 'Node ID -> input handle -> JSON value.',
    }
  if (name != 'apply') {
    try {
      return changeOperationsSchema(name)
    } catch {
      return undefined
    }
  }
  const { $defs, $schema: _, ...operations } = changeOperationsSchema() as Record<string, unknown>
  return {
    $defs,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['version', 'operations'],
    properties: { version: { const: 1 }, operations },
    description:
      'An atomic ordered ChangeOperation transaction. IDs are explicit; before values refer to the specified base revision. Reapplying with a new key is a new transaction.',
    examples: [{ version: 1, operations: [{ kind: 'graph.node.create', nodeId: 'start', target: { kind: 'flow' }, node: { kind: 'manual', name: 'Start' } }] }],
  }
}

export const commandExamples = [
  'oo flow list --limit 20 --json',
  'oo flow inspect FLOW_ID --summary --json',
  'oo flow schema apply --json',
  'oo flow apply FLOW_ID --file changes.json --expected-revision REVISION_ID --idempotency-key EDIT_KEY --json',
  'oo flow connector search email --flow FLOW_ID --json',
  'oo flow run FLOW_ID --expected-revision REVISION_ID --idempotency-key RUN_KEY --wait --timeout 60000 --json',
  'oo flow runs wait RUN_ID --timeout 60000 --json',
  'oo flow runs resolve RUN_ID WAIT_ID approve --json',
  'oo flow runs events RUN_ID --after 0 --follow --timeout 60000 --json',
]
