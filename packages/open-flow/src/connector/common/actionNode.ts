import type { HandleInputFrom, InputHandleDef, NodeId, OutputHandleDef, TaskNode } from '../../schema/index.ts'
import type { ConnectorAction } from './model.ts'

import { capitalCase } from 'change-case'
import { connectorActionPorts } from './actionSchema.ts'

export function connectorActionTitle(name: string): string {
  return capitalCase(name)
}

export function connectorActionNode(
  action: ConnectorAction,
  connection: string | undefined,
  nodeId: NodeId,
  title: string = connectorActionTitle(action.name),
): TaskNode {
  const ports = connectorActionPorts(action.inputSchema, action.outputSchema)
  return {
    icon: connectorActionIcon(action),
    inputs_from: ports.initialInputs.length > 0 ? ([...ports.initialInputs] as HandleInputFrom[]) : undefined,
    node_id: nodeId,
    task: {
      executor: { name: 'connector', options: { action: action.actionId, ...(connection == null ? {} : { connection }) } },
      inputs_def: [...ports.inputs] as InputHandleDef[],
      outputs_def: [...ports.outputs] as OutputHandleDef[],
    },
    title,
  }
}

export function connectorActionNodeId(actionId: string): NodeId {
  return connectorNodeId(actionId.replaceAll('.', '_'))
}

export function connectorNodeId(value: string): NodeId {
  return value as NodeId
}

export function connectorActionIcon(action: Pick<ConnectorAction, 'homepageUrl' | 'iconUrl'>): string | undefined {
  const iconUrl = action.iconUrl?.trim()
  if (iconUrl) return iconUrl

  const domain = homepageDomain(action.homepageUrl)
  if (domain == null) return

  const search = new URLSearchParams({ domain, sz: '64' })
  return `https://www.google.com/s2/favicons?${search}`
}

function homepageDomain(homepageUrl: string | undefined): string | undefined {
  const value = homepageUrl?.trim()
  if (!value) return
  try {
    return new URL(value).hostname || undefined
  } catch {
    return
  }
}
