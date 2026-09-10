import type { ReactNode } from 'react'
import type { GroupDividerDef } from '../../../../schema/index.ts'

export interface FlowCanvasViewSource {
  readonly nodeId: string
  readonly output: string
}

export interface FlowCanvasViewInput {
  readonly defaultValue?: unknown
  readonly description?: string
  readonly handle: string
  readonly jsonSchema?: unknown
  readonly nullable?: boolean
  readonly sources?: readonly FlowCanvasViewSource[]
  readonly value?: unknown
}

export interface FlowCanvasViewOutput {
  readonly description?: string
  readonly handle: string
  readonly jsonSchema?: unknown
  readonly nullable?: boolean
}

export interface FlowCanvasViewValue extends FlowCanvasViewOutput {
  readonly value?: unknown
}

export type FlowCanvasViewConditionOperator =
  | '!='
  | '<'
  | '<='
  | '=='
  | '>'
  | '>='
  | 'contains'
  | 'ends with'
  | 'has key'
  | 'has value'
  | 'is empty'
  | 'is false'
  | 'is not empty'
  | 'is not null'
  | 'is null'
  | 'is true'
  | 'not contains'
  | 'not has key'
  | 'not has value'
  | 'starts with'

export interface FlowCanvasViewConditionCase {
  readonly expressions: readonly {
    readonly input: string
    readonly operator: FlowCanvasViewConditionOperator
    readonly value?: unknown
  }[]
  readonly output: string
  readonly relation: 'all' | 'any'
}

export interface FlowCanvasViewNodeRun {
  readonly runId?: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly outputs?: unknown
  readonly error?: unknown
  readonly logs?: readonly { readonly message: string; readonly level: string; readonly time: string }[]
  readonly artifacts?: readonly unknown[]
  readonly progress?: number
  readonly status: 'error' | 'idle' | 'running' | 'success' | 'waiting'
  readonly successCount?: number
}

export interface FlowCanvasViewPosition {
  readonly x: number
  readonly y: number
}

export interface FlowCanvasViewViewport extends FlowCanvasViewPosition {
  readonly zoom: number
}

interface FlowCanvasViewNodeBase {
  readonly contentHidden?: boolean
  readonly description?: string
  readonly diagnostics?: number
  readonly icon?: string
  readonly id: string
  readonly inputs: readonly (FlowCanvasViewInput | GroupDividerDef)[]
  readonly outputs: readonly (FlowCanvasViewOutput | GroupDividerDef)[]
  readonly position: FlowCanvasViewPosition
  readonly run?: FlowCanvasViewNodeRun
  readonly title: string
}

export interface FlowCanvasViewTaskNode extends FlowCanvasViewNodeBase {
  readonly tools?: readonly { readonly id: string; readonly icon: string; readonly label: string }[]
  readonly additionalInputs?: readonly FlowCanvasViewInput[]
  readonly executorName?: string
  readonly kind: 'task'
  readonly reference: string
}

export interface FlowCanvasViewSubflowNode extends FlowCanvasViewNodeBase {
  readonly kind: 'subflow'
  readonly reference: string
}

export interface FlowCanvasViewConditionNode extends FlowCanvasViewNodeBase {
  readonly cases: readonly FlowCanvasViewConditionCase[]
  readonly defaultOutput?: string
  readonly kind: 'condition'
}

export interface FlowCanvasViewValueNode extends FlowCanvasViewNodeBase {
  readonly kind: 'value'
  readonly values: readonly FlowCanvasViewValue[]
}

export type FlowCanvasViewTriggerSchedule =
  | {
      readonly expression: string
      readonly timezone: string
      readonly type: 'cron'
    }
  | {
      readonly type: 'every'
      readonly unit: 'day' | 'hour' | 'minute' | 'month' | 'week'
      readonly value: number
    }

export interface FlowCanvasViewTriggerPresentation {
  readonly kind: 'cron' | 'integration' | 'manual' | 'poll' | 'webhook'
  readonly schedules: readonly FlowCanvasViewTriggerSchedule[]
  readonly source?: string
}

export interface FlowCanvasViewTriggerNode extends FlowCanvasViewNodeBase {
  readonly kind: 'trigger'
  readonly presentation?: FlowCanvasViewTriggerPresentation
}

export interface FlowCanvasViewCommentNode {
  readonly contentHidden?: boolean
  readonly content: string
  readonly id: string
  readonly kind: 'comment'
  readonly position: FlowCanvasViewPosition
  readonly title: string
}

export type FlowCanvasViewNode =
  | FlowCanvasViewCommentNode
  | FlowCanvasViewConditionNode
  | FlowCanvasViewSubflowNode
  | FlowCanvasViewTaskNode
  | FlowCanvasViewTriggerNode
  | FlowCanvasViewValueNode
  | (FlowCanvasViewNodeBase & {
      readonly kind: 'wait'
      readonly notice?: { readonly icon?: string; readonly text: string }
    })

export type FlowCanvasViewSemanticNode = Exclude<FlowCanvasViewNode, FlowCanvasViewCommentNode>

