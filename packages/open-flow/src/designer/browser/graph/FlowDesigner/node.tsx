import type { Val } from 'value-enhancer'
import type { NodeId } from '../../../../schema/index.ts'
import type { DesignerStore } from '../../stores/designer/designer.store.ts'
import type { FlowDesignerViewCommentNode, FlowDesignerViewNode, FlowDesignerViewPosition, FlowDesignerViewSemanticNode, ViewCallbacks } from './model.ts'
import type { NodeContent } from './nodeContent.ts'

import { attachSetter, val } from 'value-enhancer'
import { CommentNodeStore } from '../../stores/node/commentNode.store.ts'
import { NODE_TYPE } from '../../stores/node/constants.ts'
import { NodeStore } from '../../stores/node/node.store.ts'
import { nodeContent } from './nodeContent.ts'

interface SemanticNodeEntry {
  readonly contentKey: string
  readonly kind: Exclude<FlowDesignerViewNode['kind'], 'comment'>
  readonly store: NodeStore
  readonly content$: Val<NodeContent>
}

interface CommentNodeEntry {
  readonly contentKey: string
  readonly kind: 'comment'
  readonly setTitle: (title: string | undefined) => void
  readonly store: CommentNodeStore
}

export type NodeEntry = CommentNodeEntry | SemanticNodeEntry

export function createCommentNodeEntry(
  node: FlowDesignerViewCommentNode,
  contentKey: string,
  designerStore: DesignerStore,
  callbacks: ViewCallbacks,
): CommentNodeEntry {
  const store = new CommentNodeStore(node.id as NodeId, {
    title: node.title,
    content: node.content,
    position: node.position,
    duplicateNode: (offset) => designerStore.onDuplicate?.([node.id as NodeId], offset),
    onSaveContent: (content) => callbacks.onChangeComment?.(node.id, { content, title: store.$$.title.value ?? 'Comment' }),
  })
  const setTitle = store.$$.title.set
  attachSetter(store.$$.title, (title) => {
    const previous = store.$$.title.value
    setTitle(title)
    if (store.$$.title.value === previous) return
    callbacks.onChangeComment?.(node.id, {
      content: store.$$.content.value ?? '',
      title: title ?? 'Comment',
    })
  })
  const entry: CommentNodeEntry = {
    contentKey,
    kind: 'comment',
    setTitle,
    store,
  }
  return entry
}

export function updateCommentNodeEntry(entry: CommentNodeEntry, node: FlowDesignerViewCommentNode, contentKey: string): CommentNodeEntry {
  entry.store.$$.content.set(node.content)
  entry.setTitle(node.title)
  return { ...entry, contentKey }
}

export function createNodeEntry(node: FlowDesignerViewSemanticNode, contentKey: string, designerStore: DesignerStore): SemanticNodeEntry {
  const content$ = val<NodeContent>(nodeContent(node))
  const duplicateNode = (offset?: FlowDesignerViewPosition) => designerStore.onDuplicate?.([node.id as NodeId], offset)
  const types = {
    condition: NODE_TYPE.ConditionNode,
    subflow: NODE_TYPE.SubflowNode,
    task: NODE_TYPE.TaskNode,
    trigger: NODE_TYPE.TriggerNode,
    value: NODE_TYPE.ValueNode,
    wait: NODE_TYPE.TaskNode,
  } as const
  const store = new NodeStore(node.id as NodeId, types[node.kind], {
    content$,
    position: node.position,
    duplicateNode: node.kind == 'trigger' ? undefined : duplicateNode,
  })
  return {
    contentKey,
    kind: node.kind,
    store,
    content$,
  }
}

export function updateNodeEntry(entry: SemanticNodeEntry, node: FlowDesignerViewSemanticNode, contentKey: string): SemanticNodeEntry {
  entry.content$.set(nodeContent(node))
  return { ...entry, contentKey }
}
