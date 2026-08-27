import type { CommandHost, Runtime, ParsedArguments } from './support.ts'

import { ApiError, ControlClient } from '@oomol-lab/open-flow/control-api'
import { flowCommand } from './flowCommands.ts'
import { createI18n } from './i18n.ts'
import { CliError, parseArguments, cloudError } from './support.ts'

const commandSyntax: readonly string[] = [
  '  oo flow list',
  '  oo flow create <name>',
  '  oo flow show <flow>',
  '  oo flow inspect <flow> [--summary]',
  '  oo flow apply <flow> --file <path|-> [--expected-revision <revision>]',
  '  oo flow rename <flow> <new-name>',
  '  oo flow delete <flow> --yes',
  '  oo flow check <flow>',
  '  oo flow node <list|show|add|set|remove> <flow>',
  '  oo flow node add <flow> code <name> [--code <javascript|@file|->]',
  '  oo flow connect <flow> <source> <source-output> <target-node> <target-input>',
  '  oo flow disconnect <flow> <source> <source-output> <target-node> <target-input>',
  '  oo flow code <list|show|edit|set>',
  '  oo flow connector <list|search|show|connections|add|set>',
  '  oo flow trigger <search|show|list|add|set|remove>',
  '  oo flow run <flow> [--source draft|live] [--input <json|@file|->] [--wait]',
  '  oo flow runs <list|show|events|result|cancel>',
  '  oo flow publish <flow>',
  '  oo flow publications <list|show> <flow>',
  '  oo flow rollback <flow> <publication>',
  '  oo flow open [flow]',
  '  oo flow workbench [flow]',
]

function codeUsage(subcommand: string | undefined): string {
  switch (subcommand) {
    case 'list':
      return 'oo flow code list <flow> [--json]'
    case 'show':
      return 'oo flow code show <flow> <module> [--json]'
    case 'edit':
      return 'oo flow code edit <flow> <module> --code <javascript|@file|-> [--json]'
    case 'set':
      return 'oo flow code set <flow> <module> --name <name> [--json]'
    default:
      return 'oo flow code <list|show|edit|set>'
  }
}

function help(runtime: Runtime, args: readonly string[]): string {
  const i18n = createI18n(runtime.language)
  try {
    if (args[0] == 'code') return i18n.t('help.usage', { command: codeUsage(args[1]) })
    return [i18n.t('help.title'), '', ...commandSyntax, '', i18n.t('help.options')].join('\n')
  } finally {
    i18n.dispose()
  }
}

export async function runCli(args: readonly string[], host: CommandHost, runtime: Runtime): Promise<number> {
  let parsed: ParsedArguments | undefined
  try {
    if (args.length == 0 || args.includes('--help') || args.includes('-h')) {
      runtime.stdout.write(`${help(runtime, args)}\n`)
      return 0
    }
    parsed = parseArguments(args)
    const client = new ControlClient(host.request)
    await flowCommand(client, host, parsed, runtime)
    return 0
  } catch (error) {
    let value: CliError
    if (error instanceof CliError) value = error
    else if (error instanceof ApiError) value = cloudError(error)
    else value = new CliError('flow.unexpected', error instanceof Error ? error.message : String(error))
    if (parsed?.json == true) {
      runtime.stderr.write(
        `${JSON.stringify({ error: { code: value.code, ...(value.details == null ? {} : { details: value.details }), message: value.message }, version: 1 })}\n`,
      )
    } else {
      runtime.stderr.write(`${value.code}: ${value.message}\n`)
    }
    return 1
  }
}
