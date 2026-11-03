import type { I18n } from 'val-i18n'
import type { Point } from '../canvasPresentation.ts'
import type { RevisionView } from '../revisionView.ts'
import type { PresentationUpdate } from '../stores/presentationChanges.ts'
import type { DesignerGraph } from '../workspace.ts'
import type { FlowChanges } from './flowChanges.ts'
import type { NodeClipboard } from './nodeClipboard.ts'

import { setComment, setNodeContentHidden, setNodePositions, setVerticalNodeWidth } from '../canvasPresentation.ts'
import { copyNodes, pasteNodes } from './nodeClipboard.ts'

interface Clipboard {
  readonly verticalNodeWidths: Readonly<Record<string, number>>
  readonly hiddenNodeIds: readonly string[]
  readonly comments: readonly {
    readonly content: string
    readonly position: Point
    readonly sourceId: string
    readonly title: string
  }[]
  readonly nodes: NodeClipboard
}

interface PastedCanvas {
  readonly changes: FlowChanges
  readonly nodeIds: readonly string[]
  readonly update: PresentationUpdate
}

export class CanvasClipboard {
  #value?: Clipboard

  public constructor(
    private readonly identity: () => string,
    private readonly t: I18n['t'],
  ) {}

  public copy(revision: RevisionView, graph: DesignerGraph, nodeIds: readonly string[]): void {
    const selected = new Set(nodeIds)
    this.#value = {
      verticalNodeWidths: Object.fromEntries(
        graph.nodes.flatMap((node) =>
          node.kind === 'condition' && node.verticalWidth != null && selected.has(node.id) ? [[node.id, node.verticalWidth]] : [],
        ),
      ),
      hiddenNodeIds: graph.nodes.flatMap((node) => (node.contentHidden && selected.has(node.id) ? [node.id] : [])),
      comments: graph.nodes.flatMap((node) =>
        node.kind == 'comment' && selected.has(node.id)
          ? [
              {
                content: node.content,
                position: node.position,
                sourceId: node.id,
                title: node.title,
              },
            ]
          : [],
      ),
      nodes: copyNodes(revision, nodeIds),
    }
  }

  public paste(
    revision: RevisionView,
    graph: DesignerGraph,
    sourcePositions?: Readonly<Record<string, Point>>,
    offset: Point = { x: 40, y: 40 },
  ): PastedCanvas | undefined {
    if (this.#value == null) return
    const hiddenNodeIds = new Set(this.#value.hiddenNodeIds)
    const verticalNodeWidths = this.#value.verticalNodeWidths
    const pasted = pasteNodes(revision, this.#value.nodes, this.identity)
    const comments = this.#value.comments.map((comment) => ({
      ...comment,
      nodeId: this.identity(),
    }))
    if (pasted.nodeIds.length == 0 && comments.length == 0) return
    const designerNodes = new Map(graph.nodes.map((node) => [node.id, node]))
    const added = new Set([...pasted.nodeIds, ...comments.map((comment) => comment.nodeId)])
    const occupied = new Set([...designerNodes].filter(([nodeId]) => !added.has(nodeId)).map(([, node]) => `${node.position.x}\0${node.position.y}`))
    const sources = [
      ...pasted.sourceIds.map((sourceId) => sourcePositions?.[sourceId] ?? designerNodes.get(sourceId)?.position ?? { x: 80, y: 80 }),
      ...comments.map((comment) => comment.position),
    ]
    let step = 1
    if (offset.x != 0 || offset.y != 0) {
      while (sources.some((source) => occupied.has(`${source.x + offset.x * step}\0${source.y + offset.y * step}`))) step += 1
    }
    const positions = Object.fromEntries(
      pasted.sourceIds.map((sourceId, index) => {
        const source = sourcePositions?.[sourceId] ?? designerNodes.get(sourceId)?.position
        return [
          pasted.nodeIds[index]!,
          {
            x: (source?.x ?? 80) + offset.x * step,
            y: (source?.y ?? 80) + offset.y * step,
          },
        ]
      }),
    )
    return {
      changes: pasted.changes,
      nodeIds: [...pasted.nodeIds, ...comments.map((comment) => comment.nodeId)],
      update: (value) => {
        let next = setNodePositions(value, positions)
        for (const [index, sourceId] of pasted.sourceIds.entries()) {
          if (hiddenNodeIds.has(sourceId)) next = setNodeContentHidden(next, pasted.nodeIds[index]!, true)
          if (verticalNodeWidths[sourceId] != null) next = setVerticalNodeWidth(next, pasted.nodeIds[index]!, verticalNodeWidths[sourceId])
        }
        for (const comment of comments) {
          if (hiddenNodeIds.has(comment.sourceId)) next = setNodeContentHidden(next, comment.nodeId, true)
          next = setComment(next, comment.nodeId, {
            content: comment.content,
            position: { x: comment.position.x + offset.x * step, y: comment.position.y + offset.y * step },
            title: this.t('addNode.commentCopy', { title: comment.title }),
          })
        }
        return next
      },
    }
  }
}
