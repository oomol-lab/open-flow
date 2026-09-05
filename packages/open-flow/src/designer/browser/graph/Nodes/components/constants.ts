/* @unocss-include */

import type { NodeType } from '../../../stores/node/constants.ts'

import { NODE_TYPE } from '../../../stores/node/constants.ts'

export const defaultNodeIcon = 'i-carbon:hexagon-vertical-outline'
export const defaultConditionIcon = 'i-carbon:child-node'
export const defaultSubflowIcon = 'i-carbon:subflow'
export const defaultFlowIcon = 'i-carbon:flow-connection'
export const defaultTriggerIcon = 'i-codicon:symbol-event'

export const iconForNodeType = (nodeType: NodeType): string =>
  nodeType === NODE_TYPE.TaskNode
    ? 'i-carbon:code'
    : nodeType === NODE_TYPE.ConditionNode
      ? defaultConditionIcon
      : nodeType === NODE_TYPE.SubflowNode
        ? defaultSubflowIcon
        : nodeType === NODE_TYPE.TriggerNode
          ? defaultTriggerIcon
          : defaultNodeIcon