export interface FlowCanvasViewModel {
  readonly edges: readonly FlowCanvasViewEdge[]
  readonly nodes: readonly FlowCanvasViewNode[]
  readonly runStatus?: 'idle' | 'running'
  readonly viewport: FlowCanvasViewViewport
}

export interface FlowCanvasViewAddItem {
  readonly choices?: readonly {
    readonly description?: string
    readonly id: string
    readonly inputs?: readonly FlowCanvasViewAddPort[]
    readonly label: string
    readonly outputs?: readonly FlowCanvasViewAddPort[]
  }[]
  readonly description?: string
  readonly disabled?: boolean
  readonly group?: string
  readonly icon?: string
  readonly id: string
  readonly inputs: readonly FlowCanvasViewAddPort[]
  readonly label: string
  readonly outputs: readonly FlowCanvasViewAddPort[]
  readonly type: 'block' | 'comment' | 'condition' | 'connector' | 'llm' | 'scriptlet' | 'trigger' | 'value' | 'wait'
}

export interface FlowCanvasViewAddPort {
  readonly description?: string
  readonly handle: string
  readonly jsonSchema?: unknown
}

export interface FlowCanvasViewEdge {
  readonly id: string
  readonly source: string
  readonly sourceHandle: string
  readonly target: string
  readonly targetHandle: string
}

export interface FlowCanvasViewProps {
  readonly ignoredNodeIds: readonly string[]
  readonly onIgnoreNodes: (nodeIds: readonly string[], ignored: boolean) => void
  readonly cornerTools?: ReactNode
  readonly toolbar?: ReactNode
  readonly addNodeRequest?: {
    readonly onComplete?: () => void
    readonly position: FlowCanvasViewPosition
    readonly screenPosition?: FlowCanvasViewPosition
  }
  readonly addItemRequest?: {
    readonly itemId: string
    readonly onComplete?: (nodeId: string | undefined) => void
    readonly position: FlowCanvasViewPosition
    readonly screenPosition?: FlowCanvasViewPosition
  }
  readonly addItems: readonly FlowCanvasViewAddItem[]
  readonly autoLayout?: boolean
  readonly className?: string
  readonly dark?: boolean
  readonly editable: boolean
  readonly focusNodeRequest?: {
    readonly nodeId: string
    readonly requestId: number
  }
  readonly identity: string
  readonly isValidConnection?: (edge: Omit<FlowCanvasViewEdge, 'id'>) => boolean
  readonly language?: string
  readonly layoutMotion?: boolean
  readonly model: FlowCanvasViewModel
  readonly onAddNode: (
    itemId: string,
    position: FlowCanvasViewPosition,
    connection?: (nodeId: string) => Omit<FlowCanvasViewEdge, 'id'>,
  ) => Promise<string | undefined> | string | undefined
  readonly onConnect: (edge: Omit<FlowCanvasViewEdge, 'id'>) => void
  readonly onChangeNodeContentHidden?: (nodeId: string, hidden: boolean) => void
  readonly onChangeComment?: (nodeId: string, value: { readonly content: string; readonly title: string }) => void
  readonly onDeleteNodes: (nodeIds: readonly string[]) => void
  readonly onDisconnect: (edge: FlowCanvasViewEdge) => void
  readonly onDuplicate: (nodeIds: readonly string[], offset?: FlowCanvasViewPosition, positions?: Readonly<Record<string, FlowCanvasViewPosition>>) => void
  readonly onMoveNodes: (positions: Readonly<Record<string, FlowCanvasViewPosition>>) => void
  readonly onMoveViewport: (viewport: FlowCanvasViewViewport) => void
  readonly onPaste: (position: FlowCanvasViewPosition) => void
  readonly onSelectionChange: (nodeIds: readonly string[], edge: FlowCanvasViewEdge | undefined) => void
  readonly provideAddItems?: (searchTerm: string, signal: AbortSignal) => Promise<readonly FlowCanvasViewAddItem[] | undefined>
  readonly selectedNodeIds: readonly string[]
}

export interface ViewCallbacks {
  readonly onIgnoreNodes: FlowCanvasViewProps['onIgnoreNodes']
  readonly onMoveNodes: FlowCanvasViewProps['onMoveNodes']
  readonly onAddNode: FlowCanvasViewProps['onAddNode']
  readonly onConnect: FlowCanvasViewProps['onConnect']
  readonly onChangeNodeContentHidden?: FlowCanvasViewProps['onChangeNodeContentHidden']
  readonly onChangeComment: FlowCanvasViewProps['onChangeComment']
  readonly onDeleteNodes: FlowCanvasViewProps['onDeleteNodes']
  readonly onDisconnect: FlowCanvasViewProps['onDisconnect']
  readonly onDuplicate: FlowCanvasViewProps['onDuplicate']
  readonly onPaste: FlowCanvasViewProps['onPaste']
  readonly provideAddItems: FlowCanvasViewProps['provideAddItems']
}

export function toViewEdge(source: string, sourceHandle: string, target: string, targetHandle: string): FlowCanvasViewEdge {
  return {
    id: JSON.stringify([source, sourceHandle, target, targetHandle]),
    source,
    sourceHandle,
    target,
    targetHandle,
  }
}
