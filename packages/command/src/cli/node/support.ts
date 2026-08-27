import type {
  ConnectorAction,
  ConnectorConnection,
  Flow,
  JsonValue,
  Publication,
  RunDetails,
  RunEvent,
  RunStatus,
  TriggerKeySnapshot,
  TriggerKeySummary,
} from '@oomol-lab/open-flow/control-api'
import type {
  CodeModule,
  GraphNode,
  InputPort,
  InputPortDefinition,
  PortDefinition,
  RevisionContent,
  TriggerNode,
  TriggerSchedule,
} from '@oomol-lab/open-flow/flow-change'
import type { UiLanguage } from '@oomol-lab/open-flow/localization'

import { ApiError, ControlClient } from '@oomol-lab/open-flow/control-api'
import { resourceNameIssue, resourceNameMaxLength } from '@oomol-lab/open-flow/flow-change'
import { runStatuses as runStatusValues } from '@oomol-lab/open-flow/run-lifecycle'

export interface CommandHost {
  readonly request: (path: string, init?: RequestInit) => Promise<Response>
  getWorkbenchUrl?(flowId?: string): Promise<string>
}

export interface Runtime {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly language: UiLanguage
  openUrl(url: string): Promise<void>
  readFile(path: string): Promise<string>
  readStdin(): Promise<string>
  readonly stderr: { write(value: string): unknown }
  readonly stdout: { write(value: string): unknown }
  wait(milliseconds: number): Promise<void>
}

export interface ParsedArguments {
  readonly after?: number
  readonly code?: string
  readonly connection?: string
  readonly concurrency?: number
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

interface ErrorDetails {
  readonly [key: string]: unknown
}

type ApplyNode =
  | {
      readonly action: string
      readonly connection?: string
      readonly inputs: Readonly<Record<string, JsonValue>>
      readonly kind: 'connector'
      readonly name?: string
    }
  | {
      readonly code: string
      readonly inputs?: Readonly<Record<string, InputPortDefinition>>
      readonly kind: 'code'
      readonly name: string
      readonly outputs?: Readonly<Record<string, PortDefinition>>
    }
  | {
      readonly inputs?: Readonly<Record<string, JsonValue>>
      readonly kind: 'llm-chat' | 'llm-json'
      readonly name: string
      readonly output?: PortDefinition
    }
  | { readonly kind: 'condition' | 'value'; readonly name: string }

interface ApplyEdge {
  readonly input: string
  readonly output: string
  readonly source: string
  readonly target: string
}

type ApplyTrigger =
  | { readonly kind: 'webhook'; readonly name?: string }
  | { readonly kind: 'cron'; readonly name?: string; readonly schedule?: readonly TriggerSchedule[] }
  | {
      readonly config: Readonly<Record<string, JsonValue>>
      readonly connection?: string
      readonly key: string
      readonly kind: 'provider'
      readonly name?: string
      readonly schedule?: readonly TriggerSchedule[]
    }

interface ApplySpec {
  readonly edges: readonly ApplyEdge[]
  readonly nodes: Readonly<Record<string, ApplyNode>>
  readonly triggers: Readonly<Record<string, ApplyTrigger>>
  readonly version: 1
}

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: ErrorDetails,
  ) {
    super(message)
    this.name = 'CliError'
  }
}

export function checkedResourceName(value: string, label: 'Flow'): string {
  const name = value.trim()
  if (resourceNameIssue(name) != null) {
    throw new CliError(
      'cli.invalid-arguments',
      `${label} name must be between 1 and ${resourceNameMaxLength} characters and use only letters, numbers, spaces, hyphens, or underscores.`,
    )
  }
  return name
}

const flowPageLimit = 100
export const publicationPageLimit = 100
export const runPageLimit = 100
const terminalRunStatuses = new Set<RunStatus>(['canceled', 'completed', 'failed', 'indeterminate'])
const runStatuses: ReadonlySet<RunStatus> = new Set(runStatusValues)

