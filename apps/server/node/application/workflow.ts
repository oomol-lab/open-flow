import type { RevisionContent, TaskNode } from '@oomol-lab/open-flow/flow-change'
import type { WorkflowContract } from '@oomol-lab/open-flow/workflow'
import type { Store } from '../storage/store.ts'

import { decodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { flowDependencies } from '@oomol-lab/open-flow/flow-semantics'
import { workflowCompatibility, publishedWorkflowInterfaceSchema, workflowCandidate } from '@oomol-lab/open-flow/workflow'
import { ControlError } from '../error.ts'

/** Resolve availability and the published interface without reading Revision content. */
function readWorkflowTarget(store: Pick<Store, 'flows' | 'publications'>, ownerId: string, flowId: string) {
  const flow = store.flows.get(flowId)
  if (flow?.ownerId != ownerId) throw new ControlError('flow.not-found', 'The workflow is unavailable.')
  const candidate = workflowCandidate({
    ...flow,
    live: flow.publicationId == null ? null : { enabled: flow.liveEnabled == 1, hasStart: flow.liveHasStart == 1 },
  })
  if (candidate.problem != null) return { kind: 'unavailable' as const, candidate }
  const publication = store.publications.publication(flowId, flow.publicationId!)
  if (publication == null) throw new ControlError('flow.invalid', 'Called workflow Publication is unavailable.')
  const snapshot = publishedWorkflowInterfaceSchema.parse(JSON.parse(publication.interfaceJson))
  if (snapshot.inputs == null) throw new ControlError('flow.invalid', 'Called workflow has no Start node.', { details: { reason: 'workflow.missing-start' } })
  const contract: WorkflowContract = {
    version: 1,
    flowId,
    name: flow.name,
    revisionId: publication.revisionId,
    publicationId: publication.publicationId,
    inputs: snapshot.inputs,
    outputs: snapshot.outputs,
  }
  return { kind: 'available' as const, contract }
}

export function workflowTarget(store: Pick<Store, 'flows' | 'publications'>, ownerId: string, flowId: string) {
  const target = readWorkflowTarget(store, ownerId, flowId)
  if (target.kind == 'unavailable') {
    const { problem } = target.candidate
    throw new ControlError('flow.invalid', `Called workflow is ${problem}.`, { details: { reason: `workflow.${problem}` } })
  }
  return target
}

export function workflowAuthoringTarget(store: Pick<Store, 'flows' | 'publications'>, ownerId: string, flowId: string) {
  const target = readWorkflowTarget(store, ownerId, flowId)
  return target.kind == 'available' ? target.contract : target.candidate
}

/** Full definition reads belong to dependency inspection and execution, not interface queries. */
export function workflowContent(store: Pick<Store, 'flows' | 'publications'>, contract: WorkflowContract): RevisionContent {
  const saved = store.flows.revision(contract.flowId, contract.revisionId)
  if (saved == null) throw new ControlError('flow.invalid', 'Called workflow Revision is unavailable.')
  return decodeRevision(new TextEncoder().encode(saved.content))
}

export function workflowCallCompatibility(store: Pick<Store, 'flows' | 'publications'>, node: TaskNode, contract: WorkflowContract) {
  const executor = 'executor' in node.task ? node.task.executor : undefined
  const previous =
    executor?.kind == 'workflow' && executor.revisionId && executor.revisionId != contract.revisionId
      ? store.publications.interfaceForRevision(contract.flowId, executor.revisionId)
      : undefined
  return workflowCompatibility(node, contract, previous)
}

function pointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

export function workflowDiagnostics(store: Pick<Store, 'flows' | 'publications'>, flowId: string, content: RevisionContent, triggerId?: string) {
  const owner = store.flows.get(flowId)?.ownerId
  const cache = new Map<string, ReturnType<typeof workflowTarget> | Error>()
  const contents = new Map<string, RevisionContent>()
  const diagnostics: { code: string; message: string; path: string; line: number; column: number; values: Record<string, string> }[] = []
  const visit = (revision: RevisionContent, entry: string | undefined, ancestors: ReadonlySet<string>, rootNode?: string, expanded?: Set<string>) => {
    for (const nodeId of flowDependencies(revision, entry).nodes) {
      const node = revision.document.graph.nodes[nodeId]
      if (node?.kind != 'task' || !('executor' in node.task) || node.task.executor.kind != 'workflow') continue
      const targetId = node.task.executor.flowId
      const at = rootNode ?? nodeId
      const path = `/document/graph/nodes/${pointer(at)}/task/executor/flowId`
      if (!targetId) {
        diagnostics.push({
          code: rootNode == null ? 'workflow.target-required' : 'workflow.dependency-invalid',
          message: rootNode == null ? 'Select a target workflow.' : 'A call inside the target workflow has no target selected.',
          path,
          line: 0,
          column: 0,
          values: {},
        })
        continue
      }
      try {
        if (ancestors.has(targetId))
          throw new ControlError('flow.invalid', 'Recursive workflow calls are not supported.', { details: { reason: 'workflow.recursive' } })
        if (!cache.has(targetId)) {
          try {
            cache.set(targetId, workflowTarget(store, owner ?? '', targetId))
          } catch (error) {
            cache.set(targetId, error instanceof Error ? error : new Error(String(error)))
          }
        }
        const target = cache.get(targetId)!
        if (target instanceof Error) throw target
        for (const issue of workflowCallCompatibility(store, node, target.contract)) {
          const location =
            rootNode != null
              ? path
              : issue.side == 'revision'
                ? `/document/graph/nodes/${pointer(at)}/task/executor/revisionId`
                : issue.side == 'input'
                  ? `/document/graph/nodes/${pointer(at)}/inputs/${pointer(issue.field)}`
                  : `/document/graph/nodes/${pointer(at)}/task/outputs/${node.task.outputs.findIndex((port) => 'handle' in port && port.handle == issue.field)}`
          diagnostics.push({
            code:
              issue.side == 'revision'
                ? rootNode == null
                  ? `workflow.${issue.reason ?? 'revision-stale'}`
                  : 'workflow.dependency-stale'
                : rootNode == null
                  ? 'workflow.interface'
                  : 'workflow.dependency-invalid',
            message:
              issue.side == 'revision' && rootNode != null
                ? 'A nested workflow call has an outdated interface. Update the called workflow and publish it again.'
                : issue.message,
            path: location,
            line: 0,
            column: 0,
            values: { field: issue.field, flowId: targetId },
          })
        }
        // Expansion is per calling node so shared dependencies still diagnose every caller.
        // The read cache above remains shared across the whole check.
        const visited = expanded ?? new Set<string>()
        if (!visited.has(targetId)) {
          if (!contents.has(targetId)) contents.set(targetId, workflowContent(store, target.contract))
          visit(contents.get(targetId)!, undefined, new Set([...ancestors, targetId]), at, visited)
          visited.add(targetId)
        }
      } catch (error) {
        diagnostics.push({
          code:
            rootNode != null
              ? 'workflow.dependency-invalid'
              : error instanceof ControlError && typeof error.details?.reason == 'string'
                ? error.details.reason
                : 'workflow.unavailable',
          message: error instanceof Error ? error.message : String(error),
          path,
          line: 0,
          column: 0,
          values: {},
        })
      }
    }
  }
  visit(content, triggerId, new Set([flowId]))
  return diagnostics
}

/** Drafts may be incomplete, but must never directly reference their own Flow. */
export function requireNoWorkflowSelfReference(flowId: string, content: RevisionContent) {
  for (const node of Object.values(content.document.graph.nodes)) {
    if (node.kind == 'task' && 'executor' in node.task && node.task.executor.kind == 'workflow' && node.task.executor.flowId == flowId)
      throw new ControlError('flow.invalid', 'A workflow cannot call itself.', { details: { reason: 'workflow.recursive' } })
  }
}

export function requireWorkflowCalls(store: Pick<Store, 'flows' | 'publications'>, flowId: string, content: RevisionContent, triggerId?: string) {
  const diagnostics = workflowDiagnostics(store, flowId, content, triggerId)
  if (diagnostics.length) throw new ControlError('flow.invalid', diagnostics[0]!.message)
}
