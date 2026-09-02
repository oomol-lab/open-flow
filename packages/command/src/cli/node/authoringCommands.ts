import type { ConnectorAction, Flow, TriggerKeySnapshot } from '@oomol-lab/open-flow/control-api'
import type { TriggerNode } from '@oomol-lab/open-flow/flow-change'
import type { Runtime, ParsedArguments, SemanticNode } from './support.ts'

import { ApiError, ControlClient } from '@oomol-lab/open-flow/control-api'
import {
  connect as connectEdge,
  createAuthoringId,
  createBuiltinTrigger,
  createCodeTask,
  createCondition,
  createLlmTask,
  createManagedTask,
  createProviderTrigger,
  createValue,
  deleteNodes,
  disconnect as disconnectEdge,
  moduleImports,
  renameModule,
  replaceModuleSource,
  updateSettings,
} from '@oomol-lab/open-flow/flow-authoring'
import { applyFlowChanges } from '@oomol-lab/open-flow/flow-change'
import {
  CliError,
  selectedDraftFlow,
  exactNode,
  exactModule,
  referencedAction,
  preferredConnection,
  exactEdgeSource,
  referencedTriggerKey,
  nodeDetails,
  inspectedNode,
  inspectedNodeSummary,
  inspectedTriggerSummary,
  inspectedEdges,
  requireCount,
  write,
  nodeText,
  nodeSummary,
  moduleText,
  argumentText,
  applySpec,
  withInputValues,
  changeDraft,
} from './support.ts'

export async function codeCommand(client: ControlClient, flow: Flow, operands: readonly string[], args: ParsedArguments, runtime: Runtime): Promise<void> {
  const [operation, moduleReference, ...extra] = operands
  const draft = await client.getDraft(flow.flowId)

  switch (operation) {
    case 'list': {
      if (moduleReference != null) throw new CliError('cli.invalid-arguments', 'Usage: oo flow code list [--json]')
      const entries = Object.entries(draft.content.modules).toSorted(
        (left, right) => left[1].name.localeCompare(right[1].name) || left[0].localeCompare(right[0]),
      )
      const modules = entries.map(([moduleId, module]) => ({ imports: module.imports, moduleId, name: module.name }))
      write(
        runtime,
        args.json,
        { kind: 'code.list', modules, flowId: flow.flowId, revisionId: draft.revisionId, version: 1 },
        entries.map(([moduleId, module]) => moduleText(moduleId, module)).join('\n'),
      )
      return
    }
    case 'show': {
      if (moduleReference == null || extra.length > 0) throw new CliError('cli.invalid-arguments', 'Usage: oo flow code show <module> [--json]')
      const resolved = exactModule(draft.content.modules, moduleReference)
      if (args.json) {
        write(
          runtime,
          true,
          { kind: 'code.show', module: resolved.module, moduleId: resolved.moduleId, flowId: flow.flowId, revisionId: draft.revisionId, version: 1 },
          '',
        )
      } else {
        runtime.stdout.write(resolved.module.source.endsWith('\n') ? resolved.module.source : `${resolved.module.source}\n`)
      }
      return
    }
    case 'edit': {
      if (moduleReference == null || extra.length > 0 || args.code == null) {
        throw new CliError('cli.invalid-arguments', 'Usage: oo flow code edit <module> --code <javascript|@file|-> [--json]')
      }
      const resolved = exactModule(draft.content.modules, moduleReference)
      const source = await argumentText(args.code, '--code', 'code.source-unreadable', runtime)
      const imports = await moduleImports(source)
      const unchanged =
        source == resolved.module.source &&
        imports.length == resolved.module.imports.length &&
        imports.every((value, index) => value == resolved.module.imports[index])
      if (unchanged) {
        write(
          runtime,
          args.json,
          { changed: false, kind: 'code.edit', moduleId: resolved.moduleId, flowId: flow.flowId, revisionId: draft.revisionId, version: 1 },
          `${moduleText(resolved.moduleId, resolved.module)}\t${draft.revisionId}`,
        )
        return
      }
      const target = { kind: 'module', moduleId: resolved.moduleId }
      const changed = await changeDraft(
        client,
        flow.flowId,
        draft.revisionId,
        target,
        replaceModuleSource(resolved.moduleId, resolved.module.source, resolved.module.imports, source, imports),
      )
      write(
        runtime,
        args.json,
        { imports, kind: 'code.edit', moduleId: resolved.moduleId, flowId: flow.flowId, revision: changed.revision, version: 1 },
        `${resolved.module.name}\t${resolved.moduleId}\t${changed.revision.revisionId}`,
      )
      return
    }
    case 'set': {
      if (moduleReference == null || extra.length > 0 || args.name == null) {
        throw new CliError('cli.invalid-arguments', 'Usage: oo flow code set <module> --name <name> [--json]')
      }
      const resolved = exactModule(draft.content.modules, moduleReference)
      const name = args.name.trim()
      if (name.length == 0) throw new CliError('cli.invalid-arguments', 'CodeModule name cannot be empty.')
      if (name == resolved.module.name) {
        write(
          runtime,
          args.json,
          { changed: false, kind: 'code.set', moduleId: resolved.moduleId, flowId: flow.flowId, revisionId: draft.revisionId, version: 1 },
          `${moduleText(resolved.moduleId, resolved.module)}\t${draft.revisionId}`,
        )
        return
      }
      const target = { kind: 'module', moduleId: resolved.moduleId }
      const changed = await changeDraft(client, flow.flowId, draft.revisionId, target, renameModule(resolved.moduleId, resolved.module.name, name))
      write(
        runtime,
        args.json,
        { kind: 'code.set', moduleId: resolved.moduleId, name, flowId: flow.flowId, revision: changed.revision, version: 1 },
        `${name}\t${resolved.moduleId}\t${changed.revision.revisionId}`,
      )
      return
    }
    default:
      throw new CliError('cli.invalid-arguments', 'Usage: oo flow code <list|show|edit|set> ...')
  }
}