export function parseArguments(args: readonly string[]): ParsedArguments {
  const positionals: string[] = []
  let after: number | undefined
  let code: string | undefined
  let connection: string | undefined
  let concurrency: number | undefined
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
    const argument = args[index]!
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
      argument == '--status' ||
      argument == '--cursor' ||
      argument == '--limit' ||
      argument == '--after' ||
      argument == '--concurrency' ||
      argument == '--timeout' ||
      argument == '--timezone' ||
      argument == '--set' ||
      argument == '--unset'
    ) {
      const value = args[++index]
      if (value == null || value.length == 0) throw new CliError('cli.invalid-arguments', `${argument} requires a value.`)
      if (argument == '--code') code = value
      else if (argument == '--connection') connection = value
      else if (argument == '--cron') cron = value
      else if (argument == '--description') description = value
      else if (argument == '--every') every = value
      else if (argument == '--expected-revision') expectedRevision = value
      else if (argument == '--file') file = value
      else if (argument == '--flow') flow = value
      else if (argument == '--name') name = value
      else if (argument == '--input') input = value
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
        if (!Number.isSafeInteger(numeric) || numeric < minimum || (argument == '--limit' && numeric > 1000)) {
          throw new CliError('cli.invalid-arguments', `${argument} has an invalid value.`)
        }
        if (argument == '--limit') limit = numeric
        else if (argument == '--after') after = numeric
        else if (argument == '--concurrency') concurrency = numeric
        else timeoutMs = numeric
      }
    } else if (argument.startsWith('--flow=')) {
      flow = argument.slice('--flow='.length)
      if (flow.length == 0) throw new CliError('cli.invalid-arguments', '--flow requires a value.')
    } else if (argument.startsWith('--expected-revision=')) {
      expectedRevision = argument.slice('--expected-revision='.length)
      if (expectedRevision.length == 0) throw new CliError('cli.invalid-arguments', '--expected-revision requires a value.')
    } else if (argument.startsWith('--file=')) {
      file = argument.slice('--file='.length)
      if (file.length == 0) throw new CliError('cli.invalid-arguments', '--file requires a value.')
    } else if (argument.startsWith('--name=')) {
      name = argument.slice('--name='.length)
      if (name.length == 0) throw new CliError('cli.invalid-arguments', '--name requires a value.')
    } else if (argument.startsWith('--connection=')) {
      connection = argument.slice('--connection='.length)
      if (connection.length == 0) throw new CliError('cli.invalid-arguments', '--connection requires a value.')
    } else if (argument.startsWith('--set=')) {
      const value = argument.slice('--set='.length)
      if (value.length == 0) throw new CliError('cli.invalid-arguments', '--set requires a value.')
      sets.push(value)
    } else if (argument.startsWith('--unset=')) {
      const value = argument.slice('--unset='.length)
      if (value.length == 0) throw new CliError('cli.invalid-arguments', '--unset requires a value.')
      unsets.push(value)
    } else if (argument.startsWith('--source=')) {
      const value = argument.slice('--source='.length)
      if (value != 'draft' && value != 'live') throw new CliError('cli.invalid-arguments', '--source must be draft or live.')
      source = value
    } else if (argument.startsWith('--input=')) {
      input = argument.slice('--input='.length)
      if (input.length == 0) throw new CliError('cli.invalid-arguments', '--input requires a value.')
    } else if (argument.startsWith('-')) {
      throw new CliError('cli.invalid-arguments', `Unknown option ${JSON.stringify(argument)}.`)
    } else {
      positionals.push(argument)
    }
  }

  return {
    ...(after == null ? {} : { after }),
    ...(code == null ? {} : { code }),
    ...(connection == null ? {} : { connection }),
    ...(concurrency == null ? {} : { concurrency }),
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

export async function allFlows(client: ControlClient): Promise<readonly Flow[]> {
  const flows: Flow[] = []
  const cursors = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await client.listFlows({ cursor, limit: flowPageLimit })
    flows.push(...page.flows)
    cursor = page.nextCursor
    if (cursor != null && cursors.has(cursor)) throw new CliError('page.invalid-cursor', 'The deployment returned a repeated Flow cursor.')
    if (cursor != null) cursors.add(cursor)
  } while (cursor != null)
  return flows
}

export function exactFlow(flows: readonly Flow[], reference: string): Flow {
  const byId = flows.find((flow) => flow.flowId == reference)
  if (byId != null) return byId
  const byName = flows.filter((flow) => flow.name == reference)
  if (byName.length == 1) return byName[0]!
  if (byName.length > 1) {
    throw new CliError('flow.ambiguous', `Flow name ${JSON.stringify(reference)} is ambiguous.`, {
      candidates: byName.map(({ flowId, name }) => ({ flowId, name })),
    })
  }
  throw new CliError('flow.not-found', `Flow ${JSON.stringify(reference)} was not found.`)
}

export async function referencedFlow(client: ControlClient, reference: string): Promise<Flow> {
  try {
    return await client.getFlow(reference)
  } catch (error) {
    if (!(error instanceof ApiError) || (error.code != 'flow.invalid' && error.code != 'flow.not-found')) throw error
  }
  return exactFlow(await allFlows(client), reference)
}

export async function selectedDraftFlow(client: ControlClient, flowId: string, reference: string) {
  const flow = await referencedFlow(client, reference)
  if (flow.flowId != flowId) throw new CliError('flow.not-found', `Flow ${JSON.stringify(reference)} was not found.`)
  const draft = await client.getRevision(flowId, flow.draftRevisionId)
  return { draft, flow, graph: draft.content.document.graph, target: { kind: 'flow' } as const }
}

export type SemanticNode = Exclude<GraphNode, TriggerNode>

export function exactNode(nodes: Readonly<Record<string, GraphNode>>, reference: string): { readonly node: SemanticNode; readonly nodeId: string } {
  const byId = nodes[reference]
  if (byId != null && !('inputs' in byId)) throw new CliError('node.not-found', `Node ${JSON.stringify(reference)} was not found.`)
  if (byId != null) return { node: byId, nodeId: reference }
  const byName = Object.entries(nodes).filter((entry): entry is [string, SemanticNode] => 'inputs' in entry[1] && entry[1].name == reference)
  if (byName.length == 1) return { node: byName[0]![1], nodeId: byName[0]![0] }
  if (byName.length > 1) {
    throw new CliError('node.ambiguous', `Node name ${JSON.stringify(reference)} is ambiguous.`, {
      candidates: byName.map(([nodeId, node]) => ({ name: node.name, nodeId })),
    })
  }
  throw new CliError('node.not-found', `Node ${JSON.stringify(reference)} was not found.`)
}

