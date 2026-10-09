import type { AgentInput, AgentTool } from '../../flow/common/change.ts'
import type { ConnectorAction } from './api.ts'

export interface AuthoringAgentTool {
  readonly name: string
  readonly description: string
  readonly action: string
  readonly connectionId?: string
  readonly approval: boolean
  readonly inputs?: Readonly<Record<string, AgentInput>>
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
  return tools.map(({ id: _id, inputs, ...tool }) => ({ ...tool, inputs: Object.fromEntries(inputs.map((input) => [input.handle, input.source])) }))
}

/** Keep persisted Action contracts until the caller selects a different Action. */
export async function prepareAgentTools(
  tools: readonly AuthoringAgentTool[],
  previous: readonly AgentTool[],
  action: (id: string) => Promise<ConnectorAction>,
  id: () => string,
): Promise<readonly AgentTool[]> {
  const prepared: AgentTool[] = []
  for (const tool of tools) {
    const old = previous.find((item) => item.name == tool.name)
    const retained = old?.action == tool.action ? old : undefined
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
