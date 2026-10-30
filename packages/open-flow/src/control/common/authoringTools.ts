import type { AgentInput, AgentTool, TaskCapability, WorkflowCapability } from '../../flow/common/change.ts'
import type { WorkflowContract, WorkflowCandidate } from '../../workflow/common/workflow.ts'
import type { ConnectorAction } from './api.ts'

import { workflowAgentTool, workflowCapability } from '../../workflow/common/workflow.ts'

interface AuthoringAgentToolBase {
  readonly name: string
  readonly description: string
  readonly approval: boolean
  readonly inputs?: Readonly<Record<string, AgentInput>>
}

export type AuthoringAgentTool = AuthoringAgentToolBase &
  ({ readonly kind?: 'connector'; readonly action: string; readonly connectionId?: string } | { readonly kind: 'workflow'; readonly flowId: string })
export type AuthoringCapability = Exclude<TaskCapability, WorkflowCapability> | Pick<WorkflowCapability, 'kind' | 'name' | 'flowId'>
export type WorkflowLookup = (flowId: string) => Promise<WorkflowContract | WorkflowCandidate>

interface ToolIdentity {
  readonly kind?: string
  readonly name?: string
  readonly flowId?: string
}

/** A rename retains a snapshot only when one removed name matches one added name for the same target. */
function previousWorkflowTool<T extends ToolIdentity>(
  tool: Pick<WorkflowCapability, 'name' | 'flowId'>,
  next: readonly ToolIdentity[],
  previous: readonly T[],
): T | undefined {
  const named = previous.find((item) => item.name == tool.name)
  if (named != null) return named
  const added = next.filter((item) => item.kind == 'workflow' && item.flowId == tool.flowId && !previous.some((old) => old.name == item.name))
  if (added.length != 1) return
  const removed = previous.filter((item) => item.kind == 'workflow' && item.flowId == tool.flowId && !next.some((itemNext) => itemNext.name == item.name))
  return removed.length == 1 ? removed[0] : undefined
}

export function outwardCapabilities(capabilities: readonly TaskCapability[]): readonly AuthoringCapability[] {
  return capabilities.map((item) => (item.kind == 'workflow' ? { kind: item.kind, name: item.name, flowId: item.flowId } : item))
}

export async function prepareCapabilities(
  capabilities: readonly AuthoringCapability[],
  previous: readonly TaskCapability[],
  workflow: WorkflowLookup,
): Promise<readonly TaskCapability[]> {
  return Promise.all(
    capabilities.map(async (item) => {
      if (item.kind != 'workflow') return item
      const old = previousWorkflowTool(item, capabilities, previous)
      return old?.kind == 'workflow' && old.flowId == item.flowId ? { ...old, name: item.name } : workflowCapability(item.name, await workflow(item.flowId))
    }),
  )
}

export class AuthoringToolInputError extends Error {
  readonly code = 'tool.input-not-found'
  readonly details: { tool: string; action: string; input: string; choices: readonly string[] }
  constructor(details: AuthoringToolInputError['details']) {
    super(`Unknown input ${JSON.stringify(details.input)} for tool ${JSON.stringify(details.tool)}. Choose from: ${details.choices.join(', ') || '(none)'}.`)
    this.name = 'AuthoringToolInputError'
    this.details = details
  }
}

export function outwardAgentTools(tools: readonly AgentTool[]): readonly AuthoringAgentTool[] {
  return tools.map((tool) => {
    const { id: _id, inputs, ...settings } = tool
    return {
      ...(tool.kind == 'workflow'
        ? { kind: tool.kind, name: tool.name, description: tool.description, approval: tool.approval, flowId: tool.flowId }
        : settings),
      inputs: Object.fromEntries(inputs.map((input) => [input.handle, input.source])),
    } as AuthoringAgentTool
  })
}

/** Keep persisted tool contracts until the caller selects a different target or explicitly refreshes. */
export async function prepareAgentTools(
  tools: readonly AuthoringAgentTool[],
  previous: readonly AgentTool[],
  action: (id: string) => Promise<ConnectorAction>,
  id: () => string,
  workflow?: WorkflowLookup,
): Promise<readonly AgentTool[]> {
  const prepared: AgentTool[] = []
  for (const tool of tools) {
    const old = tool.kind == 'workflow' ? previousWorkflowTool(tool, tools, previous) : previous.find((item) => item.name == tool.name)
    if (tool.kind == 'workflow') {
      if (workflow == null) throw new Error('Workflow tools are unavailable.')
      const retained = old?.kind == 'workflow' && old.flowId == tool.flowId ? old : undefined
      const preparedTool = retained ?? workflowAgentTool(old?.id ?? id(), tool.name, await workflow(tool.flowId))
      const choices = preparedTool.inputs.map((port) => port.handle)
      for (const input of Object.keys(tool.inputs ?? {}))
        if (!choices.includes(input)) throw new AuthoringToolInputError({ tool: tool.name, action: tool.flowId, input, choices })
      prepared.push({
        ...preparedTool,
        name: tool.name,
        description: tool.description,
        approval: tool.approval,
        inputs: preparedTool.inputs.map((port) => Object.assign({}, port, { source: tool.inputs?.[port.handle] ?? port.source })),
      })
      continue
    }
    const retained = old?.kind != 'workflow' && old?.action == tool.action ? old : undefined
    const definition = retained == null ? await action(tool.action) : undefined
    const ports =
      retained?.inputs ?? Object.entries(definition!.inputs).map(([handle, port]) => Object.assign({}, port, { handle, source: { kind: 'model' } as const }))
    const choices = ports.map((port) => port.handle)
    for (const input of Object.keys(tool.inputs ?? {})) {
      if (!choices.includes(input)) throw new AuthoringToolInputError({ tool: tool.name, action: tool.action, input, choices })
    }
    const { inputs: sources, ...settings } = tool
    prepared.push({
      ...settings,
      id: old?.id ?? id(),
      action: definition?.actionId ?? tool.action,
      inputs: ports.map((port) => (sources != null && Object.hasOwn(sources, port.handle) ? Object.assign({}, port, { source: sources[port.handle]! }) : port)),
    })
  }
  return prepared
}
