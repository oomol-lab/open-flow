import type { GraphNode } from './change.ts'
import type { RetryConfiguration } from './model.ts'

import { z } from 'zod'

export type { RetryConfiguration } from './model.ts'

export const retryNodeTypes = ['code', 'connector', 'openapi', 'llm', 'decision'] as const
export const nodeRetryLimits = { maxRetries: 5, minIntervalMs: 1000, maxIntervalMs: 60000, intervalStepMs: 1000 } as const
export const defaultNodeRetry: RetryConfiguration = { maxRetries: 2, intervalMs: 2000 }
export const retryConfigurationSchema = z.strictObject({
  maxRetries: z.number().int().min(0).max(nodeRetryLimits.maxRetries),
  intervalMs: z.number().int().min(nodeRetryLimits.minIntervalMs).max(nodeRetryLimits.maxIntervalMs).multipleOf(nodeRetryLimits.intervalStepMs),
})

export function supportsNodeRetry(node: GraphNode): boolean {
  return node.kind == 'task' && retryNodeTypes.some((type) => type == ('moduleId' in node.task ? 'code' : node.task.executor.kind))
}
