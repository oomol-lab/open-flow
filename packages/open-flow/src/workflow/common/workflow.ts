import type { TaskNode, ManagedTaskDefinition, Port, JsonValue, RevisionContent, WorkflowCapability, AgentWorkflowTool } from '../../flow/common/change.ts'

import { dequal } from 'dequal/lite'
import { z } from 'zod'
import { comparePorts, matchesSchema } from '../../flow/common/schema.ts'

export type { WorkflowExecutor } from '../../flow/common/model.ts'
export { nodeWorkflowReferences } from '../../flow/common/workflowReferences.ts'

const portSchema = z.object({
  handle: z.string().min(1),
  jsonSchema: z.json() as z.ZodType<JsonValue>,
  nullable: z.boolean(),
  description: z.string().optional(),
})
export const publishedWorkflowInterfaceSchema = z.strictObject({
  inputs: z.array(portSchema).nullable(),
  outputs: z.array(portSchema).nullable(),
})
export type PublishedWorkflowInterface = z.infer<typeof publishedWorkflowInterfaceSchema>

/** The callable interface of one fixed definition; absence differs from empty ports. */
export function publishedWorkflowInterface(content: Pick<RevisionContent, 'document'>): PublishedWorkflowInterface {
  const nodes = Object.values(content.document.graph.nodes)
  const start = nodes.find((node) => node.kind == 'start')
  const outputs = nodes.find((node) => node.kind == 'outputs')
  return { inputs: start == null ? null : workflowPorts(start.inputDefs), outputs: outputs == null ? null : workflowPorts(outputs.outputDefs) }
}

function comparablePorts(value: PublishedWorkflowInterface['inputs']) {
  return value == null
    ? null
    : value
        .map(({ handle, jsonSchema, nullable }) => ({ handle, jsonSchema, nullable }))
        .toSorted((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0))
}

export function sameWorkflowInterface(left: PublishedWorkflowInterface, right: PublishedWorkflowInterface): boolean {
  return dequal(comparablePorts(left.inputs), comparablePorts(right.inputs)) && dequal(comparablePorts(left.outputs), comparablePorts(right.outputs))
}

export const workflowContractSchema = z.object({
  version: z.literal(1),
  flowId: z.string().min(1),
  name: z.string(),
  revisionId: z.string().min(1),
  publicationId: z.string().min(1),
  inputs: z.array(portSchema),
  outputs: z.array(portSchema).nullable(),
})
export type WorkflowContract = z.infer<typeof workflowContractSchema>

export interface WorkflowCandidate {
  readonly flowId: string
  readonly name: string
  readonly problem: 'unpublished' | 'disabled' | 'retiring' | 'recursive' | 'missing-start' | null
}

/** Classify only list metadata; opening the selector does not inspect a Revision. */
export function workflowCandidate(
  flow: { flowId: string; name: string; status: string; live?: { enabled: boolean; hasStart: boolean } | null },
  sourceFlowId?: string,
): WorkflowCandidate {
  const problem =
    flow.flowId == sourceFlowId
      ? 'recursive'
      : flow.status != 'active'
        ? 'retiring'
        : flow.live == null
          ? 'unpublished'
          : !flow.live.enabled
            ? 'disabled'
            : !flow.live.hasStart
              ? 'missing-start'
              : null
  return { flowId: flow.flowId, name: flow.name, problem }
}

export function workflowCandidateGroup(candidate: WorkflowCandidate): 'published' | 'missingStart' | 'other' {
  return candidate.problem == null ? 'published' : candidate.problem == 'missing-start' ? 'missingStart' : 'other'
}

/** A selected target is durable even before its callable interface is available. */
export function workflowSelectionTask(
  candidate: Pick<WorkflowCandidate, 'flowId' | 'name'>,
  contract?: WorkflowContract,
  previous?: ManagedTaskDefinition,
): ManagedTaskDefinition {
  if (contract != null) return workflowTask(contract, candidate.name)
  if (previous?.executor.kind == 'workflow' && previous.executor.flowId == candidate.flowId) return previous
  return { name: candidate.name, inputs: [], outputs: [], executor: { kind: 'workflow', flowId: candidate.flowId, revisionId: '' } }
}

export function workflowTask(contract: WorkflowContract, name = contract.name): ManagedTaskDefinition {
  return {
    name,
    executor: { kind: 'workflow', flowId: contract.flowId, revisionId: contract.revisionId },
    inputs: contract.inputs,
    outputs: contract.outputs ?? [],
  }
}

export function workflowPorts(ports: readonly Port[]): WorkflowContract['inputs'] {
  return ports.map(({ handle, jsonSchema, nullable, description }) => ({ handle, jsonSchema, nullable, ...(description == null ? {} : { description }) }))
}

