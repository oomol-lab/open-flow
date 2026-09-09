import type { ParsedArguments } from './arguments.ts'
import type { CommandHost, Runtime } from './support.ts'

import { ApiError, ControlClient } from '@oomol-lab/open-flow/control-api'
import { parseArguments } from './arguments.ts'
import { commandExamples, commandHelp, commandOptions, commandSchema } from './commands.ts'
import { flowCommand } from './flowCommands.ts'
import { createI18n } from './i18n.ts'
import { CliError, cloudError } from './support.ts'

function help(runtime: Runtime, args: readonly string[]) {
  const path = args.filter((argument) => !argument.startsWith('-'))
  let entries = commandHelp(path)
  while (entries.length == 0 && path.length > 0) {
    path.pop()
    entries = commandHelp(path)
  }
  const i18n = createI18n(runtime.language)
  try {
    const result = {
      kind: 'cli.help',
      version: 1,
      commands: entries.length == 1 ? entries : entries.map(({ command, usage }) => ({ command, usage })),
      examples: commandExamples,
      exitCodes: {
        0: 'Success or accepted asynchronous operation.',
        1: 'Error or unsuccessful terminal Run.',
        2: 'Run is waiting for an explicit action; inspect run.waiting.',
        3: 'Waiting timed out or publication is pending; the operation continues.',
      },
      notes: [
        '--timeout is a wait budget in milliseconds (default 60000), except node set where it changes the node execution timeout.',
        '--follow --json writes NDJSON pages immediately; resume from nextAfter.',
        'Use schema apply for complete atomic edits and schema operations for the lower contract.',
        'Retry mutations with the same idempotency key, fixed revision/publication and identical arguments.',
      ],
    }
    return args.includes('--json')
      ? JSON.stringify(result)
      : [
          i18n.t('help.title'),
          '',
          ...entries.map((entry) =>
            entries.length != 1
              ? entry.usage
              : `${entry.usage}\n  Options: ${entry.options.map((option) => option.name + (option.value ? ' <value>' : '') + (option.description == null ? '' : `: ${option.description}`)).join('\n  ')}`,
          ),
          '',
          i18n.t('help.options'),
          '',
          ...result.notes,
          '',
          ...commandExamples,
        ].join('\n')
  } finally {
    i18n.dispose()
  }
}

export async function runCli(args: readonly string[], host: CommandHost, runtime: Runtime): Promise<number> {
  let parsed: ParsedArguments | undefined
  let mutation: { path: string; idempotencyKey: string; request?: unknown } | undefined
  try {
    if (args.length == 0 || args.includes('--help') || args.includes('-h')) {
      runtime.stdout.write(`${help(runtime, args)}\n`)
      return 0
    }
    parsed = parseArguments(args)
    const allowed = commandOptions(parsed.positionals)
    if (allowed == null) throw new CliError('cli.invalid-arguments', 'Unknown command. Use oo flow --help.')
    for (const flag of parsed.options) {
      if (flag != 'json' && !allowed.includes(flag)) throw new CliError('cli.invalid-arguments', `Option --${flag} is not supported by this command.`)
    }
    if (parsed.options.includes('idempotency-key')) {
      const liveRun = parsed.positionals[0] == 'run' && parsed.source == 'live'
      if (allowed.includes('expected-revision') && !liveRun && parsed.expectedRevision == null)
        throw new CliError('cli.invalid-arguments', 'An explicit idempotency key requires --expected-revision for a repeatable mutation.')
      if ((liveRun || parsed.positionals[0] == 'publish' || parsed.positionals[0] == 'rollback') && parsed.expectedPublication == null)
        throw new CliError('cli.invalid-arguments', 'An explicit idempotency key requires --expected-publication (use none for the first publication).')
    }
    if (parsed.timeoutMs != null && parsed.positionals[0] == 'run' && !parsed.wait)
      throw new CliError('cli.invalid-arguments', '--timeout requires --wait for run.')
    if (parsed.timeoutMs != null && parsed.positionals[0] == 'runs' && parsed.positionals[1] == 'events' && !parsed.follow)
      throw new CliError('cli.invalid-arguments', '--timeout requires --follow for events.')
    if (
      parsed.positionals[0] == 'run' &&
      ((parsed.source == 'live' && parsed.expectedRevision != null) || (parsed.source == 'draft' && parsed.expectedPublication != null))
    )
      throw new CliError('cli.invalid-arguments', 'Use --expected-revision for draft runs and --expected-publication for live runs.')
    if (parsed.positionals[0] == 'schema') {
      if (parsed.positionals.length > 2) throw new CliError('cli.invalid-arguments', 'Usage: oo flow schema [apply|operations|input|payload]')
      const schema = commandSchema(parsed.positionals[1])
      if (schema == null) throw new CliError('cli.invalid-arguments', 'Unknown schema.')
      runtime.stdout.write(`${JSON.stringify(schema)}\n`)
      return 0
    }
    const client = new ControlClient(async (path, init) => {
      const key = new Headers(init?.headers).get('idempotency-key')
      mutation =
        key == null ? undefined : { path, idempotencyKey: key, ...(typeof init?.body == 'string' ? { request: JSON.parse(init.body) as unknown } : {}) }
      return await host.request(path, init)
    })
    return (await flowCommand(client, host, parsed, runtime)) ?? 0
  } catch (error) {
    let value: CliError
    if (error instanceof CliError) value = error
    else if (error instanceof ApiError) value = cloudError(error)
    else value = new CliError('flow.unexpected', error instanceof Error ? error.message : String(error))
    if (
      mutation != null &&
      ((!(error instanceof ApiError) && !(error instanceof CliError)) || (error instanceof ApiError && error.code == 'response.invalid'))
    ) {
      value = new CliError('flow.mutation-outcome-unknown', 'The mutation outcome is unknown. Retry the exact request with the same idempotency key.', mutation)
    }
    if (args.includes('--json')) {
      runtime.stderr.write(
        `${JSON.stringify({ error: { code: value.code, ...(value.details == null ? {} : { details: value.details }), message: value.message }, version: 1 })}\n`,
      )
    } else {
      runtime.stderr.write(`${value.code}: ${value.message}\n`)
    }
    return 1
  }
}
