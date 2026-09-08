import type { FlowPosition, PublicationPosition, RunPosition, TriggerActivityPosition } from './control-service.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { ControlError } from './error.ts'

export function encodeFlowCursor(position: FlowPosition): string {
  return Buffer.from(JSON.stringify({ kind: 'flows', ...position })).toString('base64url')
}

export function encodeRunCursor(flowId: string, position: RunPosition): string {
  return Buffer.from(JSON.stringify({ flowId, kind: 'runs', ...position })).toString('base64url')
}

export function encodePublicationCursor(flowId: string, position: PublicationPosition): string {
  return Buffer.from(JSON.stringify({ flowId, kind: 'publications', ...position })).toString('base64url')
}

export function encodeTriggerActivityCursor(flowId: string, triggerNodeId: string, position: TriggerActivityPosition): string {
  return Buffer.from(JSON.stringify({ flowId, kind: 'trigger-activities', triggerNodeId, ...position })).toString('base64url')
}

export function decodeFlowCursor(value: string): FlowPosition {
  const decoded = decodeCursor(value, 'flows', ['createdAt', 'flowId', 'kind'])
  return { createdAt: decoded.createdAt as number, flowId: decoded.flowId as string }
}

export function decodeRunCursor(value: string, flowId: string): RunPosition {
  const decoded = decodeCursor(value, 'runs', ['createdAt', 'flowId', 'kind', 'runId'])
  if (decoded.flowId != flowId) invalid()
  return { createdAt: decoded.createdAt as number, runId: decoded.runId as string }
}

export function decodePublicationCursor(value: string, flowId: string): PublicationPosition {
  const decoded = decodeCursor(value, 'publications', ['createdAt', 'flowId', 'kind', 'publicationId'])
  if (decoded.flowId != flowId) invalid()
  return { createdAt: decoded.createdAt as number, publicationId: decoded.publicationId as string }
}

export function decodeTriggerActivityCursor(value: string, flowId: string, triggerNodeId: string): TriggerActivityPosition {
  const decoded = decodeCursor(value, 'trigger-activities', ['activityId', 'createdAt', 'flowId', 'kind', 'triggerNodeId'])
  if (decoded.flowId != flowId || decoded.triggerNodeId != triggerNodeId) invalid()
  return { activityId: decoded.activityId as string, createdAt: decoded.createdAt as number }
}

function decodeCursor(value: string, kind: string, keys: readonly string[]): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (parsed == null || typeof parsed != 'object' || Array.isArray(parsed)) return invalid()
    const decoded = parsed as Record<string, unknown>
    if (
      Object.keys(decoded).length != keys.length ||
      keys.some((key) =>
        key == 'createdAt' ? !Number.isSafeInteger(decoded[key]) || (decoded[key] as number) < 0 : typeof decoded[key] != 'string' || decoded[key].length == 0,
      ) ||
      decoded.kind != kind
    )
      return invalid()
    return decoded
  } catch {
    return invalid()
  }
}

function invalid(): never {
  throw new ControlError(controlErrorCode.pageInvalidCursor, 'Cursor is invalid.')
}
