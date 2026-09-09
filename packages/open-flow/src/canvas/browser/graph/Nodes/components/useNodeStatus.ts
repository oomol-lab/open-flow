import type { ReadonlyVal } from 'value-enhancer'
import type { FlowRunStatus } from '../../../stores/canvas/typings.ts'
import type { NodeStatus } from '../../../stores/node/constants.ts'

import { useVal } from 'use-value-enhancer'
import { FLOW_RUN_STATUS } from '../../../stores/canvas/typings.ts'
import { NODE_STATUS } from '../../../stores/node/constants.ts'

export interface NodeStatusState {
  status: NodeStatus
  count: number
}

function isNodeRunningOrWaiting(nodeStatus: NodeStatus): boolean {
  return nodeStatus === NODE_STATUS.Running || nodeStatus === NODE_STATUS.Waiting
}

export function useNodeStatus(nodeStatus: NodeStatus, flowStatus$: ReadonlyVal<FlowRunStatus>, successCount = 0): NodeStatusState {
  const flowStatus = useVal(flowStatus$)

  // A node returns to a stable state when its Flow stops.
  if (flowStatus === FLOW_RUN_STATUS.Idle && isNodeRunningOrWaiting(nodeStatus)) {
    return { status: NODE_STATUS.Idle, count: 0 }
  }

  // Otherwise preserve the node's own state.
  return {
    status: nodeStatus,
    count: nodeStatus === NODE_STATUS.Success ? Math.max(successCount, 1) : nodeStatus === NODE_STATUS.Error ? 1 : 0,
  }
}
