import type { RunStatus } from '@oomol-lab/open-flow/control-api'

import { runStatuses as runStatusValues } from '@oomol-lab/open-flow/run-lifecycle'
import { randomUUID } from 'node:crypto'
import { CliError } from './support.ts'

export interface ParsedArguments {
  readonly idempotencyKey: string
  readonly expectedPublication?: string
  readonly trigger?: string
  readonly payload?: string
  readonly after?: number
  readonly code?: string
  readonly connection?: string
  readonly cron?: string
  readonly cursor?: string
  readonly description?: string
  readonly every?: string
  readonly expectedRevision?: string
  readonly file?: string
  readonly flow?: string
  readonly follow: boolean
  readonly input?: string
  readonly json: boolean
  readonly limit?: number
  readonly name?: string
  readonly options: readonly string[]
  readonly positionals: readonly string[]
  readonly source: 'draft' | 'live'
  readonly status?: RunStatus
  readonly summary: boolean
  readonly sets: readonly string[]
  readonly timeoutMs?: number
  readonly timezone?: string
  readonly unsets: readonly string[]
  readonly wait: boolean
  readonly yes: boolean
}

const runStatuses: ReadonlySet<RunStatus> = new Set(runStatusValues)

export function parseArguments(args: readonly string[]): ParsedArguments {
  let idempotencyKey = randomUUID() as string
  let expectedPublication: string | undefined
  const positionals: string[] = []
  const options: string[] = []
  let trigger: string | undefined
  let payload: string | undefined
  let after: number | undefined
  let code: string | undefined
  let connection: string | undefined
  let cron: string | undefined
  let cursor: string | undefined
  let description: string | undefined
  let every: string | undefined
  let expectedRevision: string | undefined
  let file: string | undefined
  let flow: string | undefined
  let follow = false
  let input: string | undefined
  let json = false
  let limit: number | undefined
  let name: string | undefined
  const sets: string[] = []
  let source: ParsedArguments['source'] = 'draft'
  let status: RunStatus | undefined
  let summary = false
  let timeoutMs: number | undefined
  let timezone: string | undefined
  const unsets: string[] = []
  let wait = false
  let yes = false

  for (let index = 0; index < args.length; index += 1) {
    const raw = args[index]!
    const equals = raw.startsWith('--') ? raw.indexOf('=') : -1
    const argument = equals < 0 ? raw : raw.slice(0, equals)
    const inlineValue = equals < 0 ? undefined : raw.slice(equals + 1)
    if (inlineValue != null && ['--json', '--follow', '--wait', '--yes', '--summary'].includes(argument))
      throw new CliError('cli.invalid-arguments', `${argument} does not accept a value.`)
    if (argument.startsWith('--')) {
      const flag = argument.slice(2)
      if (options.includes(flag) && flag != 'set' && flag != 'unset') throw new CliError('cli.invalid-arguments', `Duplicate option --${flag}.`)
      options.push(flag)
    }
    if (argument == '--json') {
      json = true
    } else if (argument == '--follow') {
      follow = true
    } else if (argument == '--wait') {
      wait = true
    } else if (argument == '--yes') {
      yes = true
    } else if (argument == '--summary') {
      summary = true
    } else if (
      argument == '--idempotency-key' ||
      argument == '--expected-publication' ||
      argument == '--code' ||
      argument == '--connection' ||
      argument == '--cron' ||
      argument == '--description' ||
      argument == '--every' ||
      argument == '--expected-revision' ||
      argument == '--file' ||
      argument == '--flow' ||
      argument == '--name' ||
      argument == '--source' ||
      argument == '--input' ||
      argument == '--trigger' ||
      argument == '--payload' ||
      argument == '--status' ||
      argument == '--cursor' ||
      argument == '--limit' ||
      argument == '--after' ||
      argument == '--timeout' ||
      argument == '--timezone' ||
      argument == '--set' ||
      argument == '--unset'
    ) {
      const value = inlineValue ?? args[++index]
      if (value == null || value.length == 0) throw new CliError('cli.invalid-arguments', `${argument} requires a value.`)
      if (argument == '--idempotency-key') idempotencyKey = value
      else if (argument == '--expected-publication') expectedPublication = value
      else if (argument == '--code') code = value
      else if (argument == '--connection') connection = value
      else if (argument == '--cron') cron = value
      else if (argument == '--description') description = value
      else if (argument == '--every') every = value
      else if (argument == '--expected-revision') expectedRevision = value
      else if (argument == '--file') file = value
      else if (argument == '--flow') flow = value
      else if (argument == '--name') name = value
      else if (argument == '--input') input = value
      else if (argument == '--trigger') trigger = value
      else if (argument == '--payload') payload = value
      else if (argument == '--cursor') cursor = value
      else if (argument == '--timezone') timezone = value
      else if (argument == '--set') sets.push(value)
      else if (argument == '--unset') unsets.push(value)
      else if (argument == '--source') {
        if (value != 'draft' && value != 'live') throw new CliError('cli.invalid-arguments', '--source must be draft or live.')
        source = value
      } else if (argument == '--status') {
        if (!runStatuses.has(value as RunStatus)) throw new CliError('cli.invalid-arguments', `Unknown Run status ${JSON.stringify(value)}.`)
        status = value as RunStatus
      } else {
        const numeric = Number(value)
        const minimum = argument == '--after' ? 0 : 1
        if (!Number.isSafeInteger(numeric) || numeric < minimum || (argument == '--limit' && numeric > 100)) {
          throw new CliError('cli.invalid-arguments', `${argument} has an invalid value.`)
        }
        if (argument == '--limit') limit = numeric
        else if (argument == '--after') after = numeric
        else timeoutMs = numeric
      }
    } else if (argument.startsWith('-')) {
      throw new CliError('cli.invalid-arguments', `Unknown option ${JSON.stringify(argument)}.`)
    } else {
      positionals.push(argument)
    }
  }

  return {
    idempotencyKey,
    ...(expectedPublication == null ? {} : { expectedPublication }),
    ...(after == null ? {} : { after }),
    ...(code == null ? {} : { code }),
    ...(connection == null ? {} : { connection }),
    ...(cron == null ? {} : { cron }),
    ...(cursor == null ? {} : { cursor }),
    ...(description == null ? {} : { description }),
    ...(every == null ? {} : { every }),
    ...(expectedRevision == null ? {} : { expectedRevision }),
    ...(file == null ? {} : { file }),
    ...(flow == null ? {} : { flow }),
    follow,
    ...(input == null ? {} : { input }),
    json,
    ...(limit == null ? {} : { limit }),
    ...(name == null ? {} : { name }),
    positionals,
    options,
    ...(trigger == null ? {} : { trigger }),
    ...(payload == null ? {} : { payload }),
    sets,
    source,
    ...(status == null ? {} : { status }),
    summary,
    ...(timeoutMs == null ? {} : { timeoutMs }),
    ...(timezone == null ? {} : { timezone }),
    unsets,
    wait,
    yes,
  }
}
