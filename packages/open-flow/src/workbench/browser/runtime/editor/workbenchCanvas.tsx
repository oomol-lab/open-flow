import type { KeyboardEvent, PointerEvent, ReactElement, ReactNode } from 'react'
import type { FlowCanvasViewAddItem } from '../../../../canvas/browser/graph/FlowCanvas/model.ts'
import type { GraphTarget } from '../../../../flow/common/change.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { DesignerEdge, DesignerGraph, DesignerViewport, Point } from '../workspace.ts'
import type { AddNodeOption } from './addNodeOptions.ts'
import type { CanvasHistoryControlsProps } from './canvasHistoryControls.tsx'

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLang, useTranslate } from 'val-i18n-react'
import { CanvasTooltip } from '../../../../canvas/browser/components/tooltip.tsx'
import { FlowCanvasView } from '../../../../canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { Badge } from '../../../../ui/browser/badge.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Icon } from '../icons.tsx'
import { indexAddNodeOptions } from './addNodeOptions.ts'
import { CanvasHistoryControls } from './canvasHistoryControls.tsx'

interface Props {
  readonly history?: CanvasHistoryControlsProps
  readonly ignoredNodeIds: readonly string[]
  readonly onIgnoreNodes: (nodeIds: readonly string[], ignored: boolean) => void
  readonly runControl?: ReactNode
  readonly addNodeOptions: readonly AddNodeOption[]
  readonly blocksOpen: boolean
  readonly disabled: boolean
  readonly theme: WorkbenchTheme
  readonly focusNodeRequest?: {
    readonly nodeId: string
    readonly requestId: number
  }
  readonly inspectorOpen: boolean
  readonly model: DesignerGraph
  readonly onAddNode: (option: AddNodeOption, position: Point, connection?: (nodeId: string) => Omit<DesignerEdge, 'id'>) => Promise<string | undefined>
  readonly onConnect: (edge: Omit<DesignerEdge, 'id'>) => void
  readonly onChangeNodeContentHidden?: (nodeId: string, hidden: boolean) => void
  readonly onChangeComment: (nodeId: string, value: { readonly content: string; readonly title: string }) => void
  readonly onCopy: () => void
  readonly onDeleteEdge: (edge: DesignerEdge) => void
  readonly onDeleteNodes: () => void
  readonly onDuplicate: (positions?: Readonly<Record<string, Point>>, offset?: Point) => void
  readonly onMoveNodes: (positions: Readonly<Record<string, Point>>) => void
  readonly onMoveViewport: (viewport: DesignerViewport) => void
  readonly onOpenBlocks: (opener?: HTMLButtonElement) => void
  readonly onOpenInspector: () => void
  readonly onPaste: () => void
  readonly provideAddNodeOptions: (searchTerm: string, signal: AbortSignal) => Promise<readonly AddNodeOption[] | undefined>
  readonly onSelectNodes: (nodeIds: readonly string[]) => void
  readonly onToggleInspector: (opener: HTMLButtonElement) => void
  readonly selectedNodeIds: readonly string[]
  readonly target: GraphTarget | undefined
}

export interface WorkbenchCanvasHandle {
  readonly addNode: (option: AddNodeOption, canvasPosition?: Point) => Promise<string | undefined>
  readonly focusCanvas: () => void
  readonly registerAddNodeOption: (option: AddNodeOption) => void
}

const browseProviderTriggersId = 'workbench:browse-provider-triggers'
const inspectorReflowDelay = 300

function addItems(options: readonly AddNodeOption[]): FlowCanvasViewAddItem[] {
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
    type:
      option.kind == 'agent' || option.kind == 'new-task' || option.kind == 'subflow' ? 'block' : option.kind == 'connector-group' ? 'connector' : option.kind,
  }))
}

function focusPanel(event: PointerEvent<HTMLElement>): void {
  const element = event.target
  if (element instanceof Element && element.closest('a, button, input, label, select, textarea, [contenteditable="true"]')) return
  event.currentTarget.focus({ preventScroll: true })
}