export function workflowCompatibility(
  node: TaskNode,
  contract: WorkflowContract,
  previous?: PublishedWorkflowInterface,
): readonly { side: 'revision' | 'input' | 'output'; field: string; message: string; reason?: 'snapshot-missing' | 'interface-required' | 'revision-stale' }[] {
  const issues: {
    side: 'revision' | 'input' | 'output'
    field: string
    message: string
    reason?: 'snapshot-missing' | 'interface-required' | 'revision-stale'
  }[] = []
  if ('executor' in node.task && node.task.executor.kind == 'workflow') {
    const interfaceIssues = workflowInterfaceIssues(node.task.executor, contract, previous)
    if (interfaceIssues.length) return interfaceIssues
  }

  for (const port of contract.inputs) {
    const source = node.inputs[port.handle]
    const saved = node.task.inputs.find((p) => 'handle' in p && p.handle == port.handle)
    if (source == null || source.kind == 'unset') {
      if (!port.nullable) issues.push({ side: 'input', field: port.handle, message: `Required workflow input "${port.handle}" is missing.` })
    } else if (source.kind == 'value') {
      const value = source.value ?? null
      if (value == null ? !port.nullable : !matchesSchema(value, port.jsonSchema))
        issues.push({ side: 'input', field: port.handle, message: `Workflow input "${port.handle}" changed type.` })
    } else if (saved != null && 'handle' in saved && comparePorts(saved, port).kind != 'compatible')
      issues.push({ side: 'input', field: port.handle, message: `Workflow input "${port.handle}" changed type.` })
  }
  for (const [handle, source] of Object.entries(node.inputs)) {
    if (source.kind != 'unset' && !contract.inputs.some((p) => p.handle == handle))
      issues.push({ side: 'input', field: handle, message: `Workflow input "${handle}" was removed.` })
  }
  for (const port of node.task.outputs) {
    if (!('handle' in port)) continue
    const current = contract.outputs?.find((p) => p.handle == port.handle)
    if (current == null || comparePorts(current, port).kind != 'compatible')
      issues.push({ side: 'output', field: port.handle, message: `Workflow output "${port.handle}" was removed or changed type.` })
  }
  return issues
}

/** Refresh capability ports by exact name; removed outputs remain unresolved at consumers. */
export function withWorkflowTask(node: TaskNode, task: ManagedTaskDefinition): TaskNode {
  return {
    ...node,
    task,
    inputs: Object.fromEntries(Object.entries(node.inputs).filter(([handle]) => task.inputs.some((port) => 'handle' in port && port.handle == handle))),
  }
}

export const workflowReferencesSchema = z.object({
  version: z.literal(1),
  direction: z.enum(['incoming', 'outgoing']),
  total: z.int().nonnegative(),
  nextOffset: z.int().nonnegative().optional(),
  references: z.array(
    z.object({
      flowId: z.string(),
      name: z.string().nullable(),
      available: z.boolean(),
      draft: z.boolean(),
      live: z.object({ publicationId: z.string(), enabled: z.boolean() }).nullable(),
    }),
  ),
})
export type WorkflowReferences = z.infer<typeof workflowReferencesSchema>

export function workflowCapability(name: string, target: WorkflowContract | WorkflowCandidate): WorkflowCapability {
  return {
    kind: 'workflow',
    name,
    flowId: target.flowId,
    revisionId: 'inputs' in target ? target.revisionId : '',
    inputs: 'inputs' in target ? target.inputs : [],
    outputs: 'inputs' in target ? target.outputs : null,
  }
}

export function workflowAgentTool(id: string, name: string, target: WorkflowContract | WorkflowCandidate, previous?: AgentWorkflowTool): AgentWorkflowTool {
  const capability = workflowCapability(name, target)
  return {
    ...capability,
    id,
    description: previous?.description ?? target.name,
    approval: previous?.approval ?? false,
    inputs: capability.inputs.map((port) =>
      Object.assign({}, port, { source: previous?.inputs.find((old) => old.handle == port.handle)?.source ?? { kind: 'model' as const } }),
    ),
  }
}

export function workflowInterfaceIssues(
  target: { readonly revisionId: string },
  contract: WorkflowContract,
  previous?: PublishedWorkflowInterface,
): readonly { side: 'revision'; field: string; message: string; reason: 'snapshot-missing' | 'interface-required' | 'revision-stale' }[] {
  if (!target.revisionId)
    return [
      {
        side: 'revision',
        field: 'revisionId',
        reason: 'interface-required',
        message: 'The called workflow interface has not been loaded. Refresh the interface definition.',
      },
    ]
  if (target.revisionId == contract.revisionId) return []
  if (previous == null)
    return [
      {
        side: 'revision',
        field: 'revisionId',
        reason: 'snapshot-missing',
        message: 'The saved workflow interface snapshot is unavailable. Refresh the interface definition.',
      },
    ]
  if (!sameWorkflowInterface(previous, contract))
    return [
      {
        side: 'revision',
        field: 'revisionId',
        reason: 'revision-stale',
        message: 'The called workflow interface has changed. Update the interface definition.',
      },
    ]
  return []
}
