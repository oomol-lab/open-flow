import type { ReactNode } from 'react'
import type { GroupDividerDef } from '../../../../schema/index.ts'

export interface FlowDesignerViewSource {
  readonly nodeId: string
  readonly output: string
}

export interface FlowDesignerViewInput {
  readonly defaultValue?: unknown
  readonly description?: string
  readonly handle: string
  readonly jsonSchema?: unknown
  readonly nullable?: boolean
  readonly sources?: readonly FlowDesignerViewSource[]
  readonly value?: unknown
}

export interface FlowDesignerViewOutput {
  readonly description?: string
  readonly handle: string
  readonly jsonSchema?: unknown
  readonly nullable?: boolean
}

export interface FlowDesignerViewValue extends FlowDesignerViewOutput {
  readonly value?: unknown
}

export type FlowDesignerViewConditionOperator =
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

export interface FlowDesignerViewConditionCase {
  readonly expressions: readonly {
    readonly input: string
    readonly operator: FlowDesignerViewConditionOperator
    readonly value?: unknown
  }[]
  readonly output: string
  readonly relation: 'all' | 'any'
}

export interface FlowDesignerViewNodeRun {
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

export interface FlowDesignerViewPosition {
  readonly x: number
  readonly y: number
}

export interface FlowDesignerViewViewport extends FlowDesignerViewPosition {
  readonly zoom: number
}

interface FlowDesignerViewNodeBase {
  readonly description?: string
  readonly diagnostics?: number
  readonly icon?: string
  readonly id: string
  readonly inputs: readonly (FlowDesignerViewInput | GroupDividerDef)[]
  readonly outputs: readonly (FlowDesignerViewOutput | GroupDividerDef)[]
  readonly position: FlowDesignerViewPosition
  readonly run?: FlowDesignerViewNodeRun
  readonly title: string
}

export interface FlowDesignerViewTaskNode extends FlowDesignerViewNodeBase {
  readonly tools?: readonly { readonly id: string; readonly icon: string; readonly label: string }[]
  readonly additionalInputs?: readonly FlowDesignerViewInput[]
  readonly executorName?: string
  readonly kind: 'task'
  readonly reference: string
}

export interface FlowDesignerViewSubflowNode extends FlowDesignerViewNodeBase {
  readonly kind: 'subflow'
  readonly reference: string
}

export interface FlowDesignerViewConditionNode extends FlowDesignerViewNodeBase {
  readonly cases: readonly FlowDesignerViewConditionCase[]
  readonly defaultOutput?: string
  readonly kind: 'condition'
}

export interface FlowDesignerViewValueNode extends FlowDesignerViewNodeBase {
  readonly kind: 'value'
  readonly values: readonly FlowDesignerViewValue[]
}

export type FlowDesignerViewTriggerSchedule =
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

export interface FlowDesignerViewTriggerPresentation {
  readonly kind: 'cron' | 'integration' | 'manual' | 'poll' | 'webhook'
  readonly schedules: readonly FlowDesignerViewTriggerSchedule[]
  readonly source?: string
}

export interface FlowDesignerViewTriggerNode extends FlowDesignerViewNodeBase {
  readonly kind: 'trigger'
  readonly presentation?: FlowDesignerViewTriggerPresentation
}

export interface FlowDesignerViewCommentNode {
  readonly content: string
  readonly id: string
  readonly kind: 'comment'
  readonly position: FlowDesignerViewPosition
  readonly title: string
}

export type FlowDesignerViewNode =
  | FlowDesignerViewCommentNode
  | FlowDesignerViewConditionNode
  | FlowDesignerViewSubflowNode
  | FlowDesignerViewTaskNode
  | FlowDesignerViewTriggerNode
  | FlowDesignerViewValueNode
  | (FlowDesignerViewNodeBase & {
      readonly kind: 'wait'
      readonly notice?: { readonly icon?: string; readonly text: string }
    })

export type FlowDesignerViewSemanticNode = Exclude<FlowDesignerViewNode, FlowDesignerViewCommentNode>

export interface FlowDesignerViewModel {
  readonly edges: readonly FlowDesignerViewEdge[]
  readonly nodes: readonly FlowDesignerViewNode[]
  readonly runStatus?: 'idle' | 'running'
  readonly viewport: FlowDesignerViewViewport
}

export interface FlowDesignerViewAddItem {
  readonly choices?: readonly {
    readonly description?: string
    readonly id: string
    readonly inputs?: readonly FlowDesignerViewAddPort[]
    readonly label: string
    readonly outputs?: readonly FlowDesignerViewAddPort[]
  }[]
  readonly description?: string
  readonly disabled?: boolean
  readonly group?: string
  readonly icon?: string
  readonly id: string
  readonly inputs: readonly FlowDesignerViewAddPort[]
  readonly label: string
  readonly outputs: readonly FlowDesignerViewAddPort[]
  readonly type: 'block' | 'comment' | 'condition' | 'connector' | 'llm' | 'scriptlet' | 'trigger' | 'value' | 'wait'
}

export interface FlowDesignerViewAddPort {
  readonly description?: string
  readonly handle: string
  readonly jsonSchema?: unknown
}

export interface FlowDesignerViewEdge {
  readonly id: string
  readonly source: string
  readonly sourceHandle: string
  readonly target: string
  readonly targetHandle: string
}

export interface FlowDesignerViewProps {
  readonly ignoredNodeIds: readonly string[]
  readonly onIgnoreNodes: (nodeIds: readonly string[], ignored: boolean) => void
  readonly cornerTools?: ReactNode
  readonly toolbar?: ReactNode
  readonly addNodeRequest?: {
    readonly onComplete?: () => void
    readonly position: FlowDesignerViewPosition
    readonly screenPosition?: FlowDesignerViewPosition
  }
  readonly addItemRequest?: {
    readonly itemId: string
    readonly onComplete?: (nodeId: string | undefined) => void
    readonly position: FlowDesignerViewPosition
    readonly screenPosition?: FlowDesignerViewPosition
  }
  readonly addItems: readonly FlowDesignerViewAddItem[]
  readonly autoLayout?: boolean
  readonly className?: string
  readonly dark?: boolean
  readonly editable: boolean
  readonly focusNodeRequest?: {
    readonly nodeId: string
    readonly requestId: number
  }
  readonly identity: string
  readonly isValidConnection?: (edge: Omit<FlowDesignerViewEdge, 'id'>) => boolean
  readonly language?: string
  readonly layoutMotion?: boolean
  readonly model: FlowDesignerViewModel
  readonly onAddNode: (
    itemId: string,
    position: FlowDesignerViewPosition,
    connection?: (nodeId: string) => Omit<FlowDesignerViewEdge, 'id'>,
  ) => Promise<string | undefined> | string | undefined
  readonly onConnect: (edge: Omit<FlowDesignerViewEdge, 'id'>) => void
  readonly onChangeComment?: (nodeId: string, value: { readonly content: string; readonly title: string }) => void
  readonly onDeleteNodes: (nodeIds: readonly string[]) => void
  readonly onDisconnect: (edge: FlowDesignerViewEdge) => void
  readonly onDuplicate: (nodeIds: readonly string[], offset?: FlowDesignerViewPosition, positions?: Readonly<Record<string, FlowDesignerViewPosition>>) => void
  readonly onMoveNodes: (positions: Readonly<Record<string, FlowDesignerViewPosition>>) => void
  readonly onMoveViewport: (viewport: FlowDesignerViewViewport) => void
  readonly onPaste: (position: FlowDesignerViewPosition) => void
  readonly onSelectionChange: (nodeIds: readonly string[], edge: FlowDesignerViewEdge | undefined) => void
  readonly provideAddItems?: (searchTerm: string, signal: AbortSignal) => Promise<readonly FlowDesignerViewAddItem[] | undefined>
  readonly selectedNodeIds: readonly string[]
}

export interface ViewCallbacks {
  readonly onIgnoreNodes: FlowDesignerViewProps['onIgnoreNodes']
  readonly onMoveNodes: FlowDesignerViewProps['onMoveNodes']
  readonly onAddNode: FlowDesignerViewProps['onAddNode']
  readonly onConnect: FlowDesignerViewProps['onConnect']
  readonly onChangeComment: FlowDesignerViewProps['onChangeComment']
  readonly onDeleteNodes: FlowDesignerViewProps['onDeleteNodes']
  readonly onDisconnect: FlowDesignerViewProps['onDisconnect']
  readonly onDuplicate: FlowDesignerViewProps['onDuplicate']
  readonly onPaste: FlowDesignerViewProps['onPaste']
  readonly provideAddItems: FlowDesignerViewProps['provideAddItems']
}

export function toViewEdge(source: string, sourceHandle: string, target: string, targetHandle: string): FlowDesignerViewEdge {
  return {
    id: JSON.stringify([source, sourceHandle, target, targetHandle]),
    source,
    sourceHandle,
    target,
    targetHandle,
  }
}