export async function edgeCommand(
  client: ControlClient,
  flow: Flow,
  operation: 'connect' | 'disconnect',
  operands: readonly string[],
  args: ParsedArguments,
  runtime: Runtime,
): Promise<void> {
  requireCount(operands, 5, `oo flow ${operation} <flow> <source> <source-output> <target-node> <target-input> [--json]`)
  const selected = await selectedDraftFlow(client, flow.flowId, operands[0]!)
  const source = exactEdgeSource(selected.graph.nodes, operands[1]!)
  if (source.kind == 'trigger' && operands[2] != 'payload') {
    throw new CliError('trigger.output-not-found', 'Trigger output must be payload.')
  }
  const targetNode = exactNode(selected.graph.nodes, operands[3]!)
  const edge = { source: source.id, sourceHandle: operands[2]!, target: targetNode.nodeId, targetHandle: operands[4]! }
  const operations =
    operation == 'connect' ? connectEdge(selected.draft.content, selected.target, edge) : disconnectEdge(selected.draft.content, selected.target, edge)
  const kind = `edge.${operation}` as const
  if (operations.length == 0) {
    write(
      runtime,
      args.json,
      { changed: false, edge, flowId: selected.flow.flowId, kind, revisionId: selected.draft.revisionId, version: 1 },
      `${operation}\tunchanged\t${source.id}:${edge.sourceHandle}\t${targetNode.nodeId}:${edge.targetHandle}\t${selected.draft.revisionId}`,
    )
    return
  }
  const changeTarget = { edge, flowId: selected.flow.flowId, kind: 'edge' }
  const changed = await changeDraft(client, flow.flowId, selected.draft.revisionId, changeTarget, operations)
  write(
    runtime,
    args.json,
    { edge, flowId: selected.flow.flowId, kind, revision: changed.revision, version: 1 },
    `${operation}\t${source.id}:${edge.sourceHandle}\t${targetNode.nodeId}:${edge.targetHandle}\t${changed.revision.revisionId}`,
  )
}

