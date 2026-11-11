import type { CanvasDirection } from '../../../../canvas/common/direction.ts'
import type { DesignerViewport, Point } from '../canvasPresentation.ts'

export interface GraphSession {
  readonly initialLayout?: {
    readonly direction: CanvasDirection
    readonly positions: Readonly<Record<string, Point>>
  }
  readonly direction?: CanvasDirection
  readonly positions?: Readonly<Record<string, Point>>
  readonly viewport?: DesignerViewport
}
export type RevisionCanvasSession = Readonly<Record<string, GraphSession>>
export type RevisionCanvasChange =
  | { readonly kind: 'initialize'; readonly direction: CanvasDirection; readonly positions: Readonly<Record<string, Point>> }
  | { readonly kind: 'move'; readonly positions: Readonly<Record<string, Point>> }
  | { readonly kind: 'direction'; readonly direction: CanvasDirection; readonly positions: Readonly<Record<string, Point>> }
  | { readonly kind: 'viewport'; readonly viewport: DesignerViewport }
  | { readonly kind: 'restore' }

/** Layout restoration deliberately preserves the current viewport and other graphs. */
export function changeRevisionCanvasSession(session: RevisionCanvasSession, graphId: string, change: RevisionCanvasChange): RevisionCanvasSession {
  const previous = session[graphId]
  let next: GraphSession
  switch (change.kind) {
    case 'initialize':
      next = { ...previous, initialLayout: previous?.initialLayout ?? { direction: change.direction, positions: change.positions } }
      break
    case 'move':
      next = { ...previous, positions: { ...previous?.positions, ...change.positions } }
      break
    case 'direction':
      next = { ...previous, direction: change.direction, positions: { ...previous?.positions, ...change.positions } }
      break
    case 'viewport':
      next = { ...previous, viewport: change.viewport }
      break
    case 'restore':
      next = { ...previous, direction: undefined, positions: undefined }
      break
  }
  return { ...session, [graphId]: next }
}
