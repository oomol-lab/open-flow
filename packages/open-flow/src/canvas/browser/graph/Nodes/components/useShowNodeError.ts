import type { CommentNodeStore } from '../../../stores/node/commentNode.store.ts'

import { useVal } from 'use-value-enhancer'
import { NodeStore } from '../../../stores/node/node.store.ts'

export function useShowNodeError(nodeStore: NodeStore | CommentNodeStore): boolean {
  const hasError = useVal(NodeStore.to(nodeStore)?.$.hasError)

  return !!hasError
}
