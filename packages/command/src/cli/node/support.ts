import type {
  ConnectorAction,
  ConnectorConnection,
  Flow,
  JsonValue,
  Publication,
  PublishOperation,
  RunDetails,
  RunEvent,
  RunStatus,
  TriggerKeySnapshot,
  TriggerKeySummary,
} from '@oomol-lab/open-flow/control-api'
import type { CodeModule, GraphNode, InputPort, RevisionContent, TriggerNode, TriggerSchedule } from '@oomol-lab/open-flow/flow-change'
import type { UiLanguage } from '@oomol-lab/open-flow/localization'
import type { ParsedArguments } from './arguments.ts'

import { ApiError, ControlClient } from '@oomol-lab/open-flow/control-api'
import { resourceNameIssue, resourceNameMaxLength } from '@oomol-lab/open-flow/flow-change'
import { createHash } from 'node:crypto'

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

interface ErrorDetails {
  readonly [key: string]: unknown
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

export async function selectedDraftFlow(client: ControlClient, flow: Flow, args: ParsedArguments) {
  if (args.expectedRevision != null && args.expectedRevision != flow.draftRevisionId && !args.options.includes('idempotency-key')) {
    throw new CliError('flow.revision-conflict', 'The Flow Draft changed. Inspect it before submitting a new mutation.', {
      expectedRevisionId: args.expectedRevision,
      actualRevisionId: flow.draftRevisionId,
      flowId: flow.flowId,
    })
  }
  const draft = await client.getRevision(flow.flowId, args.expectedRevision ?? flow.draftRevisionId)
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

export async function referencedAction(client: ControlClient, reference: string, flowId?: string): Promise<ConnectorAction> {
  try {
    return await client.getConnectorAction(reference, undefined, flowId)
  } catch (error) {
    if (!(error instanceof ApiError) || error.status != 404) throw error
  }
  return exactAction(await client.searchConnectorActions(reference, undefined, flowId), reference)
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
  flowId?: string,
): Promise<ConnectorConnection | undefined> {
  const selected = reference == 'default' ? undefined : reference
  if (selected == null && fallback?.status == 'active') return fallback
  const connections = await client.listConnectorConnections(serviceId, undefined, flowId)
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
  return `${run.source}\t${run.status}\t${run.runId}\t${run.revisionId}${publication}${run.waiting == null ? '' : `\n${JSON.stringify(run.waiting)}`}`
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

export async function waitForRun(client: ControlClient, created: RunDetails, runtime: Runtime, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  let current = created
  while (!terminalRunStatuses.has(current.status) && current.status != 'waiting') {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return { run: current, timedOut: true }
    await runtime.wait(Math.min(1_000, remaining))
    if (Date.now() >= deadline) return { run: current, timedOut: true }
    try {
      current = await client.getRun(current.runId, AbortSignal.timeout(Math.max(1, deadline - Date.now())))
    } catch (error) {
      if (Date.now() >= deadline || (error instanceof Error && error.name == 'TimeoutError')) return { run: current, timedOut: true }
      throw new CliError('run.wait-failed', error instanceof Error ? error.message : String(error), { runId: current.runId })
    }
  }
  return { run: current, timedOut: false }
}

export function runExitCode(run: RunDetails, timedOut = false): number {
  if (timedOut) return 3
  if (run.status == 'waiting') return 2
  return run.status == 'failed' || run.status == 'canceled' || run.status == 'indeterminate' ? 1 : 0
}

export function cloudError(error: ApiError): CliError {
  return new CliError(error.code, error.message, { status: error.status })
}

export async function changeDraft(
  client: ControlClient,
  args: ParsedArguments,
  flowId: string,
  baseRevisionId: string,
  target: ErrorDetails,
  operations: Parameters<ControlClient['changeDraft']>[2],
) {
  try {
    return { ...(await client.changeDraft(flowId, baseRevisionId, operations, args.idempotencyKey)), baseRevisionId }
  } catch (error) {
    if (error instanceof ApiError && error.code != 'response.invalid') throw cloudError(error)
    throw new CliError(
      'flow.mutation-outcome-unknown',
      'The deployment did not confirm whether the Draft change was accepted. Retry with the same --idempotency-key, --expected-revision and arguments.',
      {
        baseRevisionId,
        idempotencyKey: args.idempotencyKey,
        flowId,
        target,
      },
    )
  }
}

export function authoringId(args: ParsedArguments, label: string): string {
  return createHash('sha256')
    .update(JSON.stringify([args.idempotencyKey, label]))
    .digest('hex')
    .slice(0, 24)
}

export async function waitForPublication(client: ControlClient, flowId: string, created: PublishOperation, runtime: Runtime, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  let operation = created
  while (operation.status == 'pending') {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return { operation, timedOut: true }
    await runtime.wait(Math.min(1_000, remaining))
    if (Date.now() >= deadline) return { operation, timedOut: true }
    try {
      operation = await client.getPublishOperation(flowId, operation.operationId, AbortSignal.timeout(Math.max(1, deadline - Date.now())))
    } catch (error) {
      if (Date.now() >= deadline || (error instanceof Error && error.name == 'TimeoutError')) return { operation, timedOut: true }
      throw new CliError('publication.wait-failed', error instanceof Error ? error.message : String(error), { flowId, operationId: operation.operationId })
    }
  }
  return { operation, timedOut: false }
}
