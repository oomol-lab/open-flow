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
import type { RevisionContent, TriggerNode } from '@oomol-lab/open-flow/flow-change'
import type { UiLanguage } from '@oomol-lab/open-flow/localization'
import type { ParsedArguments } from './arguments.ts'

import { ApiError, ControlClient } from '@oomol-lab/open-flow/control-api'
import { resourceNameIssue, resourceNameMaxLength } from '@oomol-lab/open-flow/flow-change'

export interface CommandHost {
  readonly request: (path: string, init?: RequestInit) => Promise<Response>
  getWorkbenchUrl?(flowId?: string): Promise<string>
}

export interface Runtime {
  readonly commandPrefix?: string
  readonly scopeGuidance?: readonly string[]
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
  readonly code: string
  readonly details?: ErrorDetails

  constructor(code: string, message: string, details?: ErrorDetails) {
    super(message)
    this.code = code
    this.details = details
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
  return { draft, flow, graph: draft.content.document.graph }
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

export function connectionText(connection: ConnectorConnection): string {
  return `${connection.displayName}\t${connection.connectionId}\t${connection.serviceId}\t${connection.status}${connection.isDefault ? '\tdefault' : ''}`
}

export function actionText(action: ConnectorAction): string {
  return `${action.name}\t${action.actionId}\t${action.serviceName}\t${action.serviceId}`
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

export function publicationText(publication: Publication): string {
  return `${publication.operation}\t${publication.publicationId}\t${publication.revisionId}\t${publication.createdAt}`
}

export function runText(run: RunDetails): string {
  const publication = run.source == 'draft' ? '' : `\t${run.publicationId}`
  return `${run.source}\t${run.status}\t${run.runId}\t${run.revisionId}${publication}${run.waits.length == 0 ? '' : `\n${JSON.stringify(run.waits)}`}`
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
  while (!terminalRunStatuses.has(current.status) && current.waits.length == 0) {
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
  if (run.waits.length > 0) return 2
  return run.status == 'failed' || run.status == 'canceled' || run.status == 'indeterminate' ? 1 : 0
}

export function cloudError(error: ApiError): CliError {
  return new CliError(error.code, error.message, { status: error.status, ...error.details })
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
