import type { DesignerViewport, Point } from '../canvasPresentation.ts'

export interface GraphSession {
  readonly positions?: Readonly<Record<string, Point>>
  readonly viewport?: DesignerViewport
}
export type RevisionCanvasSession = Readonly<Record<string, GraphSession>>
export type RevisionCanvasChange =
  | { readonly kind: 'move'; readonly positions: Readonly<Record<string, Point>> }
  | { readonly kind: 'viewport'; readonly viewport: DesignerViewport }
  | { readonly kind: 'restore' }

/** Layout restoration deliberately preserves the current viewport and other graphs. */
export function changeRevisionCanvasSession(session: RevisionCanvasSession, graphId: string, change: RevisionCanvasChange): RevisionCanvasSession {
  const previous = session[graphId]
  const next =
    change.kind === 'move'
      ? { ...previous, positions: { ...previous?.positions, ...change.positions } }
      : change.kind === 'viewport'
        ? { ...previous, viewport: change.viewport }
        : { ...previous, positions: undefined }
  return { ...session, [graphId]: next }
}
