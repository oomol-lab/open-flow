import type { CanvasDirection } from '../../../canvas/common/direction.ts'
import type { JsonValue } from './api.ts'

import { dequal } from 'dequal/lite'
import { canvasDirection } from '../../../canvas/common/direction.ts'

export interface Point {
  readonly x: number
  readonly y: number
}

export interface DesignerViewport extends Point {
  readonly zoom: number
}

export interface DesignerComment {
  readonly content: string
  readonly position: Point
  readonly title: string
}

function record(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | undefined {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return undefined
  return value as Readonly<Record<string, JsonValue>>
}

function finite(value: JsonValue | undefined): number | undefined {
  return typeof value == 'number' && Number.isFinite(value) ? value : undefined
}

export function flowPresentation(value: Readonly<Record<string, JsonValue>>): Readonly<Record<string, JsonValue>> | undefined {
  const designer = record(value.designer)
  if (designer?.version != 1) return undefined
  return record(designer.flow)
}

export function savedDirection(value: Readonly<Record<string, JsonValue>>): CanvasDirection {
  return canvasDirection(flowPresentation(value)?.direction)
}

export function setCanvasLayout(
  value: Readonly<Record<string, JsonValue>>,
  direction: CanvasDirection,
  positions: Readonly<Record<string, Point>> = {},
): Readonly<Record<string, JsonValue>> {
  const positioned = setNodePositions(value, positions)
  return {
    ...positioned,
    designer: replaceFlowPresentation(designerPresentation(positioned), { ...normalizedFlow(positioned), direction }),
  }
}

export function savedPositions(value: Readonly<Record<string, JsonValue>>): Readonly<Record<string, { readonly x: number; readonly y: number }>> {
  const current = flowPresentation(value)
  const positions = (source: JsonValue | undefined): Readonly<Record<string, { readonly x: number; readonly y: number }>> => {
    return Object.fromEntries(
      Object.entries(record(source) ?? {}).flatMap(([nodeId, candidate]) => {
        const position = record(candidate)
        const x = finite(position?.x)
        const y = finite(position?.y)
        return x == null || y == null ? [] : [[nodeId, { x, y }]]
      }),
    )
  }
  return positions(current?.nodes)
}

export function savedOrder(value: Readonly<Record<string, JsonValue>>): readonly string[] {
  const positions = savedPositions(value)
  const source = flowPresentation(value)?.order
  const order = Array.isArray(source) ? source.flatMap((nodeId) => (typeof nodeId == 'string' && positions[nodeId] != null ? [nodeId] : [])) : []
  return [...new Set([...order, ...Object.keys(positions)])]
}

function optionalViewport(value: Readonly<Record<string, JsonValue>>): DesignerViewport | undefined {
  const viewport = record(flowPresentation(value)?.viewport)
  const x = finite(viewport?.x)
  const y = finite(viewport?.y)
  const zoom = finite(viewport?.zoom)
  return x == null || y == null || zoom == null || zoom <= 0 ? undefined : { x, y, zoom }
}

export function savedViewport(value: Readonly<Record<string, JsonValue>>): DesignerViewport {
  return optionalViewport(value) ?? { x: 0, y: 0, zoom: 1 }
}

export function savedComments(
  value: Readonly<Record<string, JsonValue>>,
  positions: Readonly<Record<string, Point>>,
): Readonly<Record<string, DesignerComment>> {
  const comments = record(flowPresentation(value)?.comments) ?? {}
  return Object.fromEntries(
    Object.entries(comments).flatMap(([nodeId, candidate]) => {
      const comment = record(candidate)
      const title = typeof comment?.title == 'string' ? comment.title : undefined
      const content = typeof comment?.content == 'string' ? comment.content : undefined
      return title == null || content == null ? [] : [[nodeId, { content, position: positions[nodeId] ?? { x: 80, y: 80 }, title }]]
    }),
  )
}

function designerPresentation(value: Readonly<Record<string, JsonValue>>): Readonly<Record<string, JsonValue>> {
  const designer = record(value.designer)
  return designer?.version == 1 ? designer : { version: 1 }
}

function replaceFlowPresentation(
  designer: Readonly<Record<string, JsonValue>>,
  value: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, JsonValue>> {
  return { ...designer, flow: value, version: 1 }
}

function normalizedFlow(value: Readonly<Record<string, JsonValue>>): Record<string, JsonValue> {
  const normalized: Record<string, JsonValue> = {
    ...flowPresentation(value),
    viewport: { ...savedViewport(value) },
    nodes: savedPositions(value),
    order: savedOrder(value),
  }
  delete normalized.layouts
  return normalized
}

export function setNodePosition(value: Readonly<Record<string, JsonValue>>, nodeId: string, position: Point): Readonly<Record<string, JsonValue>> {
  return setNodePositions(value, { [nodeId]: position })
}

export function setNodePositions(value: Readonly<Record<string, JsonValue>>, positions: Readonly<Record<string, Point>>): Readonly<Record<string, JsonValue>> {
  const designer = designerPresentation(value)
  const current = normalizedFlow(value)
  const nodes = record(current.nodes) ?? {}
  const order = [...savedOrder(value)]
  for (const nodeId of Object.keys(positions)) {
    if (!order.includes(nodeId)) order.push(nodeId)
  }
  const nextNodes: Record<string, JsonValue> = {
    ...nodes,
    ...Object.fromEntries(Object.entries(positions).map(([nodeId, position]) => [nodeId, { x: position.x, y: position.y }])),
  }
  return {
    ...value,
    designer: replaceFlowPresentation(designer, { ...current, nodes: nextNodes, order }),
  }
}

export function setNodeContentHidden(value: Readonly<Record<string, JsonValue>>, nodeId: string, hidden: boolean): Readonly<Record<string, JsonValue>> {
  if ((record(flowPresentation(value)?.hiddenNodeContent)?.[nodeId] === true) === hidden) return value
  const current = normalizedFlow(value)
  const hiddenNodeContent = { ...record(current.hiddenNodeContent) }
  if (hidden) hiddenNodeContent[nodeId] = true
  else delete hiddenNodeContent[nodeId]
  return {
    ...value,
    designer: replaceFlowPresentation(designerPresentation(value), { ...current, hiddenNodeContent }),
  }
}

export function setComment(value: Readonly<Record<string, JsonValue>>, nodeId: string, comment: DesignerComment): Readonly<Record<string, JsonValue>> {
  const positioned = setNodePositions(value, { [nodeId]: comment.position })
  const designer = designerPresentation(positioned)
  const current = record(designer.flow) ?? {}
  const comments = record(current.comments) ?? {}
  return {
    ...positioned,
    designer: replaceFlowPresentation(designer, {
      ...current,
      comments: { ...comments, [nodeId]: { content: comment.content, title: comment.title } },
    }),
  }
}

export function removeComments(value: Readonly<Record<string, JsonValue>>, nodeIds: ReadonlySet<string>): Readonly<Record<string, JsonValue>> {
  const designer = designerPresentation(value)
  const current = normalizedFlow(value)
  const comments = { ...record(current.comments) }
  const nodes = { ...record(current.nodes) }
  for (const nodeId of nodeIds) {
    delete comments[nodeId]
    delete nodes[nodeId]
  }
  const order = savedOrder(value).filter((nodeId) => !nodeIds.has(nodeId))
  return {
    ...value,
    designer: replaceFlowPresentation(designer, { ...current, comments, nodes, order }),
  }
}

export function commentIds(value: Readonly<Record<string, JsonValue>>): ReadonlySet<string> {
  return new Set(Object.keys(record(flowPresentation(value)?.comments) ?? {}))
}

export function setFlowViewport(value: Readonly<Record<string, JsonValue>>, viewport: DesignerViewport): Readonly<Record<string, JsonValue>> {
  const currentViewport = optionalViewport(value)
  if (currentViewport?.x == viewport.x && currentViewport.y == viewport.y && currentViewport.zoom == viewport.zoom) return value
  const designer = designerPresentation(value)
  const current = normalizedFlow(value)
  return {
    ...value,
    designer: replaceFlowPresentation(designer, {
      ...current,
      viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
    }),
  }
}

/** Retain changed node presentation and layout direction; viewport navigation is never restored. */
export interface CanvasPresentationChange {
  readonly before: Readonly<Record<string, JsonValue>>
  readonly after: Readonly<Record<string, JsonValue>>
  readonly nodeIds: readonly string[]
  readonly directionChanged?: boolean
  readonly beforeOrder: readonly string[]
  readonly afterOrder: readonly string[]
}

const nodePresentationFields = ['nodes', 'comments', 'hiddenNodeContent', 'verticalNodeWidths'] as const

export function canvasPresentationChange(before: Readonly<Record<string, JsonValue>>, after: Readonly<Record<string, JsonValue>>): CanvasPresentationChange {
  const first = normalizedFlow(before)
  const last = normalizedFlow(after)
  const directionChanged = !dequal(first.direction, last.direction)
  const nodeIds = new Set<string>()
  for (const field of nodePresentationFields) {
    const previous = record(first[field]) ?? {}
    const next = record(last[field]) ?? {}
    for (const id of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      if (!dequal(previous[id], next[id])) nodeIds.add(id)
    }
  }
  const select = (value: Record<string, JsonValue>): Record<string, JsonValue> =>
    Object.fromEntries(
      nodePresentationFields.map((field) => [field, Object.fromEntries(Object.entries(record(value[field]) ?? {}).filter(([id]) => nodeIds.has(id)))]),
    )
  const snapshot = (value: Record<string, JsonValue>) => ({
    ...select(value),
    ...(directionChanged && value.direction !== undefined ? { direction: value.direction } : {}),
  })
  return {
    before: snapshot(first),
    after: snapshot(last),
    nodeIds: [...nodeIds],
    directionChanged,
    beforeOrder: savedOrder(before),
    afterOrder: savedOrder(after),
  }
}

export function restoreCanvasPresentation(
  value: Readonly<Record<string, JsonValue>>,
  change: CanvasPresentationChange,
  redo: boolean,
): Readonly<Record<string, JsonValue>> {
  if (change.nodeIds.length == 0 && !change.directionChanged) return value
  const current = normalizedFlow(value)
  const saved = redo ? change.after : change.before
  for (const field of nodePresentationFields) {
    const next = { ...record(current[field]) }
    const source = record(saved[field]) ?? {}
    for (const id of change.nodeIds) {
      if (source[id] == null) delete next[id]
      else next[id] = source[id]!
    }
    if (Object.keys(next).length > 0 || current[field] !== undefined) current[field] = next
  }
  if (change.directionChanged) {
    if (saved.direction === undefined) delete current.direction
    else current.direction = saved.direction
  }
  current.order = [...(redo ? change.afterOrder : change.beforeOrder)]
  return { ...value, designer: replaceFlowPresentation(designerPresentation(value), current) }
}

export function savedHiddenNodeContent(value: Readonly<Record<string, JsonValue>>) {
  return record(flowPresentation(value)?.hiddenNodeContent)
}

export function savedVerticalNodeWidths(value: Readonly<Record<string, JsonValue>>): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(record(flowPresentation(value)?.verticalNodeWidths) ?? {}).flatMap(([nodeId, candidate]) => {
      const width = finite(candidate)
      return width == null || width <= 0 ? [] : [[nodeId, width]]
    }),
  )
}

export function setVerticalNodeWidth(
  value: Readonly<Record<string, JsonValue>>,
  nodeId: string,
  width: number | undefined,
): Readonly<Record<string, JsonValue>> {
  if (width !== undefined && (!Number.isFinite(width) || width <= 0)) throw new RangeError('Node width must be a positive finite number.')
  if (savedVerticalNodeWidths(value)[nodeId] === width) return value
  const current = normalizedFlow(value)
  const verticalNodeWidths = { ...record(current.verticalNodeWidths) }
  if (width === undefined) delete verticalNodeWidths[nodeId]
  else verticalNodeWidths[nodeId] = width
  return { ...value, designer: replaceFlowPresentation(designerPresentation(value), { ...current, verticalNodeWidths }) }
}