export function exactModule(modules: Readonly<Record<string, CodeModule>>, reference: string): { readonly module: CodeModule; readonly moduleId: string } {
  const byId = modules[reference]
  if (byId != null) return { module: byId, moduleId: reference }
  const byName = Object.entries(modules).filter(([, module]) => module.name == reference)
  if (byName.length == 1) return { module: byName[0]![1], moduleId: byName[0]![0] }
  if (byName.length > 1) {
    throw new CliError('code.ambiguous', `CodeModule name ${JSON.stringify(reference)} is ambiguous.`, {
      candidates: byName.map(([moduleId, module]) => ({ moduleId, name: module.name })),
    })
  }
  throw new CliError('code.not-found', `CodeModule ${JSON.stringify(reference)} was not found.`)
}

function exactAction(actions: readonly ConnectorAction[], reference: string): ConnectorAction {
  const byId = actions.find((action) => action.actionId == reference)
  if (byId != null) return byId
  const byName = actions.filter((action) => action.name == reference)
  if (byName.length == 1) return byName[0]!
  if (byName.length > 1) {
    throw new CliError('connector.action-ambiguous', `Connector Action name ${JSON.stringify(reference)} is ambiguous.`, {
      candidates: byName.map(({ actionId, name, serviceId }) => ({ actionId, name, serviceId })),
    })
  }
  throw new CliError('connector.action-not-found', `Connector Action ${JSON.stringify(reference)} was not found.`)
}

export async function referencedAction(client: ControlClient, reference: string): Promise<ConnectorAction> {
  try {
    return await client.getConnectorAction(reference)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status != 404) throw error
  }
  return exactAction(await client.searchConnectorActions(reference), reference)
}

function exactConnection(connections: readonly ConnectorConnection[], reference: string): ConnectorConnection {
  const active = connections.filter((connection) => connection.status == 'active')
  const byId = active.find((connection) => connection.connectionId == reference)
  if (byId != null) return byId
  const byName = active.filter((connection) => connection.displayName == reference)
  if (byName.length == 1) return byName[0]!
  if (byName.length > 1) {
    throw new CliError('connector.connection-ambiguous', `Connection name ${JSON.stringify(reference)} is ambiguous.`, {
      candidates: byName.map(({ connectionId, displayName, serviceId }) => ({ connectionId, displayName, serviceId })),
    })
  }
  throw new CliError('connector.connection-not-found', `Active Connection ${JSON.stringify(reference)} was not found.`)
}

export async function preferredConnection(
  client: ControlClient,
  serviceId: string,
  reference: string | undefined,
  fallback: ConnectorConnection | undefined,
  required: boolean,
): Promise<ConnectorConnection | undefined> {
  const selected = reference == 'default' ? undefined : reference
  if (selected == null && fallback?.status == 'active') return fallback
  const connections = await client.listConnectorConnections(serviceId)
  if (selected != null) return exactConnection(connections, selected)
  const active = connections.filter((connection) => connection.status == 'active')
  const preferred = active.find((connection) => connection.isDefault) ?? (active.length == 1 ? active[0] : undefined)
  if (preferred != null || !required) return preferred
  throw new CliError('connector.connection-required', `Select an active ${JSON.stringify(serviceId)} Connection with --connection.`)
}

export function exactTrigger(content: RevisionContent, reference: string): { readonly trigger: TriggerNode; readonly triggerId: string } {
  const entries = Object.entries(content.document.graph.nodes).filter((entry): entry is [string, TriggerNode] => !('inputs' in entry[1]))
  const byId = entries?.find(([triggerId]) => triggerId == reference)
  if (byId != null) return { trigger: byId[1], triggerId: byId[0] }
  const byName = entries?.filter(([, trigger]) => trigger.name == reference) ?? []
  if (byName.length == 1) return { trigger: byName[0]![1], triggerId: byName[0]![0] }
  if (byName.length > 1) {
    throw new CliError('trigger.ambiguous', `Trigger name ${JSON.stringify(reference)} is ambiguous.`, {
      candidates: byName.map(([triggerId, trigger]) => ({ name: trigger.name, triggerId })),
    })
  }
  throw new CliError('trigger.not-found', `Trigger ${JSON.stringify(reference)} was not found.`)
}

export function exactEdgeSource(nodes: Readonly<Record<string, GraphNode>>, reference: string): { readonly id: string; readonly kind: 'node' | 'trigger' } {
  const byId = nodes[reference]
  if (byId != null) return { id: reference, kind: 'inputs' in byId ? 'node' : 'trigger' }
  const candidates = Object.entries(nodes).flatMap(([id, node]) =>
    node.name == reference ? [{ id, kind: ('inputs' in node ? 'node' : 'trigger') as 'node' | 'trigger' }] : [],
  )
  if (candidates.length == 1) return candidates[0]!
  if (candidates.length > 1) {
    throw new CliError('edge.source-ambiguous', `Edge source name ${JSON.stringify(reference)} is ambiguous.`, { candidates })
  }
  throw new CliError('edge.source-not-found', `Edge source ${JSON.stringify(reference)} was not found.`)
}

