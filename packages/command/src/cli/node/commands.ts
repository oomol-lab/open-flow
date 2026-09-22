import { authoringExample, authoringExamples, draftOperationsSchema } from '@oomol-lab/open-flow/control-requests'

const edit = ['expected-revision', 'idempotency-key']
const page = ['cursor', 'limit']
const commands = [
  ['list', '[--cursor <cursor>] [--limit <count>]', page],
  ['create', '<name> [--team <teamId>]', ['idempotency-key', 'team']],
  ['show', '<flow>', []],
  ['inspect', '<flow> [--full]', ['full']],
  ['apply', '<flow> --file <path|->', [...edit, 'file']],
  ['rename', '<flow> <new-name>', []],
  ['delete', '<flow> --yes', ['yes']],
  ['check', '<flow> [--revision <revisionId>]', ['revision']],
  ['enable', '<flow> --expected-publication <publicationId>', ['expected-publication']],
  ['disable', '<flow> --expected-publication <publicationId>', ['expected-publication']],
  ['node list', '<flow>', []],
  ['node show', '<flow> <node>', []],
  ['node add', '<flow> <agent|code|condition|value|llm-chat|llm-json> <name>', [...edit, 'code']],
  ['node set', '<flow> <node>', [...edit, 'name', 'timeout']],
  ['node input', '<flow> <node> <input> <source> <output> [<source> <output> ...]', edit],
  ['node remove', '<flow> <node> --yes', [...edit, 'yes']],
  ['connect', '<flow> <source> <target-node> [branch]', edit],
  ['disconnect', '<flow> <source> <target-node> [branch]', edit],
  ['code list', '<flow>', []],
  ['code show', '<flow> <module>', []],
  ['code edit', '<flow> <module> --code <javascript|@file|->', [...edit, 'code']],
  ['code set', '<flow> <module> --name <name>', [...edit, 'name']],
  ['connector providers', '[--flow <flow>]', ['flow']],
  ['connector teams', '', []],
  ['connector search', '<query> [--flow <flow>]', ['flow']],
  ['connector show', '<action> [--flow <flow>]', ['flow']],
  ['connector connections', '<service> [--flow <flow>]', ['flow']],
  ['connector add', '<flow> <action>', [...edit, 'name', 'connection', 'set']],
  ['connector set', '<flow> <node>', [...edit, 'connection', 'set', 'unset']],
  ['trigger search', '[query]', []],
  ['trigger show', '<key>', []],
  ['trigger list', '<flow>', []],
  ['trigger add', '<flow> <manual|webhook|cron|provider-key>', [...edit, 'name', 'connection', 'cron', 'every', 'timezone', 'set']],
  ['trigger set', '<flow> <trigger>', [...edit, 'name', 'description', 'connection', 'cron', 'every', 'timezone', 'set', 'unset']],
  ['trigger remove', '<flow> <trigger> --yes', [...edit, 'yes']],
  ['run', '<flow>', [...edit, 'expected-publication', 'source', 'trigger', 'outputs', 'input', 'wait', 'timeout']],
  ['runs list', '--flow <flow>', ['flow', 'status', 'pending-wait', ...page]],
  ['runs show', '<run>', []],
  ['runs wait', '<run>', ['timeout']],
  ['runs resolve', '<run> <wait> <continue|approve|reject>', ['comment']],
  ['runs events', '<run>', ['after', 'limit', 'follow', 'timeout']],
  ['runs result', '<run>', []],
  ['runs results', '<run> [--after <resultId>]', ['after']],
  ['runs read-result', '<run> <result>', ['pointer', 'offset', 'limit', 'max-bytes']],
  ['runs download-result', '<run> <result>', []],
  ['runs cancel', '<run>', []],
  ['publish', '<flow>', [...edit, 'expected-publication', 'timeout']],
  ['publications list', '<flow>', page],
  ['publications show', '<flow> <publication>', []],
  ['publications wait', '<flow> <operation>', ['timeout']],
  ['publications operation', '<flow> <operation>', []],
  ['rollback', '<flow> <publication>', ['expected-publication', 'idempotency-key']],
  ['open', '[flow]', []],
  ['workbench', '[flow]', []],
  ['schema', '[operations|apply|input|outputs|examples|example.name|operation-kind]', []],
] as const

