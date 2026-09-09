import type { CommentNodeStore } from '../../stores/node/commentNode.store.ts'
import type { NodeType } from '../../stores/node/constants.ts'
import type { NodeStore } from '../../stores/node/node.store.ts'

import { createContext, useContext } from 'react'

export const NodeStoreContext: React.Context<NodeStore | CommentNodeStore | null> = createContext<NodeStore | CommentNodeStore | null>(null)

export const useNodeStore = (): NodeStore | CommentNodeStore => {
  const context = useContext(NodeStoreContext)
  if (!context) {
    throw new Error('NodeContext not found')
  }
  return context
}

export const useNodeType = (): NodeType => {
  return useNodeStore().nodeType
}