export function triggerKeyText(definition: TriggerKeySummary): string {
  return `${definition.displayName}\t${definition.key}\t${definition.provider}\t${definition.type}`
}

export async function referencedTriggerKey(client: ControlClient, reference: string): Promise<TriggerKeySnapshot> {
  try {
    return await client.getTriggerKey(reference)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status != 404) throw error
  }
  const summaries = await client.listTriggerKeys()
  const matches = summaries.filter((item) => item.name == reference || item.displayName == reference)
  if (matches.length == 1) return await client.getTriggerKey(matches[0]!.key)
  if (matches.length > 1) {
    throw new CliError('trigger-key.ambiguous', `Trigger Key name ${JSON.stringify(reference)} is ambiguous.`, {
      candidates: matches.map(({ displayName, key, provider }) => ({ displayName, key, provider })),
    })
  }
  throw new CliError('trigger-key.not-found', `Trigger Key ${JSON.stringify(reference)} was not found.`)
}

export function triggerText(content: RevisionContent, triggerId: string, trigger: TriggerNode): string {
  const provider = trigger.kind == 'poll' || trigger.kind == 'integration' ? trigger.definition.provider : 'open-flow'
  const binding = trigger.kind == 'poll' || trigger.kind == 'integration' ? (content.document.bindings[trigger.bindingId]?.target ?? '') : ''
  return `${trigger.name}\t${triggerId}\t${trigger.kind}\t${provider}\t${binding}`
}

export function connectionText(connection: ConnectorConnection): string {
  return `${connection.displayName}\t${connection.connectionId}\t${connection.serviceId}\t${connection.status}${connection.isDefault ? '\tdefault' : ''}`
}

export function actionText(action: ConnectorAction): string {
  return `${action.name}\t${action.actionId}\t${action.serviceName}\t${action.serviceId}`
}

export function actionSummary(action: ConnectorAction) {
  return {
    actionId: action.actionId,
    ...(action.defaultConnection == null
      ? {}
      : {
          defaultConnection: {
            connectionId: action.defaultConnection.connectionId,
            displayName: action.defaultConnection.displayName,
            status: action.defaultConnection.status,
          },
        }),
    description: action.description,
    name: action.name,
    serviceId: action.serviceId,
    serviceName: action.serviceName,
  }
}

export function nodeDetails(content: RevisionContent, nodeId: string, node: GraphNode) {
  if (node.kind != 'task') return { node, nodeId }
  if (node.task != null) {
    const module = content.modules[node.task.moduleId]
    return { node, nodeId, task: node.task, ...(module == null ? {} : { module }) }
  }
  const task = content.document.tasks[node.taskId]
  return { node, nodeId, ...(task == null ? {} : { task }) }
}

export function inspectedNode(content: RevisionContent, nodeId: string, node: GraphNode) {
  if (node.kind != 'task') return { kind: node.kind, node, nodeId }
  if (node.task != null) {
    return {
      kind: 'code',
      module: content.modules[node.task.moduleId],
      moduleId: node.task.moduleId,
      node,
      nodeId,
      task: node.task,
    }
  }
  const task = content.document.tasks[node.taskId]
  if (task == null) return { kind: 'task', node, nodeId, taskId: node.taskId }
  return {
    ...(task.executor.kind == 'connector'
      ? { actionId: task.executor.action, ...(task.executor.connectionId == null ? {} : { connectionId: task.executor.connectionId }) }
      : {}),
    kind: task.executor.kind,
    node,
    nodeId,
    task,
    taskId: node.taskId,
  }
}

export function inspectedNodeSummary(content: RevisionContent, nodeId: string, node: GraphNode) {
  if (node.kind != 'task') return { kind: node.kind, ...(node.name == null ? {} : { name: node.name }), nodeId }
  if (node.task != null) {
    return { kind: 'code', moduleId: node.task.moduleId, ...(node.name == null ? {} : { name: node.name }), nodeId }
  }
  const task = content.document.tasks[node.taskId]
  if (task == null) return { kind: 'task', ...(node.name == null ? {} : { name: node.name }), nodeId, taskId: node.taskId }
  return {
    ...(task.executor.kind == 'connector'
      ? { actionId: task.executor.action, ...(task.executor.connectionId == null ? {} : { connectionId: task.executor.connectionId }) }
      : {}),
    kind: task.executor.kind,
    ...(node.name == null ? {} : { name: node.name }),
    nodeId,
    taskId: node.taskId,
  }
}

export function inspectedTriggerSummary(content: RevisionContent, triggerId: string, trigger: TriggerNode) {
  const binding = trigger.kind == 'poll' || trigger.kind == 'integration' ? content.document.bindings[trigger.bindingId] : undefined
  return {
    ...(binding?.kind == 'connection' ? { connectionId: binding.target } : {}),
    kind: trigger.kind,
    name: trigger.name,
    ...(trigger.kind == 'poll' || trigger.kind == 'integration' ? { provider: trigger.definition.provider } : {}),
    triggerId,
  }
}