export const WorkbenchCanvas = forwardRef<WorkbenchCanvasHandle, Props>(function WorkbenchCanvas(
  {
    addNodeOptions,
    history,
    blocksOpen,
    disabled,
    focusNodeRequest,
    inspectorOpen,
    model,
    onAddNode,
    onConnect,
    onChangeNodeContentHidden,
    onChangeComment,
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
    ignoredNodeIds,
    onIgnoreNodes,
    runControl,
    selectedNodeIds,
    target,
    theme,
  }: Props,
  ref,
): ReactElement {
  const language = useLang()
  const t = useTranslate()
  const [addNodeRequest, setAddNodeRequest] = useState<{
    readonly onComplete?: () => void
    readonly position: Point
    readonly screenPosition?: Point
  }>()
  const [addItemRequest, setAddItemRequest] = useState<{
    readonly itemId: string
    readonly onComplete?: (nodeId: string | undefined) => void
    readonly position: Point
    readonly screenPosition?: Point
  }>()
  const [readyFocusNodeRequest, setReadyFocusNodeRequest] = useState(focusNodeRequest)
  const canvas = useRef<HTMLElement>(null)
  const inspectorOpenedAt = useRef(0)
  const dynamicOptions = useRef(new Map<string, AddNodeOption>())
  const pendingAdd = useRef<((nodeId: string | undefined) => void) | undefined>(undefined)
  const targetGeneration = useRef(0)
  const staticOptions = useMemo(() => indexAddNodeOptions(addNodeOptions), [addNodeOptions])

  useLayoutEffect(() => {
    inspectorOpenedAt.current = inspectorOpen ? performance.now() : 0
  }, [inspectorOpen])

  useEffect(() => {
    if (focusNodeRequest == null) {
      setReadyFocusNodeRequest(undefined)
      return
    }
    const elapsed = inspectorOpenedAt.current == 0 ? 0 : performance.now() - inspectorOpenedAt.current
    const delay = Math.max(0, inspectorReflowDelay - elapsed)
    if (delay == 0) {
      setReadyFocusNodeRequest(focusNodeRequest)
      return
    }
    setReadyFocusNodeRequest(undefined)
    const timer = globalThis.setTimeout(() => setReadyFocusNodeRequest(focusNodeRequest), delay)
    return () => globalThis.clearTimeout(timer)
  }, [focusNodeRequest])

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
      const source = nodes.get(edge.source)
      const destination = nodes.get(edge.target)
      if (
        source == null ||
        destination == null ||
        source.kind == 'comment' ||
        destination.kind == 'comment' ||
        destination.kind == 'trigger' ||
        edge.source == edge.target ||
        edge.targetHandle != '$in'
      )
        return false
      return source.kind == 'condition' || source.kind == 'wait'
        ? source.outputs.some((port) => 'handle' in port && `$branch:${port.handle}` == edge.sourceHandle)
        : edge.sourceHandle == '$out'
    }
  }, [model.nodes])

  useEffect(() => {
    targetGeneration.current++
    setAddNodeRequest(undefined)
    setAddItemRequest(undefined)
    pendingAdd.current?.(undefined)
    pendingAdd.current = undefined
    dynamicOptions.current.clear()
  }, [target?.kind == 'subflow' ? target.id : undefined, target?.kind])

  const defaultPosition = (canvasPosition: Point = { x: 92, y: 92 }): Point => ({
    x: (canvasPosition.x - model.viewport.x) / model.viewport.zoom,
    y: (canvasPosition.y - model.viewport.y) / model.viewport.zoom,
  })

  const screenPosition = (canvasPosition: Point): Point | undefined => {
    const rect = canvas.current?.getBoundingClientRect()
    return rect == null ? undefined : { x: rect.left + canvasPosition.x, y: rect.top + canvasPosition.y }
  }

  const requestAddNode = (option: AddNodeOption, canvasPosition: Point = { x: 92, y: 92 }): Promise<string | undefined> => {
    pendingAdd.current?.(undefined)
    dynamicOptions.current.set(option.id, option)
    return new Promise((resolve) => {
      const complete = (nodeId: string | undefined): void => {
        if (pendingAdd.current != complete) return
        pendingAdd.current = undefined
        setAddItemRequest(undefined)
        resolve(nodeId)
      }
      pendingAdd.current = complete
      setAddItemRequest({
        itemId: option.id,
        onComplete: complete,
        position: defaultPosition(canvasPosition),
        screenPosition: screenPosition(canvasPosition),
      })
    })
  }

  useImperativeHandle(
    ref,
    () => ({
      addNode: requestAddNode,
      focusCanvas: () => canvas.current?.focus({ preventScroll: true }),
      registerAddNodeOption: (option) => dynamicOptions.current.set(option.id, option),
    }),
    [requestAddNode],
  )

  const openAddNode = () => {
    const canvasPosition = { x: 92, y: 92 }
    setAddNodeRequest({
      onComplete: () => setAddNodeRequest(undefined),
      position: defaultPosition(canvasPosition),
      screenPosition: screenPosition(canvasPosition),
    })
  }
  const manualTrigger = staticOptions.get('trigger:manual')
  const needsTrigger = target?.kind == 'flow' && !model.nodes.some((node) => node.kind == 'trigger')
  const recommendedOptions = (target?.kind == 'flow' ? ['trigger:webhook', 'trigger:cron'] : ['javascript', 'llm:chat']).flatMap((id) => {
    const option = staticOptions.get(id)
    return option == null ? [] : [option]
  })
  const addRecommended = async (option: AddNodeOption): Promise<void> => {
    if (addingRecommended.current) return
    addingRecommended.current = true
    try {
      if ((await requestAddNode(option)) != null) onOpenInspector()
    } finally {
      addingRecommended.current = false
    }
  }

  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (disabled || target == null) return
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
    if (event.target instanceof Element && event.target.closest('[contenteditable="true"], [role="dialog"], .nokey')) return
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
      aria-label={t('designer.flowCanvas')}
      className="canvas-panel workbench-canvas"
      onKeyDown={keyDown}
      onPointerDown={focusPanel}
      ref={canvas}
      tabIndex={0}
    >
      <FlowCanvasView
        ignoredNodeIds={ignoredNodeIds}
        onIgnoreNodes={onIgnoreNodes}
        addItemRequest={addItemRequest}
        addNodeRequest={addNodeRequest}
        addItems={designerAddItems}
        className="workbench-canvas-canvas"
        dark={theme == 'dark'}
        editable={!disabled}
        focusNodeRequest={readyFocusNodeRequest}
        identity={target == null ? 'empty' : target.kind == 'flow' ? 'flow' : `subflow:${target.id}`}
        isValidConnection={isValidConnection}
        language={language}
        model={model}
        cornerTools={
          <WorkbenchInspectorToggle label={t('designer.toggleInspector')} open={inspectorOpen} disabled={target == null} onToggle={onToggleInspector} />
        }
        toolbar={
          <WorkbenchCanvasActions
            history={
              history == null
                ? undefined
                : {
                    ...history,
                    onUndo: () => {
                      history.onUndo()
                      canvas.current?.focus({ preventScroll: true })
                    },
                    onRedo: () => {
                      history.onRedo()
                      canvas.current?.focus({ preventScroll: true })
                    },
                  }
            }
            blocksOpen={blocksOpen}
            disabled={disabled || target == null}
            onOpenBlocks={onOpenBlocks}
            runControl={runControl}
            onAddTrigger={needsTrigger && model.nodes.length > 0 && manualTrigger != null ? () => void addRecommended(manualTrigger) : undefined}
          />
        }
        onAddNode={async (itemId, position, connection) => {
          if (itemId == browseProviderTriggersId) {
            onOpenBlocks()
            return
          }
          const option = staticOptions.get(itemId) ?? dynamicOptions.current.get(itemId)
          if (option == null) return
          return await onAddNode(option, position, connection)
        }}
        onConnect={onConnect}
        onChangeNodeContentHidden={onChangeNodeContentHidden}
        onChangeComment={onChangeComment}
        onDeleteNodes={(nodeIds) => {
          // Move focus off the toolbar before deleting its node and unmounting the button.
          canvas.current?.focus({ preventScroll: true })
          onSelectNodes(nodeIds)
          onDeleteNodes()
        }}
        onDisconnect={(edge) => onDeleteEdge(edge)}
        onDuplicate={(nodeIds, offset, positions) => {
          // Cloning changes selection and unmounts the focused node toolbar.
          canvas.current?.focus({ preventScroll: true })
          onSelectNodes(nodeIds)
          onDuplicate(positions, offset)
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
        onSelectionChange={(nodeIds) => {
          onSelectNodes(nodeIds)
          if (nodeIds.some((nodeId) => model.nodes.some((node) => node.id == nodeId && node.kind != 'comment'))) onOpenInspector()
        }}
        selectedNodeIds={selectedNodeIds}
      />
      <Badge className="designer-overlay top-left" variant="secondary">
        <span className="status-dot neutral" />
        {t('designer.draftBadge', {
          kind: t(target?.kind == 'subflow' ? 'common.subflow' : 'common.flow'),
        })}
      </Badge>
      {target != null && model.nodes.length == 0 && (
        <div className="canvas-empty">
          <span className="empty-icon">
            <Icon name={target.kind == 'flow' ? 'flow' : 'subflow'} size={22} />
          </span>
          <strong>
            {t(target.kind == 'flow' ? 'designer.triggerTitle' : 'designer.emptyTitle', {
              kind: t(target.kind == 'flow' ? 'common.flow' : 'common.subflow'),
            })}
          </strong>
          <span className="canvas-empty-description">{t(target.kind == 'flow' ? 'designer.triggerDescription' : 'designer.emptyDescription')}</span>
          {target.kind == 'flow' ? (
            <Button disabled={disabled || manualTrigger == null} onClick={() => manualTrigger != null && void addRecommended(manualTrigger)} type="button">
              <Icon data-icon="inline-start" name="plus" /> {t('addNode.manual')}
            </Button>
          ) : (
            <Button disabled={disabled} onClick={openAddNode} type="button">
              <Icon data-icon="inline-start" name="plus" /> {t('designer.addFirstNode')}
            </Button>
          )}
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

export function WorkbenchCanvasActions({
  history,
  blocksOpen,
  disabled,
  onOpenBlocks,
  runControl,
  onAddTrigger,
}: {
  readonly history?: CanvasHistoryControlsProps
  readonly blocksOpen: boolean
  readonly disabled: boolean
  readonly onOpenBlocks: (opener: HTMLButtonElement) => void
  readonly runControl?: ReactNode
  readonly onAddTrigger?: () => void
}): ReactElement {
  const t = useTranslate()
  return (
    <div className="designer-actions">
      {history != null && <CanvasHistoryControls {...history} disabled={disabled} />}
      <CanvasTooltip placement="top" title={t('designer.openBlocks')}>
        <Button
          aria-expanded={blocksOpen}
          className="pr-3 text-[13px]"
          disabled={disabled}
          onClick={(event) => onOpenBlocks(event.currentTarget)}
          size="default"
          type="button"
          variant="ghost"
        >
          <Icon data-icon="inline-start" name="plus" /> {t('designer.addNode')}
        </Button>
      </CanvasTooltip>
      {runControl}
      {onAddTrigger != null && (
        <CanvasTooltip placement="top" title={t('designer.triggerDescription')}>
          <Button className="text-[13px]" size="default" disabled={disabled} onClick={onAddTrigger} type="button" variant="default">
            <Icon data-icon="inline-start" name="plus" /> {t('designer.addTriggerToRun')}
          </Button>
        </CanvasTooltip>
      )}
    </div>
  )
}

export function WorkbenchInspectorToggle({
  label,
  open,
  disabled = false,
  onToggle,
}: {
  readonly label: string
  readonly open: boolean
  readonly disabled?: boolean
  readonly onToggle: (opener: HTMLButtonElement) => void
}) {
  return (
    <CanvasTooltip placement="bottom" title={label}>
      <Button
        aria-label={label}
        aria-expanded={open}
        disabled={disabled}
        onClick={(event) => onToggle(event.currentTarget)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <i aria-hidden="true" className={open ? 'i-lucide-light:panel-right-close' : 'i-lucide-light:panel-right-open'} data-corner-icon />
      </Button>
    </CanvasTooltip>
  )
}
