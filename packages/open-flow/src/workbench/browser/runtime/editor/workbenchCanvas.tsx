import type { KeyboardEvent, PointerEvent, ReactElement, ReactNode } from 'react'
import type { FlowCanvasViewProps } from '../../../../canvas/browser/graph/FlowCanvas/model.ts'
import type { GraphTarget } from '../../../../flow/common/change.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { ResourceSource } from '../stores/resource.ts'
import type { DesignerEdge, DesignerGraph, DesignerViewport, Point } from '../workspace.ts'
import type { AddNodeOption } from './addNodeOptions.ts'
import type { CanvasHistoryControlsProps } from './canvasHistoryControls.tsx'
import type { BlockLibraryProps } from './contextPanel.tsx'

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLang, useTranslate } from 'val-i18n-react'
import { CanvasTooltip } from '../../../../canvas/browser/components/tooltip.tsx'
import { FlowCanvasView } from '../../../../canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { Badge } from '../../../../ui/browser/badge.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Icon } from '../icons.tsx'
import { indexAddNodeOptions } from './addNodeOptions.ts'
import { CanvasHistoryControls } from './canvasHistoryControls.tsx'
import { CanvasNodePicker } from './nodePickerPopover.tsx'

interface Props {
  readonly nodePicker?: Pick<BlockLibraryProps, 'connections' | 'loadConnections' | 'browseOptions' | 'provideChoices' | 'catalogFailed' | 'refreshCatalog'>
  readonly addNodeControl?: ReactNode
  readonly history?: CanvasHistoryControlsProps
  readonly ignoredNodeIds: readonly string[]
  readonly onIgnoreNodes: (nodeIds: readonly string[], ignored: boolean) => void
  readonly runControl?: ReactNode
  readonly addNodeOptions: readonly AddNodeOption[]
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
  readonly onOpenInspector: () => void
  readonly onPaste: () => void
  readonly provideAddNodeOptions: (searchTerm: string, signal: AbortSignal) => ResourceSource<readonly AddNodeOption[]>
  readonly onActivateSelection?: FlowCanvasViewProps['onActivateSelection']
  readonly onSelectionStart?: FlowCanvasViewProps['onSelectionStart']
  readonly onSelectionEnd?: FlowCanvasViewProps['onSelectionEnd']
  readonly onSelectNodes: (nodeIds: readonly string[]) => void
  readonly onToggleInspector: (opener: HTMLButtonElement) => void
  readonly selectedNodeIds: readonly string[]
  readonly target: GraphTarget | undefined
}

export interface WorkbenchCanvasHandle {
  readonly addNode: (option: AddNodeOption, canvasPosition?: Point) => Promise<string | undefined>
  readonly focusCanvas: () => void
}

const inspectorReflowDelay = 300

function focusPanel(event: PointerEvent<HTMLElement>): void {
  const element = event.target
  if (element instanceof Element && element.closest('a, button, input, label, select, textarea, [contenteditable="true"]')) return
  event.currentTarget.focus({ preventScroll: true })
}