export function inspectedEdges(nodes: Readonly<Record<string, GraphNode>>) {
  return Object.entries(nodes)
    .flatMap(([targetNodeId, node]) => {
      if (!('inputs' in node)) return []
      return Object.entries(node.inputs).flatMap(([input, mapping]) =>
        mapping.kind != 'sources'
          ? []
          : mapping.sources.map((source) => ({
              input,
              source: { ...source },
              target: { nodeId: targetNodeId },
            })),
      )
    })
    .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}

export function requireCount(positionals: readonly string[], count: number, usage: string): void {
  if (positionals.length != count) throw new CliError('cli.invalid-arguments', `Usage: ${usage}`)
}

export function write(runtime: Runtime, json: boolean, value: unknown, text: string): void {
  runtime.stdout.write(json ? `${JSON.stringify(value)}\n` : `${text}\n`)
}

export function flowText(flow: Flow): string {
  return `${flow.name}\t${flow.flowId}\t${flow.status}`
}

export function nodeText(nodeId: string, node: GraphNode): string {
  return `${node.name ?? '<unnamed>'}\t${nodeId}\t${node.kind}`
}

export function nodeSummary(nodeId: string, node: GraphNode) {
  return { kind: node.kind, ...(node.name == null ? {} : { name: node.name }), nodeId }
}

export function moduleText(moduleId: string, module: CodeModule): string {
  return `${module.name}\t${moduleId}\t${module.imports.join(',')}`
}

export function publicationText(publication: Publication): string {
  return `${publication.operation}\t${publication.publicationId}\t${publication.revisionId}\t${publication.createdAt}`
}

export function runText(run: RunDetails): string {
  const publication = run.source == 'draft' ? '' : `\t${run.publicationId}`
  return `${run.source}\t${run.status}\t${run.runId}\t${run.revisionId}${publication}`
}

export function runSummaryText(run: { readonly revisionId: string; readonly runId: string; readonly source: string; readonly status: string }): string {
  return `${run.source}\t${run.status}\t${run.runId}\t${run.revisionId}`
}

export function eventText(event: RunEvent): string {
  return `${event.sequence}\t${event.kind}\t${JSON.stringify(event.payload)}`
}

export async function argumentText(value: string, option: string, errorCode: string, runtime: Runtime): Promise<string> {
  try {
    if (value == '-') return await runtime.readStdin()
    if (!value.startsWith('@')) return value
    const path = value.slice(1)
    if (path.length == 0) throw new CliError('cli.invalid-arguments', `${option} @ requires a file path.`)
    return await runtime.readFile(path)
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(errorCode, error instanceof Error ? error.message : String(error))
  }
}

function parsedJson(value: string, code: string, message: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue
  } catch {
    throw new CliError(code, message)
  }
}

function applyObject(value: unknown, message: string): Readonly<Record<string, unknown>> {
  if (value == null || typeof value != 'object' || Array.isArray(value)) throw new CliError('flow.apply-invalid', message)
  return value as Readonly<Record<string, unknown>>
}

function applyString(value: unknown, field: string): string {
  if (typeof value != 'string' || value.trim().length == 0) {
    throw new CliError('flow.apply-invalid', `${field} must be a non-empty string.`)
  }
  return value
}

function applyKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[], field: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unexpected.length > 0) throw new CliError('flow.apply-invalid', `${field} contains unknown fields: ${unexpected.join(', ')}.`)
}

function applyTriggerSchedule(trigger: Readonly<Record<string, unknown>>, reference: string): readonly TriggerSchedule[] | undefined {
  const cron = trigger.cron == null ? undefined : applyString(trigger.cron, `triggers.${reference}.cron`)
  const every = trigger.every == null ? undefined : applyString(trigger.every, `triggers.${reference}.every`)
  const timezone = trigger.timezone == null ? undefined : applyString(trigger.timezone, `triggers.${reference}.timezone`)
  return triggerSchedule(every, cron, timezone)
}

function applyPortDefinitions(value: unknown, field: string, input: boolean): Readonly<Record<string, InputPortDefinition | PortDefinition>> {
  const candidates = applyObject(value, `${field} must be an object keyed by port handle.`)
  return Object.fromEntries(
    Object.entries(candidates).map(([handle, candidate]) => {
      if (handle.trim().length == 0) throw new CliError('flow.apply-invalid', `${field} port handles cannot be empty.`)
      const port = applyObject(candidate, `${field}.${handle} must be an object.`)
      applyKeys(port, input ? ['description', 'jsonSchema', 'nullable', 'value'] : ['description', 'jsonSchema', 'nullable'], `${field}.${handle}`)
      if (!Object.hasOwn(port, 'jsonSchema')) throw new CliError('flow.apply-invalid', `${field}.${handle}.jsonSchema is required.`)
      const jsonSchema =
        typeof port.jsonSchema == 'boolean'
          ? port.jsonSchema
          : (applyObject(port.jsonSchema, `${field}.${handle}.jsonSchema must be an object or boolean.`) as JsonValue)
      if (typeof port.nullable != 'boolean') throw new CliError('flow.apply-invalid', `${field}.${handle}.nullable must be a boolean.`)
      return [
        handle,
        {
          ...(port.description == null ? {} : { description: applyString(port.description, `${field}.${handle}.description`) }),
          jsonSchema,
          nullable: port.nullable,
          ...(input && Object.hasOwn(port, 'value') ? { value: port.value as JsonValue } : {}),
        },
      ]
    }),
  )
}

