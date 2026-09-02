import type { JsonValue, Flow } from '@oomol-lab/open-flow/control-api'
import type { TriggerNode } from '@oomol-lab/open-flow/flow-change'
import type { Runtime, ParsedArguments } from './support.ts'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import {
  createBuiltinTrigger,
  createAuthoringId,
  createManagedTask,
  createProviderTrigger,
  deleteNodes,
  setConnectorConnection,
  setInputValues,
  setTriggerConnection,
  updateTrigger,
} from '@oomol-lab/open-flow/flow-authoring'
import {
  CliError,
  selectedDraftFlow,
  exactNode,
  referencedAction,
  preferredConnection,
  exactTrigger,
  triggerKeyText,
  referencedTriggerKey,
  triggerText,
  connectionText,
  actionText,
  actionSummary,
  write,
  settingValues,
  triggerSchedule,
  withInputValues,
  changeDraft,
} from './support.ts'

export async function connectorCommand(
  client: ControlClient,
  flow: Flow | undefined,
  operands: readonly string[],
  args: ParsedArguments,
  runtime: Runtime,
): Promise<void> {
  const [operation, first, second, ...extra] = operands
  switch (operation) {
    case 'list': {
      if (first != null) throw new CliError('cli.invalid-arguments', 'Usage: oo flow connector list [--json]')
      const actions = await client.listConnectorActions()
      write(runtime, args.json, { actions: actions.map(actionSummary), kind: 'connector.list', version: 1 }, actions.map(actionText).join('\n'))
      return
    }
    case 'search': {
      if (first == null || second != null) throw new CliError('cli.invalid-arguments', 'Usage: oo flow connector search <query> [--json]')
      const query = first.trim()
      if (query.length == 0 || query.length > 256) throw new CliError('cli.invalid-arguments', 'Connector search query must contain 1–256 characters.')
      const actions = await client.searchConnectorActions(query)
      write(runtime, args.json, { actions: actions.map(actionSummary), kind: 'connector.search', query, version: 1 }, actions.map(actionText).join('\n'))
      return
    }
    case 'show': {
      if (first == null || second != null) throw new CliError('cli.invalid-arguments', 'Usage: oo flow connector show <action> [--json]')
      const action = await referencedAction(client, first)
      write(runtime, args.json, { action, kind: 'connector.show', version: 1 }, actionText(action))
      return
    }
    case 'connections': {
      if (first == null || second != null) throw new CliError('cli.invalid-arguments', 'Usage: oo flow connector connections <service> [--json]')
      const connections = await client.listConnectorConnections(first)
      write(runtime, args.json, { connections, kind: 'connector.connections', serviceId: first, version: 1 }, connections.map(connectionText).join('\n'))
      return
    }
    case 'add': {
      if (first == null || second == null || extra.length > 0) {
        throw new CliError(
          'cli.invalid-arguments',
          'Usage: oo flow connector add <flow> <action> [--name <name>] [--connection <connection>] [--set <input=value>] [--json]',
        )
      }
      const selected = await selectedDraftFlow(client, requiredFlowId(flow), first)
      const action = await referencedAction(client, second)
      const values = await settingValues(args, runtime, action.inputs)
      const connection = await preferredConnection(client, action.serviceId, args.connection, action.defaultConnection, false)
      const name = args.name?.trim() ?? action.name
      if (name.length == 0) throw new CliError('cli.invalid-arguments', 'Connector Node name cannot be empty.')
      const nodeId = createAuthoringId()
      const taskId = createAuthoringId()
      const operations = createManagedTask(
        selected.target,
        { nodeId, taskId },
        {
          executor: { action: action.actionId, ...(connection == null ? {} : { connectionId: connection.connectionId }), kind: 'connector' },
          inputs: withInputValues(action, values),
          name,
          outputs: Object.entries(action.outputs).map(([handle, port]) => Object.assign({ handle }, port)),
        },
      )
      const target = { actionId: action.actionId, flowId: selected.flow.flowId, kind: 'connector', nodeId, taskId }
      const changed = await changeDraft(client, requiredFlowId(flow), selected.draft.revisionId, target, operations)
      write(
        runtime,
        args.json,
        {
          ...(connection == null ? {} : { connection }),
          connectionId: connection?.connectionId,
          kind: 'connector.add',
          revision: changed.revision,
          target,
          version: 1,
        },
        `${name}\t${nodeId}\t${action.actionId}\t${connection?.connectionId ?? 'unconfigured'}\t${changed.revision.revisionId}`,
      )
      return
    }
    case 'set': {
      if (first == null || second == null || extra.length > 0 || (args.connection == null && args.sets.length == 0 && args.unsets.length == 0)) {
        throw new CliError(
          'cli.invalid-arguments',
          'Usage: oo flow connector set <flow> <node> [--connection <connection>] [--set <input=value>] [--unset <input>] [--json]',
        )
      }
      const selected = await selectedDraftFlow(client, requiredFlowId(flow), first)
      const resolved = exactNode(selected.graph.nodes, second)
      if (resolved.node.kind != 'task' || resolved.node.task != null) {
        throw new CliError('connector.node-invalid', `Node ${JSON.stringify(second)} is not a Connector Node.`)
      }
      const task = selected.draft.content.document.tasks[resolved.node.taskId]
      if (task == null || !('executor' in task) || task.executor.kind != 'connector') {
        throw new CliError('connector.node-invalid', `Node ${JSON.stringify(second)} is not a Connector Node.`)
      }
      const taskInputs = Object.fromEntries(task.inputs.flatMap((input) => ('handle' in input ? [[input.handle, input]] : [])))
      const values = await settingValues(args, runtime, taskInputs)
      for (const handle of Object.keys(values)) {
        if (taskInputs[handle] == null) throw new CliError('connector.input-not-found', `Connector input ${JSON.stringify(handle)} was not found.`)
      }
      const inputChanged = Object.entries(values).some(([handle, value]) => {
        const current = resolved.node.inputs[handle]
        return value === undefined ? current != null : current?.kind != 'value' || JSON.stringify(current.value) != JSON.stringify(value)
      })
      let connectionId = task.executor.connectionId
      if (args.connection != null) {
        const action = await client.getConnectorAction(task.executor.action)
        connectionId = (await preferredConnection(client, action.serviceId, args.connection, action.defaultConnection, true))!.connectionId
      }
      const connectionChanged = connectionId != task.executor.connectionId
      if (!inputChanged && !connectionChanged) {
        write(
          runtime,
          args.json,
          {
            changed: false,
            connectionId,
            flowId: selected.flow.flowId,
            kind: 'connector.set',
            nodeId: resolved.nodeId,
            revisionId: selected.draft.revisionId,
            version: 1,
          },
          `${resolved.node.name ?? task.name}\t${resolved.nodeId}\tunchanged\t${selected.draft.revisionId}`,
        )
        return
      }
      const operations = [
        ...(connectionChanged ? setConnectorConnection(selected.draft.content, resolved.node.taskId, connectionId!)! : []),
        ...(inputChanged ? setInputValues(selected.draft.content, selected.target, resolved.nodeId, values)! : []),
      ]
      const target = { flowId: selected.flow.flowId, kind: 'connector', nodeId: resolved.nodeId, taskId: resolved.node.taskId }
      const changed = await changeDraft(client, requiredFlowId(flow), selected.draft.revisionId, target, operations)
      write(
        runtime,
        args.json,
        { connectionId, kind: 'connector.set', revision: changed.revision, target, version: 1 },
        `${resolved.node.name ?? task.name}\t${resolved.nodeId}\t${connectionId ?? 'unconfigured'}\t${changed.revision.revisionId}`,
      )
      return
    }
    default:
      throw new CliError('cli.invalid-arguments', 'Usage: oo flow connector <list|search|show|connections|add|set> ...')
  }
}

