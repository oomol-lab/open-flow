import type { Graph, JsonValue } from '../../flow/common/change.ts'
import type { AgentCheckpoint } from '../../runtime/common/runtime.ts'
import type { ExecutableNode } from './node-execution.ts'
import type { WaitRequest } from './scheduler.ts'

import { delayDurationSchema } from '../../flow/common/delay.ts'
import { isResolutionNode, resolutionActions } from '../../flow/common/graph.ts'
import { agentApproval, agentConfig, agentNotice, jsonEqual, usesPending, validateOutputs } from './node-execution.ts'

/**
 * How a node suspends a Run. This is the single owner of suspension rules: each kind defines the Wait it creates and
 * the saved state it accepts on resume, so adding a kind is checked by every exhaustive switch over it.
 *
 * - `resolution`: Approval and Wait nodes suspend on their inputs until a person or deadline resolves them.
 * - `delay`: Delay nodes suspend on their inputs until their timer continues them.
 * - `agent`: Agent tasks suspend mid-execution when a tool call needs approval.
 */
export type SuspensionKind = 'agent' | 'delay' | 'resolution'

export function suspensionKind(node: ExecutableNode): SuspensionKind | undefined {
  if (isResolutionNode(node)) return 'resolution'
  if (node.kind === 'delay') return 'delay'
  return agentConfig(node) == null ? undefined : 'agent'
}

/** Whether the node suspends on its resolved inputs instead of executing. */
export function suspendsOnInputs(node: ExecutableNode): node is Extract<ExecutableNode, { readonly kind: 'approval' | 'delay' | 'wait' }> {
  const kind = suspensionKind(node)
  return kind === 'resolution' || kind === 'delay'
}

function unreachable(kind: never): never {
  throw new Error(`Unknown suspension kind ${String(kind)}.`)
}

export function waitRequest(
  kind: SuspensionKind,
  node: ExecutableNode,
  identity: { readonly jobId: string; readonly nodeId: string; readonly waitId: string },
  value: JsonValue,
  notify: boolean,
  agentInput: Readonly<Record<string, JsonValue>> | undefined,
): WaitRequest {
  switch (kind) {
    case 'delay':
      return { ...identity, kind: 'delay', durationMs: delayDurationSchema.parse((value as Readonly<Record<string, JsonValue>>).durationMs) }
    case 'resolution':
      if (!isResolutionNode(node)) throw new Error('Resolution Wait requires an Approval or Wait node.')
      return {
        ...identity,
        value,
        notify,
        actions: resolutionActions(node),
        prompt: node.prompt,
        ...(node.kind === 'wait' ? { autoContinue: node.autoContinue } : {}),
      }
    case 'agent':
      return {
        ...identity,
        value,
        notify,
        actions: ['approve', 'reject'] as const,
        prompt: JSON.stringify(value, null, 2),
        notification: agentNotice(node, agentInput!),
      }
    default:
      return unreachable(kind)
  }
}

export interface SavedSuspension {
  readonly graph: Graph
  readonly nodeId: string
  readonly node: ExecutableNode
  readonly wait: { readonly jobId: string; readonly value: JsonValue; readonly pending?: JsonValue }
  readonly agent?: {
    readonly invocationId: string
    readonly input: Readonly<Record<string, JsonValue>>
    readonly remainingMs?: number
    readonly checkpoint: AgentCheckpoint
  }
  readonly resolveInputs: () => Readonly<Record<string, JsonValue>>
}

/** Rejects saved Wait state that the node could not have produced from the current graph. */
export function validateSavedSuspension(kind: SuspensionKind | undefined, saved: SavedSuspension): void {
  const { agent, node, nodeId, wait } = saved
  switch (kind) {
    case undefined:
      throw new Error('Checkpoint waiting node cannot suspend.')
    case 'agent': {
      if (agent != null && agent.invocationId != wait.jobId) throw new Error('Checkpoint Agent invocation identity changed.')
      if (agent == null || (node.timeoutMs == null) != (agent.remainingMs == null) || (agent.remainingMs != null && agent.remainingMs > node.timeoutMs!)) {
        throw new Error('Checkpoint Agent budget is invalid.')
      }
      if (!jsonEqual(wait.value, agentApproval(agentConfig(node)!, agent.checkpoint, agent.input)))
        throw new Error('Checkpoint Agent approval does not match its saved call.')
      if (!jsonEqual(saved.resolveInputs(), agent.input)) throw new Error('Checkpoint Agent inputs changed.')
      return
    }
    case 'delay':
      if (agent != null || wait.pending != null || !jsonEqual(wait.value, saved.resolveInputs())) throw new Error('Checkpoint Delay state is invalid.')
      return
    case 'resolution': {
      if (agent != null) throw new Error('Checkpoint Wait contains Agent state.')
      if (!jsonEqual(saved.resolveInputs(), wait.value)) throw new Error('Checkpoint resolution input changed.')
      const notify = usesPending(saved.graph, nodeId)
      if (notify != (wait.pending != null)) throw new Error('Checkpoint Wait pending output is missing or unexpected.')
      if (wait.pending != null) validateOutputs(nodeId, node, { pending: wait.pending })
      return
    }
    default:
      return unreachable(kind)
  }
}