function applyLlmInputs(value: unknown, field: string): Readonly<Record<string, JsonValue>> {
  const inputs = applyObject(value, `${field} must be an object.`)
  applyKeys(inputs, ['input', 'messages', 'model', 'template'], field)
  return Object.fromEntries(Object.entries(inputs).map(([handle, candidate]) => [handle, applyLlmInput(candidate, `${field}.${handle}`, handle)]))
}

function applyLlmInput(value: unknown, field: string, handle: string): JsonValue {
  switch (handle) {
    case 'input':
      if (typeof value != 'string') throw new CliError('flow.apply-invalid', `${field} must be a string.`)
      return value
    case 'messages':
      if (value == null) return null
      return applyObjectArray(value, field, false)
    case 'model':
      return applyObject(value, `${field} must be an object.`) as JsonValue
    case 'template':
      return applyObjectArray(value, field, true)
    default:
      throw new CliError('flow.apply-invalid', `${field} is not a supported LLM input.`)
  }
}

function applyObjectArray(value: unknown, field: string, nonEmpty: boolean): readonly JsonValue[] {
  if (!Array.isArray(value) || (nonEmpty && value.length == 0) || value.some((item) => item == null || typeof item != 'object' || Array.isArray(item))) {
    throw new CliError('flow.apply-invalid', `${field} must be ${nonEmpty ? 'a non-empty' : 'an'} array of objects.`)
  }
  return value as readonly JsonValue[]
}