const optionDetails: Record<
  string,
  { description: string; type?: string; enum?: readonly string[]; default?: string | number; minimum?: number; maximum?: number }
> = {
  'team': { description: 'Team ID from connector teams.', type: 'string' },
  'revision': { description: 'Exact Revision to check; defaults to the current Draft.', type: 'string' },
  'pointer': { description: 'JSON Pointer within the stored result; defaults to the root.', type: 'string' },
  'offset': { description: 'Page offset at the selected pointer.', type: 'integer', minimum: 0, default: 0 },
  'max-bytes': { description: 'Maximum result page bytes.', type: 'integer', minimum: 1, maximum: 1048576, default: 15000 },
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
  'comment': { description: 'Optional plain-text Wait decision comment (up to 2,000 Unicode code points).', type: 'string' },
  'pending-wait': { description: 'List runs with unresolved waits, including running and queued runs.', type: 'boolean' },
  'status': {
    description: 'Filter runs by status.',
    type: 'string',
    enum: ['queued', 'starting', 'running', 'waiting', 'completed', 'failed', 'canceled', 'indeterminate'],
  },
  'file': { description: 'Apply JSON file path, @path, or - for stdin. See schema apply for complete atomic edits.', type: 'string' },
  'code': { description: 'JavaScript source, @file, or - for stdin.', type: 'string' },
  'input': { description: 'JSON object keyed by node ID then input handle; literal JSON, @file, or -.', type: 'string' },
  'outputs': { description: 'Trigger outputs: literal JSON, @file, or -. Defaults to {}.', type: 'string' },
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
  'full': { description: 'Include complete Revision content, schemas, source code and revision metadata.' },
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
            value: !['json', 'help', 'wait', 'follow', 'full', 'yes', 'pending-wait'].includes(flag),
            repeatable: flag == 'set' || flag == 'unset',
          },
          optionDetails[flag],
          key == 'node set' && flag == 'timeout' ? { default: undefined } : {},
          key == 'runs results' && flag == 'after'
            ? { type: 'string', minimum: undefined, default: undefined, description: 'Result ID from nextAfter on the preceding page.' }
            : {},
          key == 'runs read-result' && flag == 'limit' ? { default: 20 } : {},
        ),
      ),
    }))
}

export function commandOptions(positionals: readonly string[]): readonly string[] | undefined {
  return commands.find(([key]) => key == positionals.slice(0, key.split(' ').length).join(' '))?.[2]
}

export function commandSchema(name = 'apply') {
  if (name == 'examples') return { examples: authoringExamples }
  if (name.startsWith('example.')) {
    try {
      return authoringExample(name.slice('example.'.length))
    } catch {
      return undefined
    }
  }
  if (name == 'operations') return draftOperationsSchema()
  if (name == 'outputs')
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      description: 'Named JSON trigger outputs. The selected trigger defines its outputs contract.',
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
      return draftOperationsSchema(name)
    } catch {
      return undefined
    }
  }
  const { $defs, $schema: _, ...operations } = draftOperationsSchema() as Record<string, unknown>
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
  'oo flow inspect FLOW_ID --json',
  'oo flow schema apply --json',
  'oo flow apply FLOW_ID --file changes.json --expected-revision REVISION_ID --idempotency-key EDIT_KEY --json',
  'oo flow connector search email --flow FLOW_ID --json',
  'oo flow run FLOW_ID --expected-revision REVISION_ID --idempotency-key RUN_KEY --wait --timeout 60000 --json',
  'oo flow runs wait RUN_ID --timeout 60000 --json',
  'oo flow runs resolve RUN_ID WAIT_ID approve --json',
  'oo flow runs events RUN_ID --after 0 --follow --timeout 60000 --json',
]
