import type { NodeType } from '../../../stores/node/constants.ts'
import type { FlowCanvasViewNode } from '../../FlowCanvas/model.ts'

import { ContentIcon } from '../../../../../ui/browser/icons/ContentIcon.tsx'
import { NODE_TYPE } from '../../../stores/node/constants.ts'
import { iconForNodeType } from './constants.ts'

export type CanvasNodeIconData = {
  readonly kind: FlowCanvasViewNode['kind']
  readonly icon?: string
}

function nodeTypeForKind(kind: CanvasNodeIconData['kind']): NodeType {
  switch (kind) {
    case 'task':
      return NODE_TYPE.TaskNode
    case 'condition':
      return NODE_TYPE.ConditionNode
    case 'subflow':
      return NODE_TYPE.SubflowNode
    case 'trigger':
      return NODE_TYPE.TriggerNode
    case 'comment':
      return NODE_TYPE.CommentNode
    default:
      return NODE_TYPE.ValueNode
  }
}

export function CanvasNodeIcon({ kind, icon, nodeType, className }: CanvasNodeIconData & { readonly nodeType?: NodeType; readonly className?: string }) {
  const src = icon ?? (kind == 'wait' ? ':carbon:hourglass:' : kind == 'approval' ? ':carbon:stamp:' : undefined)
  return <ContentIcon src={src} className={className} fallback={<i aria-hidden="true" className={iconForNodeType(nodeType ?? nodeTypeForKind(kind))} />} />
}