export function applySpec(source: string): ApplySpec {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new CliError('flow.apply-invalid', 'Flow apply input must be valid JSON.')
  }
  const root = applyObject(parsed, 'Flow apply input must be an object.')
  applyKeys(root, ['edges', 'nodes', 'triggers', 'version'], 'Flow apply input')
  if (root.version !== 1) throw new CliError('flow.apply-invalid', 'Flow apply input version must be 1.')

  const nodeValues = root.nodes == null ? {} : applyObject(root.nodes, 'Flow apply nodes must be an object keyed by local reference.')
  const nodes = Object.fromEntries(
    Object.entries(nodeValues).map(([reference, candidate]) => {
      if (reference.trim().length == 0) throw new CliError('flow.apply-invalid', 'Flow apply node references cannot be empty.')
      const node = applyObject(candidate, `Flow apply node ${JSON.stringify(reference)} must be an object.`)
      const kind = applyString(node.kind, `nodes.${reference}.kind`)
      switch (kind) {
        case 'connector': {
          applyKeys(node, ['action', 'connection', 'inputs', 'kind', 'name'], `nodes.${reference}`)
          const inputs = node.inputs == null ? {} : applyObject(node.inputs, `nodes.${reference}.inputs must be an object.`)
          return [
            reference,
            {
              action: applyString(node.action, `nodes.${reference}.action`),
              ...(node.connection == null ? {} : { connection: applyString(node.connection, `nodes.${reference}.connection`) }),
              inputs: inputs as Readonly<Record<string, JsonValue>>,
              kind,
              ...(node.name == null ? {} : { name: applyString(node.name, `nodes.${reference}.name`) }),
            },
          ] as const
        }
        case 'code': {
          applyKeys(node, ['code', 'inputs', 'kind', 'name', 'outputs'], `nodes.${reference}`)
          return [
            reference,
            {
              code: applyString(node.code, `nodes.${reference}.code`),
              ...(node.inputs == null ? {} : { inputs: applyPortDefinitions(node.inputs, `nodes.${reference}.inputs`, true) }),
              kind,
              name: applyString(node.name, `nodes.${reference}.name`),
              ...(node.outputs == null ? {} : { outputs: applyPortDefinitions(node.outputs, `nodes.${reference}.outputs`, false) }),
            },
          ] as const
        }
        case 'llm-chat':
        case 'llm-json': {
          applyKeys(node, ['inputs', 'kind', 'name', 'outputs'], `nodes.${reference}`)
          const outputs = node.outputs == null ? undefined : applyPortDefinitions(node.outputs, `nodes.${reference}.outputs`, false)
          if (outputs != null) applyKeys(outputs, ['output'], `nodes.${reference}.outputs`)
          return [
            reference,
            {
              ...(node.inputs == null ? {} : { inputs: applyLlmInputs(node.inputs, `nodes.${reference}.inputs`) }),
              kind,
              name: applyString(node.name, `nodes.${reference}.name`),
              ...(outputs?.output == null ? {} : { output: outputs.output }),
            },
          ] as const
        }
        case 'condition':
        case 'value':
          applyKeys(node, ['kind', 'name'], `nodes.${reference}`)
          return [reference, { kind, name: applyString(node.name, `nodes.${reference}.name`) }] as const
        default:
          throw new CliError('flow.apply-invalid', `Unknown Flow apply node kind ${JSON.stringify(kind)}.`)
      }
    }),
  )

  const triggerValues = root.triggers == null ? {} : applyObject(root.triggers, 'Flow apply triggers must be an object keyed by local reference.')
  const triggers = Object.fromEntries(
    Object.entries(triggerValues).map(([reference, candidate]) => {
      if (reference.trim().length == 0) throw new CliError('flow.apply-invalid', 'Flow apply trigger references cannot be empty.')
      const trigger = applyObject(candidate, `Flow apply trigger ${JSON.stringify(reference)} must be an object.`)
      const kind = applyString(trigger.kind, `triggers.${reference}.kind`)
      const name = trigger.name == null ? undefined : applyString(trigger.name, `triggers.${reference}.name`)
      switch (kind) {
        case 'webhook':
          applyKeys(trigger, ['kind', 'name'], `triggers.${reference}`)
          return [reference, { kind, ...(name == null ? {} : { name }) }] as const
        case 'cron': {
          applyKeys(trigger, ['cron', 'every', 'kind', 'name', 'timezone'], `triggers.${reference}`)
          const schedule = applyTriggerSchedule(trigger, reference)
          return [reference, { kind, ...(name == null ? {} : { name }), ...(schedule == null ? {} : { schedule }) }] as const
        }
        case 'provider': {
          applyKeys(trigger, ['config', 'connection', 'cron', 'every', 'key', 'kind', 'name', 'timezone'], `triggers.${reference}`)
          const config = trigger.config == null ? {} : applyObject(trigger.config, `triggers.${reference}.config must be an object.`)
          const connection = trigger.connection == null ? undefined : applyString(trigger.connection, `triggers.${reference}.connection`)
          const schedule = applyTriggerSchedule(trigger, reference)
          return [
            reference,
            {
              config: config as Readonly<Record<string, JsonValue>>,
              ...(connection == null ? {} : { connection }),
              key: applyString(trigger.key, `triggers.${reference}.key`),
              kind,
              ...(name == null ? {} : { name }),
              ...(schedule == null ? {} : { schedule }),
            },
          ] as const
        }
        default:
          throw new CliError('flow.apply-invalid', `Unknown Flow apply trigger kind ${JSON.stringify(kind)}.`)
      }
    }),
  )
  const duplicateReferences = Object.keys(nodes).filter((reference) => triggers[reference] != null)
  if (duplicateReferences.length > 0) {
    throw new CliError('flow.apply-invalid', `Flow apply references must be unique across nodes and triggers: ${duplicateReferences.join(', ')}.`)
  }

  const edgeValues = root.edges ?? []
  if (!Array.isArray(edgeValues)) throw new CliError('flow.apply-invalid', 'Flow apply edges must be an array.')
  const edges = edgeValues.map((candidate, index) => {
    const edge = applyObject(candidate, `edges[${index}] must be an object.`)
    applyKeys(edge, ['input', 'output', 'source', 'target'], `edges[${index}]`)
    return {
      input: applyString(edge.input, `edges[${index}].input`),
      output: applyString(edge.output, `edges[${index}].output`),
      source: applyString(edge.source, `edges[${index}].source`),
      target: applyString(edge.target, `edges[${index}].target`),
    }
  })
  if (Object.keys(nodes).length == 0 && Object.keys(triggers).length == 0 && edges.length == 0) {
    throw new CliError('flow.apply-invalid', 'Flow apply input contains no changes.')
  }
  return { edges, nodes, triggers, version: 1 }
}

type SettingPorts = Readonly<Record<string, { readonly jsonSchema: JsonValue }>>

function inlineSettingValue(source: string, schema: JsonValue | undefined, name: string): JsonValue {
  const schemaObject = schema != null && typeof schema == 'object' && !Array.isArray(schema) ? (schema as Readonly<Record<string, JsonValue>>) : undefined
  const type = typeof schemaObject?.type == 'string' ? schemaObject.type : undefined
  const choices = Array.isArray(schemaObject?.enum) ? (schemaObject.enum as readonly JsonValue[]) : undefined
  if (type == 'string' || (choices?.length != null && choices.length > 0 && choices.every((value) => typeof value == 'string'))) return source
  try {
    return JSON.parse(source) as JsonValue
  } catch {
    if (type == null) return source
    throw new CliError('config.invalid', `--set ${name}= must contain a valid ${type} value.`)
  }
}

