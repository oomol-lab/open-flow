import type { NodeProps } from '@xyflow/react'
import type { RFNode } from '../../base/rfHelpers.ts'
import type { CommentNodeStore } from '../../stores/node/commentNode.store.ts'
import type { NodeStore } from '../../stores/node/node.store.ts'

import { memo } from 'react'
import { useCanvasStore } from '../CanvasStoreContext.tsx'
import { NodeLayout } from './components/NodeLayout.tsx'
import { useNodePlaceholder } from './useNodePlaceholder.ts'

export type BasicNodeProps = NodeProps<RFNode>

// React Flow renders this passthrough component frequently.
export function BasicNode({ type, data: { store: nodeStore } }: BasicNodeProps): React.ReactElement | null {
  if (type === 'default') {
    console.warn('designer: should not use default node type')
  }

  return nodeStore ? <VisibleNode nodeStore={nodeStore} /> : null
}

interface NodeStoreProps {
  readonly nodeStore: NodeStore | CommentNodeStore
}

const VisibleNode = /*#__PURE__*/ memo(function VisibleNode({ nodeStore }: NodeStoreProps) {
  const canvasStore = useCanvasStore()

  const visible = !useNodePlaceholder(canvasStore.$.viewport, nodeStore)

  return <NodeLayout canvasStore={canvasStore} nodeStore={nodeStore} visible={visible} />
})