export async function nodeCommand(client: ControlClient, flow: Flow, operands: readonly string[], args: ParsedArguments, runtime: Runtime): Promise<void> {
  const [operation, flowReference, nodeReference, ...extra] = operands
  if (flowReference == null) throw new CliError('cli.invalid-arguments', 'Usage: oo flow node <list|show|add|set|remove> <flow> ...')
  const selected = await selectedDraftFlow(client, flow.flowId, flowReference)

  switch (operation) {
    case 'list': {
      if (nodeReference != null) throw new CliError('cli.invalid-arguments', 'Usage: oo flow node list <flow> [--json]')
      const entries = Object.entries(selected.graph.nodes).filter((entry): entry is [string, SemanticNode] => 'inputs' in entry[1])
      const nodes = entries.map(([nodeId, node]) => nodeSummary(nodeId, node))
      write(
        runtime,
        args.json,
        {
          flowId: selected.flow.flowId,
          kind: 'node.list',
          nodes,
          revisionId: selected.draft.revisionId,
          version: 1,
        },
        entries.map(([nodeId, node]) => nodeText(nodeId, node)).join('\n'),
      )
      return
    }
    case 'show': {
      if (nodeReference == null || extra.length > 0) throw new CliError('cli.invalid-arguments', 'Usage: oo flow node show <flow> <node> [--json]')
      const resolved = exactNode(selected.graph.nodes, nodeReference)
      write(
        runtime,
        args.json,
        {
          flowId: selected.flow.flowId,
          kind: 'node.show',
          node: nodeDetails(selected.draft.content, resolved.nodeId, resolved.node),
          revisionId: selected.draft.revisionId,
          version: 1,
        },
        nodeText(resolved.nodeId, resolved.node),
      )
      return
    }
    case 'add': {
      if (nodeReference == null || extra.length != 1) {
        throw new CliError(
          'cli.invalid-arguments',
          'Usage: oo flow node add <flow> <code|condition|llm-chat|llm-json|value> <name> [--code <javascript|@file|->] [--json]',
        )
      }
      const name = extra[0]!.trim()
      if (name.length == 0) throw new CliError('cli.invalid-arguments', 'Node name cannot be empty.')
      const nodeId = createAuthoringId()
      let identity: { readonly moduleId?: string; readonly taskId?: string } = {}
      let operations
      switch (nodeReference) {
        case 'code': {
          const moduleId = createAuthoringId()
          const source = args.code == null ? undefined : await argumentText(args.code, '--code', 'code.source-unreadable', runtime)
          operations = createCodeTask(
            selected.target,
            { moduleId, nodeId },
            name,
            source == null ? undefined : { imports: await moduleImports(source), source },
          )
          identity = { moduleId }
          break
        }
        case 'condition':
          if (args.code != null) throw new CliError('cli.invalid-arguments', '--code is only valid when adding a Code Node.')
          operations = createCondition(selected.target, nodeId, name)
          break
        case 'llm-chat':
        case 'llm-json':
          if (args.code != null) throw new CliError('cli.invalid-arguments', '--code is only valid when adding a Code Node.')
          identity = { taskId: createAuthoringId() }
          operations = createLlmTask(
            selected.target,
            { nodeId, taskId: identity.taskId! },
            name,
            nodeReference == 'llm-chat' ? 'chat' : 'json',
            'Generated response.',
          )
          break
        case 'value':
          if (args.code != null) throw new CliError('cli.invalid-arguments', '--code is only valid when adding a Code Node.')
          operations = createValue(selected.target, nodeId, name)
          break
        default:
          throw new CliError('node.kind-invalid', `Unknown Node kind ${JSON.stringify(nodeReference)}.`)
      }
      const target = { flowId: selected.flow.flowId, ...identity, kind: 'node', name, nodeId }
      const changed = await changeDraft(client, flow.flowId, selected.draft.revisionId, target, operations)
      write(
        runtime,
        args.json,
        { kind: 'node.add', revision: changed.revision, target, version: 1 },
        `${name}\t${nodeId}\t${nodeReference}\t${changed.revision.revisionId}`,
      )
      return
    }
    case 'set': {
      if (nodeReference == null || extra.length > 0) {
        throw new CliError('cli.invalid-arguments', 'Usage: oo flow node set <flow> <node> [--name <name>] [--concurrency <count>] [--timeout <ms>]')
      }
      if (args.name == null && args.concurrency == null && args.timeoutMs == null) {
        throw new CliError('cli.invalid-arguments', 'Node set requires --name, --concurrency, or --timeout.')
      }
      const resolved = exactNode(selected.graph.nodes, nodeReference)
      const name = args.name?.trim()
      if (name != null && name.length == 0) throw new CliError('cli.invalid-arguments', 'Node name cannot be empty.')
      const nextName = name ?? resolved.node.name
      const nextTimeoutMs = args.timeoutMs ?? resolved.node.timeoutMs
      const settings = {
        concurrency: args.concurrency ?? resolved.node.concurrency,
        ...(nextName == null ? {} : { name: nextName }),
        ...(nextTimeoutMs == null ? {} : { timeoutMs: nextTimeoutMs }),
      }
      if (settings.concurrency == resolved.node.concurrency && settings.name == resolved.node.name && settings.timeoutMs == resolved.node.timeoutMs) {
        write(
          runtime,
          args.json,
          {
            changed: false,
            flowId: selected.flow.flowId,
            kind: 'node.set',
            node: nodeDetails(selected.draft.content, resolved.nodeId, resolved.node),
            revisionId: selected.draft.revisionId,
            version: 1,
          },
          `${nodeText(resolved.nodeId, resolved.node)}\t${selected.draft.revisionId}`,
        )
        return
      }
      const operations = updateSettings(selected.draft.content, selected.target, resolved.nodeId, settings)!
      const target = { flowId: selected.flow.flowId, kind: 'node', nodeId: resolved.nodeId }
      const changed = await changeDraft(client, flow.flowId, selected.draft.revisionId, target, operations)
      write(
        runtime,
        args.json,
        { kind: 'node.set', revision: changed.revision, target, version: 1 },
        `${name ?? resolved.node.name ?? '<unnamed>'}\t${resolved.nodeId}\t${changed.revision.revisionId}`,
      )
      return
    }
    case 'remove': {
      if (nodeReference == null || extra.length > 0) throw new CliError('cli.invalid-arguments', 'Usage: oo flow node remove <flow> <node> --yes [--json]')
      if (!args.yes) throw new CliError('node.confirmation-required', 'Node removal requires --yes.')
      const resolved = exactNode(selected.graph.nodes, nodeReference)
      const target = { flowId: selected.flow.flowId, kind: 'node', nodeId: resolved.nodeId }
      const changed = await changeDraft(
        client,
        flow.flowId,
        selected.draft.revisionId,
        target,
        deleteNodes(selected.draft.content, selected.target, [resolved.nodeId]),
      )
      write(
        runtime,
        args.json,
        { kind: 'node.remove', revision: changed.revision, target, version: 1 },
        `${resolved.node.name ?? '<unnamed>'}\t${resolved.nodeId}\t${changed.revision.revisionId}`,
      )
      return
    }
    default:
      throw new CliError('cli.invalid-arguments', 'Usage: oo flow node <list|show|add|set|remove> <flow> ...')
  }
}