export async function settingValues(args: ParsedArguments, runtime: Runtime, ports?: SettingPorts): Promise<Readonly<Record<string, JsonValue | undefined>>> {
  const values: Record<string, JsonValue | undefined> = {}
  for (const setting of args.sets) {
    const separator = setting.indexOf('=')
    if (separator < 0) {
      const source = await argumentText(setting, '--set', 'config.unreadable', runtime)
      const object = parsedJson(source, 'config.invalid', '--set @file or --set - must contain a JSON object.')
      if (object == null || typeof object != 'object' || Array.isArray(object)) {
        throw new CliError('config.invalid', '--set @file or --set - must contain a JSON object.')
      }
      Object.assign(values, object)
      continue
    }
    const name = setting.slice(0, separator).trim()
    const source = setting.slice(separator + 1)
    if (name.length == 0) throw new CliError('config.invalid', '--set requires a field name before =.')
    if (source.startsWith('@') || source == '-') {
      values[name] = parsedJson(await argumentText(source, '--set', 'config.unreadable', runtime), 'config.invalid', `--set ${name}= must contain valid JSON.`)
      continue
    }
    values[name] = inlineSettingValue(source, ports?.[name]?.jsonSchema, name)
  }
  for (const name of args.unsets) {
    if (name.length == 0) throw new CliError('config.invalid', '--unset requires a field name.')
    values[name] = undefined
  }
  return values
}

export function triggerSchedule(every: string | undefined, cron: string | undefined, timezone: string | undefined): readonly TriggerSchedule[] | undefined {
  if (every != null && cron != null) throw new CliError('trigger.schedule-invalid', 'Use either every or cron, not both.')
  if (every != null) {
    if (timezone != null) throw new CliError('trigger.schedule-invalid', 'Timezone is only valid with cron.')
    const match = /^(\d+)(mo|m|h|d|w)$/.exec(every)
    const value = Number(match?.[1])
    if (match == null || !Number.isSafeInteger(value) || value < 1) {
      throw new CliError('trigger.schedule-invalid', 'Every must use a positive interval such as 5m, 1h, 1d, 1w, or 1mo.')
    }
    const units = { d: 'day', h: 'hour', m: 'minute', mo: 'month', w: 'week' } as const
    return [{ type: 'every', unit: units[match[2] as keyof typeof units], value }]
  }
  if (cron != null) return [{ expression: cron, timezone: timezone ?? 'UTC', type: 'cron' }]
  if (timezone != null) throw new CliError('trigger.schedule-invalid', 'Timezone requires cron.')
}

export function withInputValues(action: ConnectorAction, values: Readonly<Record<string, JsonValue | undefined>>): readonly InputPort[] {
  const inputs = { ...action.inputs }
  for (const [handle, value] of Object.entries(values)) {
    const input = inputs[handle]
    if (input == null) throw new CliError('connector.input-not-found', `Connector input ${JSON.stringify(handle)} was not found.`)
    const { value: _value, ...rest } = input
    inputs[handle] = value === undefined ? rest : { ...rest, value }
  }
  return Object.entries(inputs).map(([handle, input]) => Object.assign({ handle }, input))
}

export async function runInputs(args: ParsedArguments, runtime: Runtime): Promise<Readonly<Record<string, Readonly<Record<string, JsonValue>>>>> {
  if (args.input == null) return {}
  const source = await argumentText(args.input, '--input', 'run.input-unreadable', runtime)
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new CliError('run.input-invalid', 'Run input must be valid JSON.')
  }
  if (value == null || typeof value != 'object' || Array.isArray(value)) {
    throw new CliError('run.input-invalid', 'Run input must be an object keyed by node ID.')
  }
  for (const candidate of Object.values(value)) {
    if (candidate == null || typeof candidate != 'object' || Array.isArray(candidate)) {
      throw new CliError('run.input-invalid', 'Each Run input node must contain an object keyed by input handle.')
    }
  }
  return value as Readonly<Record<string, Readonly<Record<string, JsonValue>>>>
}

export async function publicationById(client: ControlClient, flowId: string, publicationId: string): Promise<Publication> {
  const cursors = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await client.listPublications(flowId, { cursor, limit: publicationPageLimit })
    const found = page.publications.find((publication) => publication.publicationId == publicationId)
    if (found != null) return found
    cursor = page.nextCursor
    if (cursor != null && cursors.has(cursor)) throw new CliError('page.invalid-cursor', 'The deployment returned a repeated Publication cursor.')
    if (cursor != null) cursors.add(cursor)
  } while (cursor != null)
  throw new CliError('publication.not-found', `Publication ${JSON.stringify(publicationId)} was not found.`)
}

export async function waitForRun(client: ControlClient, created: RunDetails, runtime: Runtime): Promise<RunDetails> {
  let current = created
  while (!terminalRunStatuses.has(current.status)) {
    await runtime.wait(1_000)
    current = await client.getRun(current.runId)
  }
  return current
}

export function cloudError(error: ApiError): CliError {
  return new CliError(error.code, error.message, { status: error.status })
}

export async function changeDraft(
  client: ControlClient,
  flowId: string,
  baseRevisionId: string,
  target: ErrorDetails,
  operations: Parameters<ControlClient['changeDraft']>[2],
) {
  try {
    return await client.changeDraft(flowId, baseRevisionId, operations)
  } catch (error) {
    if (error instanceof ApiError && error.code != 'response.invalid') throw cloudError(error)
    throw new CliError(
      'flow.mutation-outcome-unknown',
      'The deployment did not confirm whether the Draft change was accepted. Read the Flow again before retrying.',
      {
        baseRevisionId,
        flowId,
        target,
      },
    )
  }
}