export async function triggerCommand(
  client: ControlClient,
  flow: Flow | undefined,
  operands: readonly string[],
  args: ParsedArguments,
  runtime: Runtime,
): Promise<void> {
  const [operation, first, second, ...extra] = operands
  switch (operation) {
    case 'search': {
      if (first == null || second != null) throw new CliError('cli.invalid-arguments', 'Usage: oo flow trigger search <query> [--json]')
      const query = first.trim().toLowerCase()
      if (query.length == 0) throw new CliError('cli.invalid-arguments', 'Trigger search query cannot be empty.')
      const definitions = (await client.listTriggerKeys()).filter((item) =>
        [item.description, item.displayName, item.key, item.name, item.provider, item.type].some((value) => value.toLowerCase().includes(query)),
      )
      write(runtime, args.json, { definitions, kind: 'trigger.search', query, version: 1 }, definitions.map(triggerKeyText).join('\n'))
      return
    }
    case 'show': {
      if (first == null || second != null) throw new CliError('cli.invalid-arguments', 'Usage: oo flow trigger show <key> [--json]')
      const definition = await referencedTriggerKey(client, first)
      write(runtime, args.json, { definition, kind: 'trigger.show', version: 1 }, triggerKeyText(definition))
      return
    }
    case 'list': {
      if (first == null || second != null) throw new CliError('cli.invalid-arguments', 'Usage: oo flow trigger list <flow> [--json]')
      const selected = await selectedDraftFlow(client, requiredFlowId(flow), first)
      const entries = Object.entries(selected.graph.nodes).filter((entry): entry is [string, TriggerNode] => !('inputs' in entry[1]))
      const triggers = entries.map(([triggerId, trigger]) => ({ trigger, triggerId }))
      write(
        runtime,
        args.json,
        {
          flowId: selected.flow.flowId,
          kind: 'trigger.list',
          revisionId: selected.draft.revisionId,
          triggers,
          version: 1,
        },
        entries.map(([triggerId, trigger]) => triggerText(selected.draft.content, triggerId, trigger)).join('\n'),
      )
      return
    }
    case 'add': {
      if (first == null || second == null || extra.length > 0) {
        throw new CliError(
          'cli.invalid-arguments',
          'Usage: oo flow trigger add <flow> <webhook|cron|trigger-key> [--name <name>] [--connection <connection>] [--set <field=value>] [--every <interval>|--cron <expression>] [--json]',
        )
      }
      const selected = await selectedDraftFlow(client, requiredFlowId(flow), first)
      const configuredSchedule = triggerSchedule(args.every, args.cron, args.timezone)
      const values = await settingValues(args, runtime)
      const config = Object.fromEntries(Object.entries(values).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined))
      const triggerId = createAuthoringId()
      let operations
      let name: string
      let kind: TriggerNode['kind']
      if (second == 'webhook') {
        if (args.connection != null || configuredSchedule != null || Object.keys(values).length > 0) {
          throw new CliError('trigger.config-invalid', 'Webhook creation only accepts --name; configure request and response fields in Workbench.')
        }
        name = args.name?.trim() ?? 'Webhook'
        kind = 'webhook'
        operations = createBuiltinTrigger(selected.target, triggerId, { inputsDef: [], kind, name })
      } else if (second == 'cron') {
        if (args.connection != null || Object.keys(values).length > 0) {
          throw new CliError('trigger.config-invalid', 'Cron creation does not accept --connection or --set.')
        }
        name = args.name?.trim() ?? 'Scheduled Trigger'
        kind = 'cron'
        operations = createBuiltinTrigger(selected.target, triggerId, {
          cronTimes: configuredSchedule ?? [{ type: 'every', unit: 'hour', value: 1 }],
          kind,
          name,
        })
      } else {
        const definition = await referencedTriggerKey(client, second)
        const connection = await preferredConnection(client, definition.provider, args.connection, undefined, true)
        name = args.name?.trim() ?? definition.displayName
        kind = definition.type
        operations = createProviderTrigger(selected.target, { bindingId: createAuthoringId(), nodeId: triggerId }, definition, {
          config,
          connectionId: connection!.connectionId,
          name,
          ...(configuredSchedule == null ? {} : { schedule: configuredSchedule }),
        })
      }
      if (name.length == 0) throw new CliError('cli.invalid-arguments', 'Trigger name cannot be empty.')
      const target = { flowId: selected.flow.flowId, kind: 'trigger', triggerId }
      const changed = await changeDraft(client, requiredFlowId(flow), selected.draft.revisionId, target, operations)
      write(
        runtime,
        args.json,
        { kind: 'trigger.add', revision: changed.revision, target: { ...target, name, triggerKind: kind }, version: 1 },
        `${name}\t${triggerId}\t${kind}\t${changed.revision.revisionId}`,
      )
      return
    }
    case 'set': {
      if (first == null || second == null || extra.length > 0) {
        throw new CliError(
          'cli.invalid-arguments',
          'Usage: oo flow trigger set <flow> <trigger> [--name <name>] [--description <text>] [--connection <connection>] [--set <field=value>] [--unset <field>] [--every <interval>|--cron <expression>] [--json]',
        )
      }
      const selected = await selectedDraftFlow(client, requiredFlowId(flow), first)
      const resolved = exactTrigger(selected.draft.content, second)
      const configuredSchedule = triggerSchedule(args.every, args.cron, args.timezone)
      const values = await settingValues(args, runtime)
      const changesTrigger = args.name != null || args.description != null || configuredSchedule != null || args.sets.length > 0 || args.unsets.length > 0
      if (!changesTrigger && args.connection == null) {
        throw new CliError('cli.invalid-arguments', 'Trigger set requires a field to change.')
      }
      if ((args.sets.length > 0 || args.unsets.length > 0) && resolved.trigger.kind != 'poll' && resolved.trigger.kind != 'integration') {
        throw new CliError('trigger.config-invalid', '--set and --unset require a poll or integration Trigger.')
      }
      if (configuredSchedule != null && resolved.trigger.kind != 'cron' && resolved.trigger.kind != 'poll') {
        throw new CliError('trigger.schedule-invalid', 'Only cron and poll Triggers have schedules.')
      }
      if (args.connection != null && resolved.trigger.kind != 'poll' && resolved.trigger.kind != 'integration') {
        throw new CliError('trigger.connection-invalid', 'Only poll and integration Triggers have Connections.')
      }
      const operations = []
      if (changesTrigger) {
        const name = args.name?.trim() ?? resolved.trigger.name
        if (name.length == 0) throw new CliError('cli.invalid-arguments', 'Trigger name cannot be empty.')
        const description = args.description ?? resolved.trigger.description
        let changedTrigger
        switch (resolved.trigger.kind) {
          case 'webhook':
            changedTrigger = updateTrigger(selected.draft.content, selected.target, resolved.triggerId, {
              ...(description == null ? {} : { description }),
              inputs: resolved.trigger.inputsDef,
              kind: 'webhook',
              name,
              options: resolved.trigger.options ?? {},
            })
            break
          case 'cron':
            changedTrigger = updateTrigger(selected.draft.content, selected.target, resolved.triggerId, {
              ...(description == null ? {} : { description }),
              kind: 'cron',
              name,
              schedule: configuredSchedule ?? resolved.trigger.cronTimes,
            })
            break
          case 'poll': {
            const config = { ...resolved.trigger.config }
            for (const [field, value] of Object.entries(values)) {
              if (value === undefined) delete config[field]
              else config[field] = value
            }
            changedTrigger = updateTrigger(selected.draft.content, selected.target, resolved.triggerId, {
              ...(description == null ? {} : { description }),
              config,
              kind: 'poll',
              name,
              schedule: configuredSchedule ?? resolved.trigger.pollTimes,
            })
            break
          }
          case 'integration': {
            const config = { ...resolved.trigger.config }
            for (const [field, value] of Object.entries(values)) {
              if (value === undefined) delete config[field]
              else config[field] = value
            }
            changedTrigger = updateTrigger(selected.draft.content, selected.target, resolved.triggerId, {
              ...(description == null ? {} : { description }),
              config,
              kind: 'integration',
              name,
            })
            break
          }
        }
        if (changedTrigger != null) operations.push(...changedTrigger)
      }
      if (args.connection != null && (resolved.trigger.kind == 'poll' || resolved.trigger.kind == 'integration')) {
        const connection = await preferredConnection(client, resolved.trigger.definition.provider, args.connection, undefined, true)
        const binding = selected.draft.content.document.bindings[resolved.trigger.bindingId]
        if (binding?.target != connection!.connectionId)
          operations.push(...setTriggerConnection(selected.draft.content, selected.target, resolved.triggerId, connection!.connectionId)!)
      }
      if (operations.length == 0) {
        write(
          runtime,
          args.json,
          {
            changed: false,
            flowId: selected.flow.flowId,
            kind: 'trigger.set',
            revisionId: selected.draft.revisionId,
            triggerId: resolved.triggerId,
            version: 1,
          },
          `${triggerText(selected.draft.content, resolved.triggerId, resolved.trigger)}\tunchanged\t${selected.draft.revisionId}`,
        )
        return
      }
      const target = { flowId: selected.flow.flowId, kind: 'trigger', triggerId: resolved.triggerId }
      const changed = await changeDraft(client, requiredFlowId(flow), selected.draft.revisionId, target, operations)
      write(
        runtime,
        args.json,
        { kind: 'trigger.set', revision: changed.revision, target, version: 1 },
        `${resolved.trigger.name}\t${resolved.triggerId}\t${changed.revision.revisionId}`,
      )
      return
    }
    case 'remove': {
      if (first == null || second == null || extra.length > 0) {
        throw new CliError('cli.invalid-arguments', 'Usage: oo flow trigger remove <flow> <trigger> --yes [--json]')
      }
      if (!args.yes) throw new CliError('trigger.confirmation-required', 'Trigger removal requires --yes.')
      const selected = await selectedDraftFlow(client, requiredFlowId(flow), first)
      const resolved = exactTrigger(selected.draft.content, second)
      const target = { flowId: selected.flow.flowId, kind: 'trigger', triggerId: resolved.triggerId }
      const changed = await changeDraft(
        client,
        requiredFlowId(flow),
        selected.draft.revisionId,
        target,
        deleteNodes(selected.draft.content, selected.target, [resolved.triggerId]),
      )
      write(
        runtime,
        args.json,
        { kind: 'trigger.remove', revision: changed.revision, target, version: 1 },
        `${resolved.trigger.name}\t${resolved.triggerId}\t${changed.revision.revisionId}`,
      )
      return
    }
    default:
      throw new CliError('cli.invalid-arguments', 'Usage: oo flow trigger <search|show|list|add|set|remove> ...')
  }
}

function requiredFlowId(flow: Flow | undefined): string {
  if (flow == null) throw new CliError('cli.invalid-arguments', 'A Flow reference is required.')
  return flow.flowId
}
