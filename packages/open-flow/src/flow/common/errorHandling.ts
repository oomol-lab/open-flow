import type { GraphNode, PortDefinition } from './change.ts'

import { supportsNodeRetry } from './retry.ts'

export type NodeErrorData = {
  readonly code: string
  readonly message: string
  readonly nodeId: string
  readonly nodeName: string
  readonly runId: string
  readonly executionId: string
}

export const nodeErrorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message', 'nodeId', 'nodeName', 'runId', 'executionId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    nodeId: { type: 'string' },
    nodeName: { type: 'string' },
    runId: { type: 'string' },
    executionId: { type: 'string' },
  },
} as const

export function supportsNodeErrorHandling(node: GraphNode): boolean {
  return supportsNodeRetry(node) || (node.kind === 'task' && 'executor' in node.task && node.task.executor.kind === 'dedupe')
}

export function nodeSystemOutputPorts(node: GraphNode): Readonly<Record<string, PortDefinition>> {
  return supportsNodeErrorHandling(node) && node.onError == 'error' ? { error: { jsonSchema: nodeErrorSchema, nullable: true } } : {}
}