export async function inspectFlowCommand(
  client: ControlClient,
  flow: Flow,
  operands: readonly string[],
  args: ParsedArguments,
  runtime: Runtime,
): Promise<void> {
  requireCount(operands, 1, 'oo flow inspect <flow> [--summary] [--json]')
  const selected = await selectedDraftFlow(client, flow.flowId, operands[0]!)
  const check = await client.checkFlow(flow.flowId, selected.draft.revisionId)
  const nodeEntries = Object.entries(selected.graph.nodes).filter((entry): entry is [string, SemanticNode] => 'inputs' in entry[1])
  const nodeSummaries = nodeEntries.map(([nodeId, node]) => inspectedNodeSummary(selected.draft.content, nodeId, node))
  const nodes = args.summary ? nodeSummaries : nodeEntries.map(([nodeId, node]) => inspectedNode(selected.draft.content, nodeId, node))
  const triggerEntries = Object.entries(selected.graph.nodes)
    .filter((entry): entry is [string, TriggerNode] => !('inputs' in entry[1]))
    .map(([triggerId, trigger]) => ({ trigger, triggerId }))
  const triggers = args.summary
    ? triggerEntries.map(({ trigger, triggerId }) => inspectedTriggerSummary(selected.draft.content, triggerId, trigger))
    : triggerEntries.map(({ trigger, triggerId }) => {
        const binding = trigger.kind == 'poll' || trigger.kind == 'integration' ? selected.draft.content.document.bindings[trigger.bindingId] : undefined
        return binding == null ? { trigger, triggerId } : { binding, trigger, triggerId }
      })
  const { content: _content, ...revision } = selected.draft
  const result = {
    check,
    edges: inspectedEdges(selected.graph.nodes),
    flow: selected.flow,
    kind: 'flow.inspect',
    nodes,
    revision,
    ...(args.summary ? { summary: true } : {}),
    triggers,
    version: 1,
  }
  const lines = [
    `${check.valid ? 'valid' : 'invalid'}\t${selected.flow.name}\t${selected.flow.flowId}\t${selected.draft.revisionId}`,
    ...nodeSummaries.map((entry) => `node\t${entry.kind}\t${entry.name ?? '<unnamed>'}\t${entry.nodeId}`),
    ...result.edges.map((edge) =>
      edge.source.kind == 'node'
        ? `edge\t${edge.source.nodeId}:${edge.source.output}\t${edge.target.nodeId}:${edge.input}`
        : edge.source.kind == 'binding'
          ? `binding-edge\t${edge.source.bindingId}\t${edge.target.nodeId}:${edge.input}`
          : `flow-edge\t${edge.source.input}\t${edge.target.nodeId}:${edge.input}`,
    ),
  ]
  write(runtime, args.json, result, lines.join('\n'))
}

