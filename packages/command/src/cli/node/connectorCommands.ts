import type { Flow } from '@oomol-lab/open-flow/control-api'
import type { ParsedArguments } from './arguments.ts'
import type { Runtime } from './support.ts'

import { ControlClient, actionSummary, searchTriggerKeys } from '@oomol-lab/open-flow/control-api'
import { CliError, selectedDraftFlow, referencedAction, triggerKeyText, referencedTriggerKey, connectionText, actionText, write } from './support.ts'

export async function connectorCommand(
  client: ControlClient,
  flow: Flow | undefined,
  operands: readonly string[],
  args: ParsedArguments,
  runtime: Runtime,
): Promise<void> {
  const [operation, first, second, ...extra] = operands
  switch (operation) {
    case 'code-access':
    case 'candidates':
    case 'code-allow':
    case 'code-remove':
    case 'remove-usage': {
      const count = operation == 'code-access' ? 1 : operation == 'candidates' ? 2 : operation == 'remove-usage' ? 3 : 4
      if (operation == 'candidates' ? operands.length < count + 1 : operands.length != count + 1)
        throw new CliError('cli.invalid-arguments', `Invalid arguments for connector ${operation}. See --help.`)
      const flowId = requiredFlowId(flow)
      let result
      if (operation == 'code-access')
        result = args.publication == null ? await client.getConnectorAccess(flowId) : await client.getPublishedConnectorAccess(flowId, args.publication)
      else if (operation == 'candidates') result = await client.listProviderAccessBindingCandidates(flowId, operands.slice(2))
      else {
        const accessRevision = Number(operands.at(-1))
        if (!Number.isSafeInteger(accessRevision) || accessRevision < 0)
          throw new CliError('cli.invalid-arguments', 'Access revision must be a nonnegative integer.')
        if (operation == 'remove-usage') {
          const selected = await selectedDraftFlow(client, flow!, args)
          result = await client.removeConnectionUsage(flowId, second!, selected.draft.revisionId, accessRevision, args.idempotencyKey)
        } else if (operation == 'code-allow') result = await client.addProviderAccessBinding(flowId, second!, extra[0]!, accessRevision)
        else result = await client.removeProviderAccessBinding(flowId, second!, extra[0]!, accessRevision)
      }
      write(runtime, args.json, { ...result, kind: `connector.${operation}` }, JSON.stringify(result, null, 2))
      return
    }
    case 'providers': {
      if (first != null)
        throw new CliError('cli.invalid-arguments', `Usage: ${runtime.commandPrefix ?? 'oo flow'} connector providers [--flow <flow>] [--json]`)
      const providers = await client.listConnectorProviders(undefined, flow?.flowId)
      write(
        runtime,
        args.json,
        { providers, kind: 'connector.providers', version: 1 },
        providers.map((provider) => `${provider.serviceName}\t${provider.serviceId}`).join('\n'),
      )
      return
    }
    case 'teams': {
      if (first != null) throw new CliError('cli.invalid-arguments', `Usage: ${runtime.commandPrefix ?? 'oo flow'} connector teams [--json]`)
      const result = await client.listConnectorTeams()
      write(runtime, args.json, { ...result, kind: 'connector.teams' }, result.teams.map((team) => `${team.name}\t${team.id}`).join('\n'))
      return
    }
    case 'search': {
      if (first == null || second != null)
        throw new CliError('cli.invalid-arguments', `Usage: ${runtime.commandPrefix ?? 'oo flow'} connector search <query> [--json]`)
      const query = first.trim()
      if (query.length == 0 || query.length > 256) throw new CliError('cli.invalid-arguments', 'Connector search query must contain 1–256 characters.')
      const actions = await client.searchConnectorActions(query, undefined, flow?.flowId)
      write(runtime, args.json, { actions: actions.map(actionSummary), kind: 'connector.search', query, version: 1 }, actions.map(actionText).join('\n'))
      return
    }
    case 'show': {
      if (first == null || second != null)
        throw new CliError('cli.invalid-arguments', `Usage: ${runtime.commandPrefix ?? 'oo flow'} connector show <action> [--json]`)
      const action = await referencedAction(client, first, flow?.flowId)
      write(runtime, args.json, { action, kind: 'connector.show', version: 1 }, actionText(action))
      return
    }
    case 'connections': {
      if (first == null || second != null)
        throw new CliError('cli.invalid-arguments', `Usage: ${runtime.commandPrefix ?? 'oo flow'} connector connections <service> [--json]`)
      const connections = await client.listConnectorConnections(first, undefined, flow?.flowId)
      write(runtime, args.json, { connections, kind: 'connector.connections', serviceId: first, version: 1 }, connections.map(connectionText).join('\n'))
      return
    }
    default:
      throw new CliError('cli.invalid-arguments', `Usage: ${runtime.commandPrefix ?? 'oo flow'} connector <providers|teams|search|show|connections> ...`)
  }
}

export async function triggerCommand(client: ControlClient, operands: readonly string[], args: ParsedArguments, runtime: Runtime): Promise<void> {
  const [operation, first, second] = operands
  switch (operation) {
    case 'search': {
      if (second != null) throw new CliError('cli.invalid-arguments', `Usage: ${runtime.commandPrefix ?? 'oo flow'} trigger search [query] [--json]`)
      const query = first?.trim().toLowerCase()
      if (query != null && (query.length == 0 || query.length > 256))
        throw new CliError('cli.invalid-arguments', 'Trigger search query must contain 1–256 characters.')
      const keys = searchTriggerKeys(await client.listTriggerKeys(), query)
      write(runtime, args.json, { keys, kind: 'trigger.search', query, version: 1 }, keys.map(triggerKeyText).join('\n'))
      return
    }
    case 'show': {
      if (first == null || second != null)
        throw new CliError('cli.invalid-arguments', `Usage: ${runtime.commandPrefix ?? 'oo flow'} trigger show <key> [--json]`)
      const definition = await referencedTriggerKey(client, first)
      write(runtime, args.json, { definition, kind: 'trigger.show', version: 1 }, triggerKeyText(definition))
      return
    }
    default:
      throw new CliError('cli.invalid-arguments', `Usage: ${runtime.commandPrefix ?? 'oo flow'} trigger <search|show> ...`)
  }
}

function requiredFlowId(flow: Flow | undefined): string {
  if (flow == null) throw new CliError('cli.invalid-arguments', 'A Flow reference is required.')
  return flow.flowId
}
