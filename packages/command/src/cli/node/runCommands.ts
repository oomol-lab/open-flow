import type { JsonValue, RunDetails } from '@oomol-lab/open-flow/control-api'
import type { Runtime, ParsedArguments } from './support.ts'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import {
  CliError,
  argumentText,
  exactTrigger,
  eventText,
  publicationById,
  publicationPageLimit,
  publicationText,
  referencedFlow,
  requireCount,
  runInputs,
  runExitCode,
  runPageLimit,
  runSummaryText,
  runText,
  waitForRun,
  waitForPublication,
  write,
} from './support.ts'

export async function createRunCommand(client: ControlClient, operands: readonly string[], args: ParsedArguments, runtime: Runtime): Promise<number | void> {
  requireCount(
    operands,
    1,
    'oo flow run <flow> [--source draft|live] [--trigger <name|id>] [--payload <json|@file|->] [--input <json|@file|->] [--wait] [--json]',
  )
  const flow = await referencedFlow(client, operands[0]!)
  const inputs = await runInputs(args, runtime)
  const live =
    args.source == 'live'
      ? args.expectedPublication == null
        ? await client.getLive(flow.flowId)
        : { publication: await publicationById(client, flow.flowId, args.expectedPublication) }
      : undefined
  if (args.source == 'live' && live?.publication == null) throw new CliError('live.not-found', `Flow ${JSON.stringify(operands[0])} has no Live Publication.`)
  const revisionId = live?.publication?.revisionId ?? args.expectedRevision ?? flow.draftRevisionId
  const revision = await client.getRevision(flow.flowId, revisionId)
  const triggers = Object.entries(revision.content.document.graph.nodes).filter(([, node]) => !('inputs' in node))
  const only = triggers.length == 1 && triggers[0]?.[1].kind == 'manual' ? triggers[0][0] : undefined
  const reference = args.trigger ?? only
  if (reference == null)
    throw new CliError('run.trigger-required', 'Choose a start node with --trigger <name|id>.', {
      candidates: triggers.map(([triggerId, node]) => ({ triggerId, name: node.name })),
    })
  const selected = exactTrigger(revision.content, reference)
  let payload: JsonValue = {}
  if (args.payload != null) {
    const text = await argumentText(args.payload, '--payload', 'run.input-unreadable', runtime)
    try {
      payload = JSON.parse(text) as JsonValue
    } catch {
      throw new CliError('run.input-invalid', 'Trigger payload must be valid JSON.')
    }
  }
  const trigger = { nodeId: selected.triggerId, payload }
  let created: RunDetails
  if (live?.publication != null) created = await client.createLiveRun(live.publication.publicationId, { inputs, trigger, idempotencyKey: args.idempotencyKey })
  else created = await client.createDraftRun(flow.flowId, revisionId, { inputs, trigger, idempotencyKey: args.idempotencyKey })
  const result = args.wait ? await waitForRun(client, created, runtime, args.timeoutMs) : { run: created, timedOut: false }
  write(runtime, args.json, { kind: 'run.create', idempotencyKey: args.idempotencyKey, ...result, version: 1 }, runText(result.run))
  return runExitCode(result.run, result.timedOut)
}

