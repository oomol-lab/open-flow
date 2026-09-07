import type { EdgeTypes, NodeTypes } from '@xyflow/react'

import { NODE_TYPE } from '../stores/node/constants.ts'
import { BasicEdge } from './Edges/BasicEdge.tsx'
import { BasicNode } from './Nodes/BasicNode.tsx'
import { CommentNode } from './Nodes/CommentNode.tsx'
import { ConditionNode } from './Nodes/ConditionNode.tsx'
import { ErrorNode } from './Nodes/ErrorNode.tsx'
import { InputNode } from './Nodes/InputNode.tsx'
import { OutputNode } from './Nodes/OutputNode.tsx'
import { SubflowNode } from './Nodes/SubflowNode.tsx'
import { ValueNode } from './Nodes/ValueNode.tsx'

export const NODE_TYPES: NodeTypes = {
  default: BasicNode,
  [NODE_TYPE.TaskNode]: BasicNode,
  [NODE_TYPE.ValueNode]: ValueNode,
  [NODE_TYPE.InputNode]: InputNode,
  [NODE_TYPE.OutputNode]: OutputNode,
  [NODE_TYPE.ErrorNode]: ErrorNode,
  [NODE_TYPE.SubflowNode]: SubflowNode,
  [NODE_TYPE.ConditionNode]: ConditionNode,
  [NODE_TYPE.CommentNode]: CommentNode,
  [NODE_TYPE.TriggerNode]: BasicNode,
}

export const EDGE_TYPES: EdgeTypes = {
  default: BasicEdge,
}
