import type { KeyboardEvent, PointerEvent, ReactElement } from 'react'
import type {
  FlowDesignerViewConditionChange,
  FlowDesignerViewInput,
  FlowDesignerViewAddItem,
  FlowDesignerViewEdge,
  FlowDesignerViewOutput,
  FlowDesignerViewTriggerSchedule,
  FlowDesignerViewValue,
  FlowDesignerViewWebhook,
} from '../../../../designer/browser/graph/FlowDesigner/FlowDesignerView.tsx'
import type { FlowDisplayMode } from '../../../../designer/common/flowDisplay.ts'
import type { ConditionOperator, JsonValue } from '../api.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { DesignerEdge, DesignerGraph, DesignerViewport, Point } from '../workspace.ts'
import type { AddNodeOption } from './addNodeOptions.ts'
import type { ConditionSettings, DesignerTarget } from './flowChanges.ts'
import type { WebhookSettings } from './flowChanges.ts'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useLang, useTranslate } from 'val-i18n-react'
import { FlowDesignerView } from '../../../../designer/browser/graph/FlowDesigner/FlowDesignerView.tsx'
import { compareJSONSchema } from '../../../../manifest/common/schemaCompare.ts'
import { Badge } from '../../../../ui/browser/badge.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Icon } from '../icons.tsx'
import { indexAddNodeOptions } from './addNodeOptions.ts'

interface Props {
  readonly addNodeOptions: readonly AddNodeOption[]
  readonly blocksOpen: boolean
  readonly disabled: boolean
  readonly theme: WorkbenchTheme
  readonly focusNodeRequest?: { readonly nodeId: string; readonly requestId: number }
  readonly inspectorOpen: boolean
  readonly model: DesignerGraph
  readonly onAddNode: (option: AddNodeOption, position: Point, connection?: (nodeId: string) => Omit<DesignerEdge, 'id'>) => Promise<string | undefined>
  readonly onConnect: (edge: Omit<DesignerEdge, 'id'>) => void
  readonly onChangeComment: (nodeId: string, value: { readonly content: string; readonly title: string }) => void
  readonly onChangeCondition: (nodeId: string, value: ConditionSettings) => void
  readonly onChangeNodeDescription: (nodeId: string, description: string | undefined) => void
  readonly onChangeNodeIcon: (nodeId: string, icon: string | undefined) => void
  readonly onChangeNodeTitle: (nodeId: string, title: string | undefined) => void
  readonly onChangeInput: (nodeId: string, handle: string, value: JsonValue | undefined) => void
  readonly onChangeTaskPorts: (nodeId: string, inputs: readonly FlowDesignerViewInput[], outputs: readonly FlowDesignerViewOutput[]) => void
  readonly onChangeTriggerConfig: (triggerId: string, name: string, value: JsonValue | undefined) => void
  readonly onChangeTriggerSchedule: (triggerId: string, schedule: readonly FlowDesignerViewTriggerSchedule[]) => void
  readonly onChangeWebhook: (triggerId: string, webhook: WebhookSettings) => void
  readonly onChangeValue: (nodeId: string, values: readonly FlowDesignerViewValue[]) => void
  readonly onCopy: () => void
  readonly onDeleteEdge: (edge: DesignerEdge) => void
  readonly onDeleteNodes: () => void
  readonly onDuplicate: (positions?: Readonly<Record<string, Point>>) => void
  readonly onMoveNodes: (positions: Readonly<Record<string, Point>>, displayMode: FlowDisplayMode) => void
  readonly onMoveViewport: (viewport: DesignerViewport, displayMode: FlowDisplayMode) => void
  readonly onOpenBlocks: (opener?: HTMLButtonElement) => void
  readonly onOpenInspector: () => void
  readonly onPaste: () => void
  readonly provideAddNodeOptions: (searchTerm: string, signal: AbortSignal) => Promise<readonly AddNodeOption[] | undefined>
  readonly onSelectNodes: (nodeIds: readonly string[]) => void
  readonly onToggleInspector: (opener: HTMLButtonElement) => void
  readonly selectedNodeIds: readonly string[]
  readonly target: DesignerTarget | undefined
}

export interface WorkbenchDesignerHandle {
  readonly focusCanvas: () => void
  readonly registerAddNodeOption: (option: AddNodeOption) => void
}

const browseProviderTriggersId = 'workbench:browse-provider-triggers'

