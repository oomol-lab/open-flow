import type { ChangeOperation, RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { RunAcceptance } from '@oomol-lab/open-flow/run-lifecycle'
import type { FlowRunOptions } from '@oomol-lab/open-flow/scheduler'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { randomUUID } from 'node:crypto'
import { ControlError } from '../node/error.ts'
import { ServerService } from '../node/service.ts'

type RunInputs = NonNullable<FlowRunOptions['inputs']>

interface Input {
  readonly flowId: string
  readonly idempotencyKey: string
  readonly inputs?: RunInputs
  readonly revision: RevisionContent
  readonly revisionId: string
}

const revisions = new WeakMap<ServerService, Map<string, { readonly flowId: string; readonly revisionId: string }>>()

export async function storeRevision(
  service: ServerService,
  revision: RevisionContent,
  revisionKey: string,
): Promise<{ readonly flowId: string; readonly revisionId: string }> {
  let stored = revisions.get(service)?.get(revisionKey)
  if (stored == null) {
    const created = await service.control.createFlow('test', `Run fixture ${randomUUID()}`, `flow-${randomUUID()}`)
    const operations: ChangeOperation[] = [
      ...Object.entries(revision.document.bindings).map(([bindingId, binding]) => ({ binding, bindingId, kind: 'binding.create' as const })),
      ...Object.entries(revision.modules).map(([moduleId, module]) => ({ kind: 'module.create' as const, module, moduleId })),
      ...Object.entries(revision.document.tasks).map(([taskId, task]) => ({ kind: 'task.create' as const, task, taskId })),
      ...Object.entries(revision.document.subflows).map(([subflowId, subflow]) => ({ kind: 'subflow.create' as const, subflow, subflowId })),
      ...Object.entries(revision.document.graph.nodes).map(([nodeId, node]) => ({
        kind: 'graph.node.create' as const,
        node,
        nodeId,
        target: { kind: 'flow' as const },
      })),
      ...revision.document.graph.edges.map((edge) => ({ kind: 'graph.edge.connect' as const, edge, target: { kind: 'flow' as const } })),
    ]
    const revisionId =
      operations.length == 0
        ? created.flow.draftRevisionId
        : (await service.control.changeDraft('test', created.flow.flowId, created.flow.draftRevisionId, operations)).revision.revisionId
    stored = { flowId: created.flow.flowId, revisionId }
    const serviceRevisions = revisions.get(service) ?? new Map()
    serviceRevisions.set(revisionKey, stored)
    revisions.set(service, serviceRevisions)
  }
  return stored
}

export async function acceptRun(service: ServerService, input: Input): Promise<RunAcceptance> {
  const stored = await storeRevision(service, input.revision, input.revisionId)
  try {
    const accepted = await service.control.createDraftRun(stored.flowId, stored.revisionId, 'open-flow-engine/v1', input.inputs ?? {}, input.idempotencyKey)
    return { created: accepted.created, kind: 'accepted', runId: accepted.run.runId, status: accepted.run.status }
  } catch (error) {
    if (error instanceof ControlError && error.code == controlErrorCode.runConflict) return { kind: 'conflict' }
    throw error
  }
}
