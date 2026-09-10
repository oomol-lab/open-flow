import styles from './NodeHead.module.scss'
import type { TFunction } from 'val-i18n'
import type { ReadonlyVal } from 'value-enhancer'
import type { CanvasStore } from '../../../stores/canvas/canvas.store.ts'
import type { FlowRunStatus } from '../../../stores/canvas/typings.ts'

import { NodeToolbar, useViewport } from '@xyflow/react'
import { memo } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { NodeActions } from '../../../../../canvas/browser/nodeActions.tsx'
import { Button } from '../../../../../ui/browser/button.tsx'
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger } from '../../../../../ui/browser/context-menu.tsx'
import { coalesce, toTrue } from '../../../base/trivial.ts'
import { CanvasTooltip } from '../../../components/tooltip.tsx'
import { CommentNodeStore } from '../../../stores/node/commentNode.store.ts'
import { NODE_STATUS } from '../../../stores/node/constants.ts'
import { NodeStore } from '../../../stores/node/node.store.ts'
import { useCanvasStore } from '../../CanvasStoreContext.tsx'
import { useGetStaticPopupContainer } from '../../ReactFlowContainer/useGetPopupContainer.ts'
import { useNodeStore } from '../NodeStoreContext.tsx'
import { NodeStatusContent, NodeStatusIcon } from './NodeStatusLabel.tsx'
import { useNodeStatus } from './useNodeStatus.ts'

export function NodeHeadMoreMenu(): React.ReactElement {
  const canvasStore = useCanvasStore()
  return <InFlowCanvas canvasStore={canvasStore} />
}

interface SharedProps {
  readonly canvasStore: CanvasStore
}

export interface NodeFloatBarProps {
  readonly canvasStore: CanvasStore
  readonly nodeStore: NodeStore | CommentNodeStore
}

function InFlowCanvas({ canvasStore }: SharedProps) {
  const container = useGetStaticPopupContainer()
  const nodeStore = useNodeStore()
  const editable = useVal(canvasStore.$.editable)
  const semantic = NodeStore.to(nodeStore)
  const ignored = useVal(semantic?.ignore)
  return (
    <NodeActions
      className={styles.action}
      contentClassName={styles.menu}
      container={container()}
      align="start"
      ignored={ignored ?? false}
      onIgnore={semantic?.setIgnored}
      onDuplicate={nodeStore.duplicateNode}
      onDelete={editable ? () => canvasStore.deleteNodes([nodeStore]) : undefined}
    />
  )
}

export interface NodeHeadContextMenuProps {
  readonly canvasStore: CanvasStore
  readonly children?: React.ReactNode
}