function conditionOperator(operator: FlowDesignerViewConditionChange['cases'][number]['expressions'][number]['operator']): ConditionOperator {
  switch (operator) {
    case 'ends with':
      return 'endsWith'
    case 'has key':
      return 'hasKey'
    case 'has value':
      return 'hasValue'
    case 'is empty':
      return 'isEmpty'
    case 'is false':
      return 'isFalse'
    case 'is not empty':
      return 'isNotEmpty'
    case 'is not null':
      return 'isNotNull'
    case 'is null':
      return 'isNull'
    case 'is true':
      return 'isTrue'
    case 'not contains':
      return 'notContains'
    case 'not has key':
      return 'notHasKey'
    case 'not has value':
      return 'notHasValue'
    case 'starts with':
      return 'startsWith'
    case '!=':
    case '<':
    case '<=':
    case '==':
    case '>':
    case '>=':
    case 'contains':
      return operator
  }
}

function conditionSettings(value: FlowDesignerViewConditionChange): ConditionSettings {
  return {
    cases: value.cases.map((item) => ({
      expressions: item.expressions.map((expression) =>
        Object.assign(
          { input: expression.input, operator: conditionOperator(expression.operator) },
          expression.value === undefined ? {} : { value: expression.value as JsonValue },
        ),
      ),
      output: item.output,
      relation: item.relation,
    })),
    ...(value.defaultOutput == null ? {} : { defaultOutput: value.defaultOutput }),
    input: Object.assign(
      {
        ...(value.input.description == null ? {} : { description: value.input.description }),
        handle: value.input.handle,
        jsonSchema: (value.input.jsonSchema ?? {}) as JsonValue,
        nullable: value.input.nullable ?? false,
      },
      value.input.defaultValue === undefined ? {} : { value: value.input.defaultValue as JsonValue },
    ),
  }
}

function addItems(options: readonly AddNodeOption[]): FlowDesignerViewAddItem[] {
  return options.map((option) => ({
    choices: option.choices?.map((choice) => ({
      description: choice.description,
      id: choice.option.id,
      inputs: choice.option.inputs,
      label: choice.label,
      outputs: choice.option.outputs,
    })),
    description: option.description,
    group: option.group,
    icon: option.icon,
    id: option.id,
    inputs: option.inputs,
    label: option.label,
    outputs: option.outputs,
    type: option.kind == 'new-task' || option.kind == 'subflow' ? 'block' : option.kind == 'connector-group' ? 'connector' : option.kind,
  }))
}

function focusPanel(event: PointerEvent<HTMLElement>): void {
  const element = event.target
  if (element instanceof Element && element.closest('a, button, input, label, select, textarea, [contenteditable="true"], .react-select-container')) return
  event.currentTarget.focus({ preventScroll: true })
}

