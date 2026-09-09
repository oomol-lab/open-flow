import type { EdgeTypes, NodeTypes } from '@xyflow/react'

import { NODE_TYPE } from '../stores/node/constants.ts'
import { BasicEdge } from './Edges/BasicEdge.tsx'
import { BasicNode } from './Nodes/BasicNode.tsx'

export const NODE_TYPES: NodeTypes = {
  default: BasicNode,
  [NODE_TYPE.TaskNode]: BasicNode,
  [NODE_TYPE.ValueNode]: BasicNode,
  [NODE_TYPE.SubflowNode]: BasicNode,
  [NODE_TYPE.ConditionNode]: BasicNode,
  [NODE_TYPE.CommentNode]: BasicNode,
  [NODE_TYPE.TriggerNode]: BasicNode,
}

export const EDGE_TYPES: EdgeTypes = {
  default: BasicEdge,
}