export async function applyFlowCommand(client: ControlClient, flow: Flow, operands: readonly string[], args: ParsedArguments, runtime: Runtime): Promise<void> {
  requireCount(operands, 1, 'oo flow apply <flow> --file <path|-> [--expected-revision <revision>] [--json]')
  if (args.file == null) {
    throw new CliError('cli.invalid-arguments', 'Usage: oo flow apply <flow> --file <path|-> [--expected-revision <revision>] [--json]')
  }
  const selected = await selectedDraftFlow(client, flow.flowId, operands[0]!)
  if (args.expectedRevision != null && args.expectedRevision != selected.draft.revisionId) {
    throw new CliError('flow.revision-conflict', 'The selected Flow Draft changed after it was inspected.', {
      actualRevisionId: selected.draft.revisionId,
      expectedRevisionId: args.expectedRevision,
      flowId: selected.flow.flowId,
    })
  }
  let source: string
  try {
    source = args.file == '-' ? await runtime.readStdin() : await runtime.readFile(args.file.startsWith('@') ? args.file.slice(1) : args.file)
  } catch (error) {
    throw new CliError('flow.apply-unreadable', error instanceof Error ? error.message : String(error))
  }
  const spec = applySpec(source)
  const actionRequests = new Map<string, Promise<ConnectorAction>>()
  const triggerRequests = new Map<string, Promise<TriggerKeySnapshot>>()
  for (const node of Object.values(spec.nodes)) {
    if (node.kind == 'connector' && !actionRequests.has(node.action)) {
      actionRequests.set(node.action, referencedAction(client, node.action))
    }
  }
  for (const trigger of Object.values(spec.triggers)) {
    if (trigger.kind == 'provider' && !triggerRequests.has(trigger.key)) {
      triggerRequests.set(trigger.key, referencedTriggerKey(client, trigger.key))
    }
  }
  const preparedNodes = await Promise.all(
    Object.entries(spec.nodes).map(async ([reference, node]) => {
      const nodeId = createAuthoringId()
      switch (node.kind) {
        case 'code': {
          if (args.file == '-' && node.code == '-') {
            throw new CliError('flow.apply-invalid', 'A Flow apply request read from stdin cannot also read Code source from stdin.')
          }
          const code = await argumentText(node.code, 'nodes.code', 'code.source-unreadable', runtime)
          const identity = { moduleId: createAuthoringId(), nodeId }
          return {
            identity: { kind: node.kind, moduleId: identity.moduleId, name: node.name, nodeId, reference },
            operations: createCodeTask(
              selected.target,
              identity,
              node.name,
              { imports: await moduleImports(code), source: code },
              {
                inputs: Object.entries(node.inputs ?? { value: { jsonSchema: {}, nullable: true, value: null } }).map(([handle, port]) =>
                  Object.assign({ handle }, port),
                ),
                outputs: Object.entries(node.outputs ?? { result: { jsonSchema: {}, nullable: true } }).map(([handle, port]) =>
                  Object.assign({ handle }, port),
                ),
              },
            ),
          }
        }
        case 'connector': {
          const action = await actionRequests.get(node.action)!
          const connection = await preferredConnection(client, action.serviceId, node.connection, action.defaultConnection, false)
          const identity = { nodeId, taskId: createAuthoringId() }
          const name = node.name ?? action.name
          return {
            identity: {
              actionId: action.actionId,
              ...(connection == null ? {} : { connection }),
              ...(connection == null ? {} : { connectionId: connection.connectionId }),
              kind: node.kind,
              name,
              nodeId,
              reference,
              taskId: identity.taskId,
            },
            operations: createManagedTask(selected.target, identity, {
              executor: {
                action: action.actionId,
                ...(connection == null ? {} : { connectionId: connection.connectionId }),
                kind: 'connector',
              },
              inputs: withInputValues(action, node.inputs),
              name,
              outputs: Object.entries(action.outputs).map(([handle, port]) => Object.assign({ handle }, port)),
            }),
          }
        }
        case 'condition':
          return {
            identity: { kind: node.kind, name: node.name, nodeId, reference },
            operations: createCondition(selected.target, nodeId, node.name),
          }
        case 'llm-chat':
        case 'llm-json': {
          const taskId = createAuthoringId()
          return {
            identity: { kind: node.kind, name: node.name, nodeId, reference, taskId },
            operations: createLlmTask(selected.target, { nodeId, taskId }, node.name, node.kind == 'llm-chat' ? 'chat' : 'json', 'Generated response.', {
              inputs: node.inputs,
              output: node.output,
            }),
          }
        }
        case 'value':
          return {
            identity: { kind: node.kind, name: node.name, nodeId, reference },
            operations: createValue(selected.target, nodeId, node.name),
          }
      }
    }),
  )
  const preparedTriggers = await Promise.all(
    Object.entries(spec.triggers).map(async ([reference, trigger]) => {
      const triggerId = createAuthoringId()
      switch (trigger.kind) {
        case 'webhook': {
          const name = trigger.name ?? 'Webhook'
          return {
            identity: { kind: trigger.kind, name, reference, triggerId },
            operations: createBuiltinTrigger(selected.target, triggerId, { inputsDef: [], kind: trigger.kind, name }),
          }
        }
        case 'cron': {
          const name = trigger.name ?? 'Scheduled Trigger'
          return {
            identity: { kind: trigger.kind, name, reference, triggerId },
            operations: createBuiltinTrigger(selected.target, triggerId, {
              cronTimes: trigger.schedule ?? [{ type: 'every', unit: 'hour', value: 1 }],
              kind: trigger.kind,
              name,
            }),
          }
        }
        case 'provider': {
          const definition = await triggerRequests.get(trigger.key)!
          const connection = await preferredConnection(client, definition.provider, trigger.connection, undefined, true)
          const name = trigger.name ?? definition.displayName
          return {
            identity: {
              connection,
              connectionId: connection!.connectionId,
              key: definition.key,
              kind: trigger.kind,
              name,
              reference,
              triggerId,
              triggerKind: definition.type,
            },
            operations: createProviderTrigger(selected.target, { bindingId: createAuthoringId(), nodeId: triggerId }, definition, {
              config: trigger.config,
              connectionId: connection!.connectionId,
              name,
              ...(trigger.schedule == null ? {} : { schedule: trigger.schedule }),
            }),
          }
        }
      }
    }),
  )
  const nodeIdentities = preparedNodes.map((node) => node.identity)
  const triggerIdentities = preparedTriggers.map((trigger) => trigger.identity)
  const operations = [...preparedNodes.flatMap((node) => node.operations), ...preparedTriggers.flatMap((trigger) => trigger.operations)]
  let content = operations.length == 0 ? selected.draft.content : applyFlowChanges(selected.draft.content, operations)
  const nodeReferences = new Map(nodeIdentities.map((identity) => [identity.reference, identity.nodeId]))
  const triggerReferences = new Map(triggerIdentities.map((identity) => [identity.reference, identity.triggerId]))
  const edges = []
  for (const requested of spec.edges) {
    const graph = content.document.graph
    const localNodeId = nodeReferences.get(requested.source)
    const localTriggerId = triggerReferences.get(requested.source)
    let resolvedSource: ReturnType<typeof exactEdgeSource>
    if (localNodeId != null) resolvedSource = { id: localNodeId, kind: 'node' }
    else if (localTriggerId != null) resolvedSource = { id: localTriggerId, kind: 'trigger' }
    else resolvedSource = exactEdgeSource(graph.nodes, requested.source)
    if (resolvedSource.kind == 'trigger' && requested.output != 'payload') {
      throw new CliError('trigger.output-not-found', 'Trigger output must be payload.')
    }
    const targetNodeId = nodeReferences.get(requested.target) ?? exactNode(graph.nodes, requested.target).nodeId
    const edge = {
      source: resolvedSource.id,
      sourceHandle: requested.output,
      target: targetNodeId,
      targetHandle: requested.input,
    }
    const edgeOperations = connectEdge(content, selected.target, edge)
    operations.push(...edgeOperations)
    if (edgeOperations.length > 0) content = applyFlowChanges(content, edgeOperations)
    edges.push({ ...edge, sourceReference: requested.source, targetReference: requested.target })
  }
  if (operations.length == 0) {
    const check = await client.checkFlow(flow.flowId, selected.draft.revisionId)
    write(
      runtime,
      args.json,
      {
        changed: false,
        check,
        edges,
        flowId: selected.flow.flowId,
        kind: 'flow.apply',
        nodes: nodeIdentities,
        revisionId: selected.draft.revisionId,
        triggers: triggerIdentities,
        version: 1,
      },
      `unchanged\t${selected.flow.name}\t${selected.draft.revisionId}\t${check.valid ? 'valid' : 'invalid'}`,
    )
    return
  }
  const target = {
    flowId: selected.flow.flowId,
    kind: 'flow.apply',
    references: [...nodeIdentities.map((identity) => identity.reference), ...triggerIdentities.map((identity) => identity.reference)],
  }
  const changed = await changeDraft(client, flow.flowId, selected.draft.revisionId, target, operations)
  let check
  try {
    check = await client.checkFlow(flow.flowId, changed.revision.revisionId)
  } catch (error) {
    const checkError =
      error instanceof ApiError ? { code: error.code, message: error.message } : { message: error instanceof Error ? error.message : String(error) }
    write(
      runtime,
      args.json,
      {
        changed: true,
        check: { error: checkError, status: 'unavailable' },
        edges,
        flowId: selected.flow.flowId,
        kind: 'flow.apply',
        nodes: nodeIdentities,
        revision: changed.revision,
        triggers: triggerIdentities,
        version: 1,
      },
      [
        `applied\t${selected.flow.name}\t${changed.revision.revisionId}\tcheck-unavailable\t${preparedNodes.length} nodes\t${preparedTriggers.length} triggers\t${edges.length} edges`,
        `check-error\t${checkError.code ?? 'unavailable'}\t${checkError.message}`,
      ].join('\n'),
    )
    return
  }
  write(
    runtime,
    args.json,
    {
      changed: true,
      check,
      edges,
      flowId: selected.flow.flowId,
      kind: 'flow.apply',
      nodes: nodeIdentities,
      revision: changed.revision,
      triggers: triggerIdentities,
      version: 1,
    },
    [
      `applied\t${selected.flow.name}\t${changed.revision.revisionId}\t${check.valid ? 'valid' : 'invalid'}\t${preparedNodes.length} nodes\t${preparedTriggers.length} triggers\t${edges.length} edges`,
      ...check.diagnostics.map((diagnostic) => `diagnostic\t${diagnostic.code}\t${diagnostic.path}\t${diagnostic.message}`),
    ].join('\n'),
  )
}