export const WorkbenchDesigner = forwardRef<WorkbenchDesignerHandle, Props>(function WorkbenchDesigner(
  {
    addNodeOptions,
    blocksOpen,
    disabled,
    focusNodeRequest,
    inspectorOpen,
    model,
    onAddNode,
    onConnect,
    onChangeComment,
    onChangeCondition,
    onChangeNodeDescription,
    onChangeNodeIcon,
    onChangeNodeTitle,
    onChangeInput,
    onChangeTaskPorts,
    onChangeTriggerConfig,
    onChangeTriggerSchedule,
    onChangeWebhook,
    onChangeValue,
    onCopy,
    onDeleteEdge,
    onDeleteNodes,
    onDuplicate,
    onMoveNodes,
    onMoveViewport,
    onOpenBlocks,
    onOpenInspector,
    onPaste,
    provideAddNodeOptions,
    onSelectNodes,
    onToggleInspector,
    selectedNodeIds,
    target,
    theme,
  }: Props,
  ref,
): ReactElement {
  const language = useLang()
  const t = useTranslate()
  const [addNodeRequest, setAddNodeRequest] = useState<{ readonly position: Point }>()
  const [selectedEdge, setSelectedEdge] = useState<DesignerEdge>()
  const canvas = useRef<HTMLElement>(null)
  const dynamicOptions = useRef(new Map<string, AddNodeOption>())
  const targetGeneration = useRef(0)
  const staticOptions = useMemo(() => indexAddNodeOptions(addNodeOptions), [addNodeOptions])
  const designerAddItems = useMemo(() => {
    const items = [...addItems(addNodeOptions)]
    if (target?.kind != 'flow') return items
    const lastTrigger = items.findLastIndex((item) => item.type == 'trigger')
    const index = lastTrigger < 0 ? items.length : lastTrigger + 1
    items.splice(index, 0, {
      description: t('addNode.triggerBrowseDescription'),
      group: t('addNode.triggers'),
      icon: ':carbon:events:',
      id: browseProviderTriggersId,
      inputs: [],
      label: t('addNode.triggerBrowse'),
      outputs: [],
      type: 'trigger',
    })
    return items
  }, [addNodeOptions, t, target?.kind])
  const addingRecommended = useRef(false)
  const isValidConnection = useMemo(() => {
    const nodes = new Map(model.nodes.map((node) => [node.id, node]))
    return (edge: Omit<DesignerEdge, 'id'>): boolean => {
      const sourceNode = nodes.get(edge.source)
      const targetNode = nodes.get(edge.target)
      if (sourceNode == null || targetNode == null || sourceNode.kind == 'comment' || targetNode.kind == 'comment') return true
      const output = sourceNode.outputs.find((port) => port.handle == edge.sourceHandle)
      const input = targetNode.inputs.find((port) => port.handle == edge.targetHandle)
      if (output == null || input == null) return true
      const from = output.jsonSchema
      const to = input.jsonSchema
      if (from == null || to == null || typeof from != 'object' || Array.isArray(from) || typeof to != 'object' || Array.isArray(to)) return true
      if (Object.keys(from).length == 0 || Object.keys(to).length == 0) return true
      const result = compareJSONSchema(
        { packageId: undefined, schema: output.nullable ? { anyOf: [from, { type: 'null' }] } : from },
        { packageId: undefined, schema: input.nullable ? { anyOf: [to, { type: 'null' }] } : to },
      )
      return result.kind != 'incompatible'
    }
  }, [model.nodes])

  useEffect(() => {
    targetGeneration.current++
    setSelectedEdge(undefined)
    setAddNodeRequest(undefined)
    dynamicOptions.current.clear()
  }, [target?.kind == 'subflow' ? target.id : undefined, target?.kind])

  useImperativeHandle(
    ref,
    () => ({
      focusCanvas: () => canvas.current?.focus({ preventScroll: true }),
      registerAddNodeOption: (option) => dynamicOptions.current.set(option.id, option),
    }),
    [],
  )

  const defaultPosition = (): Point => ({
    x: (92 - model.viewport.x) / model.viewport.zoom,
    y: (92 - model.viewport.y) / model.viewport.zoom,
  })

  const openAddNode = () => setAddNodeRequest({ position: defaultPosition() })
  const recommendedOptions = ['javascript', 'llm:chat', 'trigger:webhook'].flatMap((id) => {
    const option = staticOptions.get(id)
    return option == null ? [] : [option]
  })
  const addRecommended = async (option: AddNodeOption): Promise<void> => {
    if (addingRecommended.current) return
    addingRecommended.current = true
    try {
      if ((await onAddNode(option, defaultPosition())) != null) onOpenInspector()
    } finally {
      addingRecommended.current = false
    }
  }

  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (disabled || target == null) return
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
    const modifier = event.metaKey || event.ctrlKey
    if (!modifier && event.key.toLocaleLowerCase() == 'a') {
      event.preventDefault()
      openAddNode()
    } else if (modifier && event.key.toLocaleLowerCase() == 'c' && selectedNodeIds.length > 0) {
      event.preventDefault()
      onCopy()
    } else if (modifier && event.key.toLocaleLowerCase() == 'v') {
      event.preventDefault()
      onPaste()
    } else if (modifier && event.key.toLocaleLowerCase() == 'd' && selectedNodeIds.length > 0) {
      event.preventDefault()
      onDuplicate()
    }
  }

  return (
    <section
      aria-label={t('designer.flowDesigner')}
      className="canvas-panel workbench-designer"
      onKeyDown={keyDown}
      onPointerDown={focusPanel}
      ref={canvas}
      tabIndex={0}
    >
      <FlowDesignerView
        addNodeRequest={addNodeRequest}
        addItems={designerAddItems}
        className="workbench-designer-canvas"
        dark={theme == 'dark'}
        editable={!disabled}
        focusNodeRequest={focusNodeRequest}
        identity={target == null ? 'empty' : target.kind == 'flow' ? 'flow' : `subflow:${target.id}`}
        isValidConnection={isValidConnection}
        language={language}
        model={model}
        onAddNode={async (itemId, position, connection) => {
          if (itemId == browseProviderTriggersId) {
            onOpenBlocks()
            return
          }
          const option = staticOptions.get(itemId) ?? dynamicOptions.current.get(itemId)
          return option == null ? undefined : await onAddNode(option, position, connection)
        }}
        onConnect={onConnect}
        onChangeComment={onChangeComment}
        onChangeCondition={(nodeId, value) => onChangeCondition(nodeId, conditionSettings(value))}
        onChangeNodeDescription={onChangeNodeDescription}
        onChangeNodeIcon={onChangeNodeIcon}
        onChangeNodeTitle={onChangeNodeTitle}
        onChangeInput={(nodeId, handle, value) => onChangeInput(nodeId, handle, value as JsonValue | undefined)}
        onChangeTaskPorts={onChangeTaskPorts}
        onChangeTriggerConfig={(triggerId, name, value) => onChangeTriggerConfig(triggerId, name, value as JsonValue | undefined)}
        onChangeTriggerSchedule={onChangeTriggerSchedule}
        onChangeWebhook={(triggerId, webhook: FlowDesignerViewWebhook) => onChangeWebhook(triggerId, webhook as WebhookSettings)}
        onChangeValue={onChangeValue}
        onDeleteNodes={(nodeIds) => {
          onSelectNodes(nodeIds)
          onDeleteNodes()
        }}
        onDisconnect={(edge) => onDeleteEdge(edge)}
        onDuplicate={(nodeIds, _offset, positions) => {
          onSelectNodes(nodeIds)
          onDuplicate(positions)
        }}
        onMoveNodes={onMoveNodes}
        onMoveViewport={onMoveViewport}
        onPaste={() => onPaste()}
        provideAddItems={async (searchTerm, signal) => {
          const generation = targetGeneration.current
          const options = await provideAddNodeOptions(searchTerm, signal)
          if (options == null || signal.aborted || generation != targetGeneration.current) return
          dynamicOptions.current = new Map(indexAddNodeOptions(options))
          return addItems(options)
        }}
        onSelectionChange={(nodeIds, edge: FlowDesignerViewEdge | undefined) => {
          onSelectNodes(nodeIds)
          if (nodeIds.some((nodeId) => model.nodes.some((node) => node.id == nodeId && node.kind != 'comment'))) onOpenInspector()
          setSelectedEdge((current) => (current?.id === edge?.id ? current : edge))
        }}
        selectedNodeIds={selectedNodeIds}
      />
      <Badge className="designer-overlay top-left" variant="secondary">
        <span className="status-dot neutral" />
        {t('designer.draftBadge', { kind: t(target?.kind == 'subflow' ? 'common.subflow' : 'common.flow') })}
      </Badge>
      <div className="designer-actions designer-overlay top-right">
        <Button
          aria-expanded={blocksOpen}
          disabled={disabled || target == null}
          onClick={(event) => onOpenBlocks(event.currentTarget)}
          size="default"
          title={t('designer.openBlocks')}
          type="button"
          variant="outline"
        >
          <Icon data-icon="inline-start" name="plus" /> {t('designer.addNode')}
        </Button>
        {(selectedNodeIds.length > 0 || selectedEdge != null) && (
          <Button
            disabled={disabled}
            onClick={() => {
              if (selectedNodeIds.length > 0) onDeleteNodes()
              else if (selectedEdge != null) onDeleteEdge(selectedEdge)
            }}
            size="default"
            type="button"
            variant="destructive"
          >
            {t('designer.delete')}
          </Button>
        )}
        <Button
          aria-label={t('designer.toggleInspector')}
          aria-expanded={inspectorOpen}
          onClick={(event) => onToggleInspector(event.currentTarget)}
          size="icon"
          title={t('designer.toggleInspector')}
          type="button"
          variant="outline"
        >
          <Icon name="panel" />
        </Button>
      </div>
      {target != null && model.nodes.length == 0 && (
        <div className="canvas-empty">
          <span className="empty-icon">
            <Icon name={target.kind == 'flow' ? 'flow' : 'subflow'} size={22} />
          </span>
          <strong>{t('designer.emptyTitle', { kind: t(target.kind == 'flow' ? 'common.flow' : 'common.subflow') })}</strong>
          <span className="canvas-empty-description">{t('designer.emptyDescription')}</span>
          <Button disabled={disabled} onClick={(event) => onOpenBlocks(event.currentTarget)} type="button">
            <Icon data-icon="inline-start" name="plus" /> {t('designer.addFirstNode')}
          </Button>
          {recommendedOptions.length > 0 && (
            <div className="canvas-empty-recommendations">
              {recommendedOptions.map((option) => (
                <Button disabled={disabled} key={option.id} onClick={() => void addRecommended(option)} size="sm" type="button" variant="outline">
                  {option.label}
                </Button>
              ))}
            </div>
          )}
          <span className="canvas-empty-shortcut">{t('designer.quickSearchHint')}</span>
        </div>
      )}
    </section>
  )
})
