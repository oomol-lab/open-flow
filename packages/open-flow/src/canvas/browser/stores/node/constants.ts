export type NodeType = `${NODE_TYPE}`
export enum NODE_TYPE {
  TaskNode = 'task_node',
  ValueNode = 'value_node',
  ConditionNode = 'condition_node',
  CommentNode = 'comment_node',
  TriggerNode = 'trigger_node',
}

export type NodeStatus = `${NODE_STATUS}`
export enum NODE_STATUS {
  Idle = 'idle',
  Waiting = 'waiting',
  Running = 'running',
  Success = 'success',
  Error = 'error',
}

export const FITTING_VIEW_CLASSNAME = 'open-flow-canvas-fitting-view'
