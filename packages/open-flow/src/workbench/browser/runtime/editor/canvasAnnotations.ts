import type { CanvasAnnotationContext } from '../../../../canvas/browser/graph/annotations.tsx'
import type { Draft } from '../api.ts'
import type { SyncState } from '../stores/workspaceModel.ts'

export function canvasAnnotations(
  flowId: string | undefined,
  draft: Pick<Draft, 'flowId' | 'revisionId'> | undefined,
  syncState: SyncState | undefined,
): CanvasAnnotationContext | undefined {
  if (flowId == null || draft == null || draft.flowId != flowId || syncState == null) return
  return { flowId, revisionId: draft.revisionId, syncState }
}