export async function runsCommand(client: ControlClient, operands: readonly string[], args: ParsedArguments, runtime: Runtime): Promise<number | void> {
  const [operation, ...references] = operands
  switch (operation) {
    case 'list': {
      requireCount(references, 0, 'oo flow runs list --flow <flow> [--status <status>] [--cursor <cursor>] [--limit <count>] [--json]')
      if (args.flow == null) throw new CliError('cli.invalid-arguments', 'oo flow runs list requires --flow <flow>.')
      const flow = await referencedFlow(client, args.flow)
      const page = await client.listRuns(flow.flowId, {
        ...(args.cursor == null ? {} : { cursor: args.cursor }),
        limit: args.limit ?? runPageLimit,
        ...(args.status == null ? {} : { status: args.status }),
      })
      write(runtime, args.json, { kind: 'run.list', ...page, version: 1 }, page.runs.map(runSummaryText).join('\n'))
      return
    }
    case 'show': {
      requireCount(references, 1, 'oo flow runs show <run> [--json]')
      const run = await client.getRun(references[0]!)
      write(runtime, args.json, { kind: 'run.show', run, version: 1 }, runText(run))
      return
    }
    case 'wait': {
      requireCount(references, 1, 'oo flow runs wait <run> [--timeout <milliseconds>] [--json]')
      const runId = references[0]!
      const deadline = Date.now() + (args.timeoutMs ?? 60_000)
      try {
        const current = await client.getRun(runId, AbortSignal.timeout(args.timeoutMs ?? 60_000))
        const result = await waitForRun(client, current, runtime, Math.max(0, deadline - Date.now()))
        write(runtime, args.json, { kind: 'run.wait', runId, ...result, version: 1 }, runText(result.run))
        return runExitCode(result.run, result.timedOut)
      } catch (error) {
        if (Date.now() >= deadline || (error instanceof Error && error.name == 'TimeoutError')) {
          write(runtime, args.json, { kind: 'run.wait', runId, timedOut: true, version: 1 }, `timeout\t${runId}`)
          return 3
        }
        if (error instanceof CliError) throw error
        throw new CliError('run.wait-failed', error instanceof Error ? error.message : String(error), { runId })
      }
    }
    case 'resolve': {
      requireCount(references, 3, 'oo flow runs resolve <run> <wait> <continue|approve|reject> [--json]')
      const [runId, waitId, action] = references
      if (action != 'continue' && action != 'approve' && action != 'reject') throw new CliError('cli.invalid-arguments', 'Invalid Wait action.')
      const resolution = await client.resolveRunWait(runId!, waitId!, action)
      write(runtime, args.json, { kind: 'run.resolve', resolution, version: 1 }, JSON.stringify(resolution))
      return
    }
    case 'events': {
      requireCount(references, 1, 'oo flow runs events <run> [--after <sequence>] [--limit <count>] [--follow] [--timeout <milliseconds>] [--json]')
      const runId = references[0]!
      let after = args.after ?? 0
      const deadline = Date.now() + (args.timeoutMs ?? 60_000)
      let run: RunDetails | undefined
      try {
        do {
          if (args.follow && Date.now() >= deadline) break
          const page = await client.getRunEvents(
            runId,
            { after, limit: args.limit ?? runPageLimit },
            args.follow ? AbortSignal.timeout(Math.max(1, deadline - Date.now())) : undefined,
          )
          after = page.nextAfter
          write(runtime, args.json, { ...page, kind: 'run.events', runId, version: 1 }, page.events.map(eventText).join('\n'))
          if (!args.follow) return
          run = await client.getRun(runId, AbortSignal.timeout(Math.max(1, deadline - Date.now())))
          if (page.done) return runExitCode(run)
          if (run.status == 'waiting') {
            write(runtime, args.json, { kind: 'run.wait', runId, run, nextAfter: after, timedOut: false, version: 1 }, runText(run))
            return 2
          }
          const remaining = deadline - Date.now()
          if (remaining <= 0) break
          if (page.events.length == 0) await runtime.wait(Math.min(1_000, remaining))
        } while (args.follow)
      } catch (error) {
        if (!args.follow || (Date.now() < deadline && !(error instanceof Error && error.name == 'TimeoutError'))) {
          throw new CliError('run.events-failed', error instanceof Error ? error.message : String(error), { runId, nextAfter: after })
        }
      }
      write(runtime, args.json, { kind: 'run.wait', runId, run, nextAfter: after, timedOut: true, version: 1 }, `timeout\t${runId}\t${after}`)
      return 3
    }
    case 'result': {
      requireCount(references, 1, 'oo flow runs result <run> [--json]')
      const result = await client.getRunResult(references[0]!)
      write(runtime, args.json, { kind: 'run.result', result, version: 1 }, JSON.stringify(result))
      return result.status == 'completed' ? 0 : 1
    }
    case 'cancel': {
      requireCount(references, 1, 'oo flow runs cancel <run> [--json]')
      const cancellation = await client.cancelRun(references[0]!)
      write(
        runtime,
        args.json,
        { cancellation, kind: 'run.cancel', version: 1 },
        `${cancellation.status}\t${cancellation.runId}\t${cancellation.cancelAccepted ? 'accepted' : 'already-terminal'}`,
      )
      return
    }
    default:
      throw new CliError('cli.invalid-arguments', 'Usage: oo flow runs <list|show|wait|resolve|events|result|cancel>')
  }
}