export function NodeHeadContextMenu({ canvasStore, children }: NodeHeadContextMenuProps): React.ReactElement {
  const t = useTranslate()
  const getStaticDesignerContainer = useGetStaticPopupContainer()
  const getPopupContainer = getStaticDesignerContainer
  const nodeStore = useNodeStore()
  const editable = useVal(canvasStore.$.editable)

  const onDelete = toTrue(editable && canvasStore.canDeleteNodes) && (() => canvasStore.deleteNodes([nodeStore]))
  const items = useNodeMenuItems({
    t,
    nodeStore,
    onDelete,
  })

  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex-1">{children}</ContextMenuTrigger>
      <ContextMenuContent align="start" className={styles.menu} container={getPopupContainer()}>
        <ContextMenuGroup>
          {items.map(
            (item) =>
              item && (
                <ContextMenuItem key={item.key} disabled={item.disabled} onClick={item.onClick} variant={item.danger ? 'destructive' : 'default'}>
                  {item.icon}
                  {item.label}
                </ContextMenuItem>
              ),
          )}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface Params {
  readonly t: TFunction
  readonly nodeStore: NodeStore | CommentNodeStore
  readonly onDelete?: () => void
}

interface ContextMenuActionItem {
  readonly danger?: boolean
  readonly disabled?: boolean
  readonly icon?: React.ReactNode
  readonly key: string
  readonly label: string
  readonly onClick?: () => void
}

type ContextMenuItem = ContextMenuActionItem | false | undefined

function useNodeMenuItems({ t, nodeStore, onDelete }: Params): ContextMenuItem[] {
  const skip = useVal(NodeStore.to(nodeStore)?.ignore)
  const { duplicateNode } = nodeStore

  return coalesce<ContextMenuItem>([
    duplicateNode && {
      label: t('nodeActions.duplicate'),
      key: '$duplicate',
      icon: <i className="i-codicon:copy" />,
      onClick: () => duplicateNode(),
    },
    toTrue(NodeStore.is(nodeStore)) && {
      label: skip ? t('nodeActions.skipDisable') : t('nodeActions.skipEnable'),
      key: '$skip',
      icon: <i className={skip ? 'i-carbon:view-off' : 'i-carbon:view'} />,
      onClick: () => NodeStore.to(nodeStore)?.setIgnored(!skip),
    },
    onDelete && {
      label: t('nodeActions.delete'),
      key: '$delete',
      icon: <i className="i-codicon:trash" />,
      danger: true,
      onClick: onDelete,
    },
  ])
}

export const NodeFloatBar: React.FC<NodeFloatBarProps> = /* @__PURE__ */ memo(function NodeFloatBar({ canvasStore, nodeStore }) {
  const t = useTranslate()
  const { zoom } = useViewport()
  const getPopupContainer = useGetStaticPopupContainer()

  const editable = useVal(canvasStore.$.editable)
  const items = useNodeMenuItems({
    t,
    nodeStore,
    onDelete: editable && canvasStore.canDeleteNodes ? () => canvasStore.deleteNodes([nodeStore]) : undefined,
  })
  const floatBarItems = items.filter((item): item is ContextMenuActionItem => !!item)

  return (
    <NodeToolbar className={styles.floatBar} offset={12 - 8 * zoom}>
      {NodeStore.is(nodeStore) && <NodeStatus flowStatus$={canvasStore.$.runStatus} nodeStore={nodeStore} />}
      {floatBarItems.map((item) => {
        return (
          <CanvasTooltip
            getPopupContainer={getPopupContainer}
            key={item.key}
            placement="top"
            title={item.danger ? `${item.label} (Backspace / Delete)` : item.label}
          >
            <Button
              aria-label={item.label}
              className={styles.floatBarButton}
              data-danger={item.danger || undefined}
              disabled={item.disabled}
              onClick={item.onClick}
              size="icon"
              variant="ghost"
            >
              {item.icon}
            </Button>
          </CanvasTooltip>
        )
      })}
    </NodeToolbar>
  )
})

interface NodeStatusProps {
  flowStatus$: ReadonlyVal<FlowRunStatus>
  nodeStore: NodeStore
}

function NodeStatus({ flowStatus$, nodeStore }: NodeStatusProps): React.ReactNode {
  const skip = useVal(nodeStore.ignore, true)
  const content = useVal(nodeStore.content$)
  const progress = content.run?.progress
  const { status, count } = useNodeStatus(content.run?.status ?? NODE_STATUS.Idle, flowStatus$, content.run?.successCount)
  const getPopupContainer = useGetStaticPopupContainer()

  if (skip) return

  switch (status) {
    case NODE_STATUS.Success:
    case NODE_STATUS.Error:
    case NODE_STATUS.Running:
    case NODE_STATUS.Waiting:
      return (
        <CanvasTooltip
          className={styles.statusTooltip}
          placement="top"
          getPopupContainer={getPopupContainer}
          title={<NodeStatusContent status={status} progress={progress} combo={count} />}
        >
          <span className={styles.floatBarStatus}>
            <NodeStatusIcon status={status} progress={progress} loaderSize={18} />
          </span>
        </CanvasTooltip>
      )
  }
}
