import type { RunDetails, RunEvent, RunEvents } from '@oomol-lab/open-flow/control-api'
import type { Runtime, ParsedArguments } from './support.ts'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import {
  CliError,
  eventText,
  publicationById,
  publicationPageLimit,
  publicationText,
  referencedFlow,
  requireCount,
  runInputs,
  runPageLimit,
  runSummaryText,
  runText,
  waitForRun,
  write,
} from './support.ts'

export async function createRunCommand(client: ControlClient, operands: readonly string[], args: ParsedArguments, runtime: Runtime): Promise<void> {
  requireCount(operands, 1, 'oo flow run <flow> [--source draft|live] [--input <json|@file|->] [--wait] [--json]')
  const flow = await referencedFlow(client, operands[0]!)
  const inputs = await runInputs(args, runtime)
  let created: RunDetails
  if (args.source == 'draft') {
    created = await client.createDraftRun(flow.flowId, flow.draftRevisionId, { inputs })
  } else {
    const live = await client.getLive(flow.flowId)
    if (live.publication == null) throw new CliError('live.not-found', `Flow ${JSON.stringify(operands[0])} has no Live Publication.`)
    created = await client.createLiveRun(live.publication.publicationId, { inputs })
  }
  if (args.wait) created = await waitForRun(client, created, runtime)
  write(runtime, args.json, { kind: 'run.create', run: created, version: 1 }, runText(created))
}

export async function runsCommand(client: ControlClient, operands: readonly string[], args: ParsedArguments, runtime: Runtime): Promise<void> {
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
    case 'events': {
      requireCount(references, 1, 'oo flow runs events <run> [--after <sequence>] [--limit <count>] [--follow] [--json]')
      let after = args.after ?? 0
      const events: RunEvent[] = []
      let page: RunEvents
      do {
        page = await client.getRunEvents(references[0]!, { after, limit: args.limit ?? runPageLimit })
        events.push(...page.events)
        after = page.nextAfter
        if (args.follow && !page.done && page.events.length == 0) await runtime.wait(1_000)
      } while (args.follow && !page.done)
      write(runtime, args.json, { ...page, events, kind: 'run.events', version: 1 }, events.map(eventText).join('\n'))
      return
    }
    case 'result': {
      requireCount(references, 1, 'oo flow runs result <run> [--json]')
      const result = await client.getRunResult(references[0]!)
      write(runtime, args.json, { kind: 'run.result', result, version: 1 }, JSON.stringify(result))
      return
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
      throw new CliError('cli.invalid-arguments', 'Usage: oo flow runs <list|show|events|result|cancel>')
  }
}

export async function publishCommand(client: ControlClient, operands: readonly string[], args: ParsedArguments, runtime: Runtime): Promise<void> {
  requireCount(operands, 1, 'oo flow publish <flow> [--json]')
  const flow = await referencedFlow(client, operands[0]!)
  const live = await client.getLive(flow.flowId)
  let operation = await client.publishFlow(flow.flowId, flow.draftRevisionId, live.publication?.publicationId ?? null)
  while (operation.status == 'pending') {
    await runtime.wait(1_000)
    operation = await client.getPublishOperation(flow.flowId, operation.operationId)
  }
  if (operation.status == 'failed') {
    throw new CliError(operation.issue.code, operation.issue.message, {
      ...(operation.issue.nodeId == null ? {} : { nodeId: operation.issue.nodeId }),
      operationId: operation.operationId,
    })
  }
  const publication = await publicationById(client, flow.flowId, operation.publicationId)
  write(runtime, args.json, { kind: 'publication.publish', publication, version: 1 }, publicationText(publication))
}

export async function publicationsCommand(client: ControlClient, operands: readonly string[], args: ParsedArguments, runtime: Runtime): Promise<void> {
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
  if (operation == 'show' && publicationId != null) {
    const publication = await publicationById(client, flow.flowId, publicationId)
    write(runtime, args.json, { kind: 'publication.show', publication, version: 1 }, publicationText(publication))
    return
  }
  throw new CliError('cli.invalid-arguments', 'Usage: oo flow publications <list|show> <flow> [publication]')
}

export async function rollbackCommand(client: ControlClient, operands: readonly string[], args: ParsedArguments, runtime: Runtime): Promise<void> {
  requireCount(operands, 2, 'oo flow rollback <flow> <publication> [--json]')
  const flow = await referencedFlow(client, operands[0]!)
  const source = await publicationById(client, flow.flowId, operands[1]!)
  const live = await client.getLive(flow.flowId)
  if (live.publication == null) throw new CliError('live.not-found', `Flow ${JSON.stringify(operands[0])} has no Live Publication.`)
  const rolledBack = await client.rollbackFlow(flow.flowId, source.publicationId, live.publication.publicationId)
  write(runtime, args.json, { kind: 'publication.rollback', publication: rolledBack, version: 1 }, publicationText(rolledBack))
}