export async function publishCommand(client: ControlClient, operands: readonly string[], args: ParsedArguments, runtime: Runtime): Promise<number | void> {
  requireCount(operands, 1, 'oo flow publish <flow> [--json]')
  const flow = await referencedFlow(client, operands[0]!)
  const expectedPublicationId =
    args.expectedPublication == 'none' ? null : (args.expectedPublication ?? (await client.getLive(flow.flowId)).publication?.publicationId ?? null)
  let operation = await client.publishFlow(flow.flowId, args.expectedRevision ?? flow.draftRevisionId, expectedPublicationId, {
    idempotencyKey: args.idempotencyKey,
  })
  const result = await waitForPublication(client, flow.flowId, operation, runtime, args.timeoutMs)
  operation = result.operation
  if (operation.status == 'pending') {
    write(
      runtime,
      args.json,
      { kind: 'publication.publish', expectedPublicationId, idempotencyKey: args.idempotencyKey, flowId: flow.flowId, ...result, version: 1 },
      JSON.stringify(operation),
    )
    return 3
  }
  if (operation.status == 'failed') {
    throw new CliError(operation.issue.code, operation.issue.message, {
      ...(operation.issue.nodeId == null ? {} : { nodeId: operation.issue.nodeId }),
      operationId: operation.operationId,
      flowId: flow.flowId,
      idempotencyKey: args.idempotencyKey,
    })
  }
  let publication
  try {
    publication = await publicationById(client, flow.flowId, operation.publicationId)
  } catch (error) {
    throw new CliError('publication.read-failed', error instanceof Error ? error.message : String(error), {
      flowId: flow.flowId,
      operationId: operation.operationId,
      publicationId: operation.publicationId,
      idempotencyKey: args.idempotencyKey,
    })
  }
  write(
    runtime,
    args.json,
    { kind: 'publication.publish', expectedPublicationId, idempotencyKey: args.idempotencyKey, publication, version: 1 },
    publicationText(publication),
  )
}

export async function publicationsCommand(client: ControlClient, operands: readonly string[], args: ParsedArguments, runtime: Runtime): Promise<number | void> {
  const [operation, flowReference, publicationId, ...extra] = operands
  if (flowReference == null || extra.length > 0) throw new CliError('cli.invalid-arguments', 'Usage: oo flow publications <list|show> <flow> [publication]')
  const flow = await referencedFlow(client, flowReference)
  if (operation == 'list') {
    if (publicationId != null) throw new CliError('cli.invalid-arguments', 'Usage: oo flow publications list <flow> [--cursor <cursor>] [--limit <count>]')
    const page = await client.listPublications(flow.flowId, {
      ...(args.cursor == null ? {} : { cursor: args.cursor }),
      limit: args.limit ?? publicationPageLimit,
    })
    write(runtime, args.json, { flow, kind: 'publication.list', ...page, version: 1 }, page.publications.map(publicationText).join('\n'))
    return
  }
  if ((operation == 'operation' || operation == 'wait') && publicationId != null) {
    const deadline = Date.now() + (args.timeoutMs ?? 60_000)
    try {
      const current = await client.getPublishOperation(
        flow.flowId,
        publicationId,
        operation == 'wait' ? AbortSignal.timeout(args.timeoutMs ?? 60_000) : undefined,
      )
      const result =
        operation == 'wait'
          ? await waitForPublication(client, flow.flowId, current, runtime, Math.max(0, deadline - Date.now()))
          : { operation: current, timedOut: false }
      write(runtime, args.json, { kind: `publication.${operation}`, flowId: flow.flowId, ...result, version: 1 }, JSON.stringify(result.operation))
      return result.operation.status == 'failed' ? 1 : result.operation.status == 'pending' ? 3 : 0
    } catch (error) {
      if (operation == 'wait' && (Date.now() >= deadline || (error instanceof Error && error.name == 'TimeoutError'))) {
        write(
          runtime,
          args.json,
          { kind: 'publication.wait', flowId: flow.flowId, operationId: publicationId, timedOut: true, version: 1 },
          `timeout\t${publicationId}`,
        )
        return 3
      }
      if (error instanceof CliError) throw error
      throw new CliError('publication.wait-failed', error instanceof Error ? error.message : String(error), { flowId: flow.flowId, operationId: publicationId })
    }
  }
  if (operation == 'show' && publicationId != null) {
    const publication = await publicationById(client, flow.flowId, publicationId)
    write(runtime, args.json, { kind: 'publication.show', publication, version: 1 }, publicationText(publication))
    return
  }
  throw new CliError('cli.invalid-arguments', 'Usage: oo flow publications <list|show> <flow> [publication]')
}

export async function rollbackCommand(client: ControlClient, operands: readonly string[], args: ParsedArguments, runtime: Runtime): Promise<number | void> {
  requireCount(operands, 2, 'oo flow rollback <flow> <publication> [--json]')
  const flow = await referencedFlow(client, operands[0]!)
  const source = await publicationById(client, flow.flowId, operands[1]!)
  const expectedPublicationId = args.expectedPublication ?? (await client.getLive(flow.flowId)).publication?.publicationId
  if (expectedPublicationId == null) throw new CliError('live.not-found', `Flow ${JSON.stringify(operands[0])} has no Live Publication.`)
  const rolledBack = await client.rollbackFlow(flow.flowId, source.publicationId, expectedPublicationId, {
    idempotencyKey: args.idempotencyKey,
  })
  write(
    runtime,
    args.json,
    { kind: 'publication.rollback', expectedPublicationId, idempotencyKey: args.idempotencyKey, publication: rolledBack, version: 1 },
    publicationText(rolledBack),
  )
}
