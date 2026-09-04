import type { GroupDividerDef } from '../../../../schema/index.ts'
import type { FlowDisplayMode } from '../../../common/flowDisplay.ts'
import type { CreateSchemaEditorFn } from '../../services/designerService.ts'
import type { DesignerUILayout } from '../../stores/designer/designerUI.store.ts'

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
  readonly variable?: string
  readonly variableCompatible?: boolean
  readonly variableEnabled?: boolean
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

export interface FlowDesignerViewConditionChange {
  readonly cases: readonly FlowDesignerViewConditionCase[]
  readonly defaultOutput?: string
  readonly input: FlowDesignerViewInput
}

export interface FlowDesignerViewNodeRun {
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
  readonly concurrency?: number
  readonly description?: string
  readonly diagnostics?: number
  readonly icon?: string
  readonly id: string
  readonly inputs: readonly (FlowDesignerViewInput | GroupDividerDef)[]
  readonly outputs: readonly (FlowDesignerViewOutput | GroupDividerDef)[]
  readonly position: FlowDesignerViewPosition
  readonly rawIcon?: string
  readonly rawTitle?: string
  readonly run?: FlowDesignerViewNodeRun
  readonly timeoutSeconds?: number
  readonly title: string
}

export interface FlowDesignerViewTaskNode extends FlowDesignerViewNodeBase {
  readonly additionalInputs?: readonly FlowDesignerViewInput[]
  readonly editableAdditionalInputs?: boolean
  readonly editablePorts?: boolean
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

interface FlowDesignerViewTriggerFieldBase {
  readonly description?: string
  readonly invalid?: boolean
  readonly label: string
  readonly name: string
  readonly required: boolean
  readonly source: string
}

export type FlowDesignerViewTriggerField =
  | (FlowDesignerViewTriggerFieldBase & {
      readonly kind: 'boolean' | 'integer' | 'number' | 'string'
    })
  | (FlowDesignerViewTriggerFieldBase & { readonly kind: 'json' })
  | (FlowDesignerViewTriggerFieldBase & {
      readonly kind: 'multi-select'
      readonly options: readonly {
        readonly label: string
        readonly source: string
        readonly value: unknown
      }[]
      readonly selected: readonly string[]
    })
  | (FlowDesignerViewTriggerFieldBase & {
      readonly kind: 'select'
      readonly options: readonly {
        readonly label: string
        readonly source: string
        readonly value: unknown
      }[]
    })

export interface FlowDesignerViewTriggerPresentation {
  readonly config?: readonly FlowDesignerViewTriggerField[]
  readonly kind: 'cron' | 'integration' | 'poll' | 'webhook'
  readonly schedules: readonly FlowDesignerViewTriggerSchedule[]
  readonly source?: string
  readonly webhook?: {
    readonly inputs: readonly FlowDesignerViewWebhookInput[]
    readonly options: FlowDesignerViewWebhookOptions
  }
}

export interface FlowDesignerViewWebhookInput {
  readonly description?: string
  readonly handle: string
  readonly jsonSchema?: unknown
  readonly nullable: boolean
  readonly value?: unknown
}

export interface FlowDesignerViewWebhookOptions {
  readonly allowedMethods?: readonly string[]
  readonly allowedOrigins?: readonly string[]
  readonly noResponseBody?: boolean
  readonly responseData?: string
  readonly responseHeaders?: Readonly<Record<string, string>>
  readonly responseStatusCode?: number
}

export interface FlowDesignerViewWebhook {
  readonly inputs: readonly FlowDesignerViewWebhookInput[]
  readonly options: FlowDesignerViewWebhookOptions
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
  readonly layouts?: Partial<Record<FlowDisplayMode, DesignerUILayout>>
  readonly nodes: readonly FlowDesignerViewNode[]
  readonly runStatus?: 'idle' | 'running'
  readonly viewport: FlowDesignerViewViewport
  readonly variableNames?: readonly string[]
  readonly variableNamesLoaded?: boolean
  readonly variableNamesLoading?: boolean
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
  readonly createSchemaEditor: CreateSchemaEditorFn
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
  readonly onChangeCondition?: (nodeId: string, value: FlowDesignerViewConditionChange) => void
  readonly onChangeNodeDescription?: (nodeId: string, description: string | undefined) => void
  readonly onChangeNodeIcon?: (nodeId: string, icon: string | undefined) => void
  readonly onChangeNodeTitle?: (nodeId: string, title: string | undefined) => void
  readonly onChangeInput?: (nodeId: string, handle: string, value: unknown) => void
  readonly onChangeInputVariable?: (nodeId: string, handle: string, name: string | undefined) => void
  readonly onChangeTaskAdditionalInputs?: (nodeId: string, inputs: readonly FlowDesignerViewInput[]) => void
  readonly onChangeTaskPorts?: (
    nodeId: string,
    inputs: readonly (FlowDesignerViewInput | GroupDividerDef)[],
    outputs: readonly (FlowDesignerViewOutput | GroupDividerDef)[],
  ) => void
  readonly onChangeTriggerConfig?: (triggerId: string, name: string, value: unknown | undefined) => void
  readonly onChangeTriggerSchedule?: (triggerId: string, schedule: readonly FlowDesignerViewTriggerSchedule[]) => void
  readonly onChangeWebhook?: (triggerId: string, webhook: FlowDesignerViewWebhook) => void
  readonly onChangeValue?: (nodeId: string, values: readonly FlowDesignerViewValue[]) => void
  readonly onDeleteNodes: (nodeIds: readonly string[]) => void
  readonly onDisconnect: (edge: FlowDesignerViewEdge) => void
  readonly onDuplicate: (nodeIds: readonly string[], offset?: FlowDesignerViewPosition, positions?: Readonly<Record<string, FlowDesignerViewPosition>>) => void
  readonly onMoveNodes: (positions: Readonly<Record<string, FlowDesignerViewPosition>>) => void
  readonly onMoveViewport: (viewport: FlowDesignerViewViewport, displayMode: FlowDisplayMode) => void
  readonly onPaste: (position: FlowDesignerViewPosition) => void
  readonly onSelectionChange: (nodeIds: readonly string[], edge: FlowDesignerViewEdge | undefined) => void
  readonly provideAddItems?: (searchTerm: string, signal: AbortSignal) => Promise<readonly FlowDesignerViewAddItem[] | undefined>
  readonly onOpenVariables?: () => void
  readonly selectedNodeIds: readonly string[]
}

export interface ViewCallbacks {
  readonly onAddNode: FlowDesignerViewProps['onAddNode']
  readonly onConnect: FlowDesignerViewProps['onConnect']
  readonly onChangeComment: FlowDesignerViewProps['onChangeComment']
  readonly onChangeCondition: FlowDesignerViewProps['onChangeCondition']
  readonly onChangeNodeDescription: FlowDesignerViewProps['onChangeNodeDescription']
  readonly onChangeNodeIcon: FlowDesignerViewProps['onChangeNodeIcon']
  readonly onChangeNodeTitle: FlowDesignerViewProps['onChangeNodeTitle']
  readonly onChangeInput: FlowDesignerViewProps['onChangeInput']
  readonly onChangeInputVariable: FlowDesignerViewProps['onChangeInputVariable']
  readonly onChangeTaskAdditionalInputs: FlowDesignerViewProps['onChangeTaskAdditionalInputs']
  readonly onChangeTaskPorts: FlowDesignerViewProps['onChangeTaskPorts']
  readonly onChangeTriggerConfig: FlowDesignerViewProps['onChangeTriggerConfig']
  readonly onChangeTriggerSchedule: FlowDesignerViewProps['onChangeTriggerSchedule']
  readonly onChangeWebhook: FlowDesignerViewProps['onChangeWebhook']
  readonly onChangeValue: FlowDesignerViewProps['onChangeValue']
  readonly onDeleteNodes: FlowDesignerViewProps['onDeleteNodes']
  readonly onDisconnect: FlowDesignerViewProps['onDisconnect']
  readonly onDuplicate: FlowDesignerViewProps['onDuplicate']
  readonly onPaste: FlowDesignerViewProps['onPaste']
  readonly provideAddItems: FlowDesignerViewProps['provideAddItems']
  readonly onOpenVariables: FlowDesignerViewProps['onOpenVariables']
}
