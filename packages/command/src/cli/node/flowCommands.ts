import type { CommandHost, Runtime, ParsedArguments } from './support.ts'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { applyFlowCommand, codeCommand, edgeCommand, inspectFlowCommand, nodeCommand } from './authoringCommands.ts'
import { connectorCommand, triggerCommand } from './connectorCommands.ts'
import { createRunCommand, publicationsCommand, publishCommand, rollbackCommand, runsCommand } from './runCommands.ts'
import { checkedResourceName, CliError, flowText, referencedFlow, requireCount, write } from './support.ts'

export async function flowCommand(client: ControlClient, host: CommandHost, args: ParsedArguments, runtime: Runtime): Promise<number | void> {
  const [operation, ...operands] = args.positionals

  switch (operation) {
    case 'apply': {
      const flow = await operandFlow(client, operands)
      return await applyFlowCommand(client, flow, operands, args, runtime)
    }
    case 'code': {
      const flowReference = operands[1]
      if (flowReference == null) throw new CliError('cli.invalid-arguments', 'Usage: oo flow code <operation> <flow> [module]')
      const flow = await referencedFlow(client, flowReference)
      return await codeCommand(client, flow, [operands[0]!, ...operands.slice(2)], args, runtime)
    }
    case 'connector': {
      const mutation = operands[0] == 'add' || operands[0] == 'set' || operands[0] == 'remove'
      const flow = mutation ? await operandFlow(client, operands.slice(1)) : args.flow == null ? undefined : await referencedFlow(client, args.flow)
      return await connectorCommand(client, flow, operands, args, runtime)
    }
    case 'connect':
    case 'disconnect': {
      const flow = await operandFlow(client, operands)
      return await edgeCommand(client, flow, operation, operands, args, runtime)
    }
    case 'node': {
      const flow = await operandFlow(client, operands.slice(1))
      return await nodeCommand(client, flow, operands, args, runtime)
    }
    case 'inspect': {
      const flow = await operandFlow(client, operands)
      return await inspectFlowCommand(client, flow, operands, args, runtime)
    }
    case 'run':
      return await createRunCommand(client, operands, args, runtime)
    case 'runs':
      return await runsCommand(client, operands, args, runtime)
    case 'publish':
      return await publishCommand(client, operands, args, runtime)
    case 'publications':
      return await publicationsCommand(client, operands, args, runtime)
    case 'rollback':
      return await rollbackCommand(client, operands, args, runtime)
    case 'trigger': {
      const operationUsesFlow = operands[0] == 'list' || operands[0] == 'add' || operands[0] == 'set' || operands[0] == 'remove'
      const flow = operationUsesFlow ? await operandFlow(client, operands.slice(1)) : undefined
      return await triggerCommand(client, flow, operands, args, runtime)
    }
    case 'open':
    case 'workbench': {
      if (operands.length > 1) throw new CliError('cli.invalid-arguments', `Usage: oo flow ${operation} [flow] [--json]`)
      if (host.getWorkbenchUrl == null) throw new CliError('workbench.unavailable', 'This CLI host cannot provide a Workbench URL.')
      const flow = operands[0] == null ? undefined : await referencedFlow(client, operands[0])
      const url = await host.getWorkbenchUrl(flow?.flowId)
      if (operation == 'open') await runtime.openUrl(url)
      write(runtime, args.json, { ...(flow == null ? {} : { flow }), kind: `flow.${operation}`, url, version: 1 }, url)
      return
    }
    case 'list': {
      requireCount(operands, 0, 'oo flow list [--json]')
      const page = await client.listFlows({ cursor: args.cursor, limit: args.limit ?? 100 })
      write(runtime, args.json, { ...page, kind: 'flow.list', version: 1 }, page.flows.map(flowText).join('\n'))
      return
    }
    case 'create': {
      requireCount(operands, 1, 'oo flow create <name> [--json]')
      const flow = await client.createFlow(checkedResourceName(operands[0]!, 'Flow'), args.idempotencyKey)
      write(runtime, args.json, { flow, idempotencyKey: args.idempotencyKey, kind: 'flow.create', version: 1 }, flowText(flow))
      return
    }
    case 'show': {
      requireCount(operands, 1, 'oo flow show <flow> [--json]')
      const flow = await referencedFlow(client, operands[0]!)
      write(runtime, args.json, { flow, kind: 'flow.show', version: 1 }, flowText(flow))
      return
    }
    case 'rename': {
      requireCount(operands, 2, 'oo flow rename <flow> <new-name> [--json]')
      const current = await referencedFlow(client, operands[0]!)
      const flow = await client.renameFlow(current.flowId, checkedResourceName(operands[1]!, 'Flow'))
      write(runtime, args.json, { flow, kind: 'flow.rename', version: 1 }, flowText(flow))
      return
    }
    case 'delete': {
      requireCount(operands, 1, 'oo flow delete <flow> --yes [--json]')
      if (!args.yes) throw new CliError('flow.confirmation-required', 'Flow deletion requires --yes.')
      const current = await referencedFlow(client, operands[0]!)
      const flow = await client.deleteFlow(current.flowId)
      write(runtime, args.json, { flow, kind: 'flow.delete', version: 1 }, flowText(flow))
      return
    }
    case 'check': {
      requireCount(operands, 1, 'oo flow check <flow> [--json]')
      const flow = await referencedFlow(client, operands[0]!)
      const check = await client.checkFlow(flow.flowId, flow.draftRevisionId)
      write(
        runtime,
        args.json,
        { check, valid: check.valid, revisionId: flow.draftRevisionId, kind: 'flow.check', scope: 'revision', version: 1 },
        `${check.valid ? 'valid' : 'invalid'}\trevision\t${flow.name}\t${flow.flowId}`,
      )
      return check.valid ? 0 : 1
    }
    default:
      throw new CliError(
        'cli.invalid-arguments',
        'Usage: oo flow <list|create|show|inspect|apply|rename|delete|check|node|connect|disconnect|code|connector|trigger|run|runs|publish|publications|rollback|workbench>',
      )
  }
}

async function operandFlow(client: ControlClient, operands: readonly string[]) {
  const reference = operands[0]
  if (reference == null) throw new CliError('cli.invalid-arguments', 'A Flow reference is required.')
  return await referencedFlow(client, reference)
}