export const WorkbenchCanvas = forwardRef<WorkbenchCanvasHandle, Props>(function WorkbenchCanvas(
  {
    nodePicker,
    addNodeControl,
    addNodeOptions,
    history,
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
    onOpenInspector,
    onPaste,
    provideAddNodeOptions,
    onSelectNodes,
    onActivateSelection,
    onSelectionStart,
    onSelectionEnd,
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
  const [pickerRequest, setPickerRequest] = useState<Parameters<NonNullable<FlowCanvasViewProps['onRequestAddNode']>>[0]>()
  const [pickerCentered, setPickerCentered] = useState(false)
  useEffect(() => {
    if (disabled) {
      setPickerRequest(undefined)
      setPickerCentered(false)
    }
  }, [disabled])
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
    setPickerRequest(undefined)
    setPickerCentered(false)
    setAddNodeRequest(undefined)
    setAddItemRequest(undefined)
    pendingAdd.current?.(undefined)
    pendingAdd.current = undefined
    dynamicOptions.current.clear()
  }, [target?.kind == 'subflow' ? target.id : undefined, target?.kind])

  const canvasCenter = (): Point => ({
    x: (canvas.current?.clientWidth ?? 184) / 2,
    y: (canvas.current?.clientHeight ?? 184) / 2,
  })

  const defaultPosition = (canvasPosition: Point = canvasCenter()): Point => ({
    x: (canvasPosition.x - model.viewport.x) / model.viewport.zoom,
    y: (canvasPosition.y - model.viewport.y) / model.viewport.zoom,
  })

  const screenPosition = (canvasPosition: Point): Point | undefined => {
    const rect = canvas.current?.getBoundingClientRect()
    return rect == null ? undefined : { x: rect.left + canvasPosition.x, y: rect.top + canvasPosition.y }
  }

  const requestAddNode = (option: AddNodeOption, canvasPosition: Point = canvasCenter()): Promise<string | undefined> => {
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
    }),
    [requestAddNode],
  )

  const openAddNode = () => {
    const canvasPosition = canvasCenter()
    setPickerCentered(true)
    setAddNodeRequest({
      onComplete: () => setAddNodeRequest(undefined),
      position: defaultPosition(canvasPosition),
      screenPosition: screenPosition(canvasPosition),
    })
  }
  const manualTrigger = staticOptions.get('trigger:manual')
  const needsTrigger = target?.kind == 'flow' && !model.nodes.some((node) => node.kind == 'trigger')
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
        onRequestAddNode={(request) => {
          if (addNodeRequest == null) setPickerCentered(false)
          setPickerRequest(request)
        }}
        ignoredNodeIds={ignoredNodeIds}
        onIgnoreNodes={onIgnoreNodes}
        addItemRequest={addItemRequest}
        addNodeRequest={addNodeRequest}
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
            addNodeControl={addNodeControl}
            pickerOpen={pickerRequest != null}
            disabled={disabled || target == null}
            onOpenNodePicker={openAddNode}
            runControl={runControl}
            onAddTrigger={needsTrigger && model.nodes.length > 0 && manualTrigger != null ? () => void addRecommended(manualTrigger) : undefined}
          />
        }
        onAddNode={async (itemId, position, connection) => {
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
        onCopy={(nodeIds) => {
          onSelectNodes(nodeIds)
          onCopy()
        }}
        onPaste={() => onPaste()}
        onSelectionChange={onSelectNodes}
        onActivateSelection={onActivateSelection}
        onSelectionStart={onSelectionStart}
        onSelectionEnd={onSelectionEnd}
        onInspectSelection={
          inspectorOpen
            ? undefined
            : () => {
                canvas.current?.focus({ preventScroll: true })
                onOpenInspector()
              }
        }
        selectedNodeIds={selectedNodeIds}
      />
      {pickerRequest && !disabled && (
        <CanvasNodePicker
          key={`${pickerRequest.screenPosition.x}:${pickerRequest.screenPosition.y}`}
          options={addNodeOptions}
          connections={nodePicker?.connections}
          loadConnections={nodePicker?.loadConnections}
          browseOptions={nodePicker?.browseOptions ?? (async () => [])}
          searchOptions={provideAddNodeOptions}
          provideChoices={nodePicker?.provideChoices ?? (async () => [])}
          catalogFailed={nodePicker?.catalogFailed}
          refreshCatalog={nodePicker?.refreshCatalog}
          disabled={disabled}
          focusRequest={0}
          request={pickerRequest}
          centered={pickerCentered}
          onClose={() => {
            setPickerRequest(undefined)
            setPickerCentered(false)
            canvas.current?.focus({ preventScroll: true })
          }}
          onAdd={(option) => onAddNode(option, pickerRequest.position, pickerRequest.connection)}
        />
      )}
      <Badge className="designer-overlay top-left" variant="secondary">
        <span className="status-dot neutral" />
        {t('designer.draftBadge', {
          kind: t(target?.kind == 'subflow' ? 'common.subflow' : 'common.flow'),
        })}
      </Badge>
      {target != null && model.nodes.length == 0 && (
        <div className="canvas-empty">
          <Button className="canvas-empty-add" disabled={disabled} onClick={openAddNode} type="button" variant="outline">
            <span className="canvas-empty-add-icon">
              <Icon name="plus" />
            </span>
            <span>{t('designer.addNode')}</span>
          </Button>
          <span className="canvas-empty-shortcut">{t('designer.quickAddHint')}</span>
        </div>
      )}
    </section>
  )
})

export function WorkbenchCanvasActions({
  addNodeControl,
  history,
  pickerOpen,
  disabled,
  onOpenNodePicker,
  runControl,
  onAddTrigger,
}: {
  readonly addNodeControl?: ReactNode
  readonly history?: CanvasHistoryControlsProps
  readonly pickerOpen: boolean
  readonly disabled: boolean
  readonly onOpenNodePicker: (opener: HTMLButtonElement) => void
  readonly runControl?: ReactNode
  readonly onAddTrigger?: () => void
}): ReactElement {
  const t = useTranslate()
  return (
    <div className="designer-actions">
      {history != null && <CanvasHistoryControls {...history} disabled={disabled} />}
      {addNodeControl ?? (
        <CanvasTooltip placement="top" title={t('designer.openBlocks')}>
          <Button
            aria-expanded={pickerOpen}
            className="pr-3 text-[13px]"
            disabled={disabled}
            onClick={(event) => onOpenNodePicker(event.currentTarget)}
            size="default"
            type="button"
            variant="ghost"
          >
            <Icon data-icon="inline-start" name="plus" /> {t('designer.addNode')}
          </Button>
        </CanvasTooltip>
      )}
      {runControl}
      {onAddTrigger != null && (
        <CanvasTooltip placement="top" title={t('designer.addTriggerToRun')}>
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
